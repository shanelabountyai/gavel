// The bid path (brief §4, D-13..D-17): boundary checks outside the transaction, then one transaction that holds
// `SELECT … FOR UPDATE` on the lot's LotState row, reads the clock once under it, checks idempotency, runs the pure
// engine, appends one Bid row and updates the projection. No retry loop; a lock timeout is BID_TIMED_OUT.
// D-31 Q1: the body runs over a small Tx interface so Prisma (production, the sequential replay) and a raw pg
// client (the barrier test, the load script) share one implementation. Donor: Bookable packages/db/booking/book.ts.
import type { Client as PgClient } from 'pg';
import { now as clockNow } from '@/core/clock';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { applyBid, minNextBid, type Lot, type LotState } from '@/auction/engine/engine';
import type { BidOutcome, Rules } from '@/auction/engine/rules';
import { BidError, LOCK_NOT_AVAILABLE, UNIQUE_VIOLATION, constraintName, sqlState } from '@/auction/errors';
import { loadRules } from '@/auction/load-rules';
import { enqueueNotice } from '@/auction/notices';

export const INT4_MAX = 2147483647; // D-36: cents are int4; a lot that needs more is a BigInt migration
export const LOCK_TIMEOUT_MS = 5000; // D-13, O-8
export const TRANSACTION_TIMEOUT_MS = 15_000; // above the lock wait, or COMMIT is refused after the bid was judged (D-30 S-3)
const IDEMPOTENCY_INDEX = 'Bid_lotId_bidderId_idempotencyKey_key';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BidInput = {
  readonly orgId: string;
  readonly lotId: string;
  readonly bidderId: string;
  readonly maxCents: number;
  readonly idempotencyKey: string;
};

/** What the bidder is told (§4 row 8): never a max, a reserve, or another bidder's id. */
export type BidResponse = {
  readonly outcome: BidOutcome;
  readonly accepted: boolean;
  readonly seq: number;
  readonly replayed: boolean;
  readonly priceCents: number;
  readonly minNextCents: number;
  readonly youLead: boolean;
  readonly closesAt: Date;
};

export type Tx = { query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]> };
export const prismaTx = (tx: Prisma.TransactionClient): Tx => ({ query: (sql, params = []) => tx.$queryRawUnsafe(sql, ...params) });
export const pgTx = (c: PgClient): Tx => ({ query: async (sql, params = []) => (await c.query(sql, [...params])).rows });

/** Runs one transaction body. Prisma by default; `pgRunner` for a raw connection outside the pool. */
export type Runner = <T>(body: (tx: Tx) => Promise<T>) => Promise<T>;
export const prismaRunner: Runner = (body) => db.$transaction((tx) => body(prismaTx(tx)), { timeout: TRANSACTION_TIMEOUT_MS });
export const pgRunner =
  (c: PgClient): Runner =>
  async (body) => {
    await c.query('BEGIN');
    try {
      const result = await body(pgTx(c));
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }
  };

/** The transaction body. `judge` below is the product's; task 4.2's lock variants pass their own (D-58). */
export type Judge = (tx: Tx, b: BidInput, lot: Lot, rules: Rules, now: () => Date) => Promise<BidResponse>;
export type Deps = { run?: Runner; now?: () => Date; rules?: Rules; judge?: Judge };
let cachedRules: Rules | undefined;

