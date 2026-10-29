// The pure bid engine (CLAUDE.md non-negotiable 1): lot, state, bid and nowMs in; outcome and new state out.
// Written from docs/domain-brief.md §5–§6 (D-8..D-12, D-21); tools/auctionlib.py is the oracle it must agree
// with, not its source. Integers only: cents and epoch ms. No clock, no I/O, no float, no `/` (rules:lint).
import { assertBps, assertCents, roundHalfUp } from './money';
import type { BidOutcome, NotWrittenOutcome, Rules, SettlementOutcome } from './rules';

/** Catalog data plus the auction's settings, flattened: nothing here changes once the lot has a bid, except that
 * `withdrawnAtMs` is set once if staff withdraw the lot (D-73). It is the lot's one input beside the ledger: the lot is
 * CLOSED from that instant, every later attempt is REJECTED_LOT_WITHDRAWN, and it settles UNSOLD_WITHDRAWN. The bid path
 * reads it under the same row lock as the state, after the lock is granted. */
export type Lot = {
  readonly startCents: number;
  readonly reserveCents: number | null;
  readonly opensAtMs: number;
  readonly scheduledEndMs: number;
  readonly softCloseWindowMs: number;
  readonly maxExtensionMs: number;
  readonly buyerPremiumBps: number;
  readonly withdrawnAtMs: number | null;
};

const withdrawn = (lot: Lot, nowMs: number): boolean => lot.withdrawnAtMs !== null && nowMs >= lot.withdrawnAtMs;

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

