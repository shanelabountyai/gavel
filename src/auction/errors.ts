// Where a Postgres refusal's SQLSTATE lives depends on the driver that raised it (D-30 S-2, S-4):
//   node-postgres  `code` is the SQLSTATE ('55P03', '23505', '23001').
//   Prisma 7       PrismaClientKnownRequestError `code: 'P2010'`; the SQLSTATE is at
//                  `meta.driverAdapterError.cause.code`, never on the error itself.
// Lesson ported from Bookable `packages/db/errors.ts`: match the shape that was verified, not the reflex.

export const LOCK_NOT_AVAILABLE = '55P03'; // lock_timeout fired → BID_TIMED_OUT (D-13)
export const UNIQUE_VIOLATION = '23505'; // the idempotency index (D-17)
export const RESTRICT_VIOLATION = '23001'; // the append-only triggers (D-14)

/** The SQLSTATE of a database error in either shape, or null when it is not one. */
export function sqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { code?: unknown; meta?: { driverAdapterError?: { cause?: { code?: unknown } } } };
  const code = e.code === 'P2010' ? e.meta?.driverAdapterError?.cause?.code : e.code;
  // Prisma's own codes (P1xxx..P6xxx) are five characters too; SQLSTATE class P0 (PL/pgSQL) is real.
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !/^P[1-9]/.test(code) ? code : null;
}
