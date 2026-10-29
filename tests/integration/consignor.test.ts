// D-74 (AX-07, R-07): consignors, insert-only contracts and the consignor statement derived on read. The statement's
// numbers are GB-25's worked by hand; a superseding contract and a settlement correction move it with no other step;
// the DB refuses an edited contract, a cross-pair supersede and an out-of-range rate; another org sees nothing.
import { beforeEach, describe, expect, it } from 'vitest';
import { closeLots } from '@/auction/close';
import { createConsignor, currentContracts, setContract, statementsForAuction } from '@/auction/consignor';
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
const money = (v: { statement: { hammerCents: number; commissionCents: number; feeCents: number; netCents: number } | null }) =>
  v.statement && [v.statement.hammerCents, v.statement.commissionCents, v.statement.feeCents, v.statement.netCents];

async function house() {
  const org = await makeOrg();
  const staff = crypto.randomUUID();
  const actor = { orgId: org.id, userId: staff };
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'A', softCloseWindowSeconds: 120, maxExtensionSeconds: 600, buyerPremiumBps: 1000, opensAt: new Date(T0) } });
  const lot = async (number: number, consignorId: string | null, reserveCents: number | null = null, endMs = END, startCents = 10000) => {
    const s = openState({ startCents, reserveCents, opensAtMs: T0, scheduledEndMs: endMs, softCloseWindowMs: 120_000, maxExtensionMs: 600_000, buyerPremiumBps: 1000 });
    return db.lot.create({ data: { orgId: org.id, auctionId: auction.id, number, title: `L${number}`, consignorId, startCents, reserveCents, scheduledEnd: new Date(endMs),
      state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: 0, acceptedCount: 0, closesAt: new Date(s.closesAtMs), extensionCount: 0 } } } });
  };
  const bidder = async (paddle: number) => {
    const u = await db.user.create({ data: { email: `b${paddle}@example.test` } });
    return (await db.bidder.create({ data: { orgId: org.id, userId: u.id, paddle } })).id;
  };
  const bid = (lotId: string, bidderId: string, maxCents: number, key: string, ms: number) => placeBid({ orgId: org.id, lotId, bidderId, maxCents, idempotencyKey: key }, { now: at(ms) });
  return { org, actor, auction, lot, bidder, bid, staff };
}

