// Task 1.9 acceptance: the database replay of every fixture matches both expected files, auction:verify is OK
// after it, auction:close is idempotent, and the verifier names the lot and the check when the projection or a
// settlement is corrupted through a raw connection (outside placeBid, which is the only writer it trusts).
import { Client as PgClient } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { closeLots } from '@/auction/close';
import { loadRules } from '@/auction/load-rules';
import { prismaTx } from '@/auction/place-bid';
import { verifyAll } from '@/auction/verify-sql';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { runDb } from '../../scripts/auction-eval';
import { resetAuthTables } from '../helpers/auth';

const { rules, hash } = loadRules();
const q = prismaTx(db as unknown as Prisma.TransactionClient);

async function raw<T>(body: (c: PgClient) => Promise<T>): Promise<T> {
  const c = new PgClient({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await body(c);
  } finally {
    await c.end();
  }
}

const lotNumbered = (number: number) => db.lot.findFirstOrThrow({ where: { number, auction: { name: { startsWith: 'Harlan' } } } });

describe('auction:eval database half, auction:close, auction:verify', () => {
  // runDb truncates the Gavel tables itself; each test replays from scratch, then corrupts one lot.
  beforeAll(resetAuthTables);

  it('the database replay reproduces expected_bids.csv and expected_lots.csv, and verify is OK after it', async () => {
    const { ok, report } = await runDb();
    expect(report).toContain('OK: expected_bids.csv (220 rows) and expected_lots.csv (36 rows)');
    expect(ok).toBe(true);
    expect(await verifyAll(q, rules)).toEqual({ lots: 36, settled: 36, failure: null });
  }, 60_000);

  it('auction:close is idempotent: a second run settles nothing and writes no row', async () => {
    await runDb();
    const before = await db.settlement.count();
    expect(await closeLots(new Date(8_000_000_000_000), q, { rules, hash })).toEqual({ considered: 0, settled: 0 });
    expect(await db.settlement.count()).toBe(before);
  }, 60_000);

  it('V1: LotState.priceCents changed through a raw connection fails naming the lot', async () => {
    await runDb();
    const lot = await lotNumbered(1);
    await raw((c) => c.query(`UPDATE "LotState" SET "priceCents" = "priceCents" + 100 WHERE "lotId" = $1::uuid`, [lot.id]));
    const { failure } = await verifyAll(q, rules);
    expect(failure).toMatchObject({ lotId: lot.id, lotNumber: 1, check: 'V1' });
    expect(failure!.detail).toMatch(/^LotState\.priceCents is \d+, fold\(ledger\) says \d+$/);
  }, 60_000);

  it('V8: a Settlement inserted for a lot that is still open fails naming the lot', async () => {
    await runDb();
    const l1 = await lotNumbered(1);
    const end = new Date(l1.scheduledEnd.getTime() + 86_400_000);
    const open = await db.lot.create({
      data: {
        orgId: l1.orgId, auctionId: l1.auctionId, number: 99, title: 'open lot', startCents: 1000, scheduledEnd: end,
        state: { create: { orgId: l1.orgId, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } },
      },
    });
    await raw((c) =>
      c.query(
        `INSERT INTO "Settlement" ("id", "orgId", "lotId", "outcome", "hammerCents", "premiumCents", "totalCents", "closedAt", "rulesHash", "premiumBps")
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'UNSOLD_NO_BIDS', 0, 0, 0, $3::timestamptz, $4, 1500)`,
        [open.orgId, open.id, new Date(end.getTime() - 3_600_000).toISOString(), hash],
      ),
    );
    const { failure } = await verifyAll(q, rules);
    expect(failure).toMatchObject({ lotId: open.id, lotNumber: 99, check: 'V8' });
    expect(failure!.detail).toContain('the lot is not closed at its closedAt');
  }, 60_000);

  it('V2: a Bid row removed past the append-only trigger is named as the seq gap, not as a fold refusal', async () => {
    await runDb();
    const lot = await lotNumbered(1);
    await raw(async (c) => {
      await c.query(`SET session_replication_role = replica`); // bypasses the trigger for this session only
      await c.query(`DELETE FROM "Bid" WHERE "lotId" = $1::uuid AND "seq" = 2`, [lot.id]);
    });
    expect((await verifyAll(q, rules)).failure).toMatchObject({ lotId: lot.id, check: 'V2' });
  }, 60_000);

  // The SQL checks V4–V6 and V9 over columns the fold does not read, so V1 still passes and the named check is the
  // one that has to catch it. Each edit goes past the append-only trigger on a raw connection, as the V2 case does;
  // the row CHECKs (price never falls, close never earlier, accepted matches outcome) still apply. V3 and V7 have no
  // case here: with V1 passing, the leader row is the fold's own accepted row, and a duplicate key is refused by
  // the unique index Bid_lotId_bidderId_idempotencyKey_key before V7 could see it.
  const pastTrigger = (sql: string, params: unknown[]) =>
    raw(async (c) => {
      await c.query(`SET session_replication_role = replica`);
      const r = await c.query(sql, params);
      expect(r.rowCount).toBe(1);
    });

  it('V4: a rejected row whose recorded price moved fails naming the lot and the row', async () => {
    await runDb();
    const lot = await lotNumbered(1);
    const { seq } = await db.bid.findFirstOrThrow({ where: { lotId: lot.id, accepted: false }, orderBy: { seq: 'asc' }, select: { seq: true } });
    await pastTrigger(`UPDATE "Bid" SET "priceAfterCents" = "priceAfterCents" + 100 WHERE "lotId" = $1::uuid AND "seq" = $2`, [lot.id, seq]);
    const { failure } = await verifyAll(q, rules);
    expect(failure).toMatchObject({ lotId: lot.id, lotNumber: 1, check: 'V4' });
    expect(failure!.detail).toMatch(new RegExp(`^seq ${seq} \\(REJECTED_`));
  }, 60_000);

  it('V5: a row flagged extended whose close did not move fails naming the lot and the row', async () => {
    await runDb();
    const lot = await lotNumbered(1);
    const first = await db.bid.findFirstOrThrow({ where: { lotId: lot.id, seq: 1 } });
    expect(first.extended).toBe(false);
    expect(first.closesAtAfter.getTime()).toBe(first.closesAtBefore.getTime());
    await pastTrigger(`UPDATE "Bid" SET "extended" = true WHERE "lotId" = $1::uuid AND "seq" = 1`, [lot.id]);
    const { failure } = await verifyAll(q, rules);
    expect(failure).toMatchObject({ lotId: lot.id, lotNumber: 1, check: 'V5' });
    expect(failure!.detail).toMatch(/^seq 1: .* extended t$/); // format() prints a boolean as t
  }, 60_000);

  it('V6: a row placed before the row ahead of it in seq order fails naming the lot and the row', async () => {
    await runDb();
    const lot = await lotNumbered(1);
    const [two, three] = await db.bid.findMany({ where: { lotId: lot.id, seq: { in: [2, 3] } }, orderBy: { seq: 'asc' } });
    // Both far from the close and after the open, so the fold judges seq 3 the same one ms earlier and V1 holds.
    expect(three!.closesAtAfter.getTime()).toBe(three!.closesAtBefore.getTime());
    await pastTrigger(`UPDATE "Bid" SET "placedAt" = $3::timestamptz WHERE "lotId" = $1::uuid AND "seq" = $2`, [lot.id, 3, new Date(two!.placedAt.getTime() - 1).toISOString()]);
    const { failure } = await verifyAll(q, rules);
    expect(failure).toMatchObject({ lotId: lot.id, lotNumber: 1, check: 'V6' });
    expect(failure!.detail).toMatch(/^seq 3 /);
  }, 60_000);

  it('V9: a settlement carrying a rules hash other than D-23 fails naming the lot', async () => {
    await runDb();
    const lot = await lotNumbered(1);
    await pastTrigger(`UPDATE "Settlement" SET "rulesHash" = $2 WHERE "lotId" = $1::uuid AND "supersedesId" IS NULL`, [lot.id, '0'.repeat(64)]);
    const { failure } = await verifyAll(q, rules);
    expect(failure).toMatchObject({ lotId: lot.id, lotNumber: 1, check: 'V9' });
    expect(failure!.detail).toBe(`rulesHash ${'0'.repeat(64)}, D-23 says ${hash}`);
  }, 60_000);
});
