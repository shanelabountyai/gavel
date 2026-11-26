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
  // D-92 (AX-23): the lots this bidder watches, open first. Closed means the LotState close has passed (a withdrawal too).
  const watched = me ? await db.watch.findMany({ where: { bidderId: me.id }, select: { lot: { select: { id: true, number: true, title: true, withdrawal: { select: { id: true } }, state: { select: { closesAt: true } }, auction: { select: { name: true, timeZone: true } } } } } }) : [];
  const watching = watched.map(({ lot: l }) => ({ ...l, closed: !!l.withdrawal || !l.state || l.state.closesAt.getTime() <= t }))
    .sort((a, b) => Number(a.closed) - Number(b.closed) || (a.state?.closesAt.getTime() ?? 0) - (b.state?.closesAt.getTime() ?? 0));
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
      {me && (
        <section aria-labelledby="watching-h">
          <h2 id="watching-h">Watching</h2>
          {watching.length === 0 ? <p className="muted">No lots on your watchlist. Watch a lot from its page to be told once when it closes within a day.</p> : (
            <div className="table-scroll catalog">
              <table data-testid="watching">
                <thead><tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col">Auction</th><th scope="col">Closes</th></tr></thead>
                <tbody>
                  {watching.map((w) => (
                    <tr key={w.id}>
                      <td className="cat-num">{w.number}</td>
                      <td className="cat-title"><Link href={`/o/${ctx.slug}/lots/${w.id}`}>{w.title}</Link></td>
                      <td className="muted cat-auction">{w.auction.name}</td>
                      <td className="cat-time">{w.closed || !w.state ? <span className="badge">Closed</span> : <ClosesAt at={w.state.closesAt} nowMs={t} tz={w.auction.timeZone} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
