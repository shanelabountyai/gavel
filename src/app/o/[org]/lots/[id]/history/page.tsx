import { notFound } from 'next/navigation';
import { formatCents } from '@/auction/engine/money';
import { outcomeLabel, outcomeTone } from '@/auction/outcome-labels';
import { prismaTx } from '@/auction/place-bid';
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
  const lot = await db.lot.findFirst({ where: { id, ...inOrg(ctx) }, select: { id: true, number: true, title: true } });
  if (!lot) notFound();
  const [bids, loaded] = await Promise.all([
    db.bid.findMany({ where: { lotId: id, ...inOrg(ctx) }, orderBy: { seq: 'asc' } }),
    loadLot(prismaTx(db as unknown as Prisma.TransactionClient), id),
  ]);
  const ids = [...new Set([...bids.flatMap((b) => [b.bidderId, b.leaderBeforeId, b.leaderAfterId]), ...[loaded.settlement, ...loaded.corrections].map((s) => s?.winner)].filter((x): x is string => !!x))];
  const bidders = await db.bidder.findMany({ where: { id: { in: ids }, ...inOrg(ctx) }, select: { id: true, paddle: true } });
  const pad = new Map(bidders.map((b) => [b.id, `#${b.paddle}`]));
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
