// Task 2.2 acceptance (D-42 Q2, D-44): a correction on a SOLD lot leaves the original row byte-identical, moves the
// invoice and keeps auction:verify OK; a second correction of the same predecessor is refused by the unique on
// supersedesId (an enforced interleaving behind the LotState lock, not a sampled one). Expected prices come from the
// stored Bid rows (V4-checked), never from resettle.
import { Client as PgClient } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeLots } from '@/auction/close';
import { correctSettlement } from '@/auction/correct';
import { CorrectionError } from '@/auction/errors';
import { invoicesForAuction } from '@/auction/invoice';
import { loadRules } from '@/auction/load-rules';
import { prismaTx } from '@/auction/place-bid';
import { verifyAll } from '@/auction/verify-sql';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { runDb } from '../../scripts/auction-eval';
import { RACE_TIMEOUT, behindRowLock } from '../contention/row-lock';
import { resetAuthTables } from '../helpers/auth';

const { rules, hash } = loadRules();
const q = prismaTx(db as unknown as Prisma.TransactionClient);
const snapshot = (id: string) => q.query<{ j: unknown }>(`SELECT to_jsonb(s) AS j FROM "Settlement" s WHERE "id" = $1::uuid`, [id]).then((r) => r[0]!.j);
const rowsFor = (lotId: string) => db.settlement.count({ where: { lotId } });

/** A SOLD lot whose underbidder's capped price meets the reserve, with that price read off the Bid table. */
async function soldLotWithUnderbidder() {
  const [c] = await q.query<{ lotId: string; orgId: string; auctionId: string; settlementId: string; winner: string; hammer: number; under: string; underSeq: number; underPrice: number }>(
    `SELECT s."lotId"::text, s."orgId"::text, l."auctionId"::text, s."id"::text AS "settlementId", s."winnerBidderId"::text AS winner, s."hammerCents" AS hammer,
            b."bidderId"::text AS under, b."seq" AS "underSeq", least(b."priceAfterCents", b."maxCents") AS "underPrice"
       FROM "Settlement" s JOIN "Lot" l ON l."id" = s."lotId"
       JOIN LATERAL (SELECT * FROM "Bid" b WHERE b."lotId" = s."lotId" AND b."accepted" AND b."bidderId" <> s."winnerBidderId" ORDER BY b."seq" DESC LIMIT 1) b ON true
      WHERE s."outcome" = 'SOLD' AND s."supersedesId" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Bid" w WHERE w."lotId" = s."lotId" AND w."accepted" AND w."bidderId" = b."bidderId" AND w."seq" > b."seq")
        AND least(b."priceAfterCents", b."maxCents") >= coalesce(l."reserveCents", 0)
      ORDER BY l."auctionId", l."number" LIMIT 1`,
  );
  if (!c) throw new Error('no fixture lot has an underbidder above the reserve');
  const user = await db.user.findFirstOrThrow();
  const { premiumBps } = await db.settlement.findUniqueOrThrow({ where: { id: c.settlementId } });
  return { ...c, userId: user.id, otherBps: premiumBps + 250 }; // a rate this lot was not settled at
}

const lotOn = (invoices: Awaited<ReturnType<typeof invoicesForAuction>>, bidderId: string, lotId: string) =>
  invoices.find((i) => i.bidderId === bidderId)?.lots.find((l) => l.lotId === lotId) ?? null;

