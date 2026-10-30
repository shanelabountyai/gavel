import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatCents } from '@/auction/engine/money';
import { currentSettlements } from '@/auction/invoice';
import { outcomeLabel } from '@/auction/outcome-labels';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { currentContracts } from '@/auction/consignor';
import { acceptancesFor, currentTerms } from '@/auction/terms';
import { createLot, publishTermsAction, setContractAction, updateSaleTerms } from '../actions';
import { DateTimeUtc } from '../datetime-utc';

export const metadata = { title: 'Auction' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Auction({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ new?: string }> }) {
  const ctx = await requireOrg((await params).org, 'results.write');
  const { id } = await params;
  const newId = (await searchParams).new;
  if (!UUID.test(id)) notFound();
  const auction = await db.auction.findFirst({ where: { id, ...inOrg(ctx) }, include: { lots: { orderBy: { number: 'asc' }, include: { consignorRef: { select: { code: true } }, state: { select: { priceCents: true, acceptedCount: true, closesAt: true } }, withdrawal: { select: { withdrawnAt: true } } } } } });
  if (!auction) notFound();
  const settled = await currentSettlements(ctx.orgId, id);
  const t = now().getTime();
  const published = auction.lots.find((l) => l.id === newId);
  // UX-16: derived, as the catalog derives it (D-21): nothing stores a status.
  const status = (l: (typeof auction.lots)[number]) => {
    const s = settled.get(l.id);
    if (s) return { text: `Settled: ${outcomeLabel(s.outcome)}`, tone: s.outcome === 'SOLD' ? 'good' : 'plain' };
    if (l.withdrawal && l.withdrawal.withdrawnAt.getTime() <= t) return { text: 'Withdrawn, awaiting settlement', tone: 'plain' };
    if (auction.opensAt.getTime() > t) return { text: 'Scheduled', tone: 'info' };
    if (!l.state || l.state.closesAt.getTime() <= t) return { text: 'Closed, awaiting settlement', tone: 'warn' };
    return { text: 'Open', tone: 'lead' };
  };
  const hasBids = (await db.bid.count({ where: { lot: { auctionId: id } }, take: 1 })) > 0;
  const due = auction.paymentDueAt?.toISOString().slice(0, 16);
  const [terms, accepted, contracts, consignors] = await Promise.all([currentTerms(id), acceptancesFor(id), currentContracts(ctx.orgId, id), db.consignor.findMany({ where: inOrg(ctx), orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } })]);
  const pct = (bps: number) => `${formatCents(bps).slice(1)}%`;
  const taxText = auction.taxBps === 0 ? 'No sales tax.' : `Sales tax ${pct(auction.taxBps)} of ${auction.taxBase === 'HAMMER' ? 'hammer' : 'hammer + premium'}, once per invoice.`;
  return (
    <main>
      <h1>{auction.name}</h1>
      <p className="muted">Opens {auction.opensAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. Soft close: a bid in the last {auction.softCloseWindowSeconds / 60} min extends the lot, up to {auction.maxExtensionSeconds / 60} min in all. Buyer&apos;s premium {formatCents(auction.buyerPremiumBps).slice(1)}%.</p>
      <p><Link href={`/o/${ctx.slug}/auctions/${id}/invoices`}>Invoices for this sale</Link> · <Link href={`/o/${ctx.slug}/auctions/${id}/statements`}>Consignor statements</Link></p>
      <h2>Payment and pickup</h2>
      {hasBids ? (
        <p>Payment due {due ? `${due.replace('T', ' ')} UTC` : <span className="muted">not set</span>}. Pickup: {auction.pickupText || <span className="muted">not set</span>}{auction.pickupWindowText && `, ${auction.pickupWindowText}`}. <span data-testid="tax-fixed">{taxText}</span> <span className="muted">Fixed: the sale has bids.</span></p>
      ) : (
        <ActionForm action={updateSaleTerms.bind(null, ctx.slug)}>
          <p className="muted">Shown on each buyer&apos;s invoice and in the won notice. Fixed once the sale has a bid.</p>
          <input type="hidden" name="auctionId" value={id} />
          <DateTimeUtc name="paymentDueAt" label="Payment due (UTC, optional)" serverNowMs={t} defaultValue={due} future="due in" past="was due" />
          <label>Pickup instructions <input name="pickupText" maxLength={500} defaultValue={auction.pickupText} /></label>
          <label>Pickup window <input name="pickupWindowText" maxLength={200} defaultValue={auction.pickupWindowText} placeholder="e.g. Sat 9:00–12:00" /></label>
          <label>Sales tax (bps, 0 = none) <input name="taxBps" inputMode="numeric" defaultValue={auction.taxBps} required /></label>
          <label>Taxed on <select name="taxBase" defaultValue={auction.taxBase}><option value="HAMMER">Hammer only</option><option value="HAMMER_PLUS_PREMIUM">Hammer + premium</option></select></label>
          <p className="muted form-explain">Tax is configuration, not advice: the rate and the base depend on where the sale happens. Exempt bidders (certificate on file, Bidders page) owe no tax.</p>
          <button type="submit">Save payment and pickup</button>
        </ActionForm>
      )}
      <h2>Terms of sale</h2>
      {terms ? (
        <section data-testid="terms-current">
          <p className="muted">Version {terms.version}, published {terms.publishedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. Hash <code>{terms.sha256.slice(0, 12)}</code>. Bidders accept this version before they bid.</p>
          <p className="terms-text">{terms.text}</p>
        </section>
      ) : <p className="muted">No terms of sale yet: bidders may bid without accepting any.</p>}
      {hasBids ? <p className="muted">Fixed since bidding started; no new version can be published.</p> : (
        <ActionForm action={publishTermsAction.bind(null, ctx.slug)}>
          <input type="hidden" name="auctionId" value={id} />
          <label>{terms ? 'New version of the terms' : 'Terms of sale'} <textarea name="text" rows={6} maxLength={20_000} required defaultValue={terms?.text} /></label>
          <button type="submit">{terms ? 'Publish a new version' : 'Publish terms'}</button>
        </ActionForm>
      )}
      {accepted.length > 0 && (
        <table data-testid="terms-acceptances">
          <thead><tr><th scope="col">Paddle</th><th scope="col" className="num">Version</th><th scope="col">Hash</th><th scope="col">Accepted (UTC)</th></tr></thead>
          <tbody>
            {accepted.map((a) => <tr key={`${a.bidderId}-${a.sha256}`}><td>#{a.paddle}</td><td className="num">{a.version ?? '?'}</td><td><code>{a.sha256.slice(0, 12)}</code></td><td>{a.acceptedAt.toISOString().slice(0, 19).replace('T', ' ')}</td></tr>)}
          </tbody>
        </table>
      )}
      <h2>Consignor contracts</h2>
      {contracts.length === 0 ? <p className="muted">No contracts for this sale yet. A consignor&apos;s lots settle without a statement until one is set.</p> : (
        <table data-testid="contracts">
          <thead><tr><th scope="col">Consignor</th><th scope="col" className="num">Commission</th><th scope="col" className="num">Per sold lot</th><th scope="col" className="num">Per unsold lot</th><th scope="col">Since (UTC)</th></tr></thead>
          <tbody>
            {contracts.map((c) => <tr key={c.id}><td><code>{c.consignor.code}</code> {c.consignor.name}</td><td className="num">{pct(c.commissionBps)}</td><td className="num">{formatCents(c.lotFeeCents)}</td><td className="num">{formatCents(c.unsoldFeeCents)}</td><td>{c.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td></tr>)}
          </tbody>
        </table>
      )}
      {consignors.length === 0 ? <p className="muted"><Link href={`/o/${ctx.slug}/consignors`}>Add a consignor</Link> before setting a contract.</p> : (
        <ActionForm action={setContractAction.bind(null, ctx.slug)}>
          <p className="muted">Whole units: 1250 bps is 12.50%; fees in cents. Saving again supersedes the pair&apos;s current contract; the statement is always drawn from the latest.</p>
          <input type="hidden" name="auctionId" value={id} />
          <label>Consignor <select name="consignorId" required defaultValue="">{[<option key="" value="" disabled>Choose</option>, ...consignors.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)]}</select></label>
          <label>Commission (bps) <input name="commissionBps" inputMode="numeric" required /></label>
          <label>Fee per sold lot (cents) <input name="lotFeeCents" inputMode="numeric" required defaultValue="0" /></label>
          <label>Fee per unsold lot (cents) <input name="unsoldFeeCents" inputMode="numeric" required defaultValue="0" /></label>
          <button type="submit">Set contract</button>
        </ActionForm>
      )}
      <h2>Lots</h2>
      {published && <p role="status" data-testid="published">Lot {published.number} published.</p>}
      <table>
        <thead><tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Consignor</th><th scope="col" className="num">Start</th><th scope="col" className="num">Reserve</th><th scope="col" className="num">Current</th><th scope="col" className="num">Bids</th><th scope="col">Closes (UTC)</th></tr></thead>
        <tbody>
          {auction.lots.map((l) => {
            const st = status(l);
            const s = settled.get(l.id);
            return (
              <tr key={l.id} data-testid={`lot-row-${l.number}`} className={l.id === newId ? 'row-new' : undefined}><td>{l.number}</td><td><Link href={`/o/${ctx.slug}/lots/${l.id}`}>{l.title}</Link> · <Link href={`/o/${ctx.slug}/lots/${l.id}/history`} className="muted">History</Link></td><td><span className="badge" data-tone={st.tone} data-testid="lot-status">{st.text}</span></td><td>{l.consignorRef ? <code>{l.consignorRef.code}</code> : l.consignor || <span className="muted">None</span>}</td><td className="num">{formatCents(l.startCents)}</td><td className="num">{l.reserveCents === null ? <span className="muted">None</span> : formatCents(l.reserveCents)}</td><td className="num">{s?.outcome === 'SOLD' ? formatCents(s.hammerCents) : l.state && l.state.acceptedCount > 0 ? formatCents(l.state.priceCents) : <span className="muted">—</span>}</td><td className="num">{l.state?.acceptedCount ?? 0}</td><td>{(l.state?.closesAt ?? l.scheduledEnd).toISOString().slice(0, 16).replace('T', ' ')}</td></tr>
            );
          })}
        </tbody>
      </table>
      <h2>New lot</h2>
      <ActionForm action={createLot.bind(null, ctx.slug)}>
        <input type="hidden" name="auctionId" value={id} />
        <label>Title <input name="title" required maxLength={200} /></label>
        <label>Consignor (optional) <select name="consignorId" defaultValue=""><option value="">None</option>{consignors.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
        <label>Start price ($) <input name="startCents" inputMode="decimal" required placeholder="150 or 150.50" /></label>
        <label>Reserve ($, optional) <input name="reserveCents" inputMode="decimal" placeholder="blank = no reserve" /></label>
        <DateTimeUtc name="scheduledEnd" label="Closes (UTC)" serverNowMs={t} required future="closes in" past="closed" />
        <button type="submit">Create and publish lot</button>
      </ActionForm>
    </main>
  );
}
