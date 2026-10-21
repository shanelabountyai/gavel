// Task 3.6 acceptance (D-53): N bids produce exactly the outbid notices their rows imply; a rolled-back bid leaves
// no outbox row; settlement writes one won notice, once; nothing is sent (the transport captures). Clock injected.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openState } from '@/auction/engine/engine';
import { formatCents } from '@/auction/engine/money';
import { closeLots } from '@/auction/close';
import { placeBid, prismaTx, type Runner } from '@/auction/place-bid';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { drainOutbox } from '@/modules/notifications/outbox';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
const END = T0 + 3_600_000;
const q = prismaTx(db as unknown as Prisma.TransactionClient);

beforeEach(async () => {
  await resetAuthTables();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function house() {
  const org = await makeOrg('house');
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'A', softCloseWindowSeconds: 0, maxExtensionSeconds: 0, buyerPremiumBps: 1500, opensAt: new Date(T0) } });
  const bidder = async (paddle: number) => {
    const user = await db.user.create({ data: { email: `b${paddle}@example.com` } });
    return (await db.bidder.create({ data: { orgId: org.id, userId: user.id, paddle } })).id;
  };
  const lot = async (number: number, reserveCents: number | null = null) => {
    const s = openState({ startCents: 1000, reserveCents, opensAtMs: T0, scheduledEndMs: END, softCloseWindowMs: 0, maxExtensionMs: 0, buyerPremiumBps: 1500 });
    return db.lot.create({
      data: {
        orgId: org.id, auctionId: auction.id, number, title: `Lot ${number}`, startCents: 1000, reserveCents, scheduledEnd: new Date(END),
        state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: s.bidCount, acceptedCount: s.acceptedCount, closesAt: new Date(s.closesAtMs), extensionCount: s.extensionCount } },
      },
    });
  };
  let k = 0;
  const bid = (lotId: string, bidderId: string, maxCents: number, run?: Runner) =>
    placeBid({ orgId: org.id, lotId, bidderId, maxCents, idempotencyKey: `k${++k}` }, { now: () => new Date(T0 + 60_000), ...(run ? { run } : {}) });
  return { org, bidder, lot, bid };
}

describe('outbid and won notices through the outbox (task 3.6)', () => {
  it('N bids write exactly the outbid notices their rows imply, to the displaced leader, and the drain only captures', async () => {
    const h = await house();
    const [b1, b2, b3] = await Promise.all([h.bidder(1), h.bidder(2), h.bidder(3)]);
    const lot = await h.lot(1);
    await h.bid(lot.id, b1, 1000); // first leader: nobody to tell
    await h.bid(lot.id, b2, 2000); // b1 displaced
    await h.bid(lot.id, b1, 1500); // under b2's max: leader unchanged
    await h.bid(lot.id, b3, 5000); // b2 displaced
    await h.bid(lot.id, b3, 8000); // own raise: leader unchanged

    const rows = await db.bid.findMany({ where: { lotId: lot.id }, orderBy: { seq: 'asc' } });
    const implied = rows.filter((r) => r.leaderBeforeId !== null && r.leaderBeforeId !== r.leaderAfterId);
    expect(implied.map((r) => r.seq)).toEqual([2, 4]);
    const notices = await db.outbox.findMany({ orderBy: { sendAfter: 'asc' } });
    expect(notices.map((n) => [n.template, n.to, n.data])).toEqual(
      implied.map((r) => ['outbid', r.leaderBeforeId === b1 ? 'b1@example.com' : 'b2@example.com', { lot: 'Lot 1', price: formatCents(r.priceAfterCents), closesAt: r.closesAtAfter.toISOString() }]),
    );

    expect(await drainOutbox()).toEqual({ sent: 2, failed: 0 });
    const captured = await db.capturedMessage.findMany({ orderBy: { to: 'asc' } });
    expect(captured.map((m) => m.to)).toEqual(['b1@example.com', 'b2@example.com']);
    expect(captured[0]!.subject).toBe('Outbid on Lot 1');
    expect(captured[0]!.body).toContain(formatCents(rows[1]!.priceAfterCents));
  });

  it('a rolled-back bid leaves no outbox row', async () => {
    const h = await house();
    const [b1, b2] = await Promise.all([h.bidder(1), h.bidder(2)]);
    const lot = await h.lot(1);
    await h.bid(lot.id, b1, 1000);
    const rollback: Runner = (body) => db.$transaction(async (tx) => { await body(prismaTx(tx)); throw new Error('rolled back after the ledger row'); });
    await expect(h.bid(lot.id, b2, 2000, rollback)).rejects.toThrow('rolled back');
    expect(await db.bid.count()).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('settlement writes one won notice to the winner, once; an unsold lot writes none', async () => {
    const h = await house();
    const [b1, b2] = await Promise.all([h.bidder(1), h.bidder(2)]);
    const sold = await h.lot(1);
    const reserved = await h.lot(2, 100_000);
    await h.bid(sold.id, b1, 1000);
    await h.bid(sold.id, b2, 3000);
    await h.bid(reserved.id, b1, 2000);
    await db.outbox.deleteMany({ where: { template: 'outbid' } });

    expect(await closeLots(new Date(END + 1), q)).toEqual({ considered: 2, settled: 2 });
    const st = await db.settlement.findFirstOrThrow({ where: { lotId: sold.id } });
    expect(st.outcome).toBe('SOLD');
    expect((await db.settlement.findFirstOrThrow({ where: { lotId: reserved.id } })).outcome).toBe('UNSOLD_RESERVE_NOT_MET');
    const won = await db.outbox.findMany();
    expect(won.map((n) => [n.template, n.to, n.data])).toEqual([
      ['won', 'b2@example.com', { lot: 'Lot 1', hammer: formatCents(st.hammerCents), total: formatCents(st.totalCents), closedAt: st.closedAt.toISOString() }],
    ]);

    expect(await closeLots(new Date(END + 1), q)).toEqual({ considered: 0, settled: 0 });
    expect(await db.outbox.count()).toBe(1);
  });
});