/** Only the scheduled end is read; a lot being created has no withdrawal yet, so the field may be left off. */
export const openState = (lot: Omit<Lot, 'withdrawnAtMs'> & { readonly withdrawnAtMs?: number | null }): LotState => ({
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

  // §6: open on [opensAt, closesAt); all three refusals are rows. Withdrawn first: it holds while SCHEDULED too (GB-24h).
  if (withdrawn(lot, nowMs)) return rejected('REJECTED_LOT_WITHDRAWN');
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

// ---- Replay, fold, status, settlement (task 1.6; brief §6–§7, D-17, D-21, D-22) ----

/** One attempt as the client sent it. `placedAtMs` is the instant the server read under the lock (D-15). */
export type Submission = {
  readonly submissionId: string;
  readonly bidderId: string;
  readonly maxCents: number;
  readonly placedAtMs: number;
  readonly idempotencyKey: string;
};

/** One Bid row (D-14): the attempt, its seq, and the state before and after it. */
export type LedgerRow = Omit<BidResult, 'state' | 'minNextBefore'> & Submission & { readonly seq: number };

/** What fold needs from a row: enough to re-apply it and check the outcome it claims. */
export type FoldRow = Pick<LedgerRow, 'seq' | 'bidderId' | 'maxCents' | 'placedAtMs' | 'outcome'>;

export type ReplayOutcome = {
  readonly submissionId: string;
  readonly outcome: BidOutcome | NotWrittenOutcome;
  readonly seq: number | null; // REPLAY names the prior row's seq; IDEMPOTENCY_MISMATCH has none
  readonly row: LedgerRow | null; // null for the two not-written outcomes
  readonly priceAfter: number;
  readonly leaderAfter: string | null;
  readonly closesAfterMs: number;
};

export const lotStatus = (lot: Lot, state: LotState, nowMs: number): 'SCHEDULED' | 'OPEN' | 'CLOSED' =>
  withdrawn(lot, nowMs) ? 'CLOSED' : nowMs < lot.opensAtMs ? 'SCHEDULED' : nowMs < state.closesAtMs ? 'OPEN' : 'CLOSED';

/**
 * Submissions in arrival order through the D-17 idempotency check, then applyBid. A prior row with the same
 * (bidderId, key) and the same max is REPLAY (its seq, no row); a different max is IDEMPOTENCY_MISMATCH (no row);
 * the same key string from another bidder is a new bid.
 */
export function replay(lot: Lot, submissions: readonly Submission[], rules: Rules) {
  let state = openState(lot);
  const rows: LedgerRow[] = [];
  const outcomes: ReplayOutcome[] = [];
  const byKey = new Map<string, LedgerRow>();
  for (const sub of submissions) {
    const key = `${sub.bidderId}\u0000${sub.idempotencyKey}`;
    const prior = byKey.get(key);
    if (prior) {
      const same = prior.maxCents === sub.maxCents;
      outcomes.push({
        submissionId: sub.submissionId,
        outcome: same ? 'REPLAY' : 'IDEMPOTENCY_MISMATCH',
        seq: same ? prior.seq : null,
        row: null,
        priceAfter: state.priceCents,
        leaderAfter: state.leader,
        closesAfterMs: state.closesAtMs,
      });
      continue;
    }
    const r = applyBid(lot, state, sub.bidderId, sub.maxCents, sub.placedAtMs, rules);
    const row: LedgerRow = {
      ...sub,
      seq: r.state.bidCount,
      outcome: r.outcome,
      accepted: r.accepted,
      priceBefore: r.priceBefore,
      priceAfter: r.priceAfter,
      leaderBefore: r.leaderBefore,
      leaderAfter: r.leaderAfter,
      closesBeforeMs: r.closesBeforeMs,
      closesAfterMs: r.closesAfterMs,
      extended: r.extended,
    };
    rows.push(row);
    byKey.set(key, row);
    state = r.state;
    outcomes.push({ submissionId: sub.submissionId, outcome: row.outcome, seq: row.seq, row, priceAfter: row.priceAfter, leaderAfter: row.leaderAfter, closesAfterMs: row.closesAfterMs });
  }
  return { state, rows, outcomes };
}

/** Rebuild the projection from the ledger alone (V1). Refuses a seq gap or a row whose outcome re-applying it disagrees with. */
export function fold(lot: Lot, rows: readonly FoldRow[], rules: Rules): LotState {
  let state = openState(lot);
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (row.seq !== state.bidCount + 1) throw new RangeError(`seq gap at ${row.seq}`);
    const r = applyBid(lot, state, row.bidderId, row.maxCents, row.placedAtMs, rules);
    if (r.outcome !== row.outcome) throw new RangeError(`ledger row ${row.seq} says ${row.outcome}, fold says ${r.outcome}`);
    state = r.state;
  }
  return state;
}

export type Settlement = {
  readonly outcome: SettlementOutcome;
  readonly winner: string | null;
  readonly winningSeq: number | null;
  readonly hammerCents: number;
  readonly premiumCents: number;
  readonly totalCents: number;
  readonly closedAtMs: number;
};

const sold = (winner: string, winningSeq: number, hammerCents: number, premiumBps: number, closedAtMs: number): Settlement => {
  const premiumCents = roundHalfUp(BigInt(assertCents(hammerCents)) * BigInt(assertBps(premiumBps)), 10000n);
  return { outcome: 'SOLD', winner, winningSeq, hammerCents, premiumCents, totalCents: hammerCents + premiumCents, closedAtMs };
};

/** D-22: null until CLOSED; then unsold (zero amounts, no winner) or SOLD with the one half-up rounding.
 * D-73: a withdrawn lot is UNSOLD_WITHDRAWN whatever the ledger says, closed at the withdrawal, not at closesAt. */
export function settle(lot: Lot, state: LotState, nowMs: number): Settlement | null {
  if (lotStatus(lot, state, nowMs) !== 'CLOSED') return null;
  const unsold = (outcome: SettlementOutcome, closedAtMs = state.closesAtMs): Settlement => ({ outcome, winner: null, winningSeq: null, hammerCents: 0, premiumCents: 0, totalCents: 0, closedAtMs });
  if (lot.withdrawnAtMs !== null) return unsold('UNSOLD_WITHDRAWN', lot.withdrawnAtMs);
  if (state.leader === null) return unsold('UNSOLD_NO_BIDS');
  if (!reserveMet(lot, state)) return unsold('UNSOLD_RESERVE_NOT_MET');
  return sold(state.leader, state.leaderSeq!, state.priceCents, lot.buyerPremiumBps, state.closesAtMs);
}

// ---- Corrections (task 2.2, D-42 Q2, D-44): a superseding settlement, recomputable from the ledger and its target ----

/** A correction-only outcome: the house withdrew the sale. settle() never produces it; the CHECK refuses it on a first row. */
export const UNSOLD_BY_CORRECTION = 'UNSOLD_BY_CORRECTION';
export type CorrectedSettlement = Omit<Settlement, 'outcome'> & {
  readonly outcome: SettlementOutcome | typeof UNSOLD_BY_CORRECTION;
  readonly premiumBps: number; // stored on every row, the first one too, so each row is recomputable from itself
};
/** What a correction may set, and nothing else (D-42 Q2): the winner (null = unsold) and the premium rate. */
export type CorrectionTarget = { readonly winner: string | null; readonly premiumBps: number };
export type CorrectionRefusal = 'NOT_AN_ACCEPTED_BIDDER' | 'RESERVE_NOT_MET' | 'LOT_WITHDRAWN';

/**
 * The settlement a correction to `target` writes. The fold's own leader gets settle()'s hammer back; any other
 * bidder gets their last accepted row, at the price that row reached capped at their own max (an outbid row's
 * price is above the max they agreed to), and only if that meets the reserve. Unsold is zero amounts.
 */
export function resettle(lot: Lot, rows: readonly FoldRow[], rules: Rules, target: CorrectionTarget): CorrectedSettlement | { readonly refused: CorrectionRefusal } {
  const folded = fold(lot, rows, rules);
  const original = settle(lot, folded, folded.closesAtMs)!; // at its own closesAt a lot is CLOSED
  assertBps(target.premiumBps);
  if (lot.withdrawnAtMs !== null && target.winner !== null) return { refused: 'LOT_WITHDRAWN' }; // D-73: a withdrawn lot is never sold, by correction either
  if (target.winner === null) {
    return { outcome: UNSOLD_BY_CORRECTION, winner: null, winningSeq: null, hammerCents: 0, premiumCents: 0, totalCents: 0, closedAtMs: original.closedAtMs, premiumBps: target.premiumBps };
  }
  if (target.winner === folded.leader) {
    if (original.outcome !== 'SOLD') return { refused: 'RESERVE_NOT_MET' };
    return { ...sold(target.winner, original.winningSeq!, original.hammerCents, target.premiumBps, original.closedAtMs), premiumBps: target.premiumBps };
  }
  const own = rows.filter((r) => r.bidderId === target.winner && !r.outcome.startsWith('REJECTED_')).sort((a, b) => b.seq - a.seq)[0];
  if (!own) return { refused: 'NOT_AN_ACCEPTED_BIDDER' };
  const hammerCents = Math.min(fold(lot, rows.filter((r) => r.seq <= own.seq), rules).priceCents, own.maxCents);
  if (lot.reserveCents !== null && hammerCents < lot.reserveCents) return { refused: 'RESERVE_NOT_MET' };
  return { ...sold(target.winner, own.seq, hammerCents, target.premiumBps, original.closedAtMs), premiumBps: target.premiumBps };
}

// ---- Invoices (task 2.1, D-42 Q1): derived on read from each lot's current settlement, never stored ----

/** One lot's current settlement with the catalog keys an invoice groups and orders by. */
export type SettledLot = Pick<CorrectedSettlement, 'outcome' | 'winner' | 'hammerCents' | 'premiumCents' | 'totalCents'> & {
  readonly auctionId: string;
  readonly lotId: string;
  readonly lotNumber: number;
};

export type InvoiceLine = Pick<SettledLot, 'lotId' | 'lotNumber' | 'hammerCents' | 'premiumCents' | 'totalCents'>;

export type Invoice = {
  readonly auctionId: string;
  readonly bidderId: string;
  readonly lots: readonly InvoiceLine[];
  readonly hammerCents: number;
  readonly premiumCents: number;
  readonly totalCents: number;
};

/** One invoice per winning bidder per auction: SOLD lots only, lines in lot-number order, sums in integer cents. */
export function invoice(settled: readonly SettledLot[]): Invoice[] {
  const by = new Map<string, { auctionId: string; bidderId: string; lots: InvoiceLine[] }>();
  for (const s of settled) {
    if (s.outcome !== 'SOLD' || s.winner === null) continue;
    const line: InvoiceLine = { lotId: s.lotId, lotNumber: s.lotNumber, hammerCents: assertCents(s.hammerCents), premiumCents: assertCents(s.premiumCents), totalCents: assertCents(s.totalCents) };
    const key = `${s.auctionId}\u0000${s.winner}`;
    (by.get(key) ?? by.set(key, { auctionId: s.auctionId, bidderId: s.winner, lots: [] }).get(key)!).lots.push(line);
  }
  const sum = (lines: readonly InvoiceLine[], k: 'hammerCents' | 'premiumCents' | 'totalCents') => lines.reduce((t, l) => t + l[k], 0);
  return [...by.values()]
    .sort((a, b) => (a.auctionId < b.auctionId ? -1 : a.auctionId > b.auctionId ? 1 : a.bidderId < b.bidderId ? -1 : a.bidderId > b.bidderId ? 1 : 0))
    .map(({ auctionId, bidderId, lots }) => {
      const sorted = [...lots].sort((a, b) => a.lotNumber - b.lotNumber);
      return { auctionId, bidderId, lots: sorted, hammerCents: sum(sorted, 'hammerCents'), premiumCents: sum(sorted, 'premiumCents'), totalCents: sum(sorted, 'totalCents') };
    });
}
