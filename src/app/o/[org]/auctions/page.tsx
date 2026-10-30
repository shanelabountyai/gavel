import Link from 'next/link';
import { requireOrg, inOrg } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { createAuction } from './actions';
import { DateTimeUtc } from './datetime-utc';

export const metadata = { title: 'Auctions' };

export default async function Auctions({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org, 'results.write');
  const auctions = await db.auction.findMany({ where: inOrg(ctx), orderBy: { opensAt: 'asc' }, include: { _count: { select: { lots: true } }, lots: { select: { state: { select: { closesAt: true } } } } } });
  const t = now().getTime();
  // UX-16: Scheduled until it opens, Closed once every lot has closed (a sale with no lots stays Open), Open between.
  const status = (a: (typeof auctions)[number]) =>
    a.opensAt.getTime() > t ? { text: 'Scheduled', tone: 'info' } : a.lots.length > 0 && a.lots.every((l) => !l.state || l.state.closesAt.getTime() <= t) ? { text: 'Closed', tone: 'plain' } : { text: 'Open', tone: 'lead' };
  return (
    <main>
      <h1>Auctions</h1>
      <ul>
        {auctions.map((a) => (
          <li key={a.id}><Link href={`/o/${ctx.slug}/auctions/${a.id}`}>{a.name}</Link> <span className="badge" data-tone={status(a).tone}>{status(a).text}</span> · opens {a.opensAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · {a._count.lots} lots</li>
        ))}
      </ul>
      <h2>New auction</h2>
      <ActionForm action={createAuction.bind(null, ctx.slug)}>
        <label>Name <input name="name" required maxLength={120} /></label>
        <DateTimeUtc name="opensAt" label="Opens (UTC)" serverNowMs={t} required future="opens in" past="opened" />
        <button type="submit">Create auction</button>
      </ActionForm>
    </main>
  );
}
