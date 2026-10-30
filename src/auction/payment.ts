// D-75 (AX-08, R-08): payment marks, the derived invoice status, buyer default and the second-chance offer. Nothing is
// stored that can be derived: status comes from `invoiceBalance` over the marks and the current invoice; "expired" from
// the clock. Payments are a non-goal: a mark is staff writing down that money arrived, never a charge. Acceptance of an
// offer writes the D-44 correction in the same transaction as the answer row, under the same one lock as a bid.
import { audit } from '@/core/audit';
import { now as clockNow } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { setBidderStatusInTx } from '@/auction/bidder';
import { correctInTx, correctionError } from '@/auction/correct';
import { type Invoice, type InvoiceBalance, invoiceBalance, secondChance } from '@/auction/engine/engine';
import { invoicesForAuction, invoicesForBidder } from '@/auction/invoice';
import { loadRules } from '@/auction/load-rules';
import { TRANSACTION_TIMEOUT_MS, prismaTx } from '@/auction/place-bid';
import { loadLot } from '@/auction/verify-sql';
import type { Prisma } from '@/generated/prisma/client';

type Actor = { orgId: string; userId: string };
type Clock = { now?: () => Date };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (auctionId: string, bidderId: string) => `${auctionId}\u0000${bidderId}`;
const DAY_MS = 86_400_000;

export type Mark = { readonly id: string; readonly amountCents: number; readonly method: string; readonly markedAt: Date; readonly byUserId: string };
export type Default = { readonly id: string; readonly reason: string; readonly declaredAt: Date; readonly byUserId: string };
/** An invoice with its payment state. `lots` is empty when every lot was corrected away after a payment: a pure credit. */
export type PaidInvoice = Invoice & { readonly balance: InvoiceBalance; readonly marks: readonly Mark[]; readonly defaulted: Default | null; readonly dueAt: Date | null };

/** Staff: every buyer's invoice for one sale with its status; bidder: their own across sales. The clock is read once here. */
export async function paidInvoices(orgId: string, by: { auctionId: string } | { bidderId: string }, deps: Clock = {}): Promise<PaidInvoice[]> {
  const q = prismaTx(db as unknown as Prisma.TransactionClient);
  const nowMs = (deps.now ?? clockNow)().getTime();
  const where = { orgId, ...by };
  const [invoices, marks, defaults] = await Promise.all([
    'auctionId' in by ? invoicesForAuction(q, orgId, by.auctionId) : invoicesForBidder(q, orgId, by.bidderId),
    db.paymentMark.findMany({ where, orderBy: { markedAt: 'asc' } }),
    db.buyerDefault.findMany({ where }),
  ]);
  const byKey = new Map(invoices.map((i) => [key(i.auctionId, i.bidderId), i]));
  for (const m of [...marks, ...defaults]) {
    const k = key(m.auctionId, m.bidderId);
    if (!byKey.has(k)) byKey.set(k, { auctionId: m.auctionId, bidderId: m.bidderId, lots: [], hammerCents: 0, premiumCents: 0, taxBps: 0, taxBase: 'HAMMER', taxCents: 0, exemptRef: null, totalCents: 0 });
  }
  const due = new Map((await db.auction.findMany({ where: { orgId, id: { in: [...new Set([...byKey.values()].map((i) => i.auctionId))] } }, select: { id: true, paymentDueAt: true } })).map((a) => [a.id, a.paymentDueAt]));
  return [...byKey.values()]
    .sort((a, b) => (a.auctionId < b.auctionId ? -1 : a.auctionId > b.auctionId ? 1 : a.bidderId < b.bidderId ? -1 : a.bidderId > b.bidderId ? 1 : 0))
    .map((i) => {
      const k = key(i.auctionId, i.bidderId);
      const mine = marks.filter((m) => key(m.auctionId, m.bidderId) === k);
      const d = defaults.find((x) => key(x.auctionId, x.bidderId) === k) ?? null;
      const dueAt = due.get(i.auctionId) ?? null;
      const paid = mine.reduce((t, m) => t + m.amountCents, 0);
      return { ...i, dueAt, marks: mine, defaulted: d, balance: invoiceBalance(i.totalCents, paid, nowMs, dueAt ? dueAt.getTime() : null, d !== null) };
    });
}

