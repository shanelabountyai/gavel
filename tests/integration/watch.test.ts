// D-92 (AX-23): watched lots get one closing-soon notice per (lot, bidder, closesAt), written by the cron. Clock injected.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openState } from '@/auction/engine/engine';
import { placeBid } from '@/auction/place-bid';
import { CLOSING_SOON_LEAD_MS, notifyClosingSoon, setWatch } from '@/auction/watch';
import { db } from '@/core/db';
import { templates } from '@/modules/notifications/templates';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
const END = T0 + 3_600_000;

beforeEach(async () => {
  await resetAuthTables();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function house(slug = 'house') {
  const org = await makeOrg(slug);
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'A', softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1500, opensAt: new Date(T0) } });
  const bidder = async (paddle: number, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') => {
    const user = await db.user.create({ data: { email: `${slug}${paddle}@example.com` } });
    return (await db.bidder.create({ data: { orgId: org.id, userId: user.id, paddle, status } })).id;
  };
  const lot = async (number: number, end = END) => {
    const s = openState({ startCents: 1000, reserveCents: null, opensAtMs: T0, scheduledEndMs: end, softCloseWindowMs: 120_000, maxExtensionMs: 1_800_000, buyerPremiumBps: 1500 });
    return db.lot.create({
      data: {
        orgId: org.id, auctionId: auction.id, number, title: `Lot ${number}`, startCents: 1000, scheduledEnd: new Date(end),
        state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: s.bidCount, acceptedCount: s.acceptedCount, closesAt: new Date(s.closesAtMs), extensionCount: s.extensionCount } },
      },
    });
  };
  return { org, bidder, lot, watch: (b: string, l: string, on = true) => setWatch(org.id, b, l, on) };
}
const notices = () => db.outbox.findMany({ where: { template: 'closing_soon' }, orderBy: { sendAfter: 'asc' } });

describe('watchlist and closing-soon notices (D-92)', () => {
  it('one notice per watcher per close: none twice, a soft-close extension is a new close, unwatched and suspended get none', async () => {
    const h = await house();
    const [ada, ben, cy, sus] = [await h.bidder(1), await h.bidder(2), await h.bidder(3), await h.bidder(4, 'SUSPENDED')];
    const lot = await h.lot(1);
    await h.watch(ada, lot.id);
    await h.watch(ada, lot.id); // idempotent
    await h.watch(ben, lot.id);
    await h.watch(ben, lot.id, false); // unwatched
    await h.watch(sus, lot.id);

    expect(await notifyClosingSoon(new Date(T0))).toBe(1);
    expect(await notifyClosingSoon(new Date(T0 + 60_000))).toBe(0); // same close: deduplicated
    const [first] = await notices();
    expect(first!.to).toBe('house1@example.com');
    expect(templates.closing_soon!(first!.data as Record<string, unknown>).body).toBe(`Lot 1, on your watchlist, closes at ${new Date(END).toISOString()}. No bids yet.`);

    // cy bids inside the soft-close window: the close moves, so ada is told again, with the price
    await placeBid({ orgId: h.org.id, lotId: lot.id, bidderId: cy, maxCents: 5000, idempotencyKey: 'k1' }, { now: () => new Date(END - 30_000) });
    const closesAt = (await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } })).closesAt;
    expect(closesAt.getTime()).toBeGreaterThan(END);
    expect(await notifyClosingSoon(new Date(END - 20_000))).toBe(1);
    const second = (await notices())[1]!;
    expect(templates.closing_soon!(second.data as Record<string, unknown>).body).toBe(`Lot 1, on your watchlist, closes at ${closesAt.toISOString()}. The price is now $10.00.`);
    expect(await notifyClosingSoon(new Date(closesAt.getTime() + 1))).toBe(0); // closed: nothing
  });

  it('a lot closing after the lead, or not yet open, writes nothing until it is inside the window', async () => {
    const h = await house();
    const ada = await h.bidder(1);
    const far = await h.lot(1, T0 + CLOSING_SOON_LEAD_MS + 3_600_000);
    await h.watch(ada, far.id);
    expect(await notifyClosingSoon(new Date(T0 - 1))).toBe(0); // the sale has not opened
    expect(await notifyClosingSoon(new Date(T0))).toBe(0); // closes 25 h out
    expect(await notifyClosingSoon(new Date(T0 + 3_600_000))).toBe(1); // exactly 24 h out
  });

  it('the trigger refuses a watch that names another house\'s lot (INV-02)', async () => {
    const a = await house('a');
    const b = await house('b');
    const ada = await a.bidder(1);
    const theirs = await b.lot(1);
    await expect(db.watch.create({ data: { orgId: a.org.id, bidderId: ada, lotId: theirs.id } })).rejects.toThrow(/Watch_same_house|own house/);
  });
});