export async function placeBid(input: BidInput, deps: Deps = {}): Promise<BidResponse> {
  const { orgId, lotId, bidderId, maxCents, idempotencyKey } = input;
  // Boundary (brief §4 row 1, D-14): typed refusals, nothing written, no lock taken.
  if (typeof idempotencyKey !== 'string' || idempotencyKey === '') throw new BidError('MISSING_KEY', 'an idempotency key is required');
  if (!Number.isSafeInteger(maxCents) || maxCents <= 0 || maxCents > INT4_MAX) {
    throw new BidError('INVALID_AMOUNT', `maxCents must be an integer in [1, ${INT4_MAX}]`);
  }
  const lotRow = UUID.test(lotId) && UUID.test(orgId) ? await db.lot.findFirst({ where: { id: lotId, orgId }, include: { auction: true } }) : null;
  if (!lotRow) throw new BidError('LOT_NOT_FOUND', 'no such lot in this house');
  const bidder = UUID.test(bidderId) ? await db.bidder.findFirst({ where: { id: bidderId, orgId, status: 'ACTIVE' }, select: { id: true } }) : null;
  if (!bidder) throw new BidError('BIDDER_NOT_ACTIVE', 'the bidder is not registered and active with this house');

  const lot = toLot(lotRow);
  const rules = deps.rules ?? (cachedRules ??= loadRules().rules);
  const run = deps.run ?? prismaRunner;
  const now = deps.now ?? clockNow;

  try {
    const body = deps.judge ?? judge;
    return await run((tx) => body(tx, input, lot, rules, now));
  } catch (error) {
    const state = sqlState(error);
    if (state === LOCK_NOT_AVAILABLE) {
      throw new BidError('BID_TIMED_OUT', 'the lot was busy; resend with the same key', true, { cause: error });
    }
    if (state === UNIQUE_VIOLATION && constraintName(error) === IDEMPOTENCY_INDEX) {
      // Defence in depth (D-17): a row with this key landed between the read and the insert, which only a writer
      // that skipped the lock can do. The index refused the duplicate; answer as the read would have.
      const prior = await db.bid.findUnique({ where: { lotId_bidderId_idempotencyKey: { lotId, bidderId, idempotencyKey } } });
      const st = await db.lotState.findUnique({ where: { lotId } });
      if (prior && st) return priorResponse({ ...prior, outcome: prior.outcome as BidOutcome }, maxCents, toState(st), lot, rules, bidderId);
    }
    throw error;
  }
}

/** The pure engine's view of a catalog row (the auction's settings flattened in, D-34). */
export const toLot = (r: { startCents: number; reserveCents: number | null; scheduledEnd: Date; auction: { opensAt: Date; softCloseWindowSeconds: number; maxExtensionSeconds: number; buyerPremiumBps: number } }): Lot => ({
  startCents: r.startCents,
  reserveCents: r.reserveCents,
  opensAtMs: r.auction.opensAt.getTime(),
  scheduledEndMs: r.scheduledEnd.getTime(),
  softCloseWindowMs: r.auction.softCloseWindowSeconds * 1000,
  maxExtensionMs: r.auction.maxExtensionSeconds * 1000,
  buyerPremiumBps: r.auction.buyerPremiumBps,
});

export type StateRow = {
  priceCents: number;
  leaderBidderId: string | null;
  leaderMaxCents: number;
  leaderSeq: number | null;
  bidCount: number;
  acceptedCount: number;
  closesAt: Date;
  extensionCount: number;
};
export type PriorRow = { seq: number; maxCents: number; outcome: BidOutcome; accepted: boolean };

export const toState = (r: StateRow): LotState => ({
  priceCents: r.priceCents,
  leader: r.leaderBidderId,
  leaderMaxCents: r.leaderMaxCents,
  leaderSeq: r.leaderSeq,
  bidCount: r.bidCount,
  acceptedCount: r.acceptedCount,
  closesAtMs: r.closesAt.getTime(),
  extensionCount: r.extensionCount,
});

export const response = (outcome: BidOutcome, accepted: boolean, seq: number, replayed: boolean, s: LotState, lot: Lot, rules: Rules, bidderId: string): BidResponse => ({
  outcome,
  accepted,
  seq,
  replayed,
  priceCents: s.priceCents,
  minNextCents: minNextBid(lot, s, rules),
  youLead: s.leader === bidderId,
  closesAt: new Date(s.closesAtMs),
});

/** D-17: same amount → its outcome and seq, replayed; a different amount → IDEMPOTENCY_MISMATCH, no row. */
export function priorResponse(prior: PriorRow, maxCents: number, s: LotState, lot: Lot, rules: Rules, bidderId: string): BidResponse {
  if (prior.maxCents !== maxCents) throw new BidError('IDEMPOTENCY_MISMATCH', `key already used for ${prior.maxCents} cents`);
  return response(prior.outcome, prior.accepted, prior.seq, true, s, lot, rules, bidderId);
}

/** The transaction body (brief §4 rows 2–7). The caller owns BEGIN/COMMIT and maps the database refusals. */
export async function judge(tx: Tx, b: BidInput, lot: Lot, rules: Rules, now: () => Date): Promise<BidResponse> {
  await tx.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  const row = await readState(tx, b.lotId, true);
  return judgeRead(tx, b, lot, rules, now, row);
}

