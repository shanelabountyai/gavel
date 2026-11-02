import Link from 'next/link';
import { linkedBids } from '@/auction/consignor';
import { formatCents } from '@/auction/engine/money';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { createConsignorAction, linkBidderAction, retractLinkAction } from '../auctions/actions';

export const metadata = { title: 'Consignors' };

// D-74 (AX-07): the house's consignors. Reference data only; the money terms are per sale, on the auction page.
export default async function Consignors({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org, 'results.write');
  const [consignors, links, bids] = await Promise.all([
    db.consignor.findMany({ where: { orgId: ctx.orgId }, orderBy: { code: 'asc' }, include: { _count: { select: { lots: true, contracts: true } } } }),
    db.consignorBidderLink.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: 'asc' }, include: { consignor: { select: { code: true } }, bidder: { select: { paddle: true } }, retraction: true } }),
    linkedBids(ctx.orgId),
  ]);
  return (
    <main>
      <h1>Consignors</h1>
      <p className="muted">Synthetic only: no real consignor. A consignor&apos;s commission and fees are set per sale on that sale&apos;s page; the statement is on the sale&apos;s Statements page.</p>
      {consignors.length === 0 ? <p className="muted">No consignors yet.</p> : (
        <table data-testid="consignors">
          <thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col" className="num">Lots</th><th scope="col" className="num">Contracts</th></tr></thead>
          <tbody>
            {consignors.map((c) => <tr key={c.id}><td><code>{c.code}</code></td><td>{c.name}</td><td className="num">{c._count.lots}</td><td className="num">{c._count.contracts}</td></tr>)}
          </tbody>
        </table>
      )}
      <h2>New consignor</h2>
      <ActionForm action={createConsignorAction.bind(null, ctx.slug)}>
        <label>Code <input name="code" required maxLength={40} placeholder="e.g. EST-041" /></label>
        <label>Name <input name="name" required maxLength={200} /></label>
        <button type="submit">Add consignor</button>
      </ActionForm>
      {/* D-93 (AX-22): a report a person reads. Nothing here blocks or flags a bid. */}
      <h2>Linked bidders</h2>
      <p className="muted">Record a bidder who is linked to a consignor (family, staff, agent). The report below lists that bidder&apos;s accepted bids on that consignor&apos;s lots. Whether such bidding is allowed varies by place and is for counsel. A link entered by mistake can be retracted with a reason; it then leaves the report but stays listed here. Nothing is deleted. Lots with only a free-text consignor are not covered.</p>
      {links.length > 0 && (
        <table data-testid="links">
          <thead><tr><th scope="col">Consignor</th><th scope="col" className="num">Paddle</th><th scope="col">Reason</th><th scope="col">Recorded</th><th scope="col">Retraction</th></tr></thead>
          <tbody>
            {links.map((k) => (
              <tr key={k.id}>
                <td><code>{k.consignor.code}</code></td><td className="num">{k.bidder.paddle}</td><td>{k.reason}</td><td>{k.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</td>
                <td>{k.retraction ? <>Retracted: {k.retraction.reason} ({k.retraction.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC)</> : (
                  <ActionForm action={retractLinkAction.bind(null, ctx.slug)}>
                    <input type="hidden" name="linkId" value={k.id} />
                    <label htmlFor={`retract-${k.id}`}>Why retract</label>
                    <input id={`retract-${k.id}`} name="reason" required maxLength={200} placeholder="e.g. wrong paddle" />
                    <button type="submit">Retract</button>
                  </ActionForm>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {consignors.length > 0 && (
        <ActionForm action={linkBidderAction.bind(null, ctx.slug)}>
          <label htmlFor="link-consignor">Consignor</label>
          <select id="link-consignor" name="consignorId" required>{consignors.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
          <label>Paddle <input name="paddle" required inputMode="numeric" pattern="\d{1,6}" /></label>
          <label>Reason <input name="reason" required maxLength={200} placeholder="e.g. consignor's brother" /></label>
          <button type="submit">Link bidder</button>
        </ActionForm>
      )}
      <h2>Bids by linked bidders</h2>
      {bids.length === 0 ? <p className="muted">No accepted bids by a linked bidder on that consignor&apos;s lots.</p> : (
        <table data-testid="linked-bids">
          <thead><tr><th scope="col">Consignor</th><th scope="col" className="num">Paddle</th><th scope="col">Sale</th><th scope="col">Lot</th><th scope="col" className="num">Seq</th><th scope="col" className="num">Max bid</th><th scope="col" className="num">Price after</th><th scope="col">Leading after</th><th scope="col">Placed</th></tr></thead>
          <tbody>
            {bids.map((b) => (
              <tr key={`${b.lotId}-${b.seq}`}>
                <td><code>{b.code}</code></td><td className="num">{b.paddle}</td><td>{b.auctionName}</td>
                <td><Link href={`/o/${ctx.slug}/lots/${b.lotId}/history`}>Lot {b.lotNumber}</Link></td>
                <td className="num">{b.seq}</td><td className="num">{formatCents(b.maxCents)}</td><td className="num">{formatCents(b.priceAfterCents)}</td>
                <td>{b.ledAfter ? 'Yes' : 'No'}</td><td>{b.placedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p><Link href={`/o/${ctx.slug}/auctions`}>Auctions</Link></p>
    </main>
  );
}
