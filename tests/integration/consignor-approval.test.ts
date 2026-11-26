// AX-14 (R-14, D-87): a subject-to-approval sale. On a fixture lot that closed UNSOLD_RESERVE_NOT_MET the consignor
// accepts the high bid; the correction sells to LotState's leader at LotState's price (read from the verified
// projection, never from resettle), the invoice gains the line, the audit names the approval, verify stays OK, and a
// later rate correction keeps the approval. V8 refuses the same SOLD row stored without one.
import { beforeEach, describe, expect, it } from 'vitest';
import { correctSettlement } from '@/auction/correct';
import { CorrectionError } from '@/auction/errors';
import { invoicesForAuction } from '@/auction/invoice';
import { loadRules } from '@/auction/load-rules';
import { prismaTx } from '@/auction/place-bid';
import { verifyAll } from '@/auction/verify-sql';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { runDb } from '../../scripts/auction-eval';
import { resetAuthTables } from '../helpers/auth';

const { rules } = loadRules();
const q = prismaTx(db as unknown as Prisma.TransactionClient);

async function belowReserveLot() {
  const [c] = await q.query<{ lotId: string; orgId: string; auctionId: string; settlementId: string; leader: string; price: number; reserve: number; premiumBps: number }>(
    `SELECT s."lotId"::text, s."orgId"::text, l."auctionId"::text, s."id"::text AS "settlementId", ls."leaderBidderId"::text AS leader,
            ls."priceCents" AS price, l."reserveCents" AS reserve, s."premiumBps" AS "premiumBps"
       FROM "Settlement" s JOIN "Lot" l ON l."id" = s."lotId" JOIN "LotState" ls ON ls."lotId" = s."lotId"
      WHERE s."outcome" = 'UNSOLD_RESERVE_NOT_MET' AND s."supersedesId" IS NULL
      ORDER BY l."auctionId", l."number" LIMIT 1`,
  );
  if (!c) throw new Error('no fixture lot closed below its reserve');
  const user = await db.user.findFirstOrThrow();
  const other = await q.query<{ id: string }>(`SELECT DISTINCT "bidderId"::text AS id FROM "Bid" WHERE "lotId" = $1::uuid AND "accepted" AND "bidderId" <> $2::uuid`, [c.lotId, c.leader]);
  return { ...c, userId: user.id, other: other[0]?.id ?? null };
}

describe('subject-to-approval sale below the reserve (AX-14)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    expect((await runDb()).ok).toBe(true);
  }, 60_000);

  it('sells to the high bidder at the reached price, invoices it, audits the approval and verifies', async () => {
    const c = await belowReserveLot();
    expect(c.price).toBeLessThan(c.reserve);
    const base = { orgId: c.orgId, lotId: c.lotId, userId: c.userId };
    await expect(correctSettlement({ ...base, winner: c.leader, reason: 'consignor accepted' })).rejects.toMatchObject({ code: 'RESERVE_NOT_MET' });
    if (c.other) await expect(correctSettlement({ ...base, winner: c.other, reason: 'x', consignorApprovalRef: 'CA-1' })).rejects.toMatchObject({ code: 'APPROVAL_NOT_APPLICABLE' });
    await expect(correctSettlement({ ...base, winner: c.leader, reason: 'x', consignorApprovalRef: '  ' })).rejects.toBeInstanceOf(CorrectionError);

    const { id, settlement } = await correctSettlement({ ...base, winner: c.leader, reason: 'consignor accepted by phone', consignorApprovalRef: 'CA-2026-0042' });
    expect(settlement).toMatchObject({ outcome: 'SOLD', winner: c.leader, hammerCents: c.price });
    const row = await db.settlement.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ consignorApprovalRef: 'CA-2026-0042', supersedesId: c.settlementId });
    const inv = await invoicesForAuction(q, c.orgId, c.auctionId);
    expect(inv.find((i) => i.bidderId === c.leader)?.lots.find((l) => l.lotId === c.lotId)).toMatchObject({ hammerCents: c.price });
    expect(await db.auditEvent.findFirst({ where: { action: 'settlement.corrected', targetId: id } })).toMatchObject({ data: expect.objectContaining({ consignorApprovalRef: 'CA-2026-0042' }) });
    expect(await verifyAll(q, rules)).toMatchObject({ failure: null });

    // A rate correction that does not restate the approval keeps it, so the reserve stays waived for that sale only.
    const rate = await correctSettlement({ ...base, premiumBps: c.premiumBps + 250, reason: 'premium renegotiated' });
    expect(await db.settlement.findUniqueOrThrow({ where: { id: rate.id } })).toMatchObject({ consignorApprovalRef: 'CA-2026-0042', hammerCents: c.price });
    expect(await verifyAll(q, rules)).toMatchObject({ failure: null });
  }, 60_000);

  it('V8 refuses a SOLD-below-reserve correction stored without an approval', async () => {
    const c = await belowReserveLot();
    const { id } = await correctSettlement({ orgId: c.orgId, lotId: c.lotId, userId: c.userId, winner: c.leader, reason: 'ok', consignorApprovalRef: 'CA-9' });
    // The append-only trigger refuses UPDATE, so forge the same row without the reference next to it in a fresh chain link.
    await q.query(
      `INSERT INTO "Settlement" ("id","orgId","lotId","supersedesId","reason","correctedByUserId","outcome","winnerBidderId","winningSeq","hammerCents","premiumCents","totalCents","closedAt","rulesHash","premiumBps")
       SELECT gen_random_uuid(),"orgId","lotId","id",'forged',"correctedByUserId","outcome","winnerBidderId","winningSeq","hammerCents","premiumCents","totalCents","closedAt","rulesHash","premiumBps"
         FROM "Settlement" WHERE "id" = $1::uuid`,
      [id],
    );
    expect((await verifyAll(q, rules)).failure).toMatchObject({ check: 'V8' });
  }, 60_000);
});
