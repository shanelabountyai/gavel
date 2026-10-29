// The one home for money representation and rounding (D-11, D-22). Ported whole from LoanBook
// `src/ledger/money.ts` (task 1.3, D-32); the numeric-text read edge and the display variants were
// left behind because Gavel's cents columns are integers and its CSVs print raw cents.
// Cents and basis points are integer `number`s; nothing else under src/auction/engine divides or rounds.

export type MoneyErrorCode = 'non_integer_amount' | 'non_integer_rate' | 'rate_out_of_range' | 'negative_amount' | 'invalid_rounding_input';

export class MoneyError extends Error {
  constructor(readonly code: MoneyErrorCode) {
    super(code);
  }
}

function assertInteger(value: unknown, code: MoneyErrorCode): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new MoneyError(code);
  return value;
}

/** Boundary guard for an amount in cents. Sign is the caller's rule, not this one's. */
export const assertCents = (value: unknown) => assertInteger(value, 'non_integer_amount');

/** Boundary guard for a rate in basis points (1500 = 15.00%). */
export const assertBps = (value: unknown) => assertInteger(value, 'non_integer_rate');

/**
 * Round half up to whole cents, once, from an exact quantity given as numerator / denominator.
 * Non-negative quantities only: "half up" is ambiguous below zero and no rule here rounds a negative.
 * The one `/` the float lint excuses (D-31 Q5): bigint division, exact.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): number {
  if (numerator < 0n || denominator <= 0n) throw new MoneyError('invalid_rounding_input');
  // floor(n/d + 1/2); bigint division truncates, which is floor for a non-negative quantity
  const cents = Number((2n * numerator + denominator) / (2n * denominator));
  return assertInteger(cents, 'invalid_rounding_input');
}

/** Display only: whole cents as dollars by string, never through a float ("-$1,234.05"). */
export function formatCents(value: number): string {
  const digits = String(Math.abs(assertCents(value))).padStart(3, '0');
  const whole = digits.slice(0, -2);
  let dollars = '';
  for (let i = 0; i < whole.length; i++) dollars += (i > 0 && (whole.length - i) % 3 === 0 ? ',' : '') + whole[i];
  return `${value < 0 ? '-' : ''}$${dollars}.${digits.slice(-2)}`;
}
