import { describe, expect, it } from 'vitest';
import { MoneyError, assertBps, assertCents, formatCents, roundHalfUp } from '@/auction/engine/money';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof MoneyError) return e.code;
    throw e;
  }
  return 'accepted';
};

describe('assertCents (D-11)', () => {
  it.each([0, 1, -1, 100000, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])('accepts %s', (v) => {
    expect(assertCents(v)).toBe(v);
  });

  it.each([
    ['a float', 100.5],
    ['a tiny fraction', 0.1 + 0.2],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['past the safe range', Number.MAX_SAFE_INTEGER + 1],
    ['true', true],
    ['a numeric string', '100'],
    ['a bigint', 100n],
    ['null', null],
    ['undefined', undefined],
    ['an object', { cents: 100 }],
  ])('rejects %s', (_, v) => {
    expect(code(() => assertCents(v))).toBe('non_integer_amount');
  });
});

describe('assertBps (D-11)', () => {
  it('accepts an integer rate', () => expect(assertBps(1500)).toBe(1500));
  it.each([12.5, true, '1500', NaN])('rejects %s', (v) => {
    expect(code(() => assertBps(v))).toBe('non_integer_rate');
  });
});

describe('roundHalfUp (D-22, GB-16)', () => {
  // GB-16: premium rounds half up once (brief §9; tools/golden_answers.py)
  it.each([
    [10020n * 1250n, 10000n, 1253],
    [10010n * 1250n, 10000n, 1251],
    [33333n * 1500n, 10000n, 5000],
    [1n, 2n, 1],
  ])('GB-16 %s / %s -> %s', (n, d, cents) => {
    expect(roundHalfUp(n, d)).toBe(cents);
  });

  it.each([
    [0n, 1n, 0],
    [7n, 1n, 7],
    [3n, 2n, 2],
    [5n, 2n, 3], // banker's rounding would give 2
    [49n, 100n, 0],
    [51n, 100n, 1],
  ])('%s / %s -> %s', (n, d, cents) => {
    expect(roundHalfUp(n, d)).toBe(cents);
  });

  it.each([
    ['a negative quantity', -1n, 2n],
    ['a zero denominator', 1n, 0n],
    ['a negative denominator', 1n, -2n],
    ['a result past the safe range', BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1n],
  ])('rejects %s', (_, n, d) => {
    expect(code(() => roundHalfUp(n, d))).toBe('invalid_rounding_input');
  });
});

describe('formatCents (display)', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [1500, '$15.00'],
    [123456, '$1234.56'],
    [-1205, '-$12.05'],
  ])('%i is %s', (c, s) => expect(formatCents(c)).toBe(s));
  it('refuses a fraction', () => expect(() => formatCents(1.5)).toThrow(MoneyError));
});
