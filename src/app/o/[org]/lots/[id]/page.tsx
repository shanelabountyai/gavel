import { notFound } from 'next/navigation';
import { lotView } from '@/auction/lot-view';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { registerBidderAction } from '../../catalog/actions';
import { LotLive, type Viewer } from './lot-live';

export const metadata = { title: 'Lot' };
export const dynamic = 'force-dynamic';

// Task 3.4: any member of the house. First paint is the same view the poll returns (lot-view.ts); lot-live.tsx takes over.
export default async function LotPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const v = await lotView(ctx.userId, id);
  const { etag, ...view } = v ?? { etag: '' };
  const lot = v && (await db.lot.findFirst({ where: { id, orgId: ctx.orgId }, select: { number: true, title: true, consignor: true, auction: { select: { name: true } } } }));
  if (!v || !lot) notFound();
  const bidder = await db.bidder.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } }, select: { paddle: true } });
  // Only the member role gets a paddle (D-49); everyone else is staff here, with the history link where audit.read allows.
  const viewer: Viewer = bidder ? { kind: 'bidder', paddle: bidder.paddle } : ctx.role === 'member' ? { kind: 'register' }
    : { kind: 'staff', historyHref: can(ctx.role, 'audit.read') ? `/o/${ctx.slug}/lots/${id}/history` : null };
  return (
    <main>
      <header className="lot-head">
        <p className="lot-number">Lot {lot.number} · {lot.auction.name}</p>
        <h1>{lot.title}</h1>
        {lot.consignor && <p className="muted">Consigned by {lot.consignor}</p>}
      </header>
      <LotLive slug={ctx.slug} lotId={id} initial={view as Omit<typeof v, 'etag'>} etag={etag} serverNowMs={now().getTime()} viewer={viewer}>
        <ActionForm action={registerBidderAction.bind(null, ctx.slug)}><p>Register once to get a paddle number, then bid on this lot.</p><button type="submit">Register to bid</button></ActionForm>
      </LotLive>
    </main>
  );
}
