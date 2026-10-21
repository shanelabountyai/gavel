// auction:close (brief §4 row 9, D-22): settle(fold(ledger), asOf) for every lot with no Settlement, one row each,
// carrying the D-23 rules hash. Idempotent: a settled lot is skipped, and ON CONFLICT covers two closers at once.
// Each lot is settled under FOR UPDATE on its LotState row, so a bid judged before the close but not yet committed
// is in the ledger the fold reads.
import { fold, settle } from '@/auction/engine/engine';
import type { Rules } from '@/auction/engine/rules';
import { loadRules } from '@/auction/load-rules';
import { enqueueNotice } from '@/auction/notices';
import { prismaRunner, type Runner, type Tx } from '@/auction/place-bid';
import { loadLot } from '@/auction/verify-sql';

export async function closeLots(asOf: Date, q: Tx, deps: { run?: Runner; rules?: Rules; hash?: string } = {}) {
  const { rules, hash } = deps.rules && deps.hash ? { rules: deps.rules, hash: deps.hash } : loadRules();
  const run = deps.run ?? prismaRunner;
  const open = await q.query<{ id: string }>(`SELECT l."id" FROM "Lot" l WHERE NOT EXISTS (SELECT 1 FROM "Settlement" s WHERE s."lotId" = l."id") ORDER BY l."id"`);
  let settled = 0;
  for (const { id } of open) {
    settled += await run(async (tx) => {
      await tx.query(`SELECT 1 FROM "LotState" WHERE "lotId" = $1::uuid FOR UPDATE`, [id]);
      const l = await loadLot(tx, id);
      const st = settle(l.lot, fold(l.lot, l.rows, rules), asOf.getTime());
      if (!st) return 0;
      const inserted = await tx.query(
        `INSERT INTO "Settlement" ("id", "orgId", "lotId", "outcome", "winnerBidderId", "winningSeq", "hammerCents", "premiumCents", "totalCents", "closedAt", "rulesHash", "premiumBps")
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9::timestamptz, $10, $11)
         ON CONFLICT ("lotId") WHERE "supersedesId" IS NULL DO NOTHING RETURNING "id"`,
        [l.orgId, id, st.outcome, st.winner, st.winningSeq, st.hammerCents, st.premiumCents, st.totalCents, new Date(st.closedAtMs).toISOString(), hash, l.lot.buyerPremiumBps],
      );
      // Task 3.6 (D-53): the won notice rides the settlement row's transaction; ON CONFLICT's no-op writes none.
      if (inserted.length && st.winner !== null) {
        await enqueueNotice(tx, l.orgId, id, st.winner, { template: 'won', hammerCents: st.hammerCents, totalCents: st.totalCents, closedAt: new Date(st.closedAtMs) });
      }
      return inserted.length;
    });
  }
  return { considered: open.length, settled };
}
