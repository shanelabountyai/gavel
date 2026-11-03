// Rules are data (D-7): this file parses and validates rules/auction.v2.json (D-90) and hashes its bytes.
// Pure: a string in, a Rules value (or a typed refusal) out. Reading the file is src/auction/load-rules.ts.
// The hash is sha256 of the raw file bytes (D-23, D-31 Q3); it is printed by auction:eval, checked by
// rules:lint and stored on every Settlement row. A new hash means a new D-23 row and regenerated fixtures.
import { createHash } from 'node:crypto';

export const RULES_V1_HASH = 'a7b214408f02a34ec1c7964ecd31d1fce6eca5b6b2aea8a5964edb8d6ef8c43f'; // D-23 (D-73: the withdrawn outcomes)
/** The file the loader reads now (D-90): rules/auction.v2.json. Its `standard` table is v1's bands and a sale with no
 * premium bands is v1's flat rate, so a row settled under a v1 hash is still what settle(fold(ledger)) says. */
export const RULES_HASH = '6a2cb3504ae03b22acae948cf69b920f0ce2d2f85308c078c1d1e22c37b9eede'; // D-23 (4), D-96: the void outcomes
/** D-23 (3), D-90: v2 before D-96 added the void outcomes; the rows settled under it carry it. */
export const RULES_V2_D90_HASH = '776a0a0ff24e69c08a1ae34ff6f1f0ed070f7632a72cf39a2356b827baf3789b';
/** Every hash D-23 has listed, oldest first. V9 accepts a settlement row computed under any of them: the rows settled
 * before a list grew were computed by the same arithmetic, and settle(fold(ledger)) still reproduces them (V8). */
export const RULES_HASHES_D23 = ['b4cce697db2d9cd82a1b7aab9622f07b61e899f6f812ce0024829ecc111961f8', RULES_V1_HASH, RULES_V2_D90_HASH, RULES_HASH] as const;

export const ACCEPTED_OUTCOMES = ['ACCEPTED_LEAD', 'ACCEPTED_OUTBID', 'ACCEPTED_RAISE'] as const;
export const REJECTED_OUTCOMES = [
  'REJECTED_LOT_NOT_OPEN',
  'REJECTED_LOT_CLOSED',
  'REJECTED_BELOW_MINIMUM',
  'REJECTED_NOT_ABOVE_OWN_MAX',
  'REJECTED_LOT_WITHDRAWN', // D-73: at or after the lot's withdrawnAt
] as const;
export const NOT_WRITTEN_OUTCOMES = ['REPLAY', 'IDEMPOTENCY_MISMATCH', 'VOID_LOT_NOT_OPEN', 'VOID_NO_LIVE_BIDS'] as const;
/** D-96: a staff void of one bidder's live bids on an open lot. A ledger row; neither accepted nor rejected. */
export const VOIDED_OUTCOMES = ['VOIDED'] as const;
export const SETTLEMENT_OUTCOMES = ['SOLD', 'UNSOLD_NO_BIDS', 'UNSOLD_RESERVE_NOT_MET', 'UNSOLD_WITHDRAWN'] as const;

export type AcceptedOutcome = (typeof ACCEPTED_OUTCOMES)[number];
export type RejectedOutcome = (typeof REJECTED_OUTCOMES)[number];
export type VoidedOutcome = (typeof VOIDED_OUTCOMES)[number];
/** Every outcome a written ledger row can carry. */
export type BidOutcome = AcceptedOutcome | RejectedOutcome | VoidedOutcome;
/** D-96 (b): a refused void writes nothing. */
export type VoidRefusal = 'VOID_LOT_NOT_OPEN' | 'VOID_NO_LIVE_BIDS';
export type NotWrittenOutcome = (typeof NOT_WRITTEN_OUTCOMES)[number];
export type SettlementOutcome = (typeof SETTLEMENT_OUTCOMES)[number];

/** One increment band: [loCents, hiCents) in cents; hiCents null is open-ended (the last band only). */
export type Band = { readonly loCents: number; readonly hiCents: number | null; readonly incrementCents: number };

/** One premium band (D-90): `bps` applies to the slice of the hammer in [loCents, hiCents); hiCents null is the last. */
export type PremiumBand = { readonly loCents: number; readonly hiCents: number | null; readonly bps: number };

