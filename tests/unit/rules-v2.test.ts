// R-18 (D-90): the GB-29 premium bands and GB-30 increment tables of docs/domain-brief.md §9, with the exact values
// tools/golden_answers.py prints. Each expected number is derived in its test name.
import { describe, expect, it } from 'vitest';
import { type Lot, applyBid, incrementFor, minNextBid, openState, premiumFor, settle } from '@/auction/engine/engine';
import { MoneyError } from '@/auction/engine/money';
import type { PremiumBand } from '@/auction/engine/rules';
import { loadRules } from '@/auction/load-rules';

const { rules } = loadRules();
const TWO: PremiumBand[] = [{ loCents: 0, hiCents: 500_000, bps: 1500 }, { loCents: 500_000, hiCents: null, bps: 1000 }];

describe('GB-29 premium bands: each rate on its slice, summed, rounded half up once', () => {
  it.each([
    ['a 499,999 × 1500 / 10,000 = 74,999.85 → 75,000', 499_999, 75_000],
    ['b the boundary: 500,000 × 1500 / 10,000 = 75,000', 500_000, 75_000],
    ['c one cent above: 75,000.1 → 75,000', 500_001, 75_000],
    ['d five cents above: 75,000.5 → 75,001', 500_005, 75_001],
    ['e 1,000,000: 75,000 + 50,000 = 125,000', 1_000_000, 125_000],
  ])('GB-29%s', (_, hammer, premium) => expect(premiumFor(hammer, 1500, TWO)).toBe(premium));

  it('GB-29f once, not per band: 20,006 over [0, 10,003) at 1500 and above at 1000 → 2,500.75 → 2,501', () => {
    expect(premiumFor(20_006, 1500, [{ loCents: 0, hiCents: 10_003, bps: 1500 }, { loCents: 10_003, hiCents: null, bps: 1000 }])).toBe(2501);
  });

  it('GB-29g no bands, or one band, is the v1 flat formula: 10,020 at 1500 → 1,503', () => {
    expect([premiumFor(10_020, 1500), premiumFor(10_020, 1500, null), premiumFor(10_020, 9999, [{ loCents: 0, hiCents: null, bps: 1500 }])]).toEqual([1503, 1503, 1503]);
  });

  it('GB-29h three bands, 3,000,000: (1e9 + 3e9 + 5e8) / 10,000 = 450,000', () => {
    expect(premiumFor(3_000_000, 2000, [{ loCents: 0, hiCents: 500_000, bps: 2000 }, { loCents: 500_000, hiCents: 2_500_000, bps: 1500 }, { loCents: 2_500_000, hiCents: null, bps: 1000 }])).toBe(450_000);
  });

  it('a non-integer hammer is a MoneyError', () => expect(() => premiumFor(500_000.5, 1500, TWO)).toThrow(MoneyError));

  it('settle() takes the lot\'s schedule: a lone 1,000,000 max on a 500,005 start sells at 500,005 + 75,001 (L044)', () => {
    const lot: Lot = { startCents: 500_005, reserveCents: null, opensAtMs: 0, scheduledEndMs: 1000, softCloseWindowMs: 0, maxExtensionMs: 0, buyerPremiumBps: 1500, withdrawnAtMs: null, premiumBands: TWO };
    const s = applyBid(lot, openState(lot), 'A', 1_000_000, 1, rules).state;
    expect(settle(lot, s, 1000)).toMatchObject({ outcome: 'SOLD', hammerCents: 500_005, premiumCents: 75_001, totalCents: 575_006 });
  });
});

describe('GB-30 named increment tables', () => {
  it('GB-30a standard is GB-17, and no name is standard', () => {
    const at = [0, 9_999, 10_000, 49_999, 50_000, 99_999, 100_000, 499_999, 500_000, 2_499_999, 2_500_000];
    expect(at.map((p) => incrementFor(p, rules, 'standard'))).toEqual(at.map((p) => incrementFor(p, rules)));
  });
  it('GB-30b equipment at each boundary', () => {
    const at = [0, 9_999, 10_000, 99_999, 100_000, 499_999, 500_000, 2_499_999, 2_500_000, 9_999_999, 10_000_000];
    expect(at.map((p) => incrementFor(p, rules, 'equipment'))).toEqual([500, 500, 2500, 2500, 5000, 5000, 10000, 10000, 25000, 25000, 50000]);
  });
  it('GB-30c estate at each boundary', () => {
    const at = [0, 1_999, 2_000, 9_999, 10_000, 24_999, 25_000, 49_999, 50_000, 99_999, 100_000, 499_999, 500_000];
    expect(at.map((p) => incrementFor(p, rules, 'estate'))).toEqual([50, 50, 100, 100, 250, 250, 500, 500, 1000, 1000, 2500, 2500, 5000]);
  });
  it('an unknown table is refused, never defaulted', () => expect(() => incrementFor(100, rules, 'farm')).toThrow(RangeError));

  const outbid = (lot: Lot) => {
    const s = applyBid(lot, openState(lot), 'A', 150_000, 100, rules).state;
    const r = applyBid(lot, s, 'B', 120_000, 200, rules);
    return [r.outcome, r.state.priceCents, minNextBid(lot, r.state, rules)];
  };
  const base: Lot = { startCents: 100_000, reserveCents: null, opensAtMs: 0, scheduledEndMs: 3_600_000, softCloseWindowMs: 120_000, maxExtensionMs: 600_000, buyerPremiumBps: 1500, withdrawnAtMs: null };
  it('GB-30d the same bids under equipment: outbid at 120,000 + 5,000; next 125,000 + 5,000', () => expect(outbid({ ...base, incrementTable: 'equipment' })).toEqual(['ACCEPTED_OUTBID', 125_000, 130_000]));
  it('GB-30e under standard: 120,000 + 2,500; next 122,500 + 2,500', () => expect(outbid(base)).toEqual(['ACCEPTED_OUTBID', 122_500, 125_000]));
});
