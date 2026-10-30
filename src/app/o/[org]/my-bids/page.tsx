import Link from 'next/link';
import { myBids } from '@/auction/lot-view';
import { standingLabel, standingTone } from '@/auction/outcome-labels';
import { requireOrg } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ClosesAt } from '../catalog/closes-at';

export const metadata = { title: 'Your bids' };

// R9 (D-80): every lot the caller holds an accepted bid on, with their standing, so a bidder outbid on one lot finds out
// without opening it (notices are capture-only, D-53 g). Read-only, no lock (D-50 e). Staff have no paddle and see nothing here.
export default async function YourBids({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const me = await db.bidder.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } }, select: { id: true, paddle: true } });
  const bids = me ? await myBids(ctx.orgId, me.id) : [];
  bids.sort((a, b) => Number(a.closed) - Number(b.closed)); // open lots first; stable, so close order holds within each
  const t = now().getTime();
  return (
    <main>
      <h1>Your bids</h1>
      {!me ? (
        <p>You have not registered to bid. <Link href={`/o/${ctx.slug}/catalog`}>Register in the catalog</Link>.</p>
      ) : bids.length === 0 ? (
        <p className="muted">Paddle {me.paddle}: no bids yet. Lots you bid on appear here with whether you lead, were outbid, or won.</p>
      ) : (
        <div className="table-scroll catalog">
          <table>
            <thead><tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col">Auction</th><th scope="col">You</th><th scope="col">Closes</th></tr></thead>
            <tbody>
              {bids.map((b) => (
                <tr key={b.lotId}>
                  <td className="cat-num">{b.number}</td>
                  <td className="cat-title"><Link href={`/o/${ctx.slug}/lots/${b.lotId}`}>{b.title}</Link></td>
                  <td className="muted cat-auction">{b.auction}</td>
                  <td className="cat-you"><span className="badge" data-tone={standingTone(b.standing)}>{standingLabel(b.standing)}</span></td>
                  <td className="cat-time">{b.closed ? <span className="badge">Closed</span> : <ClosesAt at={new Date(b.closesAtMs)} nowMs={t} tz={b.timeZone} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
