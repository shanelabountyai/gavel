import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatCents } from '@/auction/engine/money';
import { inZone } from '@/auction/house-time';
import { lotView, publicHistory } from '@/auction/lot-view';
import { registrationStatus } from '@/auction/registration';
import { currentTerms, unacceptedTermsSha } from '@/auction/terms';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { relistLotAction } from '../../auctions/actions';
import { registerBidderAction } from '../../catalog/actions';
import { acceptTermsAction, requestApprovalAction, withdrawLotAction } from './actions';
import { LotLive, type Viewer } from './lot-live';

export const metadata = { title: 'Lot' };
export const dynamic = 'force-dynamic';

// Task 3.4: any member of the house. First paint is the same view the poll returns (lot-view.ts); lot-live.tsx takes over.
export default async function LotPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const v = await lotView(ctx.userId, id);
  const { etag, ...view } = v ?? { etag: '' };
  const lot = v && (await db.lot.findFirst({ where: { id, orgId: ctx.orgId }, select: { number: true, title: true, category: true, estimateLowCents: true, estimateHighCents: true, conditionText: true, asIs: true, consignor: true, consignorRef: { select: { name: true } }, auctionId: true, startCents: true, reserveCents: true, auction: { select: { name: true, timeZone: true, requiresApproval: true } }, relistOf: { select: { id: true, number: true, auction: { select: { name: true } } } }, relistedAs: { select: { id: true, number: true, auction: { select: { name: true } } } }, settlements: { select: { id: true, supersedesId: true, outcome: true } } } }));
  if (!v || !lot) notFound();
  const bidder = await db.bidder.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } }, select: { id: true, paddle: true } });
  // D-72: a bidder who has not accepted the sale's current terms sees them, with one button, where the bid form would be
  const terms = bidder && (await unacceptedTermsSha(lot.auctionId, bidder.id)) ? await currentTerms(lot.auctionId) : null;
  // D-88: then, on a sale that requires approval, a bidder not yet approved sees where they stand (and the ask, once)
  const reg = !terms && bidder && lot.auction.requiresApproval ? await registrationStatus(lot.auctionId, bidder.id) : 'APPROVED';
  // Only the member role gets a paddle (D-49); everyone else is staff here, with the history link where audit.read allows.
  const viewer: Viewer = terms ? { kind: 'terms' } : reg !== 'APPROVED' ? { kind: 'approval' } : bidder ? { kind: 'bidder', paddle: bidder.paddle } : ctx.role === 'member' ? { kind: 'register' }
    : { kind: 'staff', historyHref: can(ctx.role, 'audit.read') ? `/o/${ctx.slug}/lots/${id}/history` : null, canWithdraw: can(ctx.role, 'results.write') && v.status !== 'CLOSED' }; // D-73
  // R-11 (D-83): rendered with the page, not polled. ponytail: a bidder watching a live lot reloads to see new rows; fold it
  // into the state poll if anyone asks for it live.
  const history = await publicHistory(id, bidder?.id ?? null);
  const at = (iso: string) => inZone(Date.parse(iso), lot.auction.timeZone); // R-12
  // D-89 (AX-17): staff relist a lot whose current settlement is unsold into a sale that has not opened. ponytail: only
  // sales with a first close are offered, since the relist takes first close + stagger; give the form a close field if a
  // house relists into sales that time every lot by hand.
  const superseded = new Set(lot.settlements.map((x) => x.supersedesId));
  const unsold = lot.settlements.find((x) => !superseded.has(x.id))?.outcome.startsWith('UNSOLD') ?? false;
  const targets = unsold && !lot.relistedAs && can(ctx.role, 'results.write')
    ? await db.auction.findMany({ where: { orgId: ctx.orgId, id: { not: lot.auctionId }, opensAt: { gt: now() }, firstCloseAt: { not: null } }, select: { id: true, name: true }, orderBy: { opensAt: 'asc' } })
    : null;
  const usd = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
  return (
    <main>
      <header className="lot-head">
        <p className="back-links"><Link href={`/o/${ctx.slug}/catalog`}>← {lot.auction.name} catalog</Link></p>{/* R19 */}
        <p className="lot-number">Lot {lot.number} · {lot.auction.name}</p>
        <h1>{lot.title}</h1>
        {(lot.consignorRef?.name || lot.consignor) && <p className="muted">Consigned by {lot.consignorRef?.name ?? lot.consignor}</p>}
        {/* D-91 (AX-21): shown only; no rule reads them */}
        <p className="muted" data-testid="lot-catalogue">{[lot.category, lot.estimateLowCents !== null && `Estimate ${formatCents(lot.estimateLowCents)}–${formatCents(lot.estimateHighCents!)}`, lot.asIs ? 'Sold as is' : 'Not sold as is'].filter(Boolean).join(' · ')}</p>
        {lot.conditionText && <p data-testid="lot-condition">Condition: {lot.conditionText}</p>}
        {lot.relistOf && <p className="muted" data-testid="relist-of">Relisted from <Link href={`/o/${ctx.slug}/lots/${lot.relistOf.id}`}>lot {lot.relistOf.number} of {lot.relistOf.auction.name}</Link></p>}
        {lot.relistedAs && <p data-testid="relisted-as">Unsold here; relisted as <Link href={`/o/${ctx.slug}/lots/${lot.relistedAs.id}`}>lot {lot.relistedAs.number} in {lot.relistedAs.auction.name}</Link></p>}
      </header>
      <LotLive slug={ctx.slug} lotId={id} initial={view as Omit<typeof v, 'etag'>} etag={etag} serverNowMs={now().getTime()} viewer={viewer} timeZone={lot.auction.timeZone}>
        {terms ? (
          <ActionForm action={acceptTermsAction.bind(null, ctx.slug)}>
            <input type="hidden" name="lotId" value={id} />
            <p>Accept the terms of sale for {lot.auction.name} (version {terms.version}) to bid on its lots.</p>
            <p className="terms-text" data-testid="terms-text">{terms.text}</p>
            <button type="submit">I accept the terms of sale</button>
          </ActionForm>
        ) : viewer.kind === 'approval' ? (
          reg === 'PENDING' ? <p data-testid="approval-pending">Your request to bid in {lot.auction.name} is awaiting the house&apos;s approval.</p>
          : reg === 'DECLINED' ? <p>The house has not approved you to bid in {lot.auction.name}.</p>
          : (
            <ActionForm action={requestApprovalAction.bind(null, ctx.slug)}>
              <input type="hidden" name="lotId" value={id} />
              <p>{lot.auction.name} needs the house&apos;s approval to bid. Ask once; staff approve each bidder for this sale.</p>
              <button type="submit">Ask to bid in this sale</button>
            </ActionForm>
          )
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
      {targets && (
        <section aria-labelledby="relist-h">
          <h2 id="relist-h">Relist this lot</h2>
          {targets.length === 0 ? <p className="muted">No sale of this house is still to open with a first close set. Create the next sale, then relist from here.</p> : (
            <ActionForm action={relistLotAction.bind(null, ctx.slug)}>
              <input type="hidden" name="lotId" value={id} />
              <p className="muted">A new lot in the chosen sale, with this title, description, image, estimate, condition and consignor, closing at that sale&apos;s first close plus its stagger. This lot and its record stay as they are and link to it.</p>
              <label htmlFor="relist-sale">Into sale</label>
              <select id="relist-sale" name="auctionId" required>{targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <label>Start price ($) <input name="startCents" inputMode="decimal" required defaultValue={usd(lot.startCents)} /></label>
              <label>Reserve ($, optional) <input name="reserveCents" inputMode="decimal" defaultValue={lot.reserveCents === null ? '' : usd(lot.reserveCents)} placeholder="blank = no reserve" /></label>
              <button type="submit">Relist lot</button>
            </ActionForm>
          )}
        </section>
      )}
      <section className="public-history" aria-labelledby="public-history-h">
        <h2 id="public-history-h">Bids on this lot</h2>
        {history.length === 0 ? <p className="muted" data-testid="public-history-empty">No bids yet.</p> : (
          <table data-testid="public-history">
            <thead><tr><th scope="col" className="num">#</th><th scope="col">Bidder</th><th scope="col" className="num">Price after</th><th scope="col">Placed at</th></tr></thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={h.seq} data-you={h.who === 'you' || undefined}>
                  <td className="num">{i + 1}</td><td>{h.who === 'you' ? <b>You</b> : h.who}</td>
                  <td className="num">{formatCents(h.priceAfterCents)}{h.extended && <> <span className="badge" data-tone="info">Extended</span></>}</td>
                  <td><time dateTime={h.placedAt}>{at(h.placedAt)}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">Accepted bids only, with the price each one set. Bidder numbers are for this lot alone. No maximum is ever shown.</p>
      </section>
    </main>
  );
}
