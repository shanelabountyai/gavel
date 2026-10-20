// Task 2.2 (D-42 Q2, D-44): resettle(lot, ledger, target) is the settlement a correction writes. Hand-worked
// lots, increments from rules/auction.v1.json (100 cents below 10000); every expected number is derived in the comment.
import { describe, expect, it } from 'vitest';
import { type Lot, type Submission, UNSOLD_BY_CORRECTION, replay, resettle, settle, fold } from '@/auction/engine/engine';
import { MoneyError } from '@/auction/engine/money';
import { loadRules } from '@/auction/load-rules';

const { rules } = loadRules();
const lot: Lot = { startCents: 1000, reserveCents: null, opensAtMs: 0, scheduledEndMs: 100_000, softCloseWindowMs: 0, maxExtensionMs: 0, buyerPremiumBps: 1500 };
const sub = (n: number, bidderId: string, maxCents: number): Submission => ({ submissionId: `s${n}`, bidderId, maxCents, placedAtMs: n, idempotencyKey: `k${n}` });
const rowsOf = (l: Lot, subs: Submission[]) => replay(l, subs, rules).rows;

// A max 5000 leads at 1000; B max 3000 is outbid at min(5000, 3000 + 100) = 3100; C max 2000 is below 3200.
const rows = rowsOf(lot, [sub(1, 'A', 5000), sub(2, 'B', 3000), sub(3, 'C', 2000)]);

describe('resettle (task 2.2)', () => {
  it('the ledger is as the comment says', () => {
    expect(rows.map((r) => [r.seq, r.bidderId, r.outcome, r.priceAfter])).toEqual([
      [1, 'A', 'ACCEPTED_LEAD', 1000], [2, 'B', 'ACCEPTED_OUTBID', 3100], [3, 'C', 'REJECTED_BELOW_MINIMUM', 3100],
    ]);
  });

  it("the fold's own winner at the auction's rate is settle() exactly", () => {
    const st = settle(lot, fold(lot, rows, rules), 100_000)!;
    expect(st).toMatchObject({ outcome: 'SOLD', winner: 'A', winningSeq: 1, hammerCents: 3100, premiumCents: 465, totalCents: 3565 });
    expect(resettle(lot, rows, rules, { winner: 'A', premiumBps: 1500 })).toEqual({ ...st, premiumBps: 1500 });
  });

  it('to the underbidder: their last accepted row, capped at their own max (3100 reached, 3000 agreed)', () => {
    expect(resettle(lot, rows, rules, { winner: 'B', premiumBps: 1500 })).toEqual({
      outcome: 'SOLD', winner: 'B', winningSeq: 2, hammerCents: 3000, premiumCents: 450, totalCents: 3450, closedAtMs: 100_000, premiumBps: 1500,
    });
  });

  it('premium bps: 3100 × 1250 / 10000 = 387.5, half up to 388', () => {
    expect(resettle(lot, rows, rules, { winner: 'A', premiumBps: 1250 })).toMatchObject({ hammerCents: 3100, premiumCents: 388, totalCents: 3488, premiumBps: 1250 });
  });

  it('unsold is zero amounts and no winner, keeping the rate for a later correction back', () => {
    expect(resettle(lot, rows, rules, { winner: null, premiumBps: 1500 })).toEqual({
      outcome: UNSOLD_BY_CORRECTION, winner: null, winningSeq: null, hammerCents: 0, premiumCents: 0, totalCents: 0, closedAtMs: 100_000, premiumBps: 1500,
    });
  });

  it('refuses a bidder with only rejected rows, and one who never bid', () => {
    expect(resettle(lot, rows, rules, { winner: 'C', premiumBps: 1500 })).toEqual({ refused: 'NOT_AN_ACCEPTED_BIDDER' });
    expect(resettle(lot, rows, rules, { winner: 'Z', premiumBps: 1500 })).toEqual({ refused: 'NOT_AN_ACCEPTED_BIDDER' });
  });

  it('refuses a sale below the reserve, to the underbidder or to a leader the reserve never reached', () => {
    // Reserve 3050. B max 3000 leads at 1000; A max 5000 takes the lead and the price is floored to 3100.
    const r = { ...lot, reserveCents: 3050 };
    const reserved = rowsOf(r, [sub(1, 'B', 3000), sub(2, 'A', 5000)]);
    expect(resettle(r, reserved, rules, { winner: 'B', premiumBps: 1500 })).toEqual({ refused: 'RESERVE_NOT_MET' });
    // Reserve 9000: A's max 5000 never reaches it, the lot closed UNSOLD_RESERVE_NOT_MET, and A cannot be sold to.
    const high = { ...lot, reserveCents: 9000 };
    expect(resettle(high, rowsOf(high, [sub(1, 'A', 5000)]), rules, { winner: 'A', premiumBps: 1500 })).toEqual({ refused: 'RESERVE_NOT_MET' });
  });

  it('a non-integer rate is a MoneyError', () => {
    expect(() => resettle(lot, rows, rules, { winner: 'A', premiumBps: 1500.5 })).toThrow(MoneyError);
  });
});
