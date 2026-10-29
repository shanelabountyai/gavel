'use server';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ownMaxCents } from '@/auction/lot-view';
import { placeBid } from '@/auction/place-bid';
import { BidError } from '@/auction/errors';
import { bidErrorText } from '@/auction/outcome-labels';
import { acceptTerms } from '@/auction/terms';
import { withdrawLot } from '@/auction/withdraw';
import { orgAction, ref } from '@/core/authz/action';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';

// Task 3.5. The key is the client's, one per submission, resent on a retry (D-17). Any member may ask; placeBid refuses
// a member with no active Bidder row. The response is the bidder-safe BidResponse, minus the Date.
export const placeBidAction = orgAction(
  null,
  z.object({ lotId: ref('lot'), maxCents: z.number().int(), idempotencyKey: z.string().min(1).max(100) }),
  async (ctx, input) => {
    if (!(await db.lot.findFirst({ where: { id: input.lotId, orgId: ctx.orgId }, select: { id: true } }))) notFound(); // INV-02
    const bidder = await db.bidder.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } }, select: { id: true } });
    if (!bidder) return { error: bidErrorText('BIDDER_NOT_ACTIVE'), code: 'BIDDER_NOT_ACTIVE', retryable: false };
    try {
      const r = await placeBid({ orgId: ctx.orgId, lotId: input.lotId, bidderId: bidder.id, maxCents: input.maxCents, idempotencyKey: input.idempotencyKey });
      // UX R7 (D-68): a refused raise quotes the caller's own maximum, read only on that outcome to keep it off the hot path
      const yourMaxCents = r.outcome === 'REJECTED_NOT_ABOVE_OWN_MAX' ? await ownMaxCents(input.lotId, bidder.id) : null;
      return { ok: true as const, outcome: r.outcome, accepted: r.accepted, priceCents: r.priceCents, minNextCents: r.minNextCents, youLead: r.youLead, yourMaxCents };
    } catch (e) {
      if (e instanceof BidError) return { error: bidErrorText(e.code), code: e.code, retryable: e.code === 'BID_TIMED_OUT' }; // UX-05: never e.message
      throw e;
    }
  },
);

// D-73 (AX-04): staff withdraw the lot, with the reason on the record. withdrawLot judges it under the lot's one lock and
// refuses with the sentence the form shows; the trigger under the insert is the guard.
export const withdrawLotAction = orgAction(
  'results.write',
  z.object({ lotId: ref('lot'), reason: z.string().trim().min(1, 'Give a reason for the withdrawal.').max(500, 'Keep the reason under 500 characters.') }),
  async (ctx, i) => {
    if (!(await db.lot.findFirst({ where: { id: i.lotId, orgId: ctx.orgId }, select: { id: true } }))) notFound(); // INV-02
    await withdrawLot({ orgId: ctx.orgId, lotId: i.lotId, reason: i.reason, userId: ctx.userId });
    revalidatePath(`/o/${ctx.slug}`, 'layout'); // the lot page, the catalog and the history all change
    return { notice: 'Lot withdrawn.' };
  },
);

// D-72 (AX-03): a bidder accepts the sale's current terms from the lot page. Idempotent; never part of the bid path.
export const acceptTermsAction = orgAction(null, z.object({ lotId: ref('lot') }), async (ctx, i) => {
  const lot = await db.lot.findFirst({ where: { id: i.lotId, orgId: ctx.orgId }, select: { auctionId: true } });
  if (!lot) notFound(); // INV-02
  const bidder = await db.bidder.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } }, select: { id: true } });
  if (!bidder) throw new Refused('Register to bid first.');
  const a = await acceptTerms(ctx.orgId, bidder.id, lot.auctionId);
  revalidatePath(`/o/${ctx.slug}`, 'layout'); // every lot of the sale swaps the terms panel for the bid form
  return { accepted: a.termsSha256 };
});
