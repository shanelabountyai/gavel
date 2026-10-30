import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatCents } from '@/auction/engine/money';
import { inZone } from '@/auction/house-time';
import { outcomeLabel } from '@/auction/outcome-labels';
import { recapForAuction } from '@/auction/recap';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';

export const metadata = { title: 'Sale recap' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pct = (bps: number) => `${formatCents(bps).slice(1)}%`;

// R-15 (D-86, AX-15): staff only (audit.read, as invoices and statements). Every number is derived on read from the current
// settlements and the lot states; the fixtures' recap equals brief §10 and that comparison is the test.
export default async function Recap({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org, 'audit.read');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const auction = await db.auction.findFirst({ where: { id, ...inOrg(ctx) }, select: { name: true, timeZone: true, buyerPremiumBps: true } });
  if (!auction) notFound();
  const { recap: r, lots, consignors } = await recapForAuction(ctx.orgId, id);
  const csv = (lotId?: string) => `/o/${ctx.slug}/auctions/${id}/ledger.csv${lotId ? `?lot=${lotId}` : ''}`;
  return (
    <main>
      <p className="back-links"><Link href={`/o/${ctx.slug}/auctions/${id}`}>← {auction.name}</Link></p>
      <h1>Sale recap: {auction.name}</h1>
      <p className="muted">Derived from each lot&apos;s current settlement; nothing on this page is stored. <a href={csv()} data-testid="csv-sale">Download the sale&apos;s ledger (CSV)</a>: every attempt on every lot, accepted or refused, with what each bidder saw.</p>
      <dl className="board-facts recap-facts" data-testid="recap">
        <div><dt>Offered</dt><dd data-testid="offered">{r.offered}</dd></div>
        <div><dt>Sold</dt><dd data-testid="sold">{r.sold}</dd></div>
        <div><dt>Sell-through</dt><dd data-testid="sell-through">{pct(r.sellThroughBps)}</dd></div>
        <div><dt>Hammer</dt><dd data-testid="hammer">{formatCents(r.hammerCents)}</dd></div>
        <div><dt>Premium ({pct(auction.buyerPremiumBps)})</dt><dd data-testid="premium">{formatCents(r.premiumCents)}</dd></div>
        <div><dt>Buyers owe</dt><dd>{formatCents(r.totalCents)}</dd></div>
        <div><dt>Extended</dt><dd data-testid="extended">{r.lotsExtended} {r.lotsExtended === 1 ? 'lot' : 'lots'}, {r.extensions} {r.extensions === 1 ? 'extension' : 'extensions'}</dd></div>
        {r.unsettled > 0 && <div><dt>Not settled yet</dt><dd>{r.unsettled}</dd></div>}
      </dl>
      <h2>Unsold, by outcome</h2>
      {r.unsold.length === 0 ? <p className="muted">Every settled lot sold.</p> : (
        <table data-testid="unsold"><tbody>{r.unsold.map(([o, n]) => <tr key={o}><td>{outcomeLabel(o)} <small className="muted outcome-key">{o}</small></td><td className="num">{n}</td></tr>)}</tbody></table>
      )}
      <h2>Consignors</h2>
      {consignors.length === 0 ? <p className="muted">No consignor contract on this sale; see <Link href={`/o/${ctx.slug}/auctions/${id}/statements`}>statements</Link>.</p> : (
        <table data-testid="consignors">
          <thead><tr><th scope="col">Consignor</th><th scope="col" className="num">Lots</th><th scope="col" className="num">Hammer</th><th scope="col" className="num">Commission</th><th scope="col" className="num">Fees</th><th scope="col" className="num">Net</th></tr></thead>
          <tbody>{consignors.map((c) => <tr key={c.code}><td><code>{c.code}</code> {c.name}</td><td className="num">{c.lots}</td><td className="num">{formatCents(c.hammerCents)}</td><td className="num">{formatCents(c.commissionCents)}</td><td className="num">{formatCents(c.feeCents)}</td><td className="num">{formatCents(c.netCents)}</td></tr>)}</tbody>
        </table>
      )}
      <h2>Lots</h2>
      <table data-testid="lots">
        <thead><tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col">Outcome</th><th scope="col" className="num">Hammer</th><th scope="col" className="num">Extensions</th><th scope="col">Closed</th><th scope="col">Ledger</th></tr></thead>
        <tbody>
          {lots.map((l) => (
            <tr key={l.lotId}>
              <td>{l.number}</td><td><Link href={`/o/${ctx.slug}/lots/${l.lotId}/history`}>{l.title}</Link></td>
              <td>{l.outcome ? outcomeLabel(l.outcome) : <span className="muted">not settled</span>}</td>
              <td className="num">{l.outcome === 'SOLD' ? formatCents(l.hammerCents) : <span className="muted">—</span>}</td>
              <td className="num">{l.extensionCount}</td><td>{l.closesAt ? inZone(l.closesAt, auction.timeZone) : '—'}</td>
              <td><a href={csv(l.lotId)}>CSV</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
