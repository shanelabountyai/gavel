import { notFound } from 'next/navigation';
import { lotView } from '@/auction/lot-view';
import { currentTerms, unacceptedTermsSha } from '@/auction/terms';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { registerBidderAction } from '../../catalog/actions';
import { acceptTermsAction, withdrawLotAction } from './actions';
import { LotLive, type Viewer } from './lot-live';

export const metadata = { title: 'Lot' };
export const dynamic = 'force-dynamic';

// Task 3.4: any member of the house. First paint is the same view the poll returns (lot-view.ts); lot-live.tsx takes over.
export default async function LotPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const v = await lotView(ctx.userId, id);
  const { etag, ...view } = v ?? { etag: '' };
  const lot = v && (await db.lot.findFirst({ where: { id, orgId: ctx.orgId }, select: { number: true, title: true, consignor: true, auctionId: true, auction: { select: { name: true } } } }));
  if (!v || !lot) notFound();
  const bidder = await db.bidder.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } }, select: { id: true, paddle: true } });
  // D-72: a bidder who has not accepted the sale's current terms sees them, with one button, where the bid form would be
  const terms = bidder && (await unacceptedTermsSha(lot.auctionId, bidder.id)) ? await currentTerms(lot.auctionId) : null;
  // Only the member role gets a paddle (D-49); everyone else is staff here, with the history link where audit.read allows.
  const viewer: Viewer = terms ? { kind: 'terms' } : bidder ? { kind: 'bidder', paddle: bidder.paddle } : ctx.role === 'member' ? { kind: 'register' }
    : { kind: 'staff', historyHref: can(ctx.role, 'audit.read') ? `/o/${ctx.slug}/lots/${id}/history` : null, canWithdraw: can(ctx.role, 'results.write') && v.status !== 'CLOSED' }; // D-73
  return (
    <main>
      <header className="lot-head">
        <p className="lot-number">Lot {lot.number} · {lot.auction.name}</p>
        <h1>{lot.title}</h1>
        {lot.consignor && <p className="muted">Consigned by {lot.consignor}</p>}
      </header>
      <LotLive slug={ctx.slug} lotId={id} initial={view as Omit<typeof v, 'etag'>} etag={etag} serverNowMs={now().getTime()} viewer={viewer}>
        {terms ? (
          <ActionForm action={acceptTermsAction.bind(null, ctx.slug)}>
            <input type="hidden" name="lotId" value={id} />
            <p>Accept the terms of sale for {lot.auction.name} (version {terms.version}) to bid on its lots.</p>
            <p className="terms-text" data-testid="terms-text">{terms.text}</p>
            <button type="submit">I accept the terms of sale</button>
          </ActionForm>
        ) : viewer.kind === 'staff' ? (
          <ActionForm action={withdrawLotAction.bind(null, ctx.slug)}>
            <input type="hidden" name="lotId" value={id} />
            <p className="muted">Withdrawing closes the lot now, voids every bid on it and tells the high bidder. The reason goes on the record.</p>
            <label>Reason <input name="reason" required maxLength={500} placeholder="e.g. title problem, damage, consignor pulled it" /></label>
            <button type="submit">Withdraw lot</button>
          </ActionForm>
        ) : (
          <ActionForm action={registerBidderAction.bind(null, ctx.slug)}><p>Register once to get a paddle number, then bid on this lot.</p><button type="submit">Register to bid</button></ActionForm>
        )}
      </LotLive>
    </main>
  );
}
