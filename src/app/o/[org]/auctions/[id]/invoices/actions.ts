'use server';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { correctionError, correctSettlement } from '@/auction/correct';
import { dollars } from '@/auction/dollars';
import { answerOffer, declareDefault, recordPayment } from '@/auction/payment';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg, type OrgCtx } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';

// D-75 (AX-08). Staff only (results.write). Every id is looked up in the caller's house before the service runs, so another
// house's id is a 404 whatever else is in the form (INV-02). Money is typed in dollars and cents and turned into whole cents
// by string arithmetic (`@/auction/dollars`): no float touches it.
const invoiceOf = z.object({ auctionId: ref('auction'), bidderId: ref('bidder') });
const paymentFields = z.object({ amount: dollars('Amount received'), method: z.string().trim().min(1, 'Say how it was paid.').max(40) });
const defaultFields = z.object({ reason: z.string().trim().min(1, 'Give a reason for the default.').max(500), replyDays: z.coerce.number().int().min(1).max(90) });
const parse = <T,>(r: z.ZodSafeParseResult<T>): T => {
  if (!r.success) throw new Refused(r.error.issues[0]?.message ?? 'Check the form and try again.');
  return r.data;
};
const back = (slug: string, auctionId: string) => revalidatePath(`/o/${slug}/auctions/${auctionId}/invoices`);

async function mustOwn(ctx: OrgCtx, auctionId: string, bidderId: string) {
  const [a, b] = await Promise.all([
    db.auction.findFirst({ where: { id: auctionId, ...inOrg(ctx) }, select: { id: true } }),
    db.bidder.findFirst({ where: { id: bidderId, ...inOrg(ctx) }, select: { id: true } }),
  ]);
  if (!a || !b) notFound();
}

export const recordPaymentAction = orgAction(
  'results.write',
  invoiceOf.extend({ amount: z.string(), method: z.string() }),
  async (ctx, raw) => {
    await mustOwn(ctx, raw.auctionId, raw.bidderId); // both ids before the fields (INV-02, INV-03)
    const i = parse(paymentFields.safeParse(raw));
    await recordPayment(ctx, { auctionId: raw.auctionId, bidderId: raw.bidderId, amountCents: i.amount, method: i.method });
    back(ctx.slug, raw.auctionId);
    return { notice: 'Payment recorded.' };
  },
);

export const declareDefaultAction = orgAction(
  'results.write',
  invoiceOf.extend({ reason: z.string(), replyDays: z.string() }),
  async (ctx, raw) => {
    await mustOwn(ctx, raw.auctionId, raw.bidderId);
    const i = parse(defaultFields.safeParse(raw));
    const d = await declareDefault(ctx, { auctionId: raw.auctionId, bidderId: raw.bidderId, reason: i.reason, replyDays: i.replyDays });
    back(ctx.slug, raw.auctionId);
    return { notice: `Declared in default${d.suspended ? ' and suspended' : ''}. ${d.offers.length} second-chance ${d.offers.length === 1 ? 'offer' : 'offers'} written.` };
  },
);

export const answerOfferAction = orgAction(
  'results.write',
  z.object({ offerId: ref('offer'), response: z.enum(['ACCEPTED', 'DECLINED']) }),
  async (ctx, i) => {
    const o = await db.secondChanceOffer.findFirst({ where: { id: i.offerId, ...inOrg(ctx) }, select: { default: { select: { auctionId: true } } } });
    if (!o) notFound();
    await answerOffer(ctx, i.offerId, i.response);
    back(ctx.slug, o.default.auctionId);
    return { notice: i.response === 'ACCEPTED' ? 'Accepted: the lot is corrected to the underbidder.' : 'Declined.' };
  },
);

// D-87 (AX-14): the consignor accepted the high bid below the reserve. A D-44 correction to the lot's high bidder carrying the
// approval reference; the price is the one the ledger reached (resettle decides, the reserve not applied). The settlement the
// staff member saw is named, so a second click or a concurrent correction is refused, never applied twice.
export const approveBelowReserveAction = orgAction(
  'results.write',
  z.object({ lotId: ref('lot'), settlementId: ref('settlement'), reason: z.string(), approvalRef: z.string() }),
  async (ctx, raw) => {
    const [lot, settlement] = await Promise.all([
      db.lot.findFirst({ where: { id: raw.lotId, ...inOrg(ctx) }, select: { auctionId: true, state: { select: { leaderBidderId: true } } } }),
      db.settlement.findFirst({ where: { id: raw.settlementId, lotId: raw.lotId, ...inOrg(ctx) }, select: { id: true } }),
    ]);
    if (!lot || !settlement) notFound(); // both ids before the fields (INV-02, INV-03)
    const reason = raw.reason.trim();
    const approvalRef = raw.approvalRef.trim();
    if (!reason) throw new Refused('Give a reason for the sale.');
    if (!approvalRef) throw new Refused('Give the consignor approval reference.');
    if (!lot.state?.leaderBidderId) throw new Refused('This lot has no high bidder to sell to.');
    try {
      await correctSettlement({ orgId: ctx.orgId, lotId: raw.lotId, supersedesId: raw.settlementId, winner: lot.state.leaderBidderId, reason, consignorApprovalRef: approvalRef, userId: ctx.userId });
    } catch (error) {
      const e = correctionError(error);
      if (!e) throw error;
      throw new Refused({
        APPROVAL_NOT_APPLICABLE: 'Only a lot that closed below its reserve can be sold this way.',
        STALE_SETTLEMENT: 'This lot was already corrected. Reload the page.',
        NO_CHANGE: 'This lot is already sold.',
        CORRECTION_TIMED_OUT: 'The lot was busy. Try again.',
      }[e.code as string] ?? `Refused: ${e.code}.`);
    }
    back(ctx.slug, lot.auctionId);
    return { notice: 'Sold subject to approval: the lot is on the high bidder\'s invoice.' };
  },
);
