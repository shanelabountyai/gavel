// Task 1.5: the brief §9 goldens that need only applyBid (GB-00..GB-14, GB-17, GB-19, GB-22, GB-23), with
// the exact values tools/golden_answers.py prints. Lot G: start 10,000, no reserve, opens 0, T = 3,600,000,
// W = 120 s, cap 600 s, premium 1500 bps. Lot R: as G with reserve 25,000.
import { describe, expect, it } from 'vitest';
import { MoneyError } from '@/auction/engine/money';
import { type FoldRow, type Lot, type LotState, applyBid, fold, incrementFor, lotStatus, minNextBid, openState, reserveMet, resettle, settle } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';

const { rules } = loadRules();
const T = 3_600_000;
const W = 120_000;
const G: Lot = { startCents: 10_000, reserveCents: null, opensAtMs: 0, scheduledEndMs: T, softCloseWindowMs: W, maxExtensionMs: 600_000, buyerPremiumBps: 1500, withdrawnAtMs: null };
const R: Lot = { ...G, reserveCents: 25_000 };
const bid = (lot: Lot, s: LotState, who: string, m: number, t: number) => applyBid(lot, s, who, m, t, rules);

describe('GB-17 increments', () => {
  it('reads the band of the amount, [lo, hi)', () => {
    const at = [0, 9_999, 10_000, 49_999, 50_000, 99_999, 100_000, 499_999, 500_000, 2_499_999, 2_500_000, 99_999_999];
    expect(at.map((p) => incrementFor(p, rules))).toEqual([100, 100, 500, 500, 1000, 1000, 2500, 2500, 5000, 10000, 25000, 25000]);
  });
});

describe('GB-00..GB-07 proxy bidding on one lot', () => {
  let s = openState(G);
  it('GB-00 minimum before any bid is the start', () => expect(minNextBid(G, s, rules)).toBe(10_000));
  it('GB-01 first bid leads at the start price', () => {
    const r = bid(G, s, 'A', 15_000, 100_000);
    expect([r.outcome, r.state.priceCents, r.state.leader, r.state.leaderMaxCents, r.state.closesAtMs, r.extended]).toEqual(['ACCEPTED_LEAD', 10_000, 'A', 15_000, T, false]);
    expect([r.priceBefore, r.priceAfter, r.leaderBefore, r.leaderAfter, r.minNextBefore, r.state.leaderSeq]).toEqual([0, 10_000, null, 'A', 10_000, 1]);
    s = r.state;
    expect(minNextBid(G, s, rules)).toBe(10_500);
  });
  it('GB-02 under the leader max: outbid at one increment over the bid', () => {
    const r = bid(G, s, 'B', 12_000, 200_000);
    expect([r.outcome, r.state.priceCents, r.state.leader]).toEqual(['ACCEPTED_OUTBID', 12_500, 'A']);
    s = r.state;
  });
  it('GB-03 over the leader max: new leader at old max + increment', () => {
    const r = bid(G, s, 'C', 20_000, 300_000);
    expect([r.outcome, r.state.priceCents, r.state.leader, r.state.leaderSeq]).toEqual(['ACCEPTED_LEAD', 15_500, 'C', 3]);
    s = r.state;
  });
  it('GB-04 equal max: the earlier bid keeps the lead at the full max', () => {
    const r = bid(G, s, 'D', 20_000, 400_000);
    expect([r.outcome, r.state.priceCents, r.state.leader, r.state.leaderSeq]).toEqual(['ACCEPTED_OUTBID', 20_000, 'C', 3]);
    s = r.state;
  });
  it('GB-05 one increment short: rejected, row still written', () => {
    const r = bid(G, s, 'E', 20_400, 500_000);
    expect([r.outcome, r.accepted, r.state.bidCount, r.state.priceCents, r.minNextBefore]).toEqual(['REJECTED_BELOW_MINIMUM', false, 5, 20_000, 20_500]);
    expect([r.priceBefore, r.priceAfter, r.leaderBefore, r.leaderAfter, r.closesBeforeMs, r.closesAfterMs, r.extended]).toEqual([20_000, 20_000, 'C', 'C', T, T, false]);
    s = r.state;
  });
  it('GB-06 leader raises own max: price unchanged, no extension', () => {
    const r = bid(G, s, 'C', 30_000, 600_000);
    expect([r.outcome, r.state.priceCents, r.state.leaderMaxCents, r.state.leaderSeq, r.extended]).toEqual(['ACCEPTED_RAISE', 20_000, 30_000, 6, false]);
    s = r.state;
  });
  it('GB-07 leader raises to the same max: rejected', () => {
    const r = bid(G, s, 'C', 30_000, 700_000);
    expect([r.outcome, r.state.bidCount, r.state.acceptedCount]).toEqual(['REJECTED_NOT_ABOVE_OWN_MAX', 7, 5]);
  });
});

