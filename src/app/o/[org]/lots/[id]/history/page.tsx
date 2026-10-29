import { notFound } from 'next/navigation';
import { formatCents } from '@/auction/engine/money';
import { outcomeLabel, outcomeTone } from '@/auction/outcome-labels';
import { prismaTx } from '@/auction/place-bid';
import { acceptancesFor, currentTerms } from '@/auction/terms';
import { loadLot } from '@/auction/verify-sql';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';

export const metadata = { title: 'Lot history' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date) => d.toISOString();

// Task 2.3: staff only (audit.read). Every Bid row in seq order, accepted or rejected, then the settlement chain.
// Read-only: no form, no action. "Shown to the bidder" is derived from the previous row, not stored (phase-2-tasks 2.3).
export default async function LotHistory({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org, 'audit.read');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const lot = await db.lot.findFirst({ where: { id, ...inOrg(ctx) }, select: { id: true, number: true, title: true, auctionId: true } });
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
  const [terms, accepted] = await Promise.all([currentTerms(lot.auctionId), acceptancesFor(lot.auctionId, bidderIds)]);
  const who = (x: string | null | undefined) => (x ? (pad.get(x) ?? '?') : '—');
  const chain = [loaded.settlement, ...loaded.corrections].filter((s) => s !== null);

  return (
    <main>
      <h1>Lot {lot.number} history: {lot.title}</h1>
      <p className="muted">{bids.length} {bids.length === 1 ? 'attempt' : 'attempts'}, in the order they were judged, accepted or refused. Highlighted rows extended the close. What a bidder saw is the price and leader after the row before theirs.</p>
      <div className="table-scroll">
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
            <tr key={b.id} data-seq={b.seq} className={b.closesAtAfter > b.closesAtBefore ? 'extended' : undefined}>
              <td className="num">{b.seq}</td><td>{who(b.bidderId)}</td><td className="num">{formatCents(b.maxCents)}</td><td><Outcome k={b.outcome} /></td>
              <td className="num">{formatCents(b.priceBeforeCents)}</td><td className="num">{formatCents(b.priceAfterCents)}</td><td>{who(b.leaderBeforeId)}</td><td>{who(b.leaderAfterId)}</td>
              <td>{iso(b.closesAtBefore)}</td><td>{iso(b.closesAtAfter)}</td><td>{iso(b.placedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <h2>Withdrawal</h2>
      {withdrawal ? (
        <p data-testid="withdrawal">Withdrawn {iso(withdrawal.withdrawnAt)} by user <code>{withdrawal.byUserId}</code>: {withdrawal.reason}. Every attempt from that instant is a <code>REJECTED_LOT_WITHDRAWN</code> row above; the lot settles <code>UNSOLD_WITHDRAWN</code>.</p>
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
                <td>{'reason' in s ? s.reason : '—'}</td><td>{'correctedByUserId' in s ? s.correctedByUserId : '—'}</td>
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
