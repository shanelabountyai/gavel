// D-96 (AX-19, R-19): staff void of one bidder's live bids, under the lot's one lock, as a VOIDED ledger row. The
// projection is the fold, the verifier passes, a resend replays, refusals write nothing, the CHECKs hold the shape,
// and the bidder-facing readers move to live rows. Clock injected throughout.
import { beforeEach, describe, expect, it } from 'vitest';
import { setBidderStatus } from '@/auction/bidder';
import { openState } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';
import { myBids, ownMaxCents, publicHistory } from '@/auction/lot-view';
import { placeBid, prismaTx } from '@/auction/place-bid';
import { verifyLot } from '@/auction/verify-sql';
import { VoidRefused, voidBidder } from '@/auction/void-bid';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import type { Prisma } from '@/generated/prisma/client';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const { rules } = loadRules();
const T0 = Date.UTC(2026, 0, 1, 12);
const END = T0 + 3_600_000;
const at = (ms: number) => ({ now: () => new Date(ms) });
const q = () => prismaTx(db as unknown as Prisma.TransactionClient);

async function house(slug = 'acme') {
  const org = await makeOrg(slug);
  const staff = crypto.randomUUID();
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'Spring estate', softCloseWindowSeconds: 120, maxExtensionSeconds: 600, buyerPremiumBps: 1500, opensAt: new Date(T0) } });
  const s = openState({ startCents: 10000, reserveCents: null, opensAtMs: T0, scheduledEndMs: END, softCloseWindowMs: 120_000, maxExtensionMs: 600_000, buyerPremiumBps: 1500 });
  const lot = await db.lot.create({ data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'Walnut dresser', startCents: 10000, scheduledEnd: new Date(END),
    state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: null, leaderMaxCents: 0, leaderSeq: null, bidCount: 0, acceptedCount: 0, closesAt: new Date(END), extensionCount: 0 } } } });
  const bidder = async (paddle: number) => {
    const u = await db.user.create({ data: { email: `${slug}${paddle}@example.test` } });
    return (await db.bidder.create({ data: { orgId: org.id, userId: u.id, paddle } })).id;
  };
  const bid = (bidderId: string, maxCents: number, ms: number) => placeBid({ orgId: org.id, lotId: lot.id, bidderId, maxCents, idempotencyKey: `${bidderId}${maxCents}` }, { ...at(ms), rules });
  const voidOf = (bidderId: string, ms: number, key = `void-${ms}`, reason = 'typed 20,000 meaning 2,000') =>
    voidBidder({ orgId: org.id, lotId: lot.id, bidderId, reason, userId: staff, idempotencyKey: key }, { ...at(ms), rules });
  return { org, staff, lot, bidder, bid, voidOf };
}

