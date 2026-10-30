import Link from 'next/link';
import { formatCents } from '@/auction/engine/money';
import { inZone } from '@/auction/house-time';
import { paymentLabel, paymentTone } from '@/auction/outcome-labels';
import { paidInvoices } from '@/auction/payment';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';

export const metadata = { title: 'Your invoices' };

// D-71 (AX-06): the caller's own invoices, one per sale they won a lot in, derived on read from each lot's current
// settlement (D-42 Q1), so a correction shows with no extra step, with the payment status the house recorded (D-75).
// No id in the URL: another bidder's invoice has no address to ask for. Read-only: a bidder cannot pay here (non-goal).
export default async function YourInvoices({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const me = await db.bidder.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } }, select: { id: true, paddle: true } });
  const invoices = me ? await paidInvoices(ctx.orgId, { bidderId: me.id }) : [];
  const [auctions, lots] = await Promise.all([
    db.auction.findMany({ where: { id: { in: invoices.map((i) => i.auctionId) }, ...inOrg(ctx) }, select: { id: true, name: true, buyerPremiumBps: true, paymentDueAt: true, pickupText: true, pickupWindowText: true, timeZone: true } }),
    db.lot.findMany({ where: { id: { in: invoices.flatMap((i) => i.lots.map((l) => l.lotId)) }, ...inOrg(ctx) }, select: { id: true, title: true } }),
  ]);
  const auction = new Map(auctions.map((a) => [a.id, a]));
  const title = new Map(lots.map((l) => [l.id, l.title]));

  return (
    <main>
      <h1>Your invoices</h1>
      {!me ? (
        <p>You have not registered to bid. <Link href={`/o/${ctx.slug}/catalog`}>Register in the catalog</Link>.</p>
      ) : invoices.length === 0 ? (
        <p className="muted">Paddle {me.paddle}: no lots won yet. An invoice appears here once a lot you lead closes and settles.</p>
      ) : (
        invoices.map((i) => {
          const a = auction.get(i.auctionId);
          const pickup = [a?.pickupText, a?.pickupWindowText].filter(Boolean).join(', ');
          return (
            <section key={i.auctionId} className="invoice">
              <h2>{a?.name} · paddle {me.paddle} <span className="badge" data-tone={paymentTone(i.balance.status)}>{paymentLabel(i.balance.status)}</span></h2>
              <p>
                Payment due {a?.paymentDueAt ? <strong>{inZone(a.paymentDueAt, a.timeZone)}</strong> : <span className="muted">date to be confirmed by the house</span>}.{' '}
                Pickup: {pickup || <span className="muted">to be confirmed by the house</span>}.
              </p>
              <p className="muted">Buyer&apos;s premium {formatCents(a?.buyerPremiumBps ?? 0).slice(1)}% of hammer.{i.defaulted && <> <strong>This invoice was declared in default</strong> on {i.defaulted.declaredAt.toISOString().slice(0, 10)}; contact the house.</>}</p>
              <table>
                <thead>
                  <tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col" className="num">Hammer</th><th scope="col" className="num">Premium</th><th scope="col" className="num">Total</th></tr>
                </thead>
                <tbody>
                  {i.lots.map((l) => (
                    <tr key={l.lotId}><td>{l.lotNumber}</td><td><Link href={`/o/${ctx.slug}/lots/${l.lotId}`}>{title.get(l.lotId)}</Link></td><td className="num">{formatCents(l.hammerCents)}</td><td className="num">{formatCents(l.premiumCents)}</td><td className="num">{formatCents(l.totalCents)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><th scope="row" colSpan={2}>Lots</th><td className="num">{formatCents(i.hammerCents)}</td><td className="num">{formatCents(i.premiumCents)}</td><td className="num">{formatCents(i.hammerCents + i.premiumCents)}</td></tr>
                  {(i.taxBps > 0 || i.exemptRef) && <tr data-testid="tax-row"><th scope="row" colSpan={4}>{i.exemptRef ? `Sales tax: exempt, certificate ${i.exemptRef}` : `Sales tax ${formatCents(i.taxBps).slice(1)}% of ${i.taxBase === 'HAMMER' ? 'hammer' : 'hammer + premium'}`}</th><td className="num">{formatCents(i.taxCents)}</td></tr>}
                  <tr><th scope="row" colSpan={4}>Total due</th><td className="num" data-testid="total-due">{formatCents(i.totalCents)}</td></tr>
                  {i.marks.length > 0 && <tr><th scope="row" colSpan={4}>Paid</th><td className="num">{formatCents(i.balance.paidCents)}</td></tr>}
                  <tr><th scope="row" colSpan={4}>{i.balance.balanceCents < 0 ? 'Credit due to you' : 'Balance'}</th><td className="num"><strong>{formatCents(Math.abs(i.balance.balanceCents))}</strong></td></tr>
                </tfoot>
              </table>
            </section>
          );
        })
      )}
    </main>
  );
}
