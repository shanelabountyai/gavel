import Link from 'next/link';
import { formatCents } from '@/auction/engine/money';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { registerBidderAction } from './actions';

export const metadata = { title: 'Catalog' };

// Any member of the house. Shows the catalog only: no reserve, no max (brief §4).
export default async function Catalog({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const lots = await db.lot.findMany({ where: inOrg(ctx), orderBy: [{ auction: { opensAt: 'asc' } }, { number: 'asc' }], select: { id: true, number: true, title: true, startCents: true, scheduledEnd: true, auction: { select: { name: true } } } });
  const me = ctx.role === 'member' ? await db.bidder.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } } }) : null;
  return (
    <main>
      <h1>Catalog</h1>
      {ctx.role === 'member' && (me ? <p>Your paddle: {me.paddle}</p> : <ActionForm action={registerBidderAction.bind(null, ctx.slug)}><button type="submit">Register to bid</button></ActionForm>)}
      <table>
        <thead><tr><th scope="col">Auction</th><th scope="col">Lot</th><th scope="col">Title</th><th scope="col">Start</th><th scope="col">Closes (UTC)</th></tr></thead>
        <tbody>
          {lots.map((l) => (
            <tr key={l.id}><td>{l.auction.name}</td><td>{l.number}</td><td><Link href={`/o/${ctx.slug}/lots/${l.id}`}>{l.title}</Link></td><td>{formatCents(l.startCents)}</td><td>{l.scheduledEnd.toISOString().slice(0, 16).replace('T', ' ')}</td></tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
