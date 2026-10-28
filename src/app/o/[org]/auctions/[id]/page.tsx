import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatCents } from '@/auction/engine/money';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { createLot, updateSaleTerms } from '../actions';

export const metadata = { title: 'Auction' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Auction({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org, 'results.write');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const auction = await db.auction.findFirst({ where: { id, ...inOrg(ctx) }, include: { lots: { orderBy: { number: 'asc' } } } });
  if (!auction) notFound();
  const hasBids = (await db.bid.count({ where: { lot: { auctionId: id } }, take: 1 })) > 0;
  const due = auction.paymentDueAt?.toISOString().slice(0, 16);
  return (
    <main>
      <h1>{auction.name}</h1>
      <p className="muted">Opens {auction.opensAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. Soft close: a bid in the last {auction.softCloseWindowSeconds / 60} min extends the lot, up to {auction.maxExtensionSeconds / 60} min in all. Buyer&apos;s premium {formatCents(auction.buyerPremiumBps).slice(1)}%.</p>
      <p><Link href={`/o/${ctx.slug}/auctions/${id}/invoices`}>Invoices for this sale</Link></p>
      <h2>Payment and pickup</h2>
      {hasBids ? (
        <p>Payment due {due ? `${due.replace('T', ' ')} UTC` : <span className="muted">not set</span>}. Pickup: {auction.pickupText || <span className="muted">not set</span>}{auction.pickupWindowText && `, ${auction.pickupWindowText}`}. <span className="muted">Fixed: the sale has bids.</span></p>
      ) : (
        <ActionForm action={updateSaleTerms.bind(null, ctx.slug)}>
          <p className="muted">Shown on each buyer&apos;s invoice and in the won notice. Fixed once the sale has a bid.</p>
          <input type="hidden" name="auctionId" value={id} />
          <label>Payment due (UTC, optional) <input name="paymentDueAt" type="datetime-local" defaultValue={due} /></label>
          <label>Pickup instructions <input name="pickupText" maxLength={500} defaultValue={auction.pickupText} /></label>
          <label>Pickup window <input name="pickupWindowText" maxLength={200} defaultValue={auction.pickupWindowText} placeholder="e.g. Sat 9:00–12:00" /></label>
          <button type="submit">Save payment and pickup</button>
        </ActionForm>
      )}
      <table>
        <thead><tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col" className="num">Start</th><th scope="col" className="num">Reserve</th><th scope="col">Closes (UTC)</th></tr></thead>
        <tbody>
          {auction.lots.map((l) => (
            <tr key={l.id}><td>{l.number}</td><td><Link href={`/o/${ctx.slug}/lots/${l.id}`}>{l.title}</Link> · <Link href={`/o/${ctx.slug}/lots/${l.id}/history`} className="muted">History</Link></td><td className="num">{formatCents(l.startCents)}</td><td className="num">{l.reserveCents === null ? <span className="muted">None</span> : formatCents(l.reserveCents)}</td><td>{l.scheduledEnd.toISOString().slice(0, 16).replace('T', ' ')}</td></tr>
          ))}
        </tbody>
      </table>
      <h2>New lot</h2>
      <ActionForm action={createLot.bind(null, ctx.slug)}>
        <input type="hidden" name="auctionId" value={id} />
        <label>Title <input name="title" required maxLength={200} /></label>
        <label>Consignor <input name="consignor" maxLength={200} /></label>
        <label>Start price (cents) <input name="startCents" inputMode="numeric" required /></label>
        <label>Reserve (cents, optional) <input name="reserveCents" inputMode="numeric" /></label>
        <label>Closes (UTC) <input name="scheduledEnd" type="datetime-local" required /></label>
        <button type="submit">Create and publish lot</button>
      </ActionForm>
    </main>
  );
}
