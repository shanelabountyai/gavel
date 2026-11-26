'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { registerBidder } from '@/auction/bidder';
import { audit } from '@/core/audit';
import { orgAction } from '@/core/authz/action';

// Any member may ask; only the `member` role gets a paddle (D-25, D-49). No staff approval (D-47).
export const registerBidderAction = orgAction(null, z.object({}), async (ctx) => {
  const b = await registerBidder(ctx.orgId, ctx.userId, ctx.role);
  await audit(ctx, 'bidder.registered', { targetType: 'bidder', targetId: b.id });
  revalidatePath(`/o/${ctx.slug}`, 'layout'); // the catalog and the lot page both swap the button for the paddle
  return { paddle: b.paddle };
});
