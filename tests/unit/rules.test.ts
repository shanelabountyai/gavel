import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULES_V1_HASH, RulesError, parseRules } from '@/auction/engine/rules';
import { RULES_PATH, loadRules } from '@/auction/load-rules';
import { lintEngineDir, lintEngineSource } from '../../scripts/rules-lint';

type Raw = {
  version: string;
  money: string;
  increments: { bands: { lo_cents: number; hi_cents: number | null; increment_cents: number }[] };
  defaults: Record<string, number | undefined>;
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
  it('loads rules/auction.v1.json with the D-23 hash', () => {
    const { rules, hash } = loadRules();
    expect(hash).toBe(RULES_V1_HASH);
    expect(rules.bands).toHaveLength(7);
    expect(rules.bands[0]).toEqual({ loCents: 0, hiCents: 10000, incrementCents: 100 });
    expect(rules.bands[6]).toEqual({ loCents: 2500000, hiCents: null, incrementCents: 25000 });
    expect(rules.defaults).toEqual({ softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1500 });
  });

  it('refuses a copy with one byte changed', () => {
    const copy = join(mkdtempSync(join(tmpdir(), 'gavel-rules-')), 'auction.v1.json');
    writeFileSync(copy, text.replace('"buyer_premium_bps": 1500', '"buyer_premium_bps": 1501'));
    expect(code(() => loadRules(copy))).toBe('hash_mismatch');
  });
});

describe('parseRules (brief §5: contiguous from 0, open last, non-decreasing increments, closed lists)', () => {
  it('accepts the committed file', () => expect(code(() => parseRules(text))).toBe('accepted'));

  it.each([
    ['overlapping bands', (r) => (r.increments.bands[1]!.lo_cents = 9000), 'bands_not_contiguous'],
    ['a gap', (r) => (r.increments.bands[1]!.lo_cents = 11000), 'bands_not_contiguous'],
    ['not starting at 0', (r) => (r.increments.bands[0]!.lo_cents = 1), 'bands_not_contiguous'],
    ['hi not above lo', (r) => (r.increments.bands[0]!.hi_cents = 0), 'bands_not_contiguous'],
    ['a closed last band', (r) => (r.increments.bands[6]!.hi_cents = 9999999), 'last_band_not_open'],
    ['an open middle band', (r) => (r.increments.bands[2]!.hi_cents = null), 'bands_not_contiguous'],
    ['a zero increment', (r) => (r.increments.bands[0]!.increment_cents = 0), 'increment_not_positive'],
    ['a float increment', (r) => (r.increments.bands[0]!.increment_cents = 100.5), 'increment_not_positive'],
    ['a decreasing increment', (r) => (r.increments.bands[3]!.increment_cents = 900), 'increments_decreasing'],
    ['a missing default', (r) => delete r.defaults.buyer_premium_bps, 'default_not_positive_integer'],
    ['a float default', (r) => (r.defaults.soft_close_window_seconds = 120.0001), 'default_not_positive_integer'],
    ['an extra outcome', (r) => r.outcomes.accepted!.push('ACCEPTED_LATE'), 'outcomes_not_closed'],
    ['a missing outcome', (r) => r.outcomes.rejected!.pop(), 'outcomes_not_closed'],
    ['a renamed settlement outcome', (r) => (r.settlement_outcomes[0]! = 'WON'), 'outcomes_not_closed'],
    ['another version', (r) => (r.version = 'auction.v2'), 'bad_shape'],
    ['float money', (r) => (r.money = 'dollars'), 'bad_shape'],
    ['no bands', (r) => (r.increments.bands = []), 'bad_shape'],
  ] as [string, (r: Raw) => void, string][])('refuses %s', (_, mutate, expected) => {
    expect(code(() => parseRules(edit(mutate)))).toBe(expected);
  });

  it('refuses non-JSON', () => expect(code(() => parseRules('{'))).toBe('not_json'));
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
});
