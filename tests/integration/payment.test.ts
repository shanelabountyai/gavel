// D-75 (AX-08, R-08): payment marks and the derived status over a real sale; a default after the due date suspends the
// buyer and offers each lot with an underbidder at D-44's price; acceptance is a settlement correction in the same
// transaction; a decline, an expiry and a second answer are refused as stated; the DB refuses an edited mark; a correction
// after a payment shows a credit; another org sees nothing; verify is clean.
import { beforeEach, describe, expect, it } from 'vitest';
import { closeLots } from '@/auction/close';
import { correctSettlement } from '@/auction/correct';
import { openState } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';
import { answerOffer, declareDefault, offersForAuction, paidInvoices, recordPayment } from '@/auction/payment';
import { placeBid, prismaTx } from '@/auction/place-bid';
import { verifyLot } from '@/auction/verify-sql';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const { rules } = loadRules();
const q = prismaTx(db as unknown as Prisma.TransactionClient);
const T0 = Date.UTC(2026, 0, 1, 12);
const END = T0 + 3_600_000;
const DUE = END + 7 * 86_400_000;
const at = (ms: number) => () => new Date(ms);
const brief = (i: { bidderId: string; totalCents: number; balance: { status: string; paidCents: number; balanceCents: number } }) => [i.totalCents, i.balance.status, i.balance.paidCents, i.balance.balanceCents];

async function house(dueAt: Date | null = new Date(DUE), slug = 'acme') {
  const org = await makeOrg(slug);
  const staff = crypto.randomUUID();
  const actor = { orgId: org.id, userId: staff };
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'A', softCloseWindowSeconds: 120, maxExtensionSeconds: 600, buyerPremiumBps: 1000, opensAt: new Date(T0), paymentDueAt: dueAt } });
  const lot = async (number: number) => {
    const s = openState({ startCents: 10000, reserveCents: null, opensAtMs: T0, scheduledEndMs: END, softCloseWindowMs: 120_000, maxExtensionMs: 600_000, buyerPremiumBps: 1000 });
    return db.lot.create({ data: { orgId: org.id, auctionId: auction.id, number, title: `L${number}`, startCents: 10000, scheduledEnd: new Date(END),
      state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: 0, acceptedCount: 0, closesAt: new Date(s.closesAtMs), extensionCount: 0 } } } });
  };
  const bidder = async (paddle: number) => {
    const u = await db.user.create({ data: { email: `b${paddle}@${slug}.test` } });
    return (await db.bidder.create({ data: { orgId: org.id, userId: u.id, paddle } })).id;
  };
  const bid = (lotId: string, bidderId: string, maxCents: number, key: string, ms: number) => placeBid({ orgId: org.id, lotId, bidderId, maxCents, idempotencyKey: key }, { now: at(ms) });
  // L1: A 50,000 over B 30,000 (price 30,500; B's offer price 30,000). L2: A alone at 10,000. L3: C alone at 10,000.
  const [l1, l2, l3] = await Promise.all([lot(1), lot(2), lot(3)]);
  const [a, b, c] = [await bidder(1), await bidder(2), await bidder(3)];
  await h.seq([() => bid(l1!.id, a, 50000, 'k1', T0 + 1000), () => bid(l1!.id, b, 30000, 'k2', T0 + 2000), () => bid(l2!.id, a, 10000, 'k3', T0 + 3000), () => bid(l3!.id, c, 10000, 'k4', T0 + 4000)]);
  expect(await closeLots(new Date(END), q)).toEqual({ considered: 3, settled: 3 });
  return { org, actor, auction, l1: l1!, l2: l2!, l3: l3!, a, b, c, staff };
}
const h = { seq: async (fs: (() => Promise<unknown>)[]) => { for (const f of fs) await f(); } };