export type Rules = {
  readonly version: 'auction.v2';
  /** The default table's bands (`standard`, which is v1's). */
  readonly bands: readonly Band[];
  /** D-90: every named increment table; a sale picks one by name (Auction.incrementTable). */
  readonly tables: Readonly<Record<string, readonly Band[]>>;
  readonly defaultTable: string;
  readonly defaults: {
    readonly softCloseWindowSeconds: number;
    readonly maxExtensionSeconds: number;
    /** The first default band's rate: what a sale's `buyerPremiumBps` is set to at creation. */
    readonly buyerPremiumBps: number;
    readonly premiumBands: readonly PremiumBand[];
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
  | 'premium_bands_invalid'
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

/**
 * D-90: a premium schedule, checked. Contiguous [lo, hi) from 0, the last open-ended, each bps an integer in 0..10000.
 * The one validator for the rules file's default, a sale's typed tiers and a stored row; throws RulesError.
 */
export function checkPremiumBands(raw: unknown): PremiumBand[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new RulesError('premium_bands_invalid', 'a non-empty list of bands');
  let expectLo = 0;
  return raw.map((b: unknown, i): PremiumBand => {
    const last = i === raw.length - 1;
    if (!isRecord(b)) throw new RulesError('premium_bands_invalid', `band ${i} is not an object`);
    const { loCents: lo, hiCents: hi, bps } = b;
    if (lo !== expectLo) throw new RulesError('premium_bands_invalid', `band ${i} starts at ${lo}, expected ${expectLo}`);
    if (last ? hi !== null : !isPosInt(hi) || hi <= (lo as number)) throw new RulesError('premium_bands_invalid', `band ${i} ends at ${hi}`);
    if (typeof bps !== 'number' || !Number.isSafeInteger(bps) || bps < 0 || bps > 10000) throw new RulesError('premium_bands_invalid', `band ${i} bps ${bps}`);
    expectLo = last ? expectLo : (hi as number);
    return { loCents: lo as number, hiCents: last ? null : (hi as number), bps };
  });
}

/** Bands: contiguous from 0, [lo, hi), open-ended last, positive non-decreasing increments. */
function parseBands(name: string, rawBands: unknown): Band[] {
  if (!Array.isArray(rawBands) || rawBands.length === 0) throw new RulesError('bad_shape', `table ${name} must be a non-empty array`);
  const bands: Band[] = [];
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
  return bands;
}

/** Parse and validate the rules file's text. Throws RulesError; never returns a partial value. */
export function parseRules(text: string): Rules {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new RulesError('not_json', e instanceof Error ? e.message : String(e));
  }
  if (!isRecord(raw) || raw.version !== 'auction.v2' || raw.money !== 'integer cents' || raw.rounding !== 'half_up')
    throw new RulesError('bad_shape', 'version "auction.v2", money "integer cents", rounding "half_up"');
  if (!isRecord(raw.increments) || !isRecord(raw.increments.tables) || typeof raw.increments.default_table !== 'string')
    throw new RulesError('bad_shape', 'increments.tables must be an object and increments.default_table a name');
  if (!isRecord(raw.defaults) || !isRecord(raw.outcomes)) throw new RulesError('bad_shape', 'defaults and outcomes');

  const tables: Record<string, readonly Band[]> = {};
  for (const [name, t] of Object.entries(raw.increments.tables)) {
    tables[name] = parseBands(name, t);
  }
  const defaultTable = raw.increments.default_table;
  const bands = tables[defaultTable];
  if (!bands) throw new RulesError('bad_shape', `default_table ${defaultTable} is not a table`);

  const d = raw.defaults;
  for (const key of ['soft_close_window_seconds', 'max_extension_seconds'])
    if (!isPosInt(d[key])) throw new RulesError('default_not_positive_integer', `${key}: ${d[key]}`);
  if (!Array.isArray(d.premium_bands)) throw new RulesError('premium_bands_invalid', 'defaults.premium_bands must be a list');
  const premiumBands = checkPremiumBands(
    d.premium_bands.map((b: unknown) => (isRecord(b) ? { loCents: b.lo_cents, hiCents: b.hi_cents, bps: b.bps } : b)),
  );

  const o = raw.outcomes;
  if (
    !sameList(o.accepted, ACCEPTED_OUTCOMES) ||
    !sameList(o.rejected, REJECTED_OUTCOMES) ||
    !sameList(o.not_written, NOT_WRITTEN_OUTCOMES) ||
    !sameList(o.voided, VOIDED_OUTCOMES) ||
    !sameList(raw.settlement_outcomes, SETTLEMENT_OUTCOMES)
  )
    throw new RulesError('outcomes_not_closed', 'the outcome lists must equal the engine\'s, in order');

  return {
    version: 'auction.v2',
    bands,
    tables,
    defaultTable,
    defaults: {
      softCloseWindowSeconds: d.soft_close_window_seconds as number,
      maxExtensionSeconds: d.max_extension_seconds as number,
      buyerPremiumBps: premiumBands[0]!.bps,
      premiumBands,
    },
  };
}
