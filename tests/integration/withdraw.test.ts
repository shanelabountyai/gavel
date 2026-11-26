// D-73 (AX-04): withdrawLot under the lot's one lock. Before any bid; after bids (the leader is told, a later attempt is
// a REJECTED_LOT_WITHDRAWN row, a resend of an earlier key still replays, LotState is not written); refused once
// closed, settled or already withdrawn; the trigger under it refuses too; the table is append-only; auction:close
// settles UNSOLD_WITHDRAWN at the withdrawal and verify is clean; a withdrawn lot cannot be corrected to a winner.
import { beforeEach, describe, expect, it } from 'vitest';
import { closeLots } from '@/auction/close';
import { correctSettlement } from '@/auction/correct';
import { openState } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';
import { placeBid, prismaTx } from '@/auction/place-bid';
import { verifyLot } from '@/auction/verify-sql';
import { withdrawLot } from '@/auction/withdraw';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const { rules } = loadRules();
const q = prismaTx(db as unknown as Prisma.TransactionClient);
const T0 = Date.UTC(2026, 0, 1, 12);
const END = T0 + 3_600_000;
const at = (ms: number) => () => new Date(ms);

async function house() {
  const org = await makeOrg();
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'A', softCloseWindowSeconds: 120, maxExtensionSeconds: 600, buyerPremiumBps: 1000, opensAt: new Date(T0) } });
  const lot = async (number: number) => {
    const s = openState({ startCents: 10000, reserveCents: null, opensAtMs: T0, scheduledEndMs: END, softCloseWindowMs: 120_000, maxExtensionMs: 600_000, buyerPremiumBps: 1000 });
    return db.lot.create({ data: { orgId: org.id, auctionId: auction.id, number, title: `L${number}`, startCents: 10000, scheduledEnd: new Date(END),
      state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: 0, acceptedCount: 0, closesAt: new Date(s.closesAtMs), extensionCount: 0 } } } });
  };
  const bidder = async (paddle: number) => {
    const u = await db.user.create({ data: { email: `b${paddle}@example.test` } });
    return (await db.bidder.create({ data: { orgId: org.id, userId: u.id, paddle } })).id;
  };
  const staff = crypto.randomUUID();
  const bid = (lotId: string, bidderId: string, maxCents: number, key: string, ms: number) => placeBid({ orgId: org.id, lotId, bidderId, maxCents, idempotencyKey: key }, { now: at(ms) });
  const withdraw = (lotId: string, ms: number, reason = 'title problem') => withdrawLot({ orgId: org.id, lotId, reason, userId: staff }, { now: at(ms) });
  return { org, auction, lot, bidder, bid, withdraw, staff };
}

