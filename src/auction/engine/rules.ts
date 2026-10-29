// Rules are data (D-7): this file parses and validates rules/auction.v1.json and hashes its bytes.
// Pure: a string in, a Rules value (or a typed refusal) out. Reading the file is src/auction/load-rules.ts.
// The hash is sha256 of the raw file bytes (D-23, D-31 Q3); it is printed by auction:eval, checked by
// rules:lint and stored on every Settlement row. A new hash means a new D-23 row and regenerated fixtures.
import { createHash } from 'node:crypto';

export const RULES_V1_HASH = 'a7b214408f02a34ec1c7964ecd31d1fce6eca5b6b2aea8a5964edb8d6ef8c43f'; // D-23 (D-73: the withdrawn outcomes)
/** Every hash D-23 has listed, oldest first. V9 accepts a settlement row computed under any of them: the rows settled
 * before a list grew were computed by the same arithmetic, and settle(fold(ledger)) still reproduces them (V8). */
export const RULES_HASHES_D23 = ['b4cce697db2d9cd82a1b7aab9622f07b61e899f6f812ce0024829ecc111961f8', RULES_V1_HASH] as const;

export const ACCEPTED_OUTCOMES = ['ACCEPTED_LEAD', 'ACCEPTED_OUTBID', 'ACCEPTED_RAISE'] as const;
export const REJECTED_OUTCOMES = [
  'REJECTED_LOT_NOT_OPEN',
  'REJECTED_LOT_CLOSED',
  'REJECTED_BELOW_MINIMUM',
  'REJECTED_NOT_ABOVE_OWN_MAX',
  'REJECTED_LOT_WITHDRAWN', // D-73: at or after the lot's withdrawnAt
] as const;
export const NOT_WRITTEN_OUTCOMES = ['REPLAY', 'IDEMPOTENCY_MISMATCH'] as const;
export const SETTLEMENT_OUTCOMES = ['SOLD', 'UNSOLD_NO_BIDS', 'UNSOLD_RESERVE_NOT_MET', 'UNSOLD_WITHDRAWN'] as const;

export type AcceptedOutcome = (typeof ACCEPTED_OUTCOMES)[number];
export type RejectedOutcome = (typeof REJECTED_OUTCOMES)[number];
export type BidOutcome = AcceptedOutcome | RejectedOutcome;
export type NotWrittenOutcome = (typeof NOT_WRITTEN_OUTCOMES)[number];
export type SettlementOutcome = (typeof SETTLEMENT_OUTCOMES)[number];

/** One increment band: [loCents, hiCents) in cents; hiCents null is open-ended (the last band only). */
export type Band = { readonly loCents: number; readonly hiCents: number | null; readonly incrementCents: number };

export type Rules = {
  readonly version: 'auction.v1';
  readonly bands: readonly Band[];
  readonly defaults: {
    readonly softCloseWindowSeconds: number;
    readonly maxExtensionSeconds: number;
    readonly buyerPremiumBps: number;
  };
};

export type RulesErrorCode =
  | 'not_json'
  | 'bad_shape'
  | 'bands_not_contiguous'
  | 'last_band_not_open'
  | 'increment_not_positive'
  | 'increments_decreasing'
  | 'default_not_positive_integer'
  | 'outcomes_not_closed'
  | 'hash_mismatch';

export class RulesError extends Error {
  constructor(
    readonly code: RulesErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export const hashRules = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const sameList = (a: unknown, b: readonly string[]) => JSON.stringify(a) === JSON.stringify(b);

/** Parse and validate the rules file's text. Throws RulesError; never returns a partial value. */
export function parseRules(text: string): Rules {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new RulesError('not_json', e instanceof Error ? e.message : String(e));
  }
  if (!isRecord(raw) || raw.version !== 'auction.v1' || raw.money !== 'integer cents' || raw.rounding !== 'half_up')
    throw new RulesError('bad_shape', 'version "auction.v1", money "integer cents", rounding "half_up"');
  if (!isRecord(raw.increments) || !Array.isArray(raw.increments.bands) || raw.increments.bands.length === 0)
    throw new RulesError('bad_shape', 'increments.bands must be a non-empty array');
  if (!isRecord(raw.defaults) || !isRecord(raw.outcomes)) throw new RulesError('bad_shape', 'defaults and outcomes');

  // Bands: contiguous from 0, [lo, hi), open-ended last, positive non-decreasing increments.
  const bands: Band[] = [];
  const rawBands: unknown[] = raw.increments.bands;
  let expectLo = 0;
  rawBands.forEach((b, i) => {
    const last = i === rawBands.length - 1;
    if (!isRecord(b)) throw new RulesError('bad_shape', `band ${i} is not an object`);
    const { lo_cents: lo, hi_cents: hi, increment_cents: inc } = b;
    if (lo !== expectLo) throw new RulesError('bands_not_contiguous', `band ${i} lo_cents ${lo}, expected ${expectLo}`);
    if (last ? hi !== null : !isPosInt(hi) || hi <= lo)
      throw new RulesError(last ? 'last_band_not_open' : 'bands_not_contiguous', `band ${i} hi_cents ${hi}`);
    if (!isPosInt(inc)) throw new RulesError('increment_not_positive', `band ${i} increment_cents ${inc}`);
    const prev = bands[i - 1];
    if (prev && inc < prev.incrementCents) throw new RulesError('increments_decreasing', `band ${i}: ${inc} < ${prev.incrementCents}`);
    bands.push({ loCents: lo, hiCents: last ? null : (hi as number), incrementCents: inc });
    expectLo = last ? expectLo : (hi as number);
  });

  const d = raw.defaults;
  for (const key of ['soft_close_window_seconds', 'max_extension_seconds', 'buyer_premium_bps'])
    if (!isPosInt(d[key])) throw new RulesError('default_not_positive_integer', `${key}: ${d[key]}`);

  const o = raw.outcomes;
  if (
    !sameList(o.accepted, ACCEPTED_OUTCOMES) ||
    !sameList(o.rejected, REJECTED_OUTCOMES) ||
    !sameList(o.not_written, NOT_WRITTEN_OUTCOMES) ||
    !sameList(raw.settlement_outcomes, SETTLEMENT_OUTCOMES)
  )
    throw new RulesError('outcomes_not_closed', 'the outcome lists must equal the engine\'s, in order');

  return {
    version: 'auction.v1',
    bands,
    defaults: {
      softCloseWindowSeconds: d.soft_close_window_seconds as number,
      maxExtensionSeconds: d.max_extension_seconds as number,
      buyerPremiumBps: d.buyer_premium_bps as number,
    },
  };
}
