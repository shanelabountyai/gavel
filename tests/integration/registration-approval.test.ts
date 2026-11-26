// D-88 (AX-16): a sale can require approval per bidder. The bidder requests (version 1, PENDING); staff approve or
// decline with insert-only rows; the latest version wins. placeBid refuses NOT_APPROVED_FOR_SALE at its boundary.
import { beforeEach, describe, expect, it } from 'vitest';
import { openState } from '@/auction/engine/engine';
import { placeBid } from '@/auction/place-bid';
import { decideRegistration, registrationStatus, requestApproval } from '@/auction/registration';
import { db } from '@/core/db';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const T0 = Date.UTC(2026, 0, 1);
async function setup(requiresApproval = true) {
  const org = await makeOrg();
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'A', softCloseWindowSeconds: 0, maxExtensionSeconds: 0, buyerPremiumBps: 1000, opensAt: new Date(T0), requiresApproval } });
  const s = openState({ startCents: 10000, reserveCents: null, opensAtMs: T0, scheduledEndMs: T0 + 3_600_000, softCloseWindowMs: 0, maxExtensionMs: 0, buyerPremiumBps: 1000 });
  const lot = await db.lot.create({ data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'L', startCents: 10000, scheduledEnd: new Date(T0 + 3_600_000),
    state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: 0, acceptedCount: 0, closesAt: new Date(s.closesAtMs), extensionCount: 0 } } } });
  const u = await db.user.create({ data: { email: 'b1@example.test' } });
  const bidder = await db.bidder.create({ data: { orgId: org.id, userId: u.id, paddle: 1 } });
  const staff = { orgId: org.id, userId: crypto.randomUUID() };
  const ask = () => requestApproval({ orgId: org.id, userId: u.id }, bidder.id, auction.id);
  const bid = (key: string, maxCents = 12000) => placeBid({ orgId: org.id, lotId: lot.id, bidderId: bidder.id, maxCents, idempotencyKey: key }, { now: () => new Date(T0 + 60_000) });
  return { org, auction, lot, bidder, staff, ask, bid };
}
const bids = (lotId: string) => db.bid.count({ where: { lotId } });

describe('per-sale registration approval (D-88)', () => {
  it('a sale without the flag asks nothing and has nothing to request', async () => {
    const { ask, bid, lot } = await setup(false);
    await expect(ask()).rejects.toThrow(/needs no approval/);
    expect((await bid('k1')).accepted).toBe(true);
    expect(await bids(lot.id)).toBe(1);
  });

  it('refuses NOT_APPROVED_FOR_SALE with nothing written until staff approve; a revoke stops new bids but not the standing max', async () => {
    const { auction, bidder, staff, ask, bid, lot } = await setup();
    await expect(bid('k1')).rejects.toMatchObject({ name: 'BidError', code: 'NOT_APPROVED_FOR_SALE', retryable: false });
    const p = await ask();
    expect([p.version, p.status]).toEqual([1, 'PENDING']);
    expect((await ask()).id).toBe(p.id); // idempotent
    await expect(bid('k2')).rejects.toMatchObject({ code: 'NOT_APPROVED_FOR_SALE' });
    expect(await bids(lot.id)).toBe(0); // a boundary refusal writes no Bid row

    const a = await decideRegistration(staff, auction.id, bidder.id, 'APPROVED', '  deposit $500 taken by phone ');
    expect([a.version, a.status, a.note]).toEqual([2, 'APPROVED', 'deposit $500 taken by phone']);
    expect((await bid('k3')).accepted).toBe(true);

    await expect(decideRegistration(staff, auction.id, bidder.id, 'DECLINED', '  ')).rejects.toThrow(/reason/);
    await decideRegistration(staff, auction.id, bidder.id, 'DECLINED', 'card declined');
    expect(await registrationStatus(auction.id, bidder.id)).toBe('DECLINED');
    await expect(bid('k4', 20000)).rejects.toMatchObject({ code: 'NOT_APPROVED_FOR_SALE' });
    expect(await bids(lot.id)).toBe(1);
    expect((await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } })).leaderBidderId).toBe(bidder.id); // D-70 c: standing max stays live

    await expect(ask()).rejects.toThrow(/declined/); // a declined bidder cannot re-queue; staff can still approve
    const again = await decideRegistration(staff, auction.id, bidder.id, 'APPROVED', '');
    expect([again.version, again.status]).toEqual([4, 'APPROVED']);
    expect(await db.auditEvent.count({ where: { action: { startsWith: 'auction.registration_' } } })).toBe(4);
  });

  it('refuses a decision with no request, a repeat decision, and another house', async () => {
    const { auction, bidder, staff, ask } = await setup();
    await expect(decideRegistration(staff, auction.id, bidder.id, 'APPROVED', '')).rejects.toThrow(/not asked/);
    await ask();
    const other = await makeOrg('other');
    await expect(decideRegistration({ ...staff, orgId: other.id }, auction.id, bidder.id, 'APPROVED', '')).rejects.toThrow(/not asked/);
    await expect(requestApproval({ orgId: other.id, userId: staff.userId }, bidder.id, auction.id)).rejects.toThrow(/No such sale/);
    await decideRegistration(staff, auction.id, bidder.id, 'APPROVED', '');
    await expect(decideRegistration(staff, auction.id, bidder.id, 'APPROVED', '')).rejects.toThrow(/already approved/);
  });

  it('two staff deciding at once give one row and one refusal, whatever the interleaving', async () => {
    const { auction, bidder, staff, ask } = await setup();
    await ask();
    const r = await Promise.allSettled([decideRegistration(staff, auction.id, bidder.id, 'APPROVED', ''), decideRegistration(staff, auction.id, bidder.id, 'APPROVED', '')]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await db.auctionRegistration.count({ where: { auctionId: auction.id } })).toBe(2);
  });

  it('the database guards: insert-only rows, version 1 and only version 1 is PENDING, the flag fixed once the sale has a bid', async () => {
    const { org, auction, bidder, staff, ask, bid } = await setup();
    const p = await ask();
    await expect(db.$executeRaw`UPDATE "AuctionRegistration" SET "note" = 'x' WHERE "id" = ${p.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM "AuctionRegistration" WHERE "id" = ${p.id}::uuid`).rejects.toThrow(/append-only/);
    const row = (version: number, status: string, note = 'n') => db.auctionRegistration.create({ data: { orgId: org.id, auctionId: auction.id, bidderId: bidder.id, version, status, note, byUserId: staff.userId, recordedAt: new Date(T0) } });
    await expect(row(1, 'APPROVED')).rejects.toThrow(); // unique (sale, bidder, version)
    await expect(row(2, 'PENDING')).rejects.toThrow(/AuctionRegistration_pending_first/);
    await expect(row(2, 'MAYBE')).rejects.toThrow(/AuctionRegistration_status_known/);
    await expect(row(2, 'DECLINED', ' ')).rejects.toThrow(/AuctionRegistration_decline_reason/);
    await decideRegistration(staff, auction.id, bidder.id, 'APPROVED', '');
    await bid('k1');
    await expect(db.auction.update({ where: { id: auction.id }, data: { requiresApproval: false } })).rejects.toThrow(/fixed/);
  });
});
