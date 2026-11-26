import Link from 'next/link';
import { liveRows, lotStatus } from '@/auction/engine/engine';
import { can } from '@/core/authz/permissions';
import { now } from '@/core/clock';
import { ActionForm } from '@/core/ui/action-form';
import { voidBidsAction } from '../actions';
import { notFound } from 'next/navigation';
import { formatCents } from '@/auction/engine/money';
import { formatLeft } from '@/auction/time-left';
import { outcomeLabel, outcomeTone } from '@/auction/outcome-labels';
import { prismaTx } from '@/auction/place-bid';
import { registrationsFor } from '@/auction/registration';
import { acceptancesFor, currentTerms } from '@/auction/terms';
import { loadLot } from '@/auction/verify-sql';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';

export const metadata = { title: 'Lot history' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date) => d.toISOString();

// Task 2.3: staff only (audit.read). Every Bid row in seq order, accepted or rejected, then the settlement chain.
// One form (D-96): staff with results.write void a paddle's bids while the lot is open. "Shown to the bidder" is derived from the previous row, not stored (phase-2-tasks 2.3).
export default async function LotHistory({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org, 'audit.read');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const lot = await db.lot.findFirst({ where: { id, ...inOrg(ctx) }, select: { id: true, number: true, title: true, auctionId: true, auction: { select: { name: true, requiresApproval: true } }, relistOf: { select: { id: true, number: true, auction: { select: { name: true } } } }, relistedAs: { select: { id: true, number: true, auction: { select: { name: true } } } } } });
  if (!lot) notFound();
  const [bids, loaded, withdrawal] = await Promise.all([
    db.bid.findMany({ where: { lotId: id, ...inOrg(ctx) }, orderBy: { seq: 'asc' } }),
    loadLot(prismaTx(db as unknown as Prisma.TransactionClient), id),
    db.lotWithdrawal.findUnique({ where: { lotId: id } }), // D-73
  ]);
  const ids = [...new Set([...bids.flatMap((b) => [b.bidderId, b.leaderBeforeId, b.leaderAfterId]), ...[loaded.settlement, ...loaded.corrections].map((s) => s?.winner)].filter((x): x is string => !!x))];
  const bidders = await db.bidder.findMany({ where: { id: { in: ids }, ...inOrg(ctx) }, select: { id: true, paddle: true } });
  const pad = new Map(bidders.map((b) => [b.id, `#${b.paddle}`]));
  // D-72: which terms each bidder in this lot accepted, and when, beside the sale's current hash
  const bidderIds = [...new Set(bids.map((b) => b.bidderId))];
  const [terms, accepted, regs] = await Promise.all([currentTerms(lot.auctionId), acceptancesFor(lot.auctionId, bidderIds), registrationsFor(lot.auctionId, bidderIds)]); // D-88
  const who = (x: string | null | undefined) => (x ? (pad.get(x) ?? '?') : '—');
  const chain = [loaded.settlement, ...loaded.corrections].filter((s) => s !== null);
  // R18: staff who acted are named, not printed as ids. The id stays in the title for the record.
  const actorIds = [...bids.map((b) => b.voidByUserId), ...chain.map((s) => ('correctedByUserId' in s ? s.correctedByUserId : null)), withdrawal?.byUserId, ...regs.filter((r) => r.status !== 'PENDING').map((r) => r.byUserId)].filter((x): x is string => !!x);
  const actors = new Map((await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name || u.email]));
  // D-96: which accepted rows a later void made dead, and whether a void may be asked for now.
  const live = new Set(liveRows(bids).map((b) => b.seq));
  const dead = (b: (typeof bids)[number]) => b.accepted && !live.has(b.seq);
  const canVoid = can(ctx.role, 'results.write') && !!loaded.state && lotStatus(loaded.lot, loaded.state, now().getTime()) === 'OPEN';
  const actor = (id: string | null | undefined) => (id ? <span title={id}>{actors.get(id) ?? id}</span> : '—');

  return (
    <main>
      {/* R19: back to the sale, and the page a bidder sees */}
      <p className="back-links"><Link href={`/o/${ctx.slug}/auctions/${lot.auctionId}`}>← {lot.auction.name}</Link> · <Link href={`/o/${ctx.slug}/lots/${lot.id}`}>Bidder view</Link> · <a href={`/o/${ctx.slug}/auctions/${lot.auctionId}/ledger.csv?lot=${lot.id}`} data-testid="csv-lot">This ledger as CSV</a></p>
      <h1>Lot {lot.number} history: {lot.title}</h1>
      {/* D-89 (AX-17): the relist chain, both ways */}
      {lot.relistOf && <p data-testid="history-relist-of">Relisted from <Link href={`/o/${ctx.slug}/lots/${lot.relistOf.id}/history`}>lot {lot.relistOf.number} of {lot.relistOf.auction.name}</Link>.</p>}
      {lot.relistedAs && <p data-testid="history-relisted-as">Relisted as <Link href={`/o/${ctx.slug}/lots/${lot.relistedAs.id}/history`}>lot {lot.relistedAs.number} in {lot.relistedAs.auction.name}</Link>; this lot&apos;s settlement stands.</p>}
      <p className="muted">{bids.length} {bids.length === 1 ? 'attempt' : 'attempts'}, in the order they were judged, accepted or refused. Rows marked Extended pushed the close out. What a bidder saw is the price and leader after the row before theirs.</p>
      <div className="table-scroll history">
      <table>
        <thead>
          <tr>
            <th scope="col" className="num">Seq</th><th scope="col">Bidder</th><th scope="col" className="num">Max</th><th scope="col">Outcome</th>
            <th scope="col" className="num">Price before</th><th scope="col" className="num">Price after</th><th scope="col">Leader before</th><th scope="col">Leader after</th>
            <th scope="col">Close before</th><th scope="col">Close after</th><th scope="col">Placed at</th>
          </tr>
        </thead>
        <tbody>
          {bids.map((b) => (
            <tr key={b.id} data-seq={b.seq} data-dead={dead(b) || undefined} className={b.closesAtAfter > b.closesAtBefore ? 'extended' : undefined}>
              <td className="num">{b.seq}</td><td>{who(b.bidderId)}</td><td className="num">{b.outcome === 'VOIDED' ? '—' : formatCents(b.maxCents)}</td>
              <td><Outcome k={b.outcome} />{dead(b) && <> <span className="badge" data-tone="bad">Voided later</span></>}{b.voidReason && <div data-testid="void-reason">By {actor(b.voidByUserId)}: {b.voidReason}</div>}</td>
              <td className="num">{formatCents(b.priceBeforeCents)}</td><td className="num">{formatCents(b.priceAfterCents)}</td><td>{who(b.leaderBeforeId)}</td><td>{who(b.leaderAfterId)}</td>
              <td>{iso(b.closesAtBefore)}</td><td>{iso(b.closesAtAfter)}{b.closesAtAfter > b.closesAtBefore && <> <span className="badge" data-tone="info">Extended +{formatLeft(Math.round((b.closesAtAfter.getTime() - b.closesAtBefore.getTime()) / 1000))}</span></>}</td><td>{iso(b.placedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div data-testid="void-section">
      <h2>Void a bidder&apos;s bids</h2>
      {canVoid ? (
        <ActionForm action={voidBidsAction.bind(null, ctx.slug)}>
          <input type="hidden" name="lotId" value={lot.id} />
          <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
          <p className="muted">Removes every standing bid of one paddle on this lot, such as a documented typo or a suspended bidder&apos;s maximum. The price and leader are worked out again from everyone else&apos;s bids; the close does not move back. The bidder may bid again. Nothing is deleted: the void is a row above, with your reason.</p>
          <label htmlFor="void-paddle">Paddle</label> <input id="void-paddle" name="paddle" required inputMode="numeric" pattern="\d{1,6}" />
          <label htmlFor="void-reason">Reason</label> <input id="void-reason" name="reason" required maxLength={500} placeholder="e.g. bidder called: typed 5,000 meaning 500" />
          <button type="submit">Void this paddle&apos;s bids</button>
        </ActionForm>
      ) : <p className="muted">{can(ctx.role, 'results.write') ? 'Only while the lot is open. After the close, a settlement correction is the remedy.' : 'Staff with results access can void a bidder\'s bids while the lot is open.'}</p>}
      </div>
      <h2>Terms of sale</h2>
      {!terms ? <p className="muted">This sale has no terms of sale; no acceptance was required.</p> : (
        <>
          <p className="muted">Current version {terms.version}, hash <code>{terms.sha256}</code>.</p>
          <table data-testid="terms-acceptances">
            <thead><tr><th scope="col">Bidder</th><th scope="col" className="num">Version</th><th scope="col">Hash</th><th scope="col">Accepted at</th></tr></thead>
            <tbody>
              {bidderIds.map((id) => {
                const rows = accepted.filter((a) => a.bidderId === id);
                return rows.length === 0 ? <tr key={id}><td>{who(id)}</td><td className="num">—</td><td>—</td><td className="muted">none on record</td></tr>
                  : rows.map((a) => <tr key={`${id}-${a.sha256}`}><td>{who(id)}</td><td className="num">{a.version ?? '?'}</td><td><code>{a.sha256}</code></td><td>{iso(a.acceptedAt)}</td></tr>);
              })}
            </tbody>
          </table>
        </>
      )}
      <h2>Approval to bid</h2>
      {!lot.auction.requiresApproval && regs.length === 0 ? <p className="muted">This sale needs no approval to bid.</p> : (
        <table data-testid="registration-history">
          <thead><tr><th scope="col">Bidder</th><th scope="col" className="num">Step</th><th scope="col">Status</th><th scope="col">Note</th><th scope="col">By</th><th scope="col">At</th></tr></thead>
          <tbody>
            {bidderIds.map((id) => {
              const rows = regs.filter((r) => r.bidderId === id);
              return rows.length === 0 ? <tr key={id}><td>{who(id)}</td><td className="num">—</td><td className="muted" colSpan={4}>none on record</td></tr>
                : rows.map((r) => <tr key={r.id}><td>{who(id)}</td><td className="num">{r.version}</td><td>{r.status}</td><td>{r.note || '—'}</td><td>{r.status === 'PENDING' ? 'the bidder' : actor(r.byUserId)}</td><td>{iso(r.recordedAt)}</td></tr>);
            })}
          </tbody>
        </table>
      )}
      <h2>Withdrawal</h2>
      {withdrawal ? (
        <p data-testid="withdrawal">Withdrawn {iso(withdrawal.withdrawnAt)} by {actor(withdrawal.byUserId)}: {withdrawal.reason}. Every attempt from that instant is a <code>REJECTED_LOT_WITHDRAWN</code> row above; the lot settles <code>UNSOLD_WITHDRAWN</code>.</p>
      ) : <p className="muted">Not withdrawn.</p>}
      <h2>Settlement</h2>
      {chain.length === 0 ? <p>Not settled.</p> : (
        <table>
          <thead>
            <tr><th scope="col">Step</th><th scope="col">Outcome</th><th scope="col">Winner</th><th scope="col" className="num">Hammer</th><th scope="col" className="num">Premium</th><th scope="col" className="num">Total</th><th scope="col">Reason</th><th scope="col">Corrected by</th></tr>
          </thead>
          <tbody>
            {chain.map((s, i) => (
              <tr key={s.id}>
                <td>{i === 0 ? 'Settled' : `Correction ${i}`}</td><td><Outcome k={s.outcome} /></td><td>{who(s.winner)}</td>
                <td className="num">{formatCents(s.hammerCents)}</td><td className="num">{formatCents(s.premiumCents)}</td><td className="num">{formatCents(s.totalCents)}</td>
                <td>{'reason' in s ? s.reason : '—'}{'consignorApprovalRef' in s && s.consignorApprovalRef && <div data-testid="approval">Consignor approval {s.consignorApprovalRef}: sold below the reserve (D-87)</div>}</td><td>{actor('correctedByUserId' in s ? s.correctedByUserId : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

// The label for people, the key for the record: staff read both (docs/design-brief.md).
function Outcome({ k }: { k: string }) {
  return <><span className="badge" data-tone={outcomeTone(k)}>{outcomeLabel(k)}</span> <small className="muted outcome-key">{k}</small></>;
}