describe('voidBidder (D-96)', () => {
  it('voids the leader under the lock: one VOIDED row, the projection is the fold, V1–V9 pass, audited', async () => {
    const h = await house();
    const [a, b, c] = [await h.bidder(101), await h.bidder(102), await h.bidder(103)];
    await h.bid(a, 15000, T0 + 100_000);
    await h.bid(b, 12000, T0 + 200_000);
    await h.bid(c, 20000, T0 + 300_000); // GB-03: C leads at 15,500
    const r = await h.voidOf(c, T0 + 400_000);
    expect(r).toMatchObject({ seq: 4, replayed: false, priceCents: 12500, leader: a, leaderBefore: c });
    const row = await db.bid.findUniqueOrThrow({ where: { lotId_seq: { lotId: h.lot.id, seq: 4 } } });
    expect([row.outcome, row.accepted, row.maxCents, row.bidderId, row.priceBeforeCents, row.priceAfterCents, row.voidReason, row.voidByUserId, row.placedAt.getTime()])
      .toEqual(['VOIDED', false, 0, c, 15500, 12500, 'typed 20,000 meaning 2,000', h.staff, T0 + 400_000]);
    const st = await db.lotState.findUniqueOrThrow({ where: { lotId: h.lot.id } });
    expect([st.priceCents, st.leaderBidderId, st.leaderSeq, st.bidCount, st.acceptedCount, st.closesAt.getTime()]).toEqual([12500, a, 1, 4, 3, END]);
    expect(await verifyLot(q(), h.lot.id, rules)).toBeNull();
    expect((await db.auditEvent.findMany({ where: { targetId: h.lot.id } })).map((e) => [e.action, e.actorUserId])).toEqual([['bid.voided', h.staff]]);
  });

  it('a resend with the same key replays; a bid key reused for a void is refused', async () => {
    const h = await house();
    const a = await h.bidder(101);
    await h.bid(a, 15000, T0 + 100_000);
    await h.voidOf(a, T0 + 200_000, 'k1');
    expect(await h.voidOf(a, T0 + 300_000, 'k1')).toMatchObject({ seq: 2, replayed: true });
    expect(await db.bid.count({ where: { lotId: h.lot.id } })).toBe(2);
    await h.bid(a, 16000, T0 + 400_000);
    await expect(h.voidOf(a, T0 + 500_000, `${a}16000`)).rejects.toThrow(/already used for a bid/);
  });

  it('refuses, writing nothing: no live bids, after the close, a blank reason, another house’s bidder', async () => {
    const h = await house();
    const [a, b] = [await h.bidder(101), await h.bidder(102)];
    await h.bid(a, 15000, T0 + 100_000);
    await expect(h.voidOf(b, T0 + 200_000)).rejects.toSatisfy((e) => e instanceof VoidRefused && e.code === 'VOID_NO_LIVE_BIDS');
    await expect(h.voidOf(a, END)).rejects.toSatisfy((e) => e instanceof VoidRefused && e.code === 'VOID_LOT_NOT_OPEN');
    await expect(h.voidOf(a, T0 + 300_000, 'k', '   ')).rejects.toThrow(Refused);
    const other = await house('other');
    const stranger = await other.bidder(201);
    await expect(h.voidOf(stranger, T0 + 300_000)).rejects.toThrow(/No such bidder/);
    expect(await db.bid.count({ where: { lotId: h.lot.id } })).toBe(1);
  });

  it('voids a suspended leader’s standing maximum (amends D-70 c)', async () => {
    const h = await house();
    const [a, b] = [await h.bidder(101), await h.bidder(102)];
    await h.bid(a, 15000, T0 + 100_000);
    await h.bid(b, 30000, T0 + 200_000);
    await setBidderStatus({ orgId: h.org.id, userId: h.staff }, b, 'SUSPENDED', 'non-payment last sale');
    expect(await h.voidOf(b, T0 + 300_000)).toMatchObject({ leader: a, priceCents: 10000 });
  });

  it('the bidder-facing readers count live rows only; the public history shows the void as a line', async () => {
    const h = await house();
    const [a, b] = [await h.bidder(101), await h.bidder(102)];
    await h.bid(a, 15000, T0 + 100_000);
    await h.bid(b, 20000, T0 + 200_000);
    await h.voidOf(b, T0 + 300_000);
    expect(await ownMaxCents(h.lot.id, b)).toBeNull();
    expect(await myBids(h.org.id, b)).toEqual([]);
    const hist = await publicHistory(h.lot.id, null);
    expect(hist.map((x) => [x.seq, x.who, x.voided, x.priceAfterCents])).toEqual([[1, 'Bidder 1', false, 10000], [3, 'Bidder 2', true, 10000]]);
    await h.bid(b, 16000, T0 + 400_000); // the right amount this time: a live row again
    expect(await ownMaxCents(h.lot.id, b)).toBe(16000);
    expect((await myBids(h.org.id, b)).map((x) => x.lotId)).toEqual([h.lot.id]); // listed again; its standing reads the real clock
  });

  it('the CHECKs hold the shape of a VOIDED row', async () => {
    const h = await house();
    const a = await h.bidder(101);
    const insert = (outcome: string, extra: { reason?: string | null; max?: number; pb?: number; pa?: number; extended?: boolean }) => db.$executeRawUnsafe(
      `INSERT INTO "Bid" ("id","orgId","lotId","seq","bidderId","maxCents","placedAt","idempotencyKey","outcome","accepted","priceBeforeCents","priceAfterCents","closesAtBefore","closesAtAfter","extended","voidReason","voidByUserId")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 1, $3::uuid, $4, now(), 'x', $5, false, $6, $7, now(), now(), $8, $9, $10::uuid)`,
      h.org.id, h.lot.id, a, extra.max ?? 0, outcome, extra.pb ?? 100, extra.pa ?? 50, extra.extended ?? false, extra.reason === undefined ? 'why' : extra.reason, extra.reason === null ? null : h.staff);
    await expect(insert('VOIDED', { reason: null })).rejects.toThrow(/Bid_void_fields/);
    await expect(insert('VOIDED', { reason: '  ' })).rejects.toThrow(/Bid_void_reason_not_blank/);
    await expect(insert('VOIDED', { max: 500 })).rejects.toThrow(/Bid_maxCents_positive/);
    await expect(insert('VOIDED', { pb: 50, pa: 100 })).rejects.toThrow(/Bid_void_keeps_close/);
    await expect(insert('VOIDED', { extended: true })).rejects.toThrow(/Bid_void_keeps_close/);
    await expect(insert('REJECTED_LOT_CLOSED', { reason: null, max: 500 })).rejects.toThrow(/Bid_price_never_falls/);
  });
});
