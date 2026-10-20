// Task 2.2 (D-42 Q2, D-44): a settlement correction is a superseding row; the original is never touched. Written
// under the same one lock as a bid (FOR UPDATE on the lot's LotState row), with an audit entry in the same
// transaction. The caller names the row it is correcting; if that row is already superseded, the unique index on
// supersedesId refuses the insert, so two staff correcting the same view cannot fork the chain. No retry.
// ponytail: no route or page calls this yet; whoever adds one must gate it on the staff permission (audit.read, D-43).
import { audit } from '@/core/audit';
import { db } from '@/core/db';
import { type CorrectedSettlement, resettle } from '@/auction/engine/engine';
import type { Rules } from '@/auction/engine/rules';
import { CorrectionError, LOCK_NOT_AVAILABLE, UNIQUE_VIOLATION, constraintName, sqlState } from '@/auction/errors';
import { loadRules } from '@/auction/load-rules';
import { INT4_MAX, LOCK_TIMEOUT_MS, TRANSACTION_TIMEOUT_MS, prismaTx } from '@/auction/place-bid';
import { loadLot } from '@/auction/verify-sql';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAIN_INDEX = 'Settlement_supersedesId_key';

export type CorrectionInput = {
  readonly orgId: string;
  readonly lotId: string;
  readonly supersedesId: string; // the settlement being corrected, as the staff member saw it
  readonly winner?: string | null; // undefined keeps the predecessor's; null withdraws the sale
  readonly premiumBps?: number; // undefined keeps the predecessor's
  readonly reason: string;
  readonly userId: string;
};

export async function correctSettlement(input: CorrectionInput, deps: { rules?: Rules; hash?: string } = {}): Promise<{ id: string; settlement: CorrectedSettlement }> {
  const { orgId, lotId, supersedesId, winner, premiumBps, reason, userId } = input;
  for (const id of [orgId, lotId, supersedesId, userId]) if (typeof id !== 'string' || !UUID.test(id)) throw new CorrectionError('INVALID_INPUT', 'ids must be uuids');
  if (winner !== undefined && winner !== null && !UUID.test(winner)) throw new CorrectionError('INVALID_INPUT', 'winner must be a bidder id or null');
  if (premiumBps !== undefined && !(Number.isInteger(premiumBps) && premiumBps >= 0 && premiumBps <= INT4_MAX)) throw new CorrectionError('INVALID_INPUT', 'premiumBps must be a non-negative integer');
  if (typeof reason !== 'string' || reason.trim() === '') throw new CorrectionError('INVALID_INPUT', 'a correction needs a reason');
  const { rules, hash } = deps.rules && deps.hash ? { rules: deps.rules, hash: deps.hash } : loadRules();

  try {
    return await db.$transaction(async (ptx) => {
      const tx = prismaTx(ptx);
      await tx.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      const locked = await tx.query(`SELECT 1 FROM "LotState" WHERE "lotId" = $1::uuid AND "orgId" = $2::uuid FOR UPDATE`, [lotId, orgId]);
      if (!locked.length) throw new CorrectionError('SETTLEMENT_NOT_FOUND', 'no such lot in this house');
      const l = await loadLot(tx, lotId);
      const prev = [l.settlement, ...l.corrections].find((s) => s?.id === supersedesId);
      if (!prev) throw new CorrectionError('SETTLEMENT_NOT_FOUND', 'no such settlement on this lot');

      const next = resettle(l.lot, l.rows, rules, { winner: winner === undefined ? prev.winner : winner, premiumBps: premiumBps ?? prev.premiumBps });
      if ('refused' in next) throw new CorrectionError(next.refused, `the correction is refused: ${next.refused}`);
      if ((['outcome', 'winner', 'hammerCents', 'premiumCents', 'premiumBps'] as const).every((k) => next[k] === prev[k])) {
        throw new CorrectionError('NO_CHANGE', 'the correction changes nothing');
      }

      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO "Settlement" ("id", "orgId", "lotId", "supersedesId", "reason", "correctedByUserId", "outcome", "winnerBidderId", "winningSeq",
                                   "hammerCents", "premiumCents", "totalCents", "closedAt", "rulesHash", "premiumBps")
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7::uuid, $8, $9, $10, $11, $12::timestamptz, $13, $14)
         RETURNING "id"::text`,
        [orgId, lotId, supersedesId, reason.trim(), userId, next.outcome, next.winner, next.winningSeq, next.hammerCents, next.premiumCents, next.totalCents,
          new Date(next.closedAtMs).toISOString(), hash, next.premiumBps],
      );
      const pick = (s: CorrectedSettlement) => ({ outcome: s.outcome, winner: s.winner, hammerCents: s.hammerCents, premiumCents: s.premiumCents, premiumBps: s.premiumBps });
      await audit({ orgId, userId }, 'settlement.corrected', { targetType: 'Settlement', targetId: row!.id, data: { lotId, supersedesId, reason: reason.trim(), from: pick(prev), to: pick(next) } }, ptx);
      return { id: row!.id, settlement: next };
    }, { timeout: TRANSACTION_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof CorrectionError) throw error;
    const state = sqlState(error);
    if (state === UNIQUE_VIOLATION && constraintName(error) === CHAIN_INDEX) {
      throw new CorrectionError('STALE_SETTLEMENT', 'that settlement was already corrected; reload and correct the current one', { cause: error });
    }
    if (state === LOCK_NOT_AVAILABLE) throw new CorrectionError('CORRECTION_TIMED_OUT', 'the lot was busy; try again', { cause: error });
    throw error;
  }
}
