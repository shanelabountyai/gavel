'use server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { placeBid } from '@/auction/place-bid';
import { BidError } from '@/auction/errors';
import { bidErrorText } from '@/auction/outcome-labels';
import { orgAction, ref } from '@/core/authz/action';
import { db } from '@/core/db';

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
      return { ok: true as const, outcome: r.outcome, accepted: r.accepted, priceCents: r.priceCents, minNextCents: r.minNextCents, youLead: r.youLead };
    } catch (e) {
      if (e instanceof BidError) return { error: bidErrorText(e.code), code: e.code, retryable: e.code === 'BID_TIMED_OUT' }; // UX-05: never e.message
      throw e;
    }
  },
);