describe('consignors and statements (D-74)', () => {
  it('GB-25 over a real sale: sold, no bids, reserve not met, withdrawn, one still open; a superseding contract moves the statement; verify is clean', async () => {
    const h = await house();
    const c = await createConsignor(h.actor, { name: 'Estate of X', code: 'EST-1' });
    const d = await createConsignor(h.actor, { name: 'Dealer Y', code: 'DLR-2' });
    await expect(createConsignor(h.actor, { name: 'again', code: ' EST-1 ' })).rejects.toThrow('already in use');
    await expect(createConsignor(h.actor, { name: '', code: 'Z' })).rejects.toThrow('name');
    const k = await setContract(h.actor, { consignorId: c.id, auctionId: h.auction.id, commissionBps: 1250, lotFeeCents: 500, unsoldFeeCents: 1500 });
    expect(k).toMatchObject({ supersedesId: null, byUserId: h.staff, createdAt: expect.any(Date) });
    expect((await db.auditEvent.findMany({ where: { orgId: h.org.id }, orderBy: { at: 'asc' } })).map((e) => e.action)).toEqual(['consignor.created', 'consignor.created', 'consignor.contract_set']);

    const [l1, l2, l3, l4, l5, l6, l7] = await Promise.all([h.lot(1, c.id, null, END, 10020), h.lot(2, c.id), h.lot(3, c.id, 50000), h.lot(4, c.id), h.lot(5, null), h.lot(6, c.id, null, END + 7_200_000), h.lot(7, d.id)]);
    const [a, b] = [await h.bidder(1), await h.bidder(2)];
    expect((await h.bid(l1!.id, b, 10000, 'k1', T0 + 1000)).outcome).toBe('REJECTED_BELOW_MINIMUM'); // under the 10,020 start: a row, no price
    await h.bid(l1!.id, a, 10020, 'k2', T0 + 2000); // the first accepted bid takes the start price: the GB-25 hammer 10,020
    await h.bid(l3!.id, a, 20000, 'k3', T0 + 3000); // under the 50,000 reserve
    await h.bid(l5!.id, a, 30000, 'k4', T0 + 4000); // unconsigned: on no statement
    await h.bid(l7!.id, a, 12000, 'k5', T0 + 5000); // D's lot, D has no contract
    await withdrawLot({ orgId: h.org.id, lotId: l4!.id, reason: 'title', userId: h.staff }, { now: at(T0 + 6000) });
    expect(await closeLots(new Date(END), q)).toEqual({ considered: 7, settled: 6 }); // L6 is still open

    const views = await statementsForAuction(q, h.org.id, h.auction.id);
    expect(views.map((v) => [v.code, v.name, v.unsettled, v.contract && v.contract.commissionBps])).toEqual([['DLR-2', 'Dealer Y', 0, null], ['EST-1', 'Estate of X', 1, 1250]]);
    const [dl, es] = views;
    expect(dl!.statement).toBeNull();
    expect(dl!.lots).toEqual([{ lotId: l7!.id, lotNumber: 7, outcome: 'SOLD', hammerCents: 10000 }]); // one bid: the start price
    expect(es!.statement!.lines.map((l) => [l.lotNumber, l.outcome, l.hammerCents, l.commissionCents, l.feeCents, l.netCents])).toEqual([
      [1, 'SOLD', 10020, 1253, 500, 8267], [2, 'UNSOLD_NO_BIDS', 0, 0, 1500, -1500], [3, 'UNSOLD_RESERVE_NOT_MET', 0, 0, 1500, -1500], [4, 'UNSOLD_WITHDRAWN', 0, 0, 0, 0],
    ]);
    expect(money(es!)).toEqual([10020, 1253, 3500, 5267]);
    expect(es!.statement!.netCents + es!.statement!.commissionCents + es!.statement!.feeCents).toBe(es!.statement!.hammerCents);
    expect(es!.lots.map((l) => l.lotNumber)).not.toContain(6); // open, not settled

    // A superseding contract: the statement is drawn from the latest, the chain is two rows, the tip names the first.
    const k2 = await setContract(h.actor, { consignorId: c.id, auctionId: h.auction.id, commissionBps: 1000, lotFeeCents: 0, unsoldFeeCents: 0 });
    expect(k2.supersedesId).toBe(k.id);
    expect((await currentContracts(h.org.id, h.auction.id)).map((x) => x.id)).toEqual([k2.id]);
    expect(await db.consignmentContract.count({ where: { auctionId: h.auction.id } })).toBe(2);
    const es2 = (await statementsForAuction(q, h.org.id, h.auction.id)).find((v) => v.code === 'EST-1')!;
    expect(money(es2)).toEqual([10020, 1002, 0, 9018]); // 10,020 × 1000 bps = 1,002 exactly

    for (const l of [l1, l2, l3, l4, l5, l7]) expect(await verifyLot(q, l!.id, rules)).toBeNull();
    expect(await statementsForAuction(q, '00000000-0000-0000-0000-000000000000', h.auction.id)).toEqual([]);
    expect(l6!.consignorId).toBe(c.id);
  }, 30_000);

  it('the DB is the guard: a contract cannot be edited or deleted, cannot supersede another pair, cannot carry a rate above 10000 bps; the service refuses first', async () => {
    const h = await house();
    const c = await createConsignor(h.actor, { name: 'C', code: 'C' });
    const d = await createConsignor(h.actor, { name: 'D', code: 'D' });
    const k = await setContract(h.actor, { consignorId: c.id, auctionId: h.auction.id, commissionBps: 1000, lotFeeCents: 0, unsoldFeeCents: 0 });
    await expect(db.$executeRawUnsafe(`UPDATE "ConsignmentContract" SET "commissionBps" = 1 WHERE "id" = $1::uuid`, k.id)).rejects.toThrow(/append-only/i);
    await expect(db.$executeRawUnsafe(`DELETE FROM "ConsignmentContract" WHERE "id" = $1::uuid`, k.id)).rejects.toThrow(/append-only/i);
    await expect(db.$executeRawUnsafe(
      `INSERT INTO "ConsignmentContract" ("id", "orgId", "consignorId", "auctionId", "supersedesId", "commissionBps", "lotFeeCents", "unsoldFeeCents", "byUserId", "createdAt")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1000, 0, 0, $5::uuid, now())`, h.org.id, d.id, h.auction.id, k.id, h.staff,
    )).rejects.toThrow(/another consignor or sale/);
    await expect(db.$executeRawUnsafe(
      `INSERT INTO "ConsignmentContract" ("id", "orgId", "consignorId", "auctionId", "commissionBps", "lotFeeCents", "unsoldFeeCents", "byUserId", "createdAt")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 10001, 0, 0, $4::uuid, now())`, h.org.id, d.id, h.auction.id, h.staff,
    )).rejects.toThrow(/commissionBps_range/);
    await expect(setContract(h.actor, { consignorId: d.id, auctionId: h.auction.id, commissionBps: 10001, lotFeeCents: 0, unsoldFeeCents: 0 })).rejects.toThrow('0 to 10000');
    await expect(setContract(h.actor, { consignorId: d.id, auctionId: h.auction.id, commissionBps: 100, lotFeeCents: -1, unsoldFeeCents: 0 })).rejects.toThrow('zero or more');
    await expect(setContract({ orgId: crypto.randomUUID(), userId: h.staff }, { consignorId: d.id, auctionId: h.auction.id, commissionBps: 100, lotFeeCents: 0, unsoldFeeCents: 0 })).rejects.toThrow('No such consignor');
    await expect(db.$executeRawUnsafe(`UPDATE "Consignor" SET "code" = '' WHERE "id" = $1::uuid`, c.id)).rejects.toThrow(/code_not_blank/);
    expect(await db.consignmentContract.count()).toBe(1);
  });
});
