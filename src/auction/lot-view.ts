import { db } from '@/core/db';
import { now } from '@/core/clock';
import { lotStatus, minNextBid, reserveMet, settle } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';
import { toLot, toState } from '@/auction/place-bid';

// Task 3.3 (brief §4, O-5). What a poller may see of a lot: public numbers, a boolean for the reserve, and for the
// caller alone whether they lead or were outbid. No max, no reserve amount, no other bidder's id or paddle.
export type LotView = {
  readonly status: 'SCHEDULED' | 'OPEN' | 'CLOSED';
  readonly priceCents: number;
  readonly minNextCents: number;
  readonly opensAt: string;
  readonly closesAt: string;
  /** Accepted bids (LotState.acceptedCount), not every ledger row (D-67). */
  readonly bidCount: number;
  readonly reserveMet: boolean; // true when there is no reserve, so "no reserve" and "met" look the same
  /** Open or scheduled lots only; null once closed, where `result` takes over. */
  readonly you: 'LEADING' | 'OUTBID' | null;
  /** Closed lots, for a caller with an accepted bid: from the current Settlement row, or settle() before there is one. */
  readonly result: 'WON' | 'NOT_WON' | 'UNSOLD' | null;
  /** A Settlement row exists, so `result` and the price will not change short of a correction. */
  readonly final: boolean;
  /** Every ledger row (bidCount, so a refused attempt refreshes pollers), status, and the current settlement. */
  readonly etag: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let rules: ReturnType<typeof loadRules>['rules'] | undefined;

/** null = not found or not yours (a lot in another house is a 404, INV-02). */
export async function lotView(userId: string, lotId: string): Promise<LotView | null> {
  if (!UUID.test(lotId)) return null;
  const row = await db.lot.findUnique({ where: { id: lotId }, include: { auction: true, state: true } });
  if (!row?.state || !(await db.membership.findUnique({ where: { orgId_userId: { orgId: row.orgId, userId } }, select: { userId: true } }))) return null;
  const lot = toLot(row);
  const state = toState(row.state);
  const status = lotStatus(lot, state, now().getTime());
  const bidder = await db.bidder.findUnique({ where: { orgId_userId: { orgId: row.orgId, userId } }, select: { id: true } });
  const hadBid = !!bidder && (state.leader === bidder.id || (await db.bid.count({ where: { lotId, bidderId: bidder.id, accepted: true } })) > 0);
  let you: LotView['you'] = null;
  let result: LotView['result'] = null;
  let priceCents = state.priceCents;
  // The current settlement is the row no other row supersedes (D-44); a correction can change the winner and hammer.
  const chain = status === 'CLOSED' ? await db.settlement.findMany({ where: { lotId } }) : [];
  const tip = chain.find((r) => !chain.some((n) => n.supersedesId === r.id));
  if (status !== 'CLOSED') you = !hadBid ? null : state.leader === bidder!.id ? 'LEADING' : 'OUTBID';
  else {
    const s = tip ? { outcome: tip.outcome, winner: tip.winnerBidderId, hammerCents: tip.hammerCents } : settle(lot, state, now().getTime())!;
    if (s.outcome === 'SOLD') priceCents = s.hammerCents;
    if (hadBid) result = s.outcome !== 'SOLD' ? 'UNSOLD' : s.winner === bidder!.id ? 'WON' : 'NOT_WON';
  }
  return {
    status,
    priceCents,
    minNextCents: minNextBid(lot, state, (rules ??= loadRules().rules)),
    opensAt: new Date(lot.opensAtMs).toISOString(),
    closesAt: new Date(state.closesAtMs).toISOString(),
    bidCount: state.acceptedCount,
    reserveMet: reserveMet(lot, state),
    you,
    result,
    final: !!tip,
    etag: `"${state.bidCount}-${status}-${tip?.id.slice(0, 8) ?? ''}"`,
  };
}