describe('GB-08, GB-22 reserve', () => {
  it('GB-08 under the reserve leads at start; clearing it jumps the price to the reserve', () => {
    const a = bid(R, openState(R), 'A', 20_000, 100_000);
    expect([a.outcome, a.state.priceCents, reserveMet(R, a.state)]).toEqual(['ACCEPTED_LEAD', 10_000, false]);
    const b = bid(R, a.state, 'B', 26_000, 200_000);
    expect([b.outcome, b.state.priceCents, b.state.leader, reserveMet(R, b.state)]).toEqual(['ACCEPTED_LEAD', 25_000, 'B', true]);
    expect(minNextBid(R, b.state, rules)).toBe(25_500);
  });
  it('GB-22 first bid over the reserve: price is the reserve at once', () => {
    const r = bid(R, openState(R), 'A', 30_000, 100_000);
    expect([r.outcome, r.state.priceCents]).toEqual(['ACCEPTED_LEAD', 25_000]);
  });
});

describe('GB-10..GB-14 soft close on the injected clock', () => {
  it('GB-10 a bid inside the window extends to now + W', () => {
    const r = bid(G, openState(G), 'A', 15_000, T - 30_000);
    expect([r.outcome, r.extended, r.state.closesAtMs, r.state.extensionCount]).toEqual(['ACCEPTED_LEAD', true, T + 90_000, 1]);
    const raise = bid(G, r.state, 'A', 20_000, T + 80_000);
    expect([raise.outcome, raise.extended, raise.state.closesAtMs]).toEqual(['ACCEPTED_RAISE', false, T + 90_000]); // GB-11
  });
  const s = bid(G, openState(G), 'A', 15_000, 1_000_000).state;
  it('GB-13 snipe at T - 1 s: price old max + increment, close moves to now + W', () => {
    const r = bid(G, s, 'B', 50_000, T - 1_000);
    expect([r.outcome, r.state.priceCents, r.state.closesAtMs, r.extended]).toEqual(['ACCEPTED_LEAD', 15_500, T + 119_000, true]);
  });
  it('GB-14 the boundaries: at T closed (row written); T - 1 ms open; T - W no change; T - W + 1 ms extends by 1 ms', () => {
    const atT = bid(G, s, 'B', 50_000, T);
    expect([atT.outcome, atT.state.bidCount]).toEqual(['REJECTED_LOT_CLOSED', 2]);
    expect(bid(G, s, 'B', 50_000, T - 1).outcome).toBe('ACCEPTED_LEAD');
    const atW = bid(G, s, 'B', 50_000, T - W);
    expect([atW.extended, atW.state.closesAtMs]).toEqual([false, T]);
    const past = bid(G, s, 'B', 50_000, T - W + 1);
    expect([past.extended, past.state.closesAtMs]).toEqual([true, T + 1]);
  });
  it('GB-12 extensions chain to the cap and stop there', () => {
    let st = openState(G);
    let m = 10_000;
    const closes: [string, boolean, number][] = [];
    for (let i = 0; i < 7; i++) {
      m += 1_000;
      const r = bid(G, st, i % 2 ? 'B' : 'A', m, st.closesAtMs - 1_000);
      st = r.state;
      closes.push([r.outcome, r.extended, st.closesAtMs]);
    }
    expect(closes).toEqual([
      ['ACCEPTED_LEAD', true, 3_719_000], ['ACCEPTED_LEAD', true, 3_838_000], ['ACCEPTED_LEAD', true, 3_957_000],
      ['ACCEPTED_LEAD', true, 4_076_000], ['ACCEPTED_LEAD', true, 4_195_000], ['ACCEPTED_LEAD', true, 4_200_000],
      ['ACCEPTED_LEAD', false, 4_200_000],
    ]);
    expect(st.extensionCount).toBe(6);
    expect(bid(G, st, 'A', m + 1_000, 4_200_000).outcome).toBe('REJECTED_LOT_CLOSED');
  });
});

describe('GB-19, GB-23', () => {
  it('GB-19 one ms before open is not open; exactly at open is', () => {
    const E: Lot = { ...G, opensAtMs: 1_000 };
    expect(bid(E, openState(E), 'A', 20_000, 999).outcome).toBe('REJECTED_LOT_NOT_OPEN');
    expect(bid(E, openState(E), 'A', 20_000, 1_000).outcome).toBe('ACCEPTED_LEAD');
  });
  it('GB-23 the increment comes from the band of the max stepped from, not the displayed price', () => {
    const a = bid(G, openState(G), 'A', 49_800, 100_000);
    const b = bid(G, a.state, 'B', 49_800, 200_000);
    expect([b.outcome, b.state.priceCents, b.state.leader]).toEqual(['ACCEPTED_OUTBID', 49_800, 'A']);
    const c = bid(G, b.state, 'C', 60_000, 300_000);
    expect([c.outcome, c.state.priceCents, c.state.leader]).toEqual(['ACCEPTED_LEAD', 50_300, 'C']);
    expect(minNextBid(G, c.state, rules)).toBe(51_300);
  });
});

