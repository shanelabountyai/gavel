import { db } from '@/core/db';
import { now } from '@/core/clock';
import { type Lot, type LotState, bidderAliases, lotStatus, minNextBid, reserveMet, settle } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';
import { toLot, toState } from '@/auction/place-bid';

// Task 3.3 (brief §4, O-5). What a poller may see of a lot: public numbers, a boolean for the reserve, and for the
// caller alone whether they lead or were outbid and their own maximum (D-68). No other bidder's max, no reserve amount,
// no other bidder's id or paddle.
export type LotView = {
  readonly status: 'SCHEDULED' | 'OPEN' | 'CLOSED';
  readonly priceCents: number;
  readonly minNextCents: number;
  readonly opensAt: string;
  readonly closesAt: string;
  /** Accepted bids (LotState.acceptedCount), not every ledger row (D-67). */
  readonly bidCount: number;
  /** R-13 (D-83): whether the lot has a reserve at all; the amount is never shown. "No reserve" is a selling point. */
  readonly hasReserve: boolean;
  readonly reserveMet: boolean; // true when there is no reserve; with hasReserve the page tells "No reserve" from "Reserve met"
  /** Open or scheduled lots only; null once closed, where `result` takes over. */
  readonly you: 'LEADING' | 'OUTBID' | null;
  /** The caller's highest accepted maxCents on this lot, or null (no accepted bid, or staff with no Bidder row). D-68. */
  readonly yourMaxCents: number | null;
  /** Closed lots, for a caller with an accepted bid: from the current Settlement row, or settle() before there is one. */
  readonly result: 'WON' | 'NOT_WON' | 'UNSOLD' | null;
  /** A Settlement row exists, so `result` and the price will not change short of a correction. */
  readonly final: boolean;
  /** D-73: the instant staff withdrew the lot, or null. A withdrawn lot is CLOSED from it and its `result` is UNSOLD. */
  readonly withdrawnAt: string | null;
  /** Every ledger row (bidCount, so a refused attempt refreshes pollers), status, and the current settlement. */
  readonly etag: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let rules: ReturnType<typeof loadRules>['rules'] | undefined;

/** The caller's standing on a lot they hold an accepted bid on (R9, D-80). Open: lead or outbid. Closed: from the current settlement. */
export type Standing = 'LEADING' | 'OUTBID' | 'WON' | 'NOT_WON' | 'UNSOLD';

/** The current settlement is the row no other row supersedes (D-44); a correction can change the winner and hammer. */
export const settlementTip = <R extends { id: string; supersedesId: string | null }>(chain: readonly R[]) => chain.find((r) => !chain.some((n) => n.supersedesId === r.id));

/** Read-only, no lock (D-50 e). `tip` is the current Settlement row; before there is one, settle() says what it will say. */
export function standing(lot: Lot, state: LotState, bidderId: string, tip: { outcome: string; winnerBidderId: string | null } | undefined, nowMs: number): Standing {
  if (lotStatus(lot, state, nowMs) !== 'CLOSED') return state.leader === bidderId ? 'LEADING' : 'OUTBID';
  const s = tip ? { outcome: tip.outcome, winner: tip.winnerBidderId } : settle(lot, state, nowMs)!;
  return s.outcome !== 'SOLD' ? 'UNSOLD' : s.winner === bidderId ? 'WON' : 'NOT_WON';
}

/** R9: every lot in the house the bidder holds an accepted bid on, with their standing. One query for the lot ids, one for the lots. */
export async function myBids(orgId: string, bidderId: string) {
  const lotIds = (await db.bid.findMany({ where: { orgId, bidderId, accepted: true }, distinct: ['lotId'], select: { lotId: true } })).map((b) => b.lotId);
  const rows = await db.lot.findMany({ where: { id: { in: lotIds }, orgId }, include: { auction: true, state: true, withdrawal: true, settlements: true }, orderBy: [{ state: { closesAt: 'asc' } }, { number: 'asc' }] });
  const nowMs = now().getTime();
  return rows.flatMap((r) => {
    if (!r.state) return [];
    const lot = toLot(r);
    const state = toState(r.state);
    return [{ lotId: r.id, number: r.number, title: r.title, auction: r.auction.name, closesAtMs: state.closesAtMs, closed: lotStatus(lot, state, nowMs) === 'CLOSED', standing: standing(lot, state, bidderId, settlementTip(r.settlements), nowMs) }];
  });
}

/** A bidder's own maximum on a lot: their highest accepted maxCents. A refused attempt is a ledger row, not a maximum. */
export async function ownMaxCents(lotId: string, bidderId: string): Promise<number | null> {
  return (await db.bid.aggregate({ where: { lotId, bidderId, accepted: true }, _max: { maxCents: true } }))._max.maxCents;
}

/** null = not found or not yours (a lot in another house is a 404, INV-02). */
export async function lotView(userId: string, lotId: string): Promise<LotView | null> {
  if (!UUID.test(lotId)) return null;
  const row = await db.lot.findUnique({ where: { id: lotId }, include: { auction: true, state: true, withdrawal: true } });
  if (!row?.state || !(await db.membership.findUnique({ where: { orgId_userId: { orgId: row.orgId, userId } }, select: { userId: true } }))) return null;
  const lot = toLot(row);
  const state = toState(row.state);
  const nowMs = now().getTime();
  const status = lotStatus(lot, state, nowMs);
  const bidder = await db.bidder.findUnique({ where: { orgId_userId: { orgId: row.orgId, userId } }, select: { id: true } });
  const yourMaxCents = bidder ? await ownMaxCents(lotId, bidder.id) : null;
  const hadBid = yourMaxCents !== null; // the leader always has an accepted row
  let priceCents = state.priceCents;
  const tip = status === 'CLOSED' ? settlementTip(await db.settlement.findMany({ where: { lotId } })) : undefined;
  if (status === 'CLOSED') {
    const s = tip ?? settle(lot, state, nowMs)!;
    if (s.outcome === 'SOLD') priceCents = s.hammerCents;
  }
  const p = hadBid ? standing(lot, state, bidder!.id, tip, nowMs) : null;
  const you: LotView['you'] = p === 'LEADING' || p === 'OUTBID' ? p : null;
  const result: LotView['result'] = p === 'WON' || p === 'NOT_WON' || p === 'UNSOLD' ? p : null;
  return {
    status,
    priceCents,
    minNextCents: minNextBid(lot, state, (rules ??= loadRules().rules)),
    opensAt: new Date(lot.opensAtMs).toISOString(),
    closesAt: new Date(state.closesAtMs).toISOString(),
    bidCount: state.acceptedCount,
    hasReserve: lot.reserveCents !== null,
    reserveMet: reserveMet(lot, state),
    you,
    yourMaxCents,
    result,
    final: !!tip,
    withdrawnAt: row.withdrawal?.withdrawnAt.toISOString() ?? null,
    etag: `"${state.bidCount}-${status}-${tip?.id.slice(0, 8) ?? ''}"`,
  };
}

/** R-11 (D-83): what any member may see of a lot's ledger. Accepted rows only, in seq order, the price each one set, whether it
 * extended the close, and a per-lot alias (GB-28); the caller's own rows say "you". Never a maximum, a refused row, a paddle or
 * an id. Read-only, no lock. */
export type PublicBid = { readonly seq: number; readonly placedAt: string; readonly priceAfterCents: number; readonly extended: boolean; readonly who: string };
export async function publicHistory(lotId: string, callerBidderId: string | null): Promise<PublicBid[]> {
  const rows = await db.bid.findMany({ where: { lotId, accepted: true }, orderBy: { seq: 'asc' }, select: { seq: true, bidderId: true, priceAfterCents: true, placedAt: true, extended: true } });
  const alias = bidderAliases(rows.map((r) => ({ seq: r.seq, bidderId: r.bidderId, accepted: true })));
  return rows.map((r) => ({ seq: r.seq, placedAt: r.placedAt.toISOString(), priceAfterCents: r.priceAfterCents, extended: r.extended, who: r.bidderId === callerBidderId ? 'you' : `Bidder ${alias.get(r.bidderId)}` }));
}
