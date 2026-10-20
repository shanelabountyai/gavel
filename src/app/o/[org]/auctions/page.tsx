import Link from 'next/link';
import { requireOrg, inOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { createAuction } from './actions';

export const metadata = { title: 'Auctions' };

export default async function Auctions({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org, 'results.write');
  const auctions = await db.auction.findMany({ where: inOrg(ctx), orderBy: { opensAt: 'asc' }, include: { _count: { select: { lots: true } } } });
  return (
    <main>
      <h1>Auctions</h1>
      <ul>
        {auctions.map((a) => (
          <li key={a.id}><Link href={`/o/${ctx.slug}/auctions/${a.id}`}>{a.name}</Link> · opens {a.opensAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · {a._count.lots} lots</li>
        ))}
      </ul>
      <h2>New auction</h2>
      <ActionForm action={createAuction.bind(null, ctx.slug)}>
        <label>Name <input name="name" required maxLength={120} /></label>
        <label>Opens (UTC) <input name="opensAt" type="datetime-local" required /></label>
        <button type="submit">Create auction</button>
      </ActionForm>
    </main>
  );
}
