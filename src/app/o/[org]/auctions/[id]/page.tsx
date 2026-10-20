import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatCents } from '@/auction/engine/money';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { createLot } from '../actions';

export const metadata = { title: 'Auction' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Auction({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org, 'results.write');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const auction = await db.auction.findFirst({ where: { id, ...inOrg(ctx) }, include: { lots: { orderBy: { number: 'asc' } } } });
  if (!auction) notFound();
  return (
    <main>
      <h1>{auction.name}</h1>
      <p>Opens {auction.opensAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · <Link href={`/o/${ctx.slug}/auctions/${id}/invoices`}>Invoices</Link></p>
      <table>
        <thead><tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col">Start</th><th scope="col">Reserve</th><th scope="col">Closes (UTC)</th></tr></thead>
        <tbody>
          {auction.lots.map((l) => (
            <tr key={l.id}><td>{l.number}</td><td><Link href={`/o/${ctx.slug}/lots/${l.id}/history`}>{l.title}</Link></td><td>{formatCents(l.startCents)}</td><td>{l.reserveCents === null ? '—' : formatCents(l.reserveCents)}</td><td>{l.scheduledEnd.toISOString().slice(0, 16).replace('T', ' ')}</td></tr>
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
