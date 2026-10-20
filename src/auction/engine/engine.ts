// The pure bid engine (CLAUDE.md non-negotiable 1): lot, state, bid and nowMs in; outcome and new state out.
// Written from docs/domain-brief.md §5–§6 (D-8..D-12, D-21); tools/auctionlib.py is the oracle it must agree
// with, not its source. Integers only: cents and epoch ms. No clock, no I/O, no float, no `/` (rules:lint).
import { assertCents } from './money';
import type { BidOutcome, Rules } from './rules';

/** Catalog data plus the auction's settings, flattened: nothing here changes once the lot has a bid. */
export type Lot = {
  readonly startCents: number;
  readonly reserveCents: number | null;
  readonly opensAtMs: number;
  readonly scheduledEndMs: number;
  readonly softCloseWindowMs: number;
  readonly maxExtensionMs: number;
  readonly buyerPremiumBps: number;
};

/** The projection one LotState row holds (D-16): a fold over the ledger, never stored truth. */
export type LotState = {
  readonly priceCents: number;
  readonly leader: string | null;
  readonly leaderMaxCents: number;
  readonly leaderSeq: number | null;
  readonly bidCount: number; // every written row, accepted or rejected
  readonly acceptedCount: number;
  readonly closesAtMs: number;
  readonly extensionCount: number;
};

export type BidResult = {
  readonly outcome: BidOutcome;
  readonly accepted: boolean;
  readonly state: LotState;
  readonly priceBefore: number;
  readonly priceAfter: number;
  readonly leaderBefore: string | null;
  readonly leaderAfter: string | null;
  readonly closesBeforeMs: number;
  readonly closesAfterMs: number;
  readonly extended: boolean;
  readonly minNextBefore: number;
};

export const hardCloseMs = (lot: Lot): number => lot.scheduledEndMs + lot.maxExtensionMs;

export const openState = (lot: Lot): LotState => ({
  priceCents: 0,
  leader: null,
  leaderMaxCents: 0,
  leaderSeq: null,
  bidCount: 0,
  acceptedCount: 0,
  closesAtMs: lot.scheduledEndMs,
  extensionCount: 0,
});

/** The increment of the band containing `cents` (D-8: the band of the amount being stepped from). */
export function incrementFor(cents: number, rules: Rules): number {
  if (assertCents(cents) < 0) throw new RangeError('incrementFor: negative cents');
  const band = rules.bands.find((b) => cents >= b.loCents && (b.hiCents === null || cents < b.hiCents));
  if (!band) throw new RangeError('unreachable: bands cover [0, inf)');
  return band.incrementCents;
}

/** What a non-leader must bid at least: the start price before any bid, else price + inc(price). */
export const minNextBid = (lot: Lot, state: LotState, rules: Rules): number =>
  state.leader === null ? lot.startCents : state.priceCents + incrementFor(state.priceCents, rules);

/** D-11: once the leading max reaches the reserve the price is at least the reserve. False with no leader. */
export const reserveMet = (lot: Lot, state: LotState): boolean =>
  state.leader !== null && (lot.reserveCents === null || state.leaderMaxCents >= lot.reserveCents);

const withReserveFloor = (lot: Lot, s: LotState): LotState =>
  lot.reserveCents !== null && reserveMet(lot, s) && s.priceCents < lot.reserveCents ? { ...s, priceCents: lot.reserveCents } : s;

/** One submission against one lot at one instant. Pure; the caller holds the row lock and read `nowMs` under it. */
export function applyBid(lot: Lot, state: LotState, bidderId: string, maxCents: number, nowMs: number, rules: Rules): BidResult {
  if (assertCents(maxCents) <= 0) throw new RangeError('applyBid: maxCents must be positive');
  assertCents(nowMs); // epoch ms are integers too; same guard, same refusal
  const minNextBefore = minNextBid(lot, state, rules);
  const seq = state.bidCount + 1;
  const result = (outcome: BidOutcome, s: LotState, extended: boolean): BidResult => ({
    outcome,
    accepted: !outcome.startsWith('REJECTED_'),
    state: s,
    priceBefore: state.priceCents,
    priceAfter: s.priceCents,
    leaderBefore: state.leader,
    leaderAfter: s.leader,
    closesBeforeMs: state.closesAtMs,
    closesAfterMs: s.closesAtMs,
    extended,
    minNextBefore,
  });
  const rejected = (outcome: BidOutcome) => result(outcome, { ...state, bidCount: seq }, false);

  // §6: open on [opensAt, closesAt); both refusals are rows.
  if (nowMs < lot.opensAtMs) return rejected('REJECTED_LOT_NOT_OPEN');
  if (nowMs >= state.closesAtMs) return rejected('REJECTED_LOT_CLOSED');

  const accepted = { bidCount: seq, acceptedCount: state.acceptedCount + 1 };

  // §5 case 1: the leader raising their own max. Price and close never move (D-10).
  if (state.leader === bidderId) {
    if (maxCents <= state.leaderMaxCents) return rejected('REJECTED_NOT_ABOVE_OWN_MAX');
    return result('ACCEPTED_RAISE', withReserveFloor(lot, { ...state, ...accepted, leaderMaxCents: maxCents, leaderSeq: seq }), false);
  }

  // Case 2.
  if (maxCents < minNextBefore) return rejected('REJECTED_BELOW_MINIMUM');

  // Cases 3–5, then the reserve floor (6).
  let outcome: BidOutcome;
  let s: LotState;
  if (state.leader === null) {
    outcome = 'ACCEPTED_LEAD';
    s = { ...state, ...accepted, priceCents: lot.startCents, leader: bidderId, leaderMaxCents: maxCents, leaderSeq: seq };
  } else if (maxCents > state.leaderMaxCents) {
    outcome = 'ACCEPTED_LEAD';
    const priceCents = Math.min(maxCents, state.leaderMaxCents + incrementFor(state.leaderMaxCents, rules));
    s = { ...state, ...accepted, priceCents, leader: bidderId, leaderMaxCents: maxCents, leaderSeq: seq };
  } else {
    // Equal max included: the earlier seq keeps the lead at the full max (D-9).
    outcome = 'ACCEPTED_OUTBID';
    s = { ...state, ...accepted, priceCents: Math.min(state.leaderMaxCents, maxCents + incrementFor(maxCents, rules)) };
  }
  s = withReserveFloor(lot, s);

  // §6 soft close, one comparison (D-12): extend iff min(now + W, hardClose) is later than the current close.
  const newClose = Math.min(nowMs + lot.softCloseWindowMs, hardCloseMs(lot));
  const extended = newClose > s.closesAtMs;
  if (extended) s = { ...s, closesAtMs: newClose, extensionCount: s.extensionCount + 1 };
  return result(outcome, s, extended);
}
