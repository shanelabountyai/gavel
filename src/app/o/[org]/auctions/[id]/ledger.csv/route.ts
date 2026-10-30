import { notFound } from 'next/navigation';
import { ledgerCsv, ledgerRows } from '@/auction/recap';
import { AuthzError, inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// R-15 (D-86): the sale's ledger as CSV, or one lot's with ?lot=<id>. Staff (audit.read), read-only; another house's
// sale or lot is a 404 (INV-02). The first await is requireOrg, so an anonymous caller is redirected to /login.
export async function GET(req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  let ctx;
  try { ctx = await requireOrg((await params).org, 'audit.read'); } catch (e) { if (e instanceof AuthzError) return new Response('Forbidden', { status: 403 }); throw e; }
  const { id } = await params;
  const lotId = new URL(req.url).searchParams.get('lot') ?? undefined;
  if (!UUID.test(id) || (lotId && !UUID.test(lotId))) notFound();
  const auction = await db.auction.findFirst({ where: { id, ...inOrg(ctx) }, select: { name: true } });
  const lot = lotId ? await db.lot.findFirst({ where: { id: lotId, auctionId: id, ...inOrg(ctx) }, select: { number: true } }) : null;
  if (!auction || (lotId && !lot)) notFound();
  const name = `${auction.name}${lot ? ` lot ${lot.number}` : ''} ledger.csv`.replace(/[^\w. -]+/g, '_');
  return new Response(ledgerCsv(await ledgerRows(ctx.orgId, id, lotId)), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' } });
}
