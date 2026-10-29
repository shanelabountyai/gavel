// D-73 (AX-04, R-04): staff withdraw a lot before it closes. The same one lock as a bid (FOR UPDATE on the lot's
// LotState row, lock_timeout set, no retry), the clock read once after it, one insert-only LotWithdrawal row, a notice
// to the leader of the moment. LotState is not written (non-negotiable 5): the engine reads `withdrawnAt` beside the
// ledger, so the lot is CLOSED from that instant, every later attempt is REJECTED_LOT_WITHDRAWN and a ledger row, and
// auction:close settles it UNSOLD_WITHDRAWN. The body runs over the bid path's Tx so the barrier test can run it inside
// a raw holder's transaction while N bids queue behind it; the Prisma wrapper adds the audit row and maps the refusals.
import { audit } from '@/core/audit';
import { now as clockNow } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { lotStatus } from '@/auction/engine/engine';
import { LOCK_NOT_AVAILABLE, sqlState } from '@/auction/errors';
import { enqueueNotice } from '@/auction/notices';
import { LOCK_TIMEOUT_MS, TRANSACTION_TIMEOUT_MS, prismaTx, type Tx } from '@/auction/place-bid';
import { loadLot } from '@/auction/verify-sql';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WithdrawInput = { readonly orgId: string; readonly lotId: string; readonly reason: string; readonly userId: string };
export type Withdrawn = { readonly id: string; readonly withdrawnAt: Date; readonly leader: string | null };

/** The transaction body: lock, read, clock, refuse or insert, notice. The caller owns BEGIN/COMMIT. */
export async function withdrawInTx(tx: Tx, input: WithdrawInput, now: () => Date): Promise<Withdrawn> {
  await tx.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  const locked = await tx.query(`SELECT 1 FROM "LotState" WHERE "lotId" = $1::uuid AND "orgId" = $2::uuid FOR UPDATE`, [input.lotId, input.orgId]);
  if (!locked.length) throw new Refused('No such lot in this house.');
  const l = await loadLot(tx, input.lotId); // a fresh statement after the lock: it sees every bid and withdrawal committed before it
  const at = now(); // D-15: once, after FOR UPDATE returned
  if (l.lot.withdrawnAtMs !== null) throw new Refused('This lot was already withdrawn.');
  if (l.settlement || lotStatus(l.lot, l.state!, at.getTime()) === 'CLOSED') throw new Refused('This lot has closed; a settlement correction is the remedy.');
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO "LotWithdrawal" ("id", "orgId", "lotId", "reason", "byUserId", "withdrawnAt")
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4::uuid, $5::timestamptz) RETURNING "id"::text`,
    [input.orgId, input.lotId, input.reason.trim(), input.userId, at.toISOString()],
  );
  const leader = l.state!.leader;
  if (leader !== null) await enqueueNotice(tx, input.orgId, input.lotId, leader, { template: 'withdrawn' });
  return { id: row!.id, withdrawnAt: at, leader };
}

/** The staff action. Refusals are `Refused` with the sentence the form shows; the trigger under the insert is the guard. */
export async function withdrawLot(input: WithdrawInput, deps: { now?: () => Date } = {}): Promise<Withdrawn> {
  for (const id of [input.orgId, input.lotId, input.userId]) if (typeof id !== 'string' || !UUID.test(id)) throw new Refused('No such lot in this house.');
  if (typeof input.reason !== 'string' || input.reason.trim() === '') throw new Refused('Give a reason for the withdrawal.');
  const now = deps.now ?? clockNow;
  try {
    return await db.$transaction(
      async (ptx) => {
        const r = await withdrawInTx(prismaTx(ptx), input, now);
        await audit({ orgId: input.orgId, userId: input.userId }, 'lot.withdrawn', { targetType: 'lot', targetId: input.lotId, data: { reason: input.reason.trim(), withdrawnAt: r.withdrawnAt.toISOString(), leader: r.leader } }, ptx);
        return r;
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    if (sqlState(error) === LOCK_NOT_AVAILABLE) throw new Refused('The lot is busy; try again.', { cause: error });
    throw error;
  }
}
