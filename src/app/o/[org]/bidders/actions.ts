'use server';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { setBidderStatus, setTaxExemption } from '@/auction/bidder';
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

// D-78 (AX-09): an exemption certificate reference on file makes the bidder's invoices tax-free; blank clears it.
export const setTaxExemptionAction = orgAction(
  'results.write',
  z.object({ bidderId: ref('bidder'), certificateRef: z.string().max(120, 'Keep the certificate reference under 120 characters.') }),
  async (ctx, i) => {
    if (!(await db.bidder.findFirst({ where: { id: i.bidderId, ...inOrg(ctx) }, select: { id: true } }))) notFound();
    const saved = await setTaxExemption(ctx, i.bidderId, i.certificateRef);
    revalidatePath(`/o/${ctx.slug}/bidders`);
    return { notice: saved ? `Exempt: certificate ${saved} on file.` : 'Taxable: no certificate on file.' };
  },
);
