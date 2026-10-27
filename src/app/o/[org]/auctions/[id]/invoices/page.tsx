import { notFound } from 'next/navigation';
import { formatCents } from '@/auction/engine/money';
import { invoicesForAuction } from '@/auction/invoice';
import { prismaTx } from '@/auction/place-bid';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';

export const metadata = { title: 'Invoices' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Task 2.1: staff only (owner/admin, the foundation's audit.read). Derived on read from each lot's current
// settlement (D-42 Q1); an unsold lot and a bidder with no wins appear nowhere. Read-only: no payment (non-goal).
export default async function Invoices({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org, 'audit.read');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const auction = await db.auction.findFirst({ where: { id, ...inOrg(ctx) }, select: { name: true, buyerPremiumBps: true } });
  if (!auction) notFound();
  const invoices = await invoicesForAuction(prismaTx(db as unknown as Prisma.TransactionClient), ctx.orgId, id);
  const ids = [...new Set([...invoices.map((i) => i.bidderId), ...invoices.flatMap((i) => i.lots.map((l) => l.lotId))])];
  const [bidders, lots] = await Promise.all([
    db.bidder.findMany({ where: { id: { in: ids }, ...inOrg(ctx) }, select: { id: true, paddle: true, user: { select: { name: true, email: true } } } }),
    db.lot.findMany({ where: { id: { in: ids }, ...inOrg(ctx) }, select: { id: true, title: true } }),
  ]);
  const bidder = new Map(bidders.map((b) => [b.id, b]));
  const title = new Map(lots.map((l) => [l.id, l.title]));

  return (
    <main>
      <h1>Invoices: {auction.name}</h1>
      <p className="muted">Buyer&apos;s premium {formatCents(auction.buyerPremiumBps).slice(1)}% of hammer. {invoices.length} {invoices.length === 1 ? 'buyer' : 'buyers'}.</p>
      {invoices.map((i) => {
        const b = bidder.get(i.bidderId);
        return (
          <section key={i.bidderId} className="invoice">
            <h2>Paddle {b?.paddle} · {b?.user.name ?? b?.user.email}</h2>
            <table>
              <thead>
                <tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col" className="num">Hammer</th><th scope="col" className="num">Premium</th><th scope="col" className="num">Total</th></tr>
              </thead>
              <tbody>
                {i.lots.map((l) => (
                  <tr key={l.lotId}><td>{l.lotNumber}</td><td>{title.get(l.lotId)}</td><td className="num">{formatCents(l.hammerCents)}</td><td className="num">{formatCents(l.premiumCents)}</td><td className="num">{formatCents(l.totalCents)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th scope="row" colSpan={2}>Due</th><td className="num">{formatCents(i.hammerCents)}</td><td className="num">{formatCents(i.premiumCents)}</td><td className="num">{formatCents(i.totalCents)}</td></tr>
              </tfoot>
            </table>
          </section>
        );
      })}
    </main>
  );
}
