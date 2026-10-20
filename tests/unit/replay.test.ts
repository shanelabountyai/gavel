// Task 1.6: the brief §9 goldens that need replay, fold and settle (GB-09, GB-15, GB-16, GB-18, GB-20, GB-21),
// lotStatus (D-21), and determinism: the frozen fixtures replayed twice diff nothing. Lot G and R as engine.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Lot, type Submission, applyBid, fold, lotStatus, openState, replay, settle } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';
import { run } from '../../scripts/auction-eval';

const { rules } = loadRules();
const T = 3_600_000;
const G: Lot = { startCents: 10_000, reserveCents: null, opensAtMs: 0, scheduledEndMs: T, softCloseWindowMs: 120_000, maxExtensionMs: 600_000, buyerPremiumBps: 1500 };
const R: Lot = { ...G, reserveCents: 25_000 };
let n = 0;
const sub = (bidderId: string, maxCents: number, placedAtMs: number, idempotencyKey = `k${++n}`): Submission => ({ submissionId: `S${n}`, bidderId, maxCents, placedAtMs, idempotencyKey });

describe('GB-18 replay and the idempotency rule (D-17)', () => {
  const subs = [sub('A', 15_000, 1000, 'k1'), sub('A', 15_000, 2000, 'k1'), sub('A', 16_000, 3000, 'k1'), sub('B', 15_000, 4000, 'k1')];
  const { state, rows, outcomes } = replay(G, subs, rules);
  const [r1, r2] = rows as [typeof rows[0], typeof rows[0]];
  const o1 = outcomes[1]!;
  it('same key + same amount is REPLAY with the prior seq; different amount is a mismatch; another bidder is a new bid', () => {
    expect(outcomes.map((o) => [o.outcome, o.seq, o.row !== null])).toEqual([
      ['ACCEPTED_LEAD', 1, true],
      ['REPLAY', 1, false],
      ['IDEMPOTENCY_MISMATCH', null, false],
      ['ACCEPTED_OUTBID', 2, true],
    ]);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect([state.bidCount, state.priceCents, state.leader]).toEqual([2, 15_000, 'A']);
  });
  it('a not-written outcome reports the state as it stands', () => {
    expect([o1.priceAfter, o1.leaderAfter, o1.closesAfterMs]).toEqual([10_000, 'A', T]);
  });
  it('GB-20 fold of the rows equals the replay state; a seq gap is refused by name', () => {
    expect(fold(G, rows, rules)).toEqual(state);
    expect(() => fold(G, [r1, { ...r2, seq: 3 }], rules)).toThrow('seq gap at 3');
  });
  it('fold refuses a row whose recorded outcome disagrees with re-applying it', () => {
    expect(() => fold(G, [r1, { ...r2, outcome: 'ACCEPTED_LEAD' }], rules)).toThrow('ledger row 2 says ACCEPTED_LEAD, fold says ACCEPTED_OUTBID');
  });
});

describe('GB-15 settlement of lot G after GB-07 (D-22)', () => {
  const steps: [string, number][] = [['A', 15_000], ['B', 12_000], ['C', 20_000], ['D', 20_000], ['E', 20_400], ['C', 30_000], ['C', 30_000]];
  const state = steps.reduce((s, [who, m], i) => applyBid(G, s, who, m, (i + 1) * 100_000, rules).state, openState(G));
  it('null at T − 1, SOLD at T with winner C, winningSeq 6, hammer 20,000, premium 3,000', () => {
    expect(settle(G, state, T - 1)).toBeNull();
    expect(settle(G, state, T)).toEqual({ outcome: 'SOLD', winner: 'C', winningSeq: 6, hammerCents: 20_000, premiumCents: 3_000, totalCents: 23_000, closedAtMs: T });
  });
  it('lotStatus is derived (D-21)', () => {
    expect([lotStatus(G, state, -1), lotStatus(G, state, 0), lotStatus(G, state, T - 1), lotStatus(G, state, T)]).toEqual(['SCHEDULED', 'OPEN', 'OPEN', 'CLOSED']);
  });
});

describe('GB-16 premium through settle: one half-up rounding', () => {
  it.each([
    [10_020, 1250, 1_253],
    [10_010, 1250, 1_251],
    [33_333, 1500, 5_000],
  ])('hammer %s × %s bps → %s', (hammer, bps, premium) => {
    const lot: Lot = { ...G, startCents: hammer, buyerPremiumBps: bps };
    const { state } = replay(lot, [sub('A', hammer, 1000)], rules);
    expect(settle(lot, state, T)?.premiumCents).toBe(premium);
  });
});

describe('GB-09, GB-21 unsold outcomes', () => {
  it('GB-09 reserve not met: no winner, zero amounts', () => {
    const { state } = replay(R, [sub('A', 20_000, 1000)], rules);
    expect(settle(R, state, T)).toEqual({ outcome: 'UNSOLD_RESERVE_NOT_MET', winner: null, winningSeq: null, hammerCents: 0, premiumCents: 0, totalCents: 0, closedAtMs: T });
  });
  it('GB-21 an empty lot: UNSOLD_NO_BIDS at T, null at T − 1', () => {
    expect(settle(G, openState(G), T)?.outcome).toBe('UNSOLD_NO_BIDS');
    expect(settle(G, openState(G), T - 1)).toBeNull();
  });
});

describe('the frozen fixtures (brief §10–§11)', () => {
  it('auction:eval reproduces expected_bids.csv and expected_lots.csv column for column', () => {
    const { ok, report } = run();
    expect(report, report).toContain('OK: expected_bids.csv (220 rows) and expected_lots.csv (36 rows)');
    expect(ok).toBe(true);
  });
  it('replays every lot twice and diffs nothing (determinism)', () => {
    const lots = JSON.parse(readFileSync('fixtures/auctions.json', 'utf8')).auctions.flatMap((a: { soft_close_window_seconds: number; max_extension_seconds: number; buyer_premium_bps: number; lots: { lot_id: string; start_cents: number; reserve_cents: number | null; opens_at_ms: number; scheduled_end_ms: number }[] }) =>
      a.lots.map((l) => ({ id: l.lot_id, lot: { startCents: l.start_cents, reserveCents: l.reserve_cents, opensAtMs: l.opens_at_ms, scheduledEndMs: l.scheduled_end_ms,
        softCloseWindowMs: a.soft_close_window_seconds * 1000, maxExtensionMs: a.max_extension_seconds * 1000, buyerPremiumBps: a.buyer_premium_bps } as Lot })));
    const subs = readFileSync('fixtures/submissions.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    for (const { id, lot } of lots) {
      const list: Submission[] = subs.filter((s) => s.lot_id === id).map((s) => ({ submissionId: s.submission_id, bidderId: s.bidder_id, maxCents: s.max_cents, placedAtMs: s.placed_at_ms, idempotencyKey: s.idempotency_key }));
      const once = replay(lot, list, rules);
      const twice = replay(lot, list, rules);
      expect(twice).toEqual(once);
      expect(fold(lot, once.rows, rules)).toEqual(once.state);
    }
    expect(lots).toHaveLength(36);
  });
});
