import { formatCents } from '@/auction/engine/money';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';

export const metadata = { title: 'Catalog' };

// Any member of the house. Shows the catalog only: no reserve, no max (brief §4). The bidder lot page is 3.4.
export default async function Catalog({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const lots = await db.lot.findMany({ where: inOrg(ctx), orderBy: [{ auction: { opensAt: 'asc' } }, { number: 'asc' }], select: { id: true, number: true, title: true, startCents: true, scheduledEnd: true, auction: { select: { name: true } } } });
  return (
    <main>
      <h1>Catalog</h1>
      <table>
        <thead><tr><th scope="col">Auction</th><th scope="col">Lot</th><th scope="col">Title</th><th scope="col">Start</th><th scope="col">Closes (UTC)</th></tr></thead>
        <tbody>
          {lots.map((l) => (
            <tr key={l.id}><td>{l.auction.name}</td><td>{l.number}</td><td>{l.title}</td><td>{formatCents(l.startCents)}</td><td>{l.scheduledEnd.toISOString().slice(0, 16).replace('T', ' ')}</td></tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
