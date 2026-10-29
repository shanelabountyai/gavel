import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { createConsignorAction } from '../auctions/actions';

export const metadata = { title: 'Consignors' };

// D-74 (AX-07): the house's consignors. Reference data only; the money terms are per sale, on the auction page.
export default async function Consignors({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org, 'results.write');
  const consignors = await db.consignor.findMany({ where: { orgId: ctx.orgId }, orderBy: { code: 'asc' }, include: { _count: { select: { lots: true, contracts: true } } } });
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
      <p><Link href={`/o/${ctx.slug}/auctions`}>Auctions</Link></p>
    </main>
  );
}