async function oneInvoice(orgId: string, auctionId: string, bidderId: string, deps: Clock) {
  const inv = (await paidInvoices(orgId, { auctionId }, deps)).find((i) => i.bidderId === bidderId);
  if (!inv || (inv.lots.length === 0 && inv.marks.length === 0 && !inv.defaulted)) throw new Refused('That bidder has no invoice in this sale.');
  return inv;
}

/** Staff write down a payment received. Any positive whole cents; several marks add up; a mark after a default still counts toward the balance. */
export async function recordPayment(actor: Actor, input: { auctionId: string; bidderId: string; amountCents: number; method: string }, deps: Clock = {}): Promise<Mark> {
  if (!UUID.test(input.auctionId) || !UUID.test(input.bidderId)) throw new Refused('That bidder has no invoice in this sale.');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Refused('The amount must be whole cents above zero.');
  const method = input.method.trim();
  if (!method) throw new Refused('Say how it was paid.');
  await oneInvoice(actor.orgId, input.auctionId, input.bidderId, deps);
  return db.$transaction(async (tx) => {
    const row = await tx.paymentMark.create({ data: { orgId: actor.orgId, auctionId: input.auctionId, bidderId: input.bidderId, amountCents: input.amountCents, method, byUserId: actor.userId, markedAt: (deps.now ?? clockNow)() } });
    await audit(actor, 'payment.marked', { targetType: 'PaymentMark', targetId: row.id, data: { auctionId: input.auctionId, bidderId: input.bidderId, amountCents: input.amountCents, method } }, tx);
    return row;
  });
}

export type Declared = { readonly id: string; readonly suspended: boolean; readonly offers: readonly { id: string; lotId: string; bidderId: string; priceCents: number; expiresAt: Date }[] };

/**
 * Declare a buyer in default: refused before the due date or when the invoice is paid (D-75 b). Writes the BuyerDefault
 * row, suspends the bidder if not already (D-70), and one SecondChanceOffer per lot the buyer currently wins in the sale
 * that has an underbidder (`secondChance`), to be answered within `replyDays`. No lot is corrected here: the lot stays
 * sold to the defaulter until an offer is accepted or staff correct it by hand.
 */