describe('withdraw a lot (D-73)', () => {
  it('before any bid: the row and the audit event, no notice; a later attempt is a REJECTED_LOT_WITHDRAWN row; close settles UNSOLD_WITHDRAWN at the withdrawal; verify OK', async () => {
    const h = await house();
    const lot = await h.lot(1);
    const b1 = await h.bidder(1);
    const w = await h.withdraw(lot.id, T0 + 60_000);
    expect(w).toMatchObject({ withdrawnAt: new Date(T0 + 60_000), leader: null });
    expect(await db.lotWithdrawal.findUnique({ where: { lotId: lot.id } })).toMatchObject({ id: w.id, reason: 'title problem', byUserId: h.staff, withdrawnAt: new Date(T0 + 60_000) });
    expect((await db.auditEvent.findMany({ where: { targetId: lot.id } })).map((e) => [e.action, e.actorUserId])).toEqual([['lot.withdrawn', h.staff]]);
    expect(await db.outbox.count()).toBe(0);
    const r = await h.bid(lot.id, b1, 20000, 'k1', T0 + 61_000);
    expect(r).toMatchObject({ outcome: 'REJECTED_LOT_WITHDRAWN', accepted: false, seq: 1, replayed: false, priceCents: 0, youLead: false });
    expect(await db.bid.findMany({ where: { lotId: lot.id } })).toHaveLength(1);
    expect(await closeLots(new Date(T0 + 2 * 3_600_000), q)).toEqual({ considered: 1, settled: 1 });
    expect(await db.settlement.findFirst({ where: { lotId: lot.id } })).toMatchObject({ outcome: 'UNSOLD_WITHDRAWN', winnerBidderId: null, hammerCents: 0, premiumCents: 0, totalCents: 0, closedAt: new Date(T0 + 60_000) });
    expect(await verifyLot(q, lot.id, rules)).toBeNull();
  });

  it('after bids: one withdrawn notice to the leader, LotState untouched, a later attempt is a row, a resend of an earlier key still replays, no correction can sell it', async () => {
    const h = await house();
    const lot = await h.lot(1);
    const [b1, b2] = [await h.bidder(1), await h.bidder(2)];
    await h.bid(lot.id, b1, 12000, 'k1', T0 + 60_000);
    await h.bid(lot.id, b2, 15000, 'k2', T0 + 120_000); // b2 leads; b1 gets the outbid notice
    const before = await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } });
    const w = await h.withdraw(lot.id, T0 + 180_000, 'consignor pulled it');
    expect(w.leader).toBe(b2);
    expect(await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } })).toEqual(before);
    const notices = await db.outbox.findMany({ orderBy: { sendAfter: 'asc' } });
    expect(notices.map((n) => n.template)).toEqual(['outbid', 'withdrawn']);
    expect(notices[1]!.to).toBe('b2@example.test');
    expect(JSON.stringify(notices[1]!.data)).not.toContain('consignor'); // the reason stays on the house's record
    await expect(h.bid(lot.id, b1, 50000, 'k3', T0 + 200_000)).resolves.toMatchObject({ outcome: 'REJECTED_LOT_WITHDRAWN', seq: 3, priceCents: 12500, youLead: false });
    await expect(h.bid(lot.id, b1, 12000, 'k1', T0 + 201_000)).resolves.toMatchObject({ outcome: 'ACCEPTED_LEAD', seq: 1, replayed: true });
    expect(await db.bid.count({ where: { lotId: lot.id } })).toBe(3);
    expect(await closeLots(new Date(T0 + 2 * 3_600_000), q)).toEqual({ considered: 1, settled: 1 });
    const s = await db.settlement.findFirstOrThrow({ where: { lotId: lot.id } });
    expect(s).toMatchObject({ outcome: 'UNSOLD_WITHDRAWN', winnerBidderId: null, hammerCents: 0, closedAt: new Date(T0 + 180_000) });
    expect(await db.outbox.count({ where: { template: 'won' } })).toBe(0);
    expect(await verifyLot(q, lot.id, rules)).toBeNull();
    await expect(correctSettlement({ orgId: h.org.id, lotId: lot.id, supersedesId: s.id, winner: b2, reason: 'sell it anyway', userId: h.staff })).rejects.toMatchObject({ name: 'CorrectionError', code: 'LOT_WITHDRAWN' });
  });

  it('refused: twice, after the close, after settlement, a blank reason, another house; the trigger refuses a closed lot; the table is append-only', async () => {
    const h = await house();
    const lot = await h.lot(1);
    await h.withdraw(lot.id, T0 + 60_000);
    await expect(h.withdraw(lot.id, T0 + 61_000)).rejects.toThrow(/already withdrawn/);
    const late = await h.lot(2);
    await expect(h.withdraw(late.id, END)).rejects.toThrow(/has closed/);
    await expect(db.$executeRaw`INSERT INTO "LotWithdrawal" ("id", "orgId", "lotId", "reason", "byUserId", "withdrawnAt") VALUES (gen_random_uuid(), ${h.org.id}::uuid, ${late.id}::uuid, 'late', ${h.staff}::uuid, ${new Date(END)})`).rejects.toThrow(/closed at/);
    await closeLots(new Date(END + 1000), q);
    await expect(db.$executeRaw`INSERT INTO "LotWithdrawal" ("id", "orgId", "lotId", "reason", "byUserId", "withdrawnAt") VALUES (gen_random_uuid(), ${h.org.id}::uuid, ${late.id}::uuid, 'late', ${h.staff}::uuid, ${new Date(T0)})`).rejects.toThrow(/is settled/);
    await expect(h.withdraw(late.id, T0)).rejects.toThrow(/has closed/); // the settlement row, whatever the clock says
    const fresh = await h.lot(3);
    await expect(h.withdraw(fresh.id, T0 + 1000, '  ')).rejects.toThrow(/reason/);
    const other = await makeOrg('other');
    await expect(withdrawLot({ orgId: other.id, lotId: fresh.id, reason: 'x', userId: h.staff })).rejects.toThrow(/No such lot/);
    expect(await db.lotWithdrawal.count()).toBe(1);
    await expect(db.$executeRaw`UPDATE "LotWithdrawal" SET "reason" = 'edited'`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM "LotWithdrawal"`).rejects.toThrow(/append-only/);
  });
});