describe('payment marks, default and the second-chance offer (D-75)', () => {
  it('status follows the marks and the clock; a default suspends and offers; acceptance corrects the sale; verify is clean', async () => {
    const s = await house();
    const inv = (ms: number) => paidInvoices(s.org.id, { auctionId: s.auction.id }, { now: at(ms) });
    // A: L1 30,500 + 3,050 and L2 10,000 + 1,000 = 44,550. C: 11,000.
    let v = await inv(END + 1);
    expect(v.map((i) => [i.bidderId, ...brief(i)]).sort()).toEqual([[s.a, 44550, 'UNPAID', 0, 44550], [s.c, 11000, 'UNPAID', 0, 11000]].sort());
    expect((await inv(DUE + 1)).map((i) => i.balance.status)).toEqual(['OVERDUE', 'OVERDUE']);
    expect(await paidInvoices('00000000-0000-0000-0000-000000000000', { auctionId: s.auction.id })).toEqual([]);

    await recordPayment(s.actor, { auctionId: s.auction.id, bidderId: s.c, amountCents: 11000, method: 'wire' }, { now: at(END + 2) });
    await recordPayment(s.actor, { auctionId: s.auction.id, bidderId: s.a, amountCents: 5000, method: 'check' }, { now: at(END + 3) });
    await expect(recordPayment(s.actor, { auctionId: s.auction.id, bidderId: s.a, amountCents: 0, method: 'cash' })).rejects.toThrow('above zero');
    await expect(recordPayment(s.actor, { auctionId: s.auction.id, bidderId: s.a, amountCents: 100, method: ' ' })).rejects.toThrow('how it was paid');
    await expect(recordPayment(s.actor, { auctionId: s.auction.id, bidderId: s.b, amountCents: 100, method: 'cash' })).rejects.toThrow('no invoice');
    v = await inv(DUE + 1);
    const byId = (id: string) => v.find((i) => i.bidderId === id)!;
    expect(brief(byId(s.c))).toEqual([11000, 'PAID', 11000, 0]);
    expect(brief(byId(s.a))).toEqual([44550, 'PARTIAL', 5000, 39550]);
    expect(byId(s.a).marks.map((m) => [m.amountCents, m.method])).toEqual([[5000, 'check']]);
    expect(await paidInvoices(s.org.id, { bidderId: s.a }, { now: at(DUE + 1) })).toHaveLength(1); // the bidder's own view, same numbers

    // Default: refused before the due date and on a paid invoice; after it, suspends A and offers L1 to B. L2 has no underbidder.
    await expect(declareDefault(s.actor, { auctionId: s.auction.id, bidderId: s.a, reason: 'no payment', replyDays: 7 }, { now: at(DUE) })).rejects.toThrow('Not yet due');
    await expect(declareDefault(s.actor, { auctionId: s.auction.id, bidderId: s.c, reason: 'x', replyDays: 7 }, { now: at(DUE + 1) })).rejects.toThrow('paid in full');
    await expect(declareDefault(s.actor, { auctionId: s.auction.id, bidderId: s.a, reason: ' ', replyDays: 7 }, { now: at(DUE + 1) })).rejects.toThrow('reason');
    await expect(declareDefault(s.actor, { auctionId: s.auction.id, bidderId: s.a, reason: 'x', replyDays: 0 }, { now: at(DUE + 1) })).rejects.toThrow('1 to 90');
    const d = await declareDefault(s.actor, { auctionId: s.auction.id, bidderId: s.a, reason: 'No payment after two reminders', replyDays: 7 }, { now: at(DUE + 1) });
    expect(d.suspended).toBe(true);
    expect(d.offers.map((o) => [o.lotId, o.bidderId, o.priceCents, o.expiresAt.getTime()])).toEqual([[s.l1.id, s.b, 30000, DUE + 1 + 7 * 86_400_000]]);
    expect((await db.bidder.findUniqueOrThrow({ where: { id: s.a } })).status).toBe('SUSPENDED');
    expect(brief((await inv(DUE + 2)).find((i) => i.bidderId === s.a)!)).toEqual([44550, 'DEFAULTED', 5000, 39550]);
    await expect(declareDefault(s.actor, { auctionId: s.auction.id, bidderId: s.a, reason: 'again', replyDays: 7 }, { now: at(DUE + 2) })).rejects.toThrow('already declared');
    expect((await offersForAuction(s.org.id, s.auction.id, { now: at(DUE + 2) })).map((o) => [o.lot.number, o.state])).toEqual([[1, 'OPEN']]);

    // Acceptance: one transaction writes the answer and the D-44 correction; L1 is now B's at 30,000 + 3,000.
    const ans = await answerOffer(s.actor, d.offers[0]!.id, 'ACCEPTED', { now: at(DUE + 3) });
    expect(ans.settlementId).toBeTruthy();
    const chain = await db.settlement.findMany({ where: { lotId: s.l1.id }, orderBy: { createdAt: 'asc' } });
    expect(chain.map((r) => [r.winnerBidderId, r.hammerCents, r.premiumCents, r.supersedesId === null])).toEqual([[s.a, 30500, 3050, true], [s.b, 30000, 3000, false]]);
    expect(chain[1]!.reason).toBe(`Second-chance offer ${d.offers[0]!.id} accepted`);
    v = await inv(DUE + 4);
    // B's invoice is born after the sale's due date, so it reads OVERDUE at once (D-75 h: a known ceiling; there is no per-invoice due date).
    expect(v.map((i) => [i.bidderId, ...brief(i)]).sort()).toEqual([[s.a, 11000, 'DEFAULTED', 5000, 6000], [s.b, 33000, 'OVERDUE', 0, 33000], [s.c, 11000, 'PAID', 11000, 0]].sort());
    await expect(answerOffer(s.actor, d.offers[0]!.id, 'DECLINED', { now: at(DUE + 5) })).rejects.toThrow('already accepted');
    expect((await offersForAuction(s.org.id, s.auction.id)).map((o) => o.state)).toEqual(['ACCEPTED']);
    for (const l of [s.l1, s.l2, s.l3]) expect(await verifyLot(q, l.id, rules)).toBeNull();

    // A correction after a payment: C's L3 withdrawn from the sale leaves C with no lots and a credit of 11,000.
    await correctSettlement({ orgId: s.org.id, lotId: s.l3.id, winner: null, reason: 'buyer and house agreed to unwind', userId: s.staff });
    const cv = (await inv(DUE + 6)).find((i) => i.bidderId === s.c)!;
    expect([cv.lots.length, ...brief(cv)]).toEqual([0, 0, 'CREDIT', 11000, -11000]);

    expect((await db.auditEvent.findMany({ where: { orgId: s.org.id }, orderBy: { at: 'asc' } })).map((e) => e.action)).toEqual([
      'payment.marked', 'payment.marked', 'bidder.suspended', 'buyer.defaulted', 'settlement.corrected', 'offer.accepted', 'settlement.corrected',
    ]);
  });

  it('a decline touches no lot; an answer after the deadline is refused; the DB refuses an edited mark, a zero amount and a second answer', async () => {
    const s = await house();
    const d = await declareDefault(s.actor, { auctionId: s.auction.id, bidderId: s.a, reason: 'silence', replyDays: 1 }, { now: at(DUE + 1) });
    const offer = d.offers[0]!;
    await answerOffer(s.actor, offer.id, 'DECLINED', { now: at(DUE + 2) });
    expect(await db.settlement.count({ where: { lotId: s.l1.id } })).toBe(1);
    expect((await offersForAuction(s.org.id, s.auction.id)).map((o) => o.state)).toEqual(['DECLINED']);
    await expect(db.offerResponse.create({ data: { orgId: s.org.id, offerId: offer.id, response: 'ACCEPTED', byUserId: s.staff, respondedAt: new Date() } })).rejects.toThrow(/Unique constraint/);

    const s2 = await house(new Date(DUE), 'globex');
    const d2 = await declareDefault(s2.actor, { auctionId: s2.auction.id, bidderId: s2.a, reason: 'silence', replyDays: 1 }, { now: at(DUE + 1) });
    await expect(answerOffer(s2.actor, d2.offers[0]!.id, 'ACCEPTED', { now: at(DUE + 1 + 86_400_000 + 1) })).rejects.toThrow('expired');
    expect((await offersForAuction(s2.org.id, s2.auction.id, { now: at(DUE + 1 + 86_400_000 + 1) })).map((o) => o.state)).toEqual(['EXPIRED']);
    await expect(answerOffer(s.actor, d2.offers[0]!.id, 'DECLINED')).rejects.toThrow('No such offer'); // another house's offer

    const m = await recordPayment(s.actor, { auctionId: s.auction.id, bidderId: s.c, amountCents: 100, method: 'cash' });
    await expect(db.paymentMark.update({ where: { id: m.id }, data: { amountCents: 1 } })).rejects.toThrow(/append-only|refused/i);
    await expect(db.paymentMark.delete({ where: { id: m.id } })).rejects.toThrow(/append-only|refused/i);
    await expect(db.paymentMark.create({ data: { orgId: s.org.id, auctionId: s.auction.id, bidderId: s.c, amountCents: 0, method: 'cash', byUserId: s.staff, markedAt: new Date() } })).rejects.toThrow(/check constraint/i);
    // A default with no due date on the sale is refused with the instruction.
    const s3 = await house(null, 'initech');
    await expect(declareDefault(s3.actor, { auctionId: s3.auction.id, bidderId: s3.a, reason: 'x', replyDays: 7 })).rejects.toThrow('due date');
    // D-70's rule holds: a suspended bidder's new bid is refused at the boundary.
    await expect(placeBid({ orgId: s.org.id, lotId: s.l2.id, bidderId: s.a, maxCents: 99000, idempotencyKey: 'late' }, { now: at(DUE + 3) })).rejects.toThrow();
  });
});
