import Link from 'next/link';
import { formatCents } from '@/auction/engine/money';
import { invoicesForBidder } from '@/auction/invoice';
import { prismaTx } from '@/auction/place-bid';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';

export const metadata = { title: 'Your invoices' };

// D-71 (AX-06): the caller's own invoices, one per sale they won a lot in, derived on read from each lot's current
// settlement (D-42 Q1), so a correction shows with no extra step. No id in the URL: another bidder's invoice has
// no address to ask for. Read-only: no payment (non-goal).
export default async function YourInvoices({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const me = await db.bidder.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } }, select: { id: true, paddle: true } });
  const invoices = me ? await invoicesForBidder(prismaTx(db as unknown as Prisma.TransactionClient), ctx.orgId, me.id) : [];
  const [auctions, lots] = await Promise.all([
    db.auction.findMany({ where: { id: { in: invoices.map((i) => i.auctionId) }, ...inOrg(ctx) }, select: { id: true, name: true, buyerPremiumBps: true, paymentDueAt: true, pickupText: true, pickupWindowText: true } }),
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
              <h2>{a?.name} · paddle {me.paddle}</h2>
              <p>
                Payment due {a?.paymentDueAt ? <strong>{a.paymentDueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</strong> : <span className="muted">date to be confirmed by the house</span>}.{' '}
                Pickup: {pickup || <span className="muted">to be confirmed by the house</span>}.
              </p>
              <p className="muted">Buyer&apos;s premium {formatCents(a?.buyerPremiumBps ?? 0).slice(1)}% of hammer.</p>
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
                  <tr><th scope="row" colSpan={2}>Due</th><td className="num">{formatCents(i.hammerCents)}</td><td className="num">{formatCents(i.premiumCents)}</td><td className="num">{formatCents(i.totalCents)}</td></tr>
                </tfoot>
              </table>
            </section>
          );
        })
      )}
    </main>
  );
}
