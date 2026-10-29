import Link from 'next/link';
import { formatCents } from '@/auction/engine/money';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { registerBidderAction } from './actions';

export const metadata = { title: 'Catalog' };

// Any member of the house. Shows the catalog only: no reserve, no max (brief §4).
export default async function Catalog({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const lots = await db.lot.findMany({ where: inOrg(ctx), orderBy: [{ auction: { opensAt: 'asc' } }, { number: 'asc' }], select: { id: true, number: true, title: true, startCents: true, scheduledEnd: true, auction: { select: { name: true } }, state: { select: { priceCents: true, acceptedCount: true, closesAt: true } }, withdrawal: { select: { withdrawnAt: true } } } });
  const t = now().getTime();
  const isWithdrawn = (l: (typeof lots)[number]) => !!l.withdrawal && l.withdrawal.withdrawnAt.getTime() <= t; // D-73
  const isClosed = (l: (typeof lots)[number]) => !l.state || l.state.closesAt.getTime() <= t || isWithdrawn(l);
  lots.sort((a, b) => Number(isClosed(a)) - Number(isClosed(b))); // open lots first; stable, so sale and lot order hold within each
  const me = ctx.role === 'member' ? await db.bidder.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } } }) : null;
  return (
    <main>
      <h1>Catalog</h1>
      {ctx.role === 'member' && (me ? <p>You bid as <strong>paddle {me.paddle}</strong>.</p> : <ActionForm action={registerBidderAction.bind(null, ctx.slug)}><p>Register once to get a paddle number, then bid on any open lot.</p><button type="submit">Register to bid</button></ActionForm>)}
      <div className="table-scroll catalog">
        <table>
          <thead><tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col">Auction</th><th scope="col" className="num">Start</th><th scope="col" className="num">Current</th><th scope="col">Closes (UTC)</th></tr></thead>
          <tbody>
            {lots.map((l) => {
              const closed = isClosed(l);
              return (
                <tr key={l.id}>
                  <td className="cat-num">{l.number}</td>
                  <td className="cat-title"><Link href={`/o/${ctx.slug}/lots/${l.id}`}>{l.title}</Link></td>
                  <td className="muted cat-auction">{l.auction.name}</td>
                  <td className="num cat-start">{formatCents(l.startCents)}</td>
                  {/* AX-01: accepted bids only; a refused attempt is a ledger row, not a bid on the lot */}
                  <td className="num cat-price">{l.state && l.state.acceptedCount > 0 ? formatCents(l.state.priceCents) : <span className="muted">No bids · opening {formatCents(l.startCents)}</span>}</td>
                  <td className="cat-time">{closed ? <span className="badge">{isWithdrawn(l) ? 'Withdrawn' : 'Closed'}</span> : (l.state?.closesAt ?? l.scheduledEnd).toISOString().slice(0, 16).replace('T', ' ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
