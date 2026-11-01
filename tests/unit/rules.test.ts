import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULES_HASH, RULES_HASHES_D23, RulesError, checkPremiumBands, parseRules } from '@/auction/engine/rules';
import { RULES_PATH, loadRules } from '@/auction/load-rules';
import { lintEngineDir, lintEngineSource } from '../../scripts/rules-lint';

type Raw = {
  version: string;
  money: string;
  increments: { default_table: string; tables: Record<string, { lo_cents: number; hi_cents: number | null; increment_cents: number }[]> };
  defaults: { soft_close_window_seconds?: number; max_extension_seconds?: number; premium_bands?: { lo_cents: number; hi_cents: number | null; bps: number }[] };
  outcomes: Record<string, string[]>;
  settlement_outcomes: string[];
};
const text = readFileSync(RULES_PATH, 'utf8');
const edit = (fn: (raw: Raw) => void) => {
  const raw = JSON.parse(text) as Raw;
  fn(raw);
  return JSON.stringify(raw);
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof RulesError) return e.code;
    throw e;
  }
  return 'accepted';
};

describe('loadRules (D-7, D-23)', () => {
  it('loads rules/auction.v2.json with the D-23 hash (D-90)', () => {
    const { rules, hash } = loadRules();
    expect(hash).toBe(RULES_HASH);
    expect(RULES_HASHES_D23).toHaveLength(3); // kickoff, D-73, D-90: every one still verifies (V9)
    expect(Object.keys(rules.tables)).toEqual(['standard', 'equipment', 'estate']);
    expect(rules.defaultTable).toBe('standard');
    expect(rules.bands).toBe(rules.tables.standard);
    expect(rules.bands).toHaveLength(7);
    expect(rules.bands[0]).toEqual({ loCents: 0, hiCents: 10000, incrementCents: 100 });
    expect(rules.bands[6]).toEqual({ loCents: 2500000, hiCents: null, incrementCents: 25000 });
    expect(rules.defaults).toEqual({ softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1500, premiumBands: [{ loCents: 0, hiCents: null, bps: 1500 }] });
  });

  it('the standard table is v1\'s bands exactly, so every v1 ledger folds the same', () => {
    const v1 = JSON.parse(readFileSync('rules/auction.v1.json', 'utf8')) as { increments: { bands: unknown } };
    expect((JSON.parse(text) as Raw).increments.tables.standard).toEqual(v1.increments.bands);
  });

  it('refuses a copy with one byte changed', () => {
    const copy = join(mkdtempSync(join(tmpdir(), 'gavel-rules-')), 'auction.v2.json');
    writeFileSync(copy, text.replace('"bps": 1500', '"bps": 1501'));
    expect(code(() => loadRules(copy))).toBe('hash_mismatch');
  });
});

describe('parseRules (brief §5: contiguous from 0, open last, non-decreasing increments, closed lists)', () => {
  it('accepts the committed file', () => expect(code(() => parseRules(text))).toBe('accepted'));

  it.each([
    ['overlapping bands', (r) => (r.increments.tables.standard![1]!.lo_cents = 9000), 'bands_not_contiguous'],
    ['a gap', (r) => (r.increments.tables.standard![1]!.lo_cents = 11000), 'bands_not_contiguous'],
    ['not starting at 0', (r) => (r.increments.tables.standard![0]!.lo_cents = 1), 'bands_not_contiguous'],
    ['hi not above lo', (r) => (r.increments.tables.standard![0]!.hi_cents = 0), 'bands_not_contiguous'],
    ['a closed last band', (r) => (r.increments.tables.standard![6]!.hi_cents = 9999999), 'last_band_not_open'],
    ['an open middle band', (r) => (r.increments.tables.standard![2]!.hi_cents = null), 'bands_not_contiguous'],
    ['a zero increment', (r) => (r.increments.tables.standard![0]!.increment_cents = 0), 'increment_not_positive'],
    ['a float increment', (r) => (r.increments.tables.standard![0]!.increment_cents = 100.5), 'increment_not_positive'],
    ['a decreasing increment', (r) => (r.increments.tables.standard![3]!.increment_cents = 900), 'increments_decreasing'],
    ['a bad equipment table', (r) => (r.increments.tables.equipment![1]!.lo_cents = 1), 'bands_not_contiguous'],
    ['a default table that is not a table', (r) => (r.increments.default_table = 'farm'), 'bad_shape'],
    ['a missing default', (r) => delete r.defaults.max_extension_seconds, 'default_not_positive_integer'],
    ['no default premium', (r) => delete r.defaults.premium_bands, 'premium_bands_invalid'],
    ['a default premium above 10000 bps', (r) => (r.defaults.premium_bands![0]!.bps = 10001), 'premium_bands_invalid'],
    ['a float default', (r) => (r.defaults.soft_close_window_seconds = 120.0001), 'default_not_positive_integer'],
    ['an extra outcome', (r) => r.outcomes.accepted!.push('ACCEPTED_LATE'), 'outcomes_not_closed'],
    ['a missing outcome', (r) => r.outcomes.rejected!.pop(), 'outcomes_not_closed'],
    ['a renamed settlement outcome', (r) => (r.settlement_outcomes[0]! = 'WON'), 'outcomes_not_closed'],
    ['another version', (r) => (r.version = 'auction.v1'), 'bad_shape'],
    ['float money', (r) => (r.money = 'dollars'), 'bad_shape'],
    ['an empty table', (r) => (r.increments.tables.estate = []), 'bad_shape'],
  ] as [string, (r: Raw) => void, string][])('refuses %s', (_, mutate, expected) => {
    expect(code(() => parseRules(edit(mutate)))).toBe(expected);
  });

  it('refuses non-JSON', () => expect(code(() => parseRules('{'))).toBe('not_json'));
});

