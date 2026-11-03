// D-96 (AX-19, R-19): staff void every live bid of one bidder on an open lot. The same one lock as a bid (FOR UPDATE on
// the lot's LotState row, lock_timeout set, no retry), the clock read once after it, the pure engine's applyVoid, one
// VOIDED ledger row with the next seq, and the projection: voidBidder is the second and last writer of LotState
// (non-negotiable 5). A resend with the same key replays. Refusals write nothing. Donor: withdraw.ts (D-73).
import { audit } from '@/core/audit';
import { now as clockNow } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { applyVoid } from '@/auction/engine/engine';
import type { Rules, VoidRefusal } from '@/auction/engine/rules';
import { LOCK_NOT_AVAILABLE, sqlState } from '@/auction/errors';
import { loadRules } from '@/auction/load-rules';
import { LOCK_TIMEOUT_MS, TRANSACTION_TIMEOUT_MS, prismaTx, updateState, type Tx } from '@/auction/place-bid';
import { loadLot } from '@/auction/verify-sql';

/** A refusal the engine decided (D-96 b), with its code for auction:eval; the message is the form's sentence. */
export class VoidRefused extends Refused {
  constructor(readonly code: VoidRefusal) {
    super(code === 'VOID_LOT_NOT_OPEN'
      ? 'The lot is not open: a void is only before the close. After it, a settlement correction is the remedy.'
      : 'That bidder has no standing bid on this lot to void.');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VoidInput = {
  readonly orgId: string;
  readonly lotId: string;
  readonly bidderId: string;
  readonly reason: string;
  readonly userId: string;
  readonly idempotencyKey: string;
};
export type Voided = { readonly seq: number; readonly replayed: boolean; readonly priceCents: number; readonly leader: string | null; readonly leaderBefore: string | null };

/** The transaction body: lock, read, clock, idempotency, engine, ledger row, projection. The caller owns BEGIN/COMMIT. */
export async function voidInTx(tx: Tx, input: VoidInput, rules: Rules, now: () => Date): Promise<Voided> {
  await tx.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  const locked = await tx.query(`SELECT 1 FROM "LotState" WHERE "lotId" = $1::uuid AND "orgId" = $2::uuid FOR UPDATE`, [input.lotId, input.orgId]);
  if (!locked.length) throw new Refused('No such lot in this house.');
  const l = await loadLot(tx, input.lotId); // a fresh statement after the lock: every bid, void and withdrawal committed before it
  const at = now(); // D-15: once, after FOR UPDATE returned
  const [prior] = await tx.query<{ seq: number; outcome: string }>(
    `SELECT "seq", "outcome" FROM "Bid" WHERE "lotId" = $1::uuid AND "bidderId" = $2::uuid AND "idempotencyKey" = $3`,
    [input.lotId, input.bidderId, input.idempotencyKey],
  );
  if (prior) {
    if (prior.outcome !== 'VOIDED') throw new Refused('That key was already used for a bid; reload the page and try again.');
    return { seq: prior.seq, replayed: true, priceCents: l.state!.priceCents, leader: l.state!.leader, leaderBefore: l.state!.leader };
  }
  const r = applyVoid(l.lot, l.state!, l.rows, input.bidderId, at.getTime(), rules);
  if ('refused' in r) throw new VoidRefused(r.refused);
  await tx.query(
    `INSERT INTO "Bid" ("id", "orgId", "lotId", "seq", "bidderId", "maxCents", "placedAt", "idempotencyKey", "outcome", "accepted",
       "priceBeforeCents", "priceAfterCents", "leaderBeforeId", "leaderAfterId", "closesAtBefore", "closesAtAfter", "extended", "voidReason", "voidByUserId")
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4::uuid, 0, $5::timestamptz, $6, 'VOIDED', false, $7, $8, $9::uuid, $10::uuid, $11::timestamptz, $11::timestamptz, false, $12, $13::uuid)`,
    [input.orgId, input.lotId, r.state.bidCount, input.bidderId, at.toISOString(), input.idempotencyKey, r.priceBefore, r.priceAfter, r.leaderBefore, r.leaderAfter,
      new Date(r.closesBeforeMs).toISOString(), input.reason.trim(), input.userId],
  );
  await updateState(tx, input.lotId, r.state);
  return { seq: r.state.bidCount, replayed: false, priceCents: r.priceAfter, leader: r.leaderAfter, leaderBefore: r.leaderBefore };
}

/** The staff action. Refusals are `Refused` with the sentence the form shows; the CHECKs under the insert are the guard. */
export async function voidBidder(input: VoidInput, deps: { now?: () => Date; rules?: Rules } = {}): Promise<Voided> {
  for (const id of [input.orgId, input.lotId, input.userId]) if (typeof id !== 'string' || !UUID.test(id)) throw new Refused('No such lot in this house.');
  if (typeof input.bidderId !== 'string' || !UUID.test(input.bidderId)) throw new Refused('No such bidder in this house.');
  if (typeof input.reason !== 'string' || input.reason.trim() === '') throw new Refused('Give a reason for the void.');
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey === '') throw new Refused('The form is missing its key; reload the page.');
  // The bidder must be this house's (INV-02); any status: voiding a suspended bidder's maximum is the point (D-70 c).
  if (!(await db.bidder.findFirst({ where: { id: input.bidderId, orgId: input.orgId }, select: { id: true } }))) throw new Refused('No such bidder in this house.');
  const now = deps.now ?? clockNow;
  const rules = deps.rules ?? loadRules().rules;
  try {
    return await db.$transaction(
      async (ptx) => {
        const r = await voidInTx(prismaTx(ptx), input, rules, now);
        if (!r.replayed) {
          await audit({ orgId: input.orgId, userId: input.userId }, 'bid.voided', {
            targetType: 'lot', targetId: input.lotId,
            data: { bidderId: input.bidderId, reason: input.reason.trim(), seq: r.seq, priceCents: r.priceCents, leaderBefore: r.leaderBefore, leaderAfter: r.leader },
          }, ptx);
        }
        return r;
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    if (sqlState(error) === LOCK_NOT_AVAILABLE) throw new Refused('The lot is busy; try again.', { cause: error });
    throw error;
  }
}
