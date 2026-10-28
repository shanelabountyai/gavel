'use server';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { setBidderStatus } from '@/auction/bidder';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg } from '@/core/authz/guards';
import { db } from '@/core/db';

// D-70 (AX-05). Staff only (owner/admin, results.write). Another house's bidder is a 404 (INV-02).
export const changeBidderStatus = orgAction(
  'results.write',
  z.object({ bidderId: ref('bidder'), status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().max(500) }),
  async (ctx, i) => {
    if (!(await db.bidder.findFirst({ where: { id: i.bidderId, ...inOrg(ctx) }, select: { id: true } }))) notFound();
    await setBidderStatus(ctx, i.bidderId, i.status, i.reason);
    revalidatePath(`/o/${ctx.slug}/bidders`);
    return { notice: i.status === 'SUSPENDED' ? 'Suspended.' : 'Reinstated.' };
  },
);