describe('checkPremiumBands (D-90, GB-29j..m)', () => {
  const two = [{ loCents: 0, hiCents: 500000, bps: 1500 }, { loCents: 500000, hiCents: null, bps: 1000 }];
  it('accepts a two-band schedule and returns it as given', () => expect(checkPremiumBands(two)).toEqual(two));
  it.each([
    ['nothing', []],
    ['not from 0', [{ loCents: 1, hiCents: null, bps: 1500 }]],
    ['a gap', [{ loCents: 0, hiCents: 100, bps: 1500 }, { loCents: 200, hiCents: null, bps: 1000 }]],
    ['an empty band', [{ loCents: 0, hiCents: 0, bps: 1500 }, { loCents: 0, hiCents: null, bps: 1000 }]],
    ['a closed last band', [{ loCents: 0, hiCents: 100, bps: 1500 }]],
    ['bps above 10000', [{ loCents: 0, hiCents: null, bps: 10001 }]],
    ['negative bps', [{ loCents: 0, hiCents: null, bps: -1 }]],
    ['fractional bps', [{ loCents: 0, hiCents: null, bps: 1500.5 }]],
    ['a fractional boundary', [{ loCents: 0, hiCents: 100.5, bps: 1500 }, { loCents: 100.5, hiCents: null, bps: 1000 }]],
  ])('refuses %s', (_, bands) => expect(code(() => checkPremiumBands(bands))).toBe('premium_bands_invalid'));
});

describe('rules:lint engine scan (non-negotiables 1 and 6)', () => {
  it('passes the committed engine', () => expect(lintEngineDir()).toEqual([]));

  it.each([
    ['Date.now', 'const t = Date.now();'],
    ['new Date', 'const t = new Date();'],
    ['Math.random', 'const r = Math.random();'],
    ['process.env', 'const p = process.env.X;'],
    ['fetch', 'await fetch(url);'],
    ['setTimeout', 'setTimeout(f, 1);'],
    ['Prisma', "import { prisma } from '@/core/db';"],
    ['@/core', "import { now } from '@/core/clock';"],
    ['@/app', "import x from '@/app/x';"],
    ['Math.round', 'const c = Math.round(x);'],
    ['toFixed', 'const s = x.toFixed(2);'],
    ['parseFloat', 'const f = parseFloat(s);'],
    ['a decimal literal', 'const bps = 0.15;'],
    ['division', 'const half = cents / 2;'],
    ['a regex literal', 'const ok = /x/.test(s);'],
  ])('flags %s', (_, src) => {
    expect(lintEngineSource('engine.ts', src)).not.toEqual([]);
  });

  it('ignores the same names inside comments', () => {
    expect(lintEngineSource('engine.ts', '// Date.now() is banned here; see /* fetch */ above\nconst x = 1;')).toEqual([]);
  });

  it('allows exactly one / in money.ts and none elsewhere', () => {
    expect(lintEngineSource('money.ts', 'const c = a / b;')).toEqual([]);
    expect(lintEngineSource('money.ts', 'const c = a / b / d;')).not.toEqual([]);
    expect(lintEngineSource('engine.ts', 'const c = a / b;')).not.toEqual([]);
  });

  it('does not count import specifiers as /, but still bans what they import', () => {
    expect(lintEngineSource('engine.ts', "import { assertCents } from './money';\nconst x = 1;")).toEqual([]);
    expect(lintEngineSource('engine.ts', "import { now } from '@/core/clock';")).toEqual(['engine.ts: @/core']);
  });
});
