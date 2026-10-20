// Where a Postgres refusal's SQLSTATE lives depends on the driver that raised it (D-30 S-2, S-4; D-37):
//   node-postgres  `code` is the SQLSTATE ('55P03', '23505', '23001'); `constraint` names the index.
//   Prisma 7       PrismaClientKnownRequestError `code: 'P2010'`; the SQLSTATE is at
//                  `meta.driverAdapterError.cause.code`, never on the error itself. For a unique violation the
//                  adapter rewrites the cause as `{ kind: 'UniqueConstraintViolation', originalCode: '23505',
//                  constraint: { index } }` with no `code` at all (verified in task 1.8), so `originalCode` is read too.
// Lesson ported from Bookable `packages/db/errors.ts`: match the shape that was verified, not the reflex.

export const LOCK_NOT_AVAILABLE = '55P03'; // lock_timeout fired → BID_TIMED_OUT (D-13)
export const UNIQUE_VIOLATION = '23505'; // the idempotency index (D-17)
export const RESTRICT_VIOLATION = '23001'; // not what gavel_append_only() raises (P0001, D-36); kept for the pg shape test

type DriverCause = { code?: unknown; originalCode?: unknown; constraint?: { index?: unknown } };
type DbErrorShape = { code?: unknown; constraint?: unknown; meta?: { driverAdapterError?: { cause?: DriverCause } } };

const cause = (error: unknown): DriverCause | null => {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as DbErrorShape;
  return e.code === 'P2010' ? (e.meta?.driverAdapterError?.cause ?? null) : null;
};

/** The SQLSTATE of a database error in either shape, or null when it is not one. */
export function sqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const c = cause(error);
  const code = c ? (c.code ?? c.originalCode) : (error as DbErrorShape).code;
  // Prisma's own codes (P1xxx..P6xxx) are five characters too; SQLSTATE class P0 (PL/pgSQL) is real.
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !/^P[1-9]/.test(code) ? code : null;
}

/** The constraint or index a 23505/23503/23514 names, in either shape, or null. */
export function constraintName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const name = cause(error)?.constraint?.index ?? (error as DbErrorShape).constraint;
  return typeof name === 'string' ? name : null;
}

export type BidErrorCode =
  | 'MISSING_KEY' // boundary (brief §4 row 1): nothing written
  | 'INVALID_AMOUNT'
  | 'LOT_NOT_FOUND'
  | 'BIDDER_NOT_ACTIVE'
  | 'BID_TIMED_OUT' // lock_timeout (D-13): retryable with the same key
  | 'IDEMPOTENCY_MISMATCH'; // same key, different amount (D-17): no row

/** A typed refusal from the bid path. Only BID_TIMED_OUT is retryable, and only with the same key. */
export class BidError extends Error {
  constructor(
    readonly code: BidErrorCode,
    message: string,
    readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'BidError';
  }
}

export type CorrectionErrorCode =
  | 'INVALID_INPUT' // boundary: nothing written
  | 'SETTLEMENT_NOT_FOUND' // no such settlement on this lot in this house
  | 'NOT_AN_ACCEPTED_BIDDER' // D-42 Q2: the new winner has no accepted row in the lot's ledger
  | 'RESERVE_NOT_MET' // the new winner's price is below the reserve
  | 'NO_CHANGE' // the correction would write the row it supersedes again
  | 'STALE_SETTLEMENT' // the predecessor is already superseded: the unique on supersedesId refused it (D-44)
  | 'CORRECTION_TIMED_OUT'; // lock_timeout on the lot's LotState row: retryable

/** A typed refusal from correctSettlement. Only CORRECTION_TIMED_OUT is retryable. */
export class CorrectionError extends Error {
  constructor(
    readonly code: CorrectionErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CorrectionError';
  }
  get retryable() {
    return this.code === 'CORRECTION_TIMED_OUT';
  }
}