export async function declareDefault(actor: Actor, input: { auctionId: string; bidderId: string; reason: string; replyDays: number }, deps: Clock = {}): Promise<Declared> {
  if (!UUID.test(input.auctionId) || !UUID.test(input.bidderId)) throw new Refused('That bidder has no invoice in this sale.');
  const reason = input.reason.trim();
  if (!reason) throw new Refused('Give a reason for the default.');
  if (!Number.isInteger(input.replyDays) || input.replyDays < 1 || input.replyDays > 90) throw new Refused('Days to reply must be a whole number from 1 to 90.');
  const now = deps.now ?? clockNow;
  const inv = await oneInvoice(actor.orgId, input.auctionId, input.bidderId, deps);
  if (inv.defaulted) throw new Refused('This buyer was already declared in default on this sale.');
  if (inv.balance.status === 'PAID' || inv.balance.status === 'CREDIT') throw new Refused('This invoice is paid in full.');
  if (inv.dueAt === null) throw new Refused('Set the payment due date on the sale first; a default needs a missed deadline.');
  if (inv.balance.status === 'UNPAID' || inv.balance.status === 'PARTIAL') {
    if (now().getTime() <= inv.dueAt.getTime()) throw new Refused(`Not yet due: payment is due ${inv.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
  }
  const { rules } = loadRules();
  return db.$transaction(async (ptx) => {
    const at = now();
    const d = await ptx.buyerDefault.create({ data: { orgId: actor.orgId, auctionId: input.auctionId, bidderId: input.bidderId, reason, byUserId: actor.userId, declaredAt: at } });
    const bidder = await ptx.bidder.findUniqueOrThrow({ where: { id: input.bidderId }, select: { status: true } });
    if (bidder.status === 'ACTIVE') await setBidderStatusInTx(ptx, actor, input.bidderId, 'SUSPENDED', `Default on invoice: ${reason}`);
    const q = prismaTx(ptx);
    const offers: { id: string; lotId: string; bidderId: string; priceCents: number; expiresAt: Date }[] = [];
    for (const line of inv.lots) {
      const l = await loadLot(q, line.lotId);
      const tip = [l.settlement, ...l.corrections].at(-1)!;
      if (tip.winner !== input.bidderId) continue; // corrected away since the page was read
      const o = secondChance(l.lot, l.rows, rules, input.bidderId, tip.premiumBps);
      if (!o) continue;
      const row = await ptx.secondChanceOffer.create({ data: { orgId: actor.orgId, defaultId: d.id, lotId: line.lotId, bidderId: o.bidderId, priceCents: o.settlement.hammerCents, premiumBps: tip.premiumBps, expiresAt: new Date(at.getTime() + input.replyDays * DAY_MS), createdAt: at } });
      offers.push({ id: row.id, lotId: row.lotId, bidderId: row.bidderId, priceCents: row.priceCents, expiresAt: row.expiresAt });
    }
    await audit(actor, 'buyer.defaulted', { targetType: 'BuyerDefault', targetId: d.id, data: { auctionId: input.auctionId, bidderId: input.bidderId, reason, offers: offers.map((o) => ({ id: o.id, lotId: o.lotId, bidderId: o.bidderId, priceCents: o.priceCents })) } }, ptx);
    return { id: d.id, suspended: bidder.status === 'ACTIVE', offers };
  }, { timeout: TRANSACTION_TIMEOUT_MS });
}

/**
 * Staff record the underbidder's answer. ACCEPTED writes the D-44 correction (winner = the underbidder, at the offer's
 * price, with the offer named as the reason) in the same transaction, under the lot's one lock; the price `resettle`
 * gives now must equal the offer's, which it does because a closed ledger never changes. One answer per offer, by the
 * unique index; an answer after `expiresAt` is refused. No lot is touched by a decline.
 */
export async function answerOffer(actor: Actor, offerId: string, response: 'ACCEPTED' | 'DECLINED', deps: Clock = {}) {
  if (!UUID.test(offerId)) throw new Refused('No such offer in this house.');
  const now = deps.now ?? clockNow;
  try {
    return await db.$transaction(async (ptx) => {
      const offer = await ptx.secondChanceOffer.findFirst({ where: { id: offerId, orgId: actor.orgId }, include: { response: true } });
      if (!offer) throw new Refused('No such offer in this house.');
      if (offer.response) throw new Refused(`This offer was already ${offer.response.response.toLowerCase()}.`);
      const at = now();
      if (at.getTime() > offer.expiresAt.getTime()) throw new Refused('This offer expired; the lot can still be corrected by hand.');
      const answer = await ptx.offerResponse.create({ data: { orgId: actor.orgId, offerId, response, byUserId: actor.userId, respondedAt: at } });
      let settlementId: string | null = null;
      if (response === 'ACCEPTED') {
        const r = await correctInTx(ptx, { orgId: actor.orgId, lotId: offer.lotId, winner: offer.bidderId, reason: `Second-chance offer ${offer.id} accepted`, userId: actor.userId });
        if (r.settlement.hammerCents !== offer.priceCents) throw new Refused('The ledger no longer supports the offered price; correct the lot by hand.');
        settlementId = r.id;
      }
      await audit(actor, response === 'ACCEPTED' ? 'offer.accepted' : 'offer.declined', { targetType: 'SecondChanceOffer', targetId: offerId, data: { lotId: offer.lotId, bidderId: offer.bidderId, priceCents: offer.priceCents, settlementId } }, ptx);
      return { ...answer, settlementId };
    }, { timeout: TRANSACTION_TIMEOUT_MS });
  } catch (error) {
    const c = correctionError(error);
    if (c) throw new Refused(`The sale could not be corrected: ${c.message}.`, { cause: error });
    throw error;
  }
}

/** Staff: every offer in a sale with its state, newest first. */
export async function offersForAuction(orgId: string, auctionId: string, deps: Clock = {}) {
  const nowMs = (deps.now ?? clockNow)().getTime();
  const rows = await db.secondChanceOffer.findMany({ where: { orgId, default: { auctionId } }, include: { response: true, lot: { select: { number: true, title: true } }, default: { select: { bidderId: true } } }, orderBy: [{ createdAt: 'desc' }, { lot: { number: 'asc' } }] });
  return rows.map((o) => ({ ...o, state: o.response ? o.response.response : nowMs > o.expiresAt.getTime() ? ('EXPIRED' as const) : ('OPEN' as const) }));
}