describe('GB-24 a withdrawn lot (R-04, D-73)', () => {
  const WD = 1_000_000;
  const Wd: Lot = { ...G, withdrawnAtMs: WD };
  it('GB-24a..e before the instant the lot is open; from it every attempt is REJECTED_LOT_WITHDRAWN and a row, the status CLOSED, the settlement UNSOLD_WITHDRAWN at the withdrawal', () => {
    const s = bid(Wd, openState(Wd), 'A', 15_000, 100_000).state;
    expect([lotStatus(Wd, s, WD - 1), settle(Wd, s, WD - 1)]).toEqual(['OPEN', null]);
    const r = bid(Wd, s, 'B', 50_000, WD);
    expect(r).toMatchObject({ outcome: 'REJECTED_LOT_WITHDRAWN', accepted: false, extended: false, priceAfter: 10_000, leaderAfter: 'A' });
    expect(r.state).toMatchObject({ bidCount: 2, acceptedCount: 1, closesAtMs: T });
    const r2 = bid(Wd, r.state, 'B', 50_000, T - 1000);
    expect([r2.outcome, r2.state.bidCount]).toEqual(['REJECTED_LOT_WITHDRAWN', 3]);
    expect([lotStatus(Wd, r2.state, WD), r2.state.closesAtMs]).toEqual(['CLOSED', T]);
    expect(settle(Wd, r2.state, WD)).toEqual({ outcome: 'UNSOLD_WITHDRAWN', winner: null, winningSeq: null, hammerCents: 0, premiumCents: 0, totalCents: 0, closedAtMs: WD });
  });
  it('GB-24f/h no bids is UNSOLD_WITHDRAWN, not NO_BIDS; withdrawn while SCHEDULED is WITHDRAWN before NOT_OPEN and CLOSED, never SCHEDULED, from then', () => {
    expect(settle(Wd, openState(Wd), T)?.outcome).toBe('UNSOLD_WITHDRAWN');
    const sched: Lot = { ...Wd, opensAtMs: 2_000_000 };
    expect(bid(sched, openState(sched), 'A', 15_000, WD).outcome).toBe('REJECTED_LOT_WITHDRAWN');
    expect([lotStatus(sched, openState(sched), WD), lotStatus(sched, openState(sched), WD - 1)]).toEqual(['CLOSED', 'SCHEDULED']);
  });
  it("GB-24g fold re-derives the WITHDRAWN row from the lot's withdrawnAt, refuses it without one; resettle never sells a withdrawn lot", () => {
    const rows: FoldRow[] = [
      { seq: 1, bidderId: 'A', maxCents: 15_000, placedAtMs: 100_000, outcome: 'ACCEPTED_LEAD' },
      { seq: 2, bidderId: 'B', maxCents: 50_000, placedAtMs: WD, outcome: 'REJECTED_LOT_WITHDRAWN' },
    ];
    expect(fold(Wd, rows, rules)).toMatchObject({ bidCount: 2, acceptedCount: 1, leader: 'A', priceCents: 10_000 });
    expect(() => fold(G, rows, rules)).toThrow(/row 2 says REJECTED_LOT_WITHDRAWN, fold says ACCEPTED_LEAD/);
    expect(resettle(Wd, rows, rules, { winner: 'A', premiumBps: 1500 })).toEqual({ refused: 'LOT_WITHDRAWN' });
    expect(resettle(Wd, rows, rules, { winner: null, premiumBps: 1500 })).toMatchObject({ outcome: 'UNSOLD_BY_CORRECTION', closedAtMs: WD });
  });
});

describe('boundary: integers only', () => {
  it('a non-integer max or ms throws before anything else; a non-positive max is a RangeError', () => {
    const s = openState(G);
    expect(() => bid(G, s, 'A', 150.5, 100_000)).toThrow(MoneyError);
    expect(() => bid(G, s, 'A', 15_000, 100_000.5)).toThrow(MoneyError);
    expect(() => bid(G, s, 'A', Number.MAX_SAFE_INTEGER + 2, 100_000)).toThrow(MoneyError);
    expect(() => bid(G, s, 'A', 0, 100_000)).toThrow(RangeError);
    expect(() => incrementFor(-1, rules)).toThrow(RangeError);
  });
  it('applyBid never mutates its inputs and is deterministic', () => {
    const s = openState(G);
    const frozen = Object.freeze({ ...s });
    const r1 = bid(G, frozen, 'A', 15_000, 100_000);
    const r2 = bid(G, frozen, 'A', 15_000, 100_000);
    expect(r1).toEqual(r2);
    expect(frozen).toEqual(s);
  });
});