describe('correctSettlement (task 2.2)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    expect((await runDb()).ok).toBe(true);
  }, 60_000);

  it('winner to the underbidder: original byte-identical, invoice moves, verify OK, audit written, close still idempotent', async () => {
    const c = await soldLotWithUnderbidder();
    const before = await snapshot(c.settlementId);
    const { id, settlement } = await correctSettlement({ orgId: c.orgId, lotId: c.lotId, supersedesId: c.settlementId, winner: c.under, reason: 'winner defaulted', userId: c.userId });

    expect(await snapshot(c.settlementId)).toEqual(before);
    expect(settlement).toMatchObject({ outcome: 'SOLD', winner: c.under, winningSeq: c.underSeq, hammerCents: c.underPrice });
    const inv = await invoicesForAuction(q, c.orgId, c.auctionId);
    expect(lotOn(inv, c.winner, c.lotId)).toBeNull();
    expect(lotOn(inv, c.under, c.lotId)).toMatchObject({ hammerCents: c.underPrice, totalCents: settlement.totalCents });
    expect(await verifyAll(q, rules)).toMatchObject({ failure: null });
    expect(await db.auditEvent.findFirst({ where: { action: 'settlement.corrected', targetId: id } })).toMatchObject({ orgId: c.orgId, actorUserId: c.userId });
    expect(await closeLots(new Date(8_000_000_000_000), q, { rules, hash })).toEqual({ considered: 0, settled: 0 });
  }, 60_000);

  it('two corrections of the same predecessor queued on the lock: one row lands, the other is refused by the unique', async () => {
    const c = await soldLotWithUnderbidder();
    const base = { orgId: c.orgId, lotId: c.lotId, supersedesId: c.settlementId, userId: c.userId };
    const results = await behindRowLock('LotState', c.lotId, 2, () =>
      Promise.allSettled([
        correctSettlement({ ...base, winner: null, reason: 'consignor withdrew' }),
        correctSettlement({ ...base, premiumBps: c.otherBps, reason: 'premium renegotiated' }),
      ]), 'lotId');
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(CorrectionError);
    expect(refused.reason).toMatchObject({ code: 'STALE_SETTLEMENT', retryable: false });
    expect(await rowsFor(c.lotId)).toBe(2);
    expect(await verifyAll(q, rules)).toMatchObject({ failure: null });
  }, RACE_TIMEOUT);

  it('unsold and back: the chain tip returns to the original amounts and the invoice line returns with it', async () => {
    const c = await soldLotWithUnderbidder();
    const first = (await db.settlement.findUniqueOrThrow({ where: { id: c.settlementId } }));
    const unsold = await correctSettlement({ orgId: c.orgId, lotId: c.lotId, supersedesId: c.settlementId, winner: null, reason: 'title dispute', userId: c.userId });
    expect(unsold.settlement).toMatchObject({ outcome: 'UNSOLD_BY_CORRECTION', winner: null, hammerCents: 0, totalCents: 0 });
    expect(lotOn(await invoicesForAuction(q, c.orgId, c.auctionId), c.winner, c.lotId)).toBeNull();

    const back = await correctSettlement({ orgId: c.orgId, lotId: c.lotId, supersedesId: unsold.id, winner: c.winner, reason: 'dispute resolved', userId: c.userId });
    expect(back.settlement).toMatchObject({ outcome: 'SOLD', winner: first.winnerBidderId, winningSeq: first.winningSeq, hammerCents: first.hammerCents, premiumCents: first.premiumCents, totalCents: first.totalCents });
    expect(lotOn(await invoicesForAuction(q, c.orgId, c.auctionId), c.winner, c.lotId)).toMatchObject({ hammerCents: first.hammerCents });
    expect(await verifyAll(q, rules)).toMatchObject({ failure: null });
  }, 60_000);

  it('refusals write nothing: bad input, a bidder with no accepted row, no change, a superseded predecessor', async () => {
    const c = await soldLotWithUnderbidder();
    const base = { orgId: c.orgId, lotId: c.lotId, supersedesId: c.settlementId, userId: c.userId, reason: 'x' };
    const refuse = (input: Parameters<typeof correctSettlement>[0], code: string) => expect(correctSettlement(input)).rejects.toMatchObject({ code });
    await refuse({ ...base, reason: '  ' }, 'INVALID_INPUT');
    await refuse({ ...base, premiumBps: 1500.5 }, 'INVALID_INPUT');
    await refuse({ ...base, winner: '00000000-0000-4000-8000-000000000000' }, 'NOT_AN_ACCEPTED_BIDDER');
    await refuse({ ...base, winner: c.winner }, 'NO_CHANGE');
    await refuse({ ...base, orgId: '00000000-0000-4000-8000-000000000000' }, 'SETTLEMENT_NOT_FOUND');
    expect(await rowsFor(c.lotId)).toBe(1);

    await correctSettlement({ ...base, premiumBps: c.otherBps });
    await refuse({ ...base, premiumBps: c.otherBps + 250 }, 'STALE_SETTLEMENT'); // sequential, so the unique is all that is left to refuse it
    expect(await rowsFor(c.lotId)).toBe(2);
  }, 60_000);

  it('verify and the schema catch a correction written around correctSettlement', async () => {
    const c = await soldLotWithUnderbidder();
    const raw = new PgClient({ connectionString: process.env.DATABASE_URL });
    await raw.connect();
    const insert = (lotId: string, supersedesId: string, reason: string | null, hammer: number) =>
      raw.query(
        `INSERT INTO "Settlement" ("id", "orgId", "lotId", "supersedesId", "reason", "correctedByUserId", "outcome", "winnerBidderId", "winningSeq",
                                   "hammerCents", "premiumCents", "totalCents", "closedAt", "rulesHash", "premiumBps")
         SELECT gen_random_uuid(), s."orgId", $1::uuid, $2::uuid, $3, $4::uuid, 'SOLD', $5::uuid, $6, $7, 0, $7, s."closedAt", s."rulesHash", 0
           FROM "Settlement" s WHERE s."id" = $2::uuid`,
        [lotId, supersedesId, reason, c.userId, c.under, c.underSeq, hammer],
      );
    try {
      await expect(insert(c.lotId, c.settlementId, '', c.underPrice)).rejects.toThrow(/Settlement_correction_names_reason_and_user/);
      const other = await db.lot.findFirstOrThrow({ where: { id: { not: c.lotId }, auctionId: c.auctionId } });
      await expect(insert(other.id, c.settlementId, 'x', c.underPrice)).rejects.toThrow(/Settlement_supersedes_same_lot/);
      await insert(c.lotId, c.settlementId, 'forged', c.underPrice + 100);
      const { failure } = await verifyAll(q, rules);
      expect(failure).toMatchObject({ lotId: c.lotId, check: 'V8' });
      expect(failure!.detail).toMatch(/^correction [0-9a-f-]+: hammerCents is \d+, resettle\(ledger\) says \d+$/);
    } finally {
      await raw.end();
    }
  }, 60_000);
});