/** The LotState row; `forUpdate` is the product's lock (D-13). A variant that serializes another way reads it plain. */
export async function readState(tx: Tx, lotId: string, forUpdate: boolean): Promise<StateRow> {
  const [row] = await tx.query<StateRow>(
    `SELECT "priceCents", "leaderBidderId", "leaderMaxCents", "leaderSeq", "bidCount", "acceptedCount", "closesAt", "extensionCount"
       FROM "LotState" WHERE "lotId" = $1::uuid${forUpdate ? ' FOR UPDATE' : ''}`,
    [lotId],
  );
  if (!row) throw new Error(`lot ${lotId} has no LotState row (V1)`);
  return row;
}

/** Everything after the state is read and serialized: clock, idempotency, engine, ledger row, projection, notice. */
export async function judgeRead(tx: Tx, b: BidInput, lot: Lot, rules: Rules, now: () => Date, row: StateRow): Promise<BidResponse> {
  const placedAt = now(); // D-15: once, after FOR UPDATE returned
  const state = toState(row);
  const prior = await findPrior(tx, b);
  if (prior) return priorResponse(prior, b.maxCents, state, lot, rules, b.bidderId);
  const r = applyBid(lot, state, b.bidderId, b.maxCents, placedAt.getTime(), rules);
  await insertBid(tx, b, placedAt, r);
  await updateState(tx, b.lotId, r.state);
  await notifyOutbid(tx, b, r);
  return response(r.outcome, r.accepted, r.state.bidCount, false, r.state, lot, rules, b.bidderId);
}

export async function findPrior(tx: Tx, b: BidInput): Promise<PriorRow | undefined> {
  const [prior] = await tx.query<PriorRow>(
    `SELECT "seq", "maxCents", "outcome", "accepted" FROM "Bid" WHERE "lotId" = $1::uuid AND "bidderId" = $2::uuid AND "idempotencyKey" = $3`,
    [b.lotId, b.bidderId, b.idempotencyKey],
  );
  return prior;
}

type Applied = ReturnType<typeof applyBid>;

/** The ledger row; its seq is the new bidCount, i.e. bidCount + 1 under whatever serialized the read (D-14). */
export async function insertBid(tx: Tx, b: BidInput, placedAt: Date, r: Applied): Promise<void> {
  await tx.query(
    `INSERT INTO "Bid" ("id", "orgId", "lotId", "seq", "bidderId", "maxCents", "placedAt", "idempotencyKey", "outcome", "accepted",
       "priceBeforeCents", "priceAfterCents", "leaderBeforeId", "leaderAfterId", "closesAtBefore", "closesAtAfter", "extended")
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4::uuid, $5, $6::timestamptz, $7, $8, $9, $10, $11, $12::uuid, $13::uuid, $14::timestamptz, $15::timestamptz, $16)`,
    [b.orgId, b.lotId, r.state.bidCount, b.bidderId, b.maxCents, placedAt.toISOString(), b.idempotencyKey, r.outcome, r.accepted,
      r.priceBefore, r.priceAfter, r.leaderBefore, r.leaderAfter, new Date(r.closesBeforeMs).toISOString(), new Date(r.closesAfterMs).toISOString(), r.extended],
  );
}

/** The projection. `expectedBidCount` (task 4.2's `version` variant only) guards it; false means another writer got there first. */
export async function updateState(tx: Tx, lotId: string, s: LotState, expectedBidCount?: number): Promise<boolean> {
  const guard = expectedBidCount === undefined ? '' : ' AND "bidCount" = $10 RETURNING "lotId"';
  const rows = await tx.query(
    `UPDATE "LotState" SET "priceCents" = $2, "leaderBidderId" = $3::uuid, "leaderMaxCents" = $4, "leaderSeq" = $5, "bidCount" = $6,
       "acceptedCount" = $7, "closesAt" = $8::timestamptz, "extensionCount" = $9 WHERE "lotId" = $1::uuid${guard}`,
    [lotId, s.priceCents, s.leader, s.leaderMaxCents, s.leaderSeq, s.bidCount, s.acceptedCount, new Date(s.closesAtMs).toISOString(), s.extensionCount,
      ...(expectedBidCount === undefined ? [] : [expectedBidCount])],
  );
  return expectedBidCount === undefined || rows.length === 1;
}

/** Task 3.6 (D-53): the previous leader, if this row displaced them, gets an outbid notice in the same transaction. */
export async function notifyOutbid(tx: Tx, b: BidInput, r: Applied): Promise<void> {
  if (r.leaderBefore !== null && r.leaderAfter !== r.leaderBefore) {
    await enqueueNotice(tx, b.orgId, b.lotId, r.leaderBefore, { template: 'outbid', priceCents: r.state.priceCents, closesAt: new Date(r.state.closesAtMs) });
  }
}
