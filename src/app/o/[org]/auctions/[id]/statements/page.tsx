import Link from 'next/link';
import { notFound } from 'next/navigation';
import { statementsForAuction } from '@/auction/consignor';
import { paidInvoices } from '@/auction/payment';
import { formatCents } from '@/auction/engine/money';
import { inZone } from '@/auction/house-time';
import { outcomeLabel, paymentLabel } from '@/auction/outcome-labels';
import { prismaTx } from '@/auction/place-bid';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';

export const metadata = { title: 'Consignor statements' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pct = (bps: number) => `${formatCents(bps).slice(1)}%`;

// D-74 (AX-07): staff only (audit.read, as invoices). One statement per consignor with lots in the sale, derived on
// read from each lot's current settlement and the pair's current contract; nothing stored. The buyer's premium is not
// on this page. Read-only: no payout (non-goal). Each sold line says whether its buyer's invoice is paid (D-75, R-08).
export default async function Statements({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org, 'audit.read');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const auction = await db.auction.findFirst({ where: { id, ...inOrg(ctx) }, select: { name: true, timeZone: true } });
  if (!auction) notFound();
  const [views, paid] = await Promise.all([statementsForAuction(prismaTx(db as unknown as Prisma.TransactionClient), ctx.orgId, id), paidInvoices(ctx.orgId, { auctionId: id })]);
  const buyerStatus = new Map(paid.map((p) => [p.bidderId, p.balance.status]));
  const winnerOf = new Map(views.flatMap((v) => v.lots.map((l) => [l.lotId, l.winner] as const)));
  const titles = new Map((await db.lot.findMany({ where: { auctionId: id, ...inOrg(ctx) }, select: { id: true, title: true } })).map((l) => [l.id, l.title]));
  return (
    <main>
      <h1>Consignor statements: {auction.name}</h1>
      <p className="muted">{views.length} {views.length === 1 ? 'consignor' : 'consignors'}. Hammer less commission and fees equals net; an unsold lot owes the unsold fee only when it went to the block. <Link href={`/o/${ctx.slug}/auctions/${id}`}>Back to the sale</Link>.</p>
      {views.map((v) => (
        <section key={v.consignorId} className="invoice" data-testid={`statement-${v.code}`}>
          <h2><code>{v.code}</code> {v.name}</h2>
          {v.contract ? (
            <p className="muted">Commission {pct(v.contract.commissionBps)} of hammer, {formatCents(v.contract.lotFeeCents)} per sold lot, {formatCents(v.contract.unsoldFeeCents)} per unsold lot (contract of {inZone(v.contract.createdAt, auction.timeZone)}).</p>
          ) : <p><strong>No contract for this sale.</strong> {v.lots.length} settled {v.lots.length === 1 ? 'lot' : 'lots'} listed without money; set the terms on the sale page.</p>}
          {v.unsettled > 0 && <p className="muted">{v.unsettled} {v.unsettled === 1 ? 'lot has' : 'lots have'} not settled yet and will join the statement when {v.unsettled === 1 ? 'it does' : 'they do'}.</p>}
          {v.statement ? (
            <table>
              <thead><tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col">Outcome</th><th scope="col" className="num">Hammer</th><th scope="col" className="num">Commission</th><th scope="col" className="num">Fee</th><th scope="col" className="num">Net</th><th scope="col">Buyer</th></tr></thead>
              <tbody>
                {v.statement.lines.map((l) => (
                  <tr key={l.lotId}><td>{l.lotNumber}</td><td><Link href={`/o/${ctx.slug}/lots/${l.lotId}/history`}>{titles.get(l.lotId)}</Link></td><td>{outcomeLabel(l.outcome)}</td><td className="num">{l.outcome === 'SOLD' ? formatCents(l.hammerCents) : <span className="muted">—</span>}</td><td className="num">{formatCents(l.commissionCents)}</td><td className="num">{formatCents(l.feeCents)}</td><td className="num">{formatCents(l.netCents)}</td><td>{l.outcome === 'SOLD' ? paymentLabel(buyerStatus.get(winnerOf.get(l.lotId) ?? '') ?? 'UNPAID') : <span className="muted">—</span>}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th scope="row" colSpan={3}>Net to consignor</th><td className="num">{formatCents(v.statement.hammerCents)}</td><td className="num">{formatCents(v.statement.commissionCents)}</td><td className="num">{formatCents(v.statement.feeCents)}</td><td className="num"><strong>{formatCents(v.statement.netCents)}</strong></td><td>{(() => { const sold = v.statement.lines.filter((l) => l.outcome === 'SOLD'); const n = sold.filter((l) => buyerStatus.get(winnerOf.get(l.lotId) ?? '') === 'PAID').length; return sold.length ? `${n} of ${sold.length} paid` : ''; })()}</td></tr>
              </tfoot>
            </table>
          ) : v.lots.length > 0 && (
            <ul>{[...v.lots].sort((a, b) => a.lotNumber - b.lotNumber).map((l) => <li key={l.lotId}>Lot {l.lotNumber} {titles.get(l.lotId)}: {outcomeLabel(l.outcome)}</li>)}</ul>
          )}
        </section>
      ))}
    </main>
  );
}
