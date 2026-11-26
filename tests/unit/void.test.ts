// D-96 (AX-19, R-19): the engine half of a staff void. GB-31 is the oracle's (tools/golden_answers.py); these are the
// same hand-worked values through the TypeScript engine, plus the readers D-96 (g) moved to live rows.
import { describe, expect, it } from 'vitest';
import { type FoldRow, type Lot, type Submission, applyVoid, fold, liveRows, minNextBid, openState, replay, resettle, secondChance, settle } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';

const { rules } = loadRules();
const T = 3_600_000;
const G: Lot = { startCents: 10000, reserveCents: null, opensAtMs: 0, scheduledEndMs: T, softCloseWindowMs: 120_000, maxExtensionMs: 600_000, buyerPremiumBps: 1500, withdrawnAtMs: null };
const R: Lot = { ...G, reserveCents: 25000 };

/** (bidder, max, t) is a bid; (bidder, null, t) is a void. */
const run = (lot: Lot, plan: [string, number | null, number][]) =>
  replay(lot, plan.map(([b, m, t], i): Submission => ({ submissionId: `V${i}`, bidderId: b, maxCents: m ?? 0, placedAtMs: t, idempotencyKey: `k${i}`, void: m === null })), rules);
const BASE: [string, number, number][] = [['A', 15000, 100_000], ['B', 12000, 200_000], ['C', 20000, 300_000]]; // C leads at 15,500

describe('applyVoid (D-96, GB-31)', () => {
  it('GB-31a/b: voiding the leader re-derives A over B at 12,500; the close and accepted count stay', () => {
    const { state: s, rows } = run(G, [...BASE, ['C', null, 400_000]]);
    const v = rows.at(-1)!;
    expect([v.outcome, v.accepted, v.priceBefore, v.priceAfter, v.leaderBefore, v.leaderAfter, v.extended]).toEqual(['VOIDED', false, 15500, 12500, 'C', 'A', false]);
    expect([s.leaderMaxCents, s.leaderSeq, s.bidCount, s.acceptedCount, s.closesAtMs, s.extensionCount]).toEqual([15000, 1, 4, 3, T, 0]);
    expect(minNextBid(G, s, rules)).toBe(13000);
  });

  it('GB-31c/d: a voided bidder may bid again; a second void sees the earlier rows dead and the rebid live', () => {
    const { state: s, rows } = run(G, [...BASE, ['C', null, 400_000], ['C', 14000, 500_000], ['A', null, 600_000]]);
    expect(rows[4]!.outcome).toBe('ACCEPTED_OUTBID');
    expect([s.priceCents, s.leader, s.leaderMaxCents, s.leaderSeq, s.bidCount, s.acceptedCount]).toEqual([12500, 'C', 14000, 5, 6, 4]);
    expect(liveRows(rows).map((r) => r.seq)).toEqual([2, 5]);
    expect(fold(G, rows, rules)).toEqual(s); // GB-31l
  });

  it('GB-31e/f/m: refusals write nothing', () => {
    const { state: s, outcomes } = run(G, [...BASE, ['Z', null, 400_000], ['C', null, T]]);
    expect(outcomes.slice(-2).map((o) => [o.outcome, o.row])).toEqual([['VOID_NO_LIVE_BIDS', null], ['VOID_LOT_NOT_OPEN', null]]);
    expect(s.bidCount).toBe(3);
    const W: Lot = { ...G, withdrawnAtMs: 250_000 };
    expect(run(W, [['A', 15000, 100_000], ['A', null, 250_000]]).outcomes[1]!.outcome).toBe('VOID_LOT_NOT_OPEN');
  });

  it('GB-31g: the close never moves back', () => {
    const { state: s, rows } = run(G, [['A', 15000, 100_000], ['B', 20000, T - 30_000], ['B', null, T + 50_000]]);
    expect(rows[1]!.extended).toBe(true);
    expect([s.priceCents, s.leader, s.closesAtMs, s.extensionCount]).toEqual([10000, 'A', T + 90_000, 1]);
  });

  it('GB-31h/i/j/k: only bidder, reserve floor both ways, equal maxes in seq order', () => {
    const only = run(G, [['A', 15000, 100_000], ['A', null, 200_000]]).state;
    expect([only.leader, only.priceCents, minNextBid(G, only, rules), settle(G, only, T)!.outcome]).toEqual([null, 0, 10000, 'UNSOLD_NO_BIDS']);
    expect(run(R, [['A', 30000, 100_000], ['B', 26000, 200_000], ['A', null, 300_000]]).state.priceCents).toBe(25000);
    expect(run(R, [['B', 20000, 100_000], ['A', 30000, 200_000], ['A', null, 300_000]]).state.priceCents).toBe(10000);
    const tie = run(G, [['A', 15000, 100_000], ['B', 15000, 200_000], ['C', 20000, 300_000], ['C', null, 400_000]]).state;
    expect([tie.priceCents, tie.leader, tie.leaderSeq]).toEqual([15000, 'A', 1]);
  });

  it('fold refuses a VOIDED row a void would refuse (a forged void of a bidder with nothing live)', () => {
    const rows: FoldRow[] = [{ seq: 1, bidderId: 'A', maxCents: 15000, placedAtMs: 100_000, outcome: 'ACCEPTED_LEAD' }, { seq: 2, bidderId: 'Z', maxCents: 0, placedAtMs: 200_000, outcome: 'VOIDED' }];
    expect(() => fold(G, rows, rules)).toThrow(/ledger row 2 says VOIDED, fold says VOID_NO_LIVE_BIDS/);
    expect(applyVoid(G, openState(G), [], 'A', 100, rules)).toEqual({ refused: 'VOID_NO_LIVE_BIDS' });
  });
});

describe('readers of live rows (D-96 g)', () => {
  // A leads after C's void; the lot closes at T with A at 12,500, B under at 12,000, C dead.
  const { rows } = run(G, [...BASE, ['C', null, 400_000]]);

  it('resettle refuses a voided bidder as a winner', () => {
    expect(resettle(G, rows, rules, { winner: 'C', premiumBps: 1500 })).toEqual({ refused: 'NOT_AN_ACCEPTED_BIDDER' });
  });

  it('secondChance skips the voided bidder and prices B from the live rows: min(12,500 reached, 12,000 own max)', () => {
    const offer = secondChance(G, rows, rules, 'A', 1500)!;
    expect([offer.bidderId, offer.settlement.hammerCents]).toEqual(['B', 12000]);
  });

  it('with no void in the ledger, resettle prices a non-leader as the fold did (B reached 12,500, own max 12,000)', () => {
    const plain = run(G, BASE).rows;
    const s = resettle(G, plain, rules, { winner: 'B', premiumBps: 1500 });
    expect('refused' in s ? s : s.hammerCents).toBe(12000);
  });
});
