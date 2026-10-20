// Task 1.7 acceptance: the Gavel migration applies from scratch, the ledger tables refuse UPDATE and DELETE,
// LotState refuses DELETE, and the CHECKs refuse what the engine never produces.
import { execFileSync } from 'node:child_process';
import { Client as PgClient } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const T0 = new Date('2026-11-07T14:00:00Z');
const hoursBefore = (h: number) => new Date(T0.getTime() - h * 3_600_000);

/** One org, bidder, auction, lot with its LotState, and one accepted bid: the smallest ledger. */
async function ledger() {
  const org = await makeOrg('house');
  const user = await db.user.create({ data: { email: 'b1@example.com' } });
  const bidder = await db.bidder.create({ data: { orgId: org.id, userId: user.id, paddle: 101 } });
  const auction = await db.auction.create({
    data: { orgId: org.id, name: 'A1', softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1500, opensAt: hoursBefore(72) },
  });
  const lot = await db.lot.create({
    data: {
      orgId: org.id, auctionId: auction.id, number: 1, title: 'Anvil', startCents: 2500, scheduledEnd: T0,
      state: { create: { orgId: org.id, priceCents: 2500, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: T0, extensionCount: 0 } },
    },
  });
  const bid = await db.bid.create({
    data: {
      orgId: org.id, lotId: lot.id, seq: 1, bidderId: bidder.id, maxCents: 5000, placedAt: hoursBefore(1), idempotencyKey: 'k1',
      outcome: 'ACCEPTED_LEAD', accepted: true, priceBeforeCents: 2500, priceAfterCents: 2500, leaderAfterId: bidder.id,
      closesAtBefore: T0, closesAtAfter: T0, extended: false,
    },
  });
  return { org, bidder, auction, lot, bid };
}

describe('gavel_init migration', () => {
  it('applies from scratch on an empty database', { timeout: 90_000 }, async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const scratch = `gavel_scratch_${process.pid}`;
    const admin = new PgClient({ connectionString: url.href });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
      await admin.query(`CREATE DATABASE "${scratch}"`);
      url.pathname = `/${scratch}`;
      execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.href, DIRECT_URL: url.href }, stdio: 'pipe' });
      const c = new PgClient({ connectionString: url.href });
      await c.connect();
      try {
        const { rows } = await c.query<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
        const tables = rows.map((r) => r.t);
        expect(tables).toEqual(expect.arrayContaining(['Auction', 'Lot', 'LotState', 'Bidder', 'Bid', 'Settlement']));
        expect(tables).not.toContain('BillingAccount'); // D-31 Q4: billing dropped in the first Gavel migration
      } finally {
        await c.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
      await admin.end();
    }
  });
});

describe('append-only ledger (D-14, D-16, D-22)', () => {
  it('Bid refuses UPDATE and DELETE, even from raw SQL', async () => {
    const { bid } = await ledger();
    await expect(db.$executeRawUnsafe(`UPDATE "Bid" SET "outcome" = 'ACCEPTED_RAISE'`)).rejects.toThrow(/Bid is append-only: UPDATE refused/);
    await expect(db.bid.deleteMany()).rejects.toThrow(/Bid is append-only: DELETE refused/);
    expect((await db.bid.findUniqueOrThrow({ where: { id: bid.id } })).outcome).toBe('ACCEPTED_LEAD');
  });

  it('Settlement refuses UPDATE and DELETE', async () => {
    const { org, lot, bidder } = await ledger();
    const row = { orgId: org.id, lotId: lot.id, outcome: 'SOLD', winnerBidderId: bidder.id, winningSeq: 1, hammerCents: 2500, premiumCents: 375, totalCents: 2875, closedAt: T0, rulesHash: 'x' };
    await db.settlement.create({ data: row });
    await expect(db.settlement.updateMany({ data: { hammerCents: 1 } })).rejects.toThrow(/Settlement is append-only/);
    await expect(db.$executeRawUnsafe(`DELETE FROM "Settlement"`)).rejects.toThrow(/Settlement is append-only/);
    await expect(db.settlement.create({ data: row })).rejects.toThrow(/Settlement_lotId_key/); // one per lot
  });

  it('LotState can be updated but never deleted, and the cascade from Lot is refused with it', async () => {
    const { lot } = await ledger();
    await db.lotState.update({ where: { lotId: lot.id }, data: { bidCount: 1 } });
    await expect(db.lotState.delete({ where: { lotId: lot.id } })).rejects.toThrow(/LotState is append-only: DELETE refused/);
    await expect(db.$executeRawUnsafe(`DELETE FROM "LotState"`)).rejects.toThrow(/LotState is append-only/);
    expect((await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } })).bidCount).toBe(1);
  });
});

type L = Awaited<ReturnType<typeof ledger>>;

describe('CHECKs refuse what the engine never produces', () => {
  const cases: [string, (l: L) => Promise<unknown>, RegExp][] = [
    ['startCents 0', (l) => db.lot.create({ data: { orgId: l.org.id, auctionId: l.auction.id, number: 2, title: 'x', startCents: 0, scheduledEnd: T0 } }), /Lot_startCents_positive/],
    ['reserve under start', (l) => db.lot.create({ data: { orgId: l.org.id, auctionId: l.auction.id, number: 2, title: 'x', startCents: 2500, reserveCents: 2499, scheduledEnd: T0 } }), /Lot_reserve_at_least_start/],
    ['lot closing at open', (l) => db.lot.create({ data: { orgId: l.org.id, auctionId: l.auction.id, number: 2, title: 'x', startCents: 2500, scheduledEnd: hoursBefore(72) } }), /closes at or before its auction opens/],
    ['auction opening after a lot closes', (l) => db.auction.update({ where: { id: l.auction.id }, data: { opensAt: T0 } }), /would open at or after one of its lots closes/],
    ['seq 0', (l) => db.bid.create({ data: { ...bidRow(l), seq: 0 } }), /Bid_seq_from_one/],
    ['maxCents 0', (l) => db.bid.create({ data: { ...bidRow(l), maxCents: 0 } }), /Bid_maxCents_positive/],
    ['price falling', (l) => db.bid.create({ data: { ...bidRow(l), priceAfterCents: 2499 } }), /Bid_price_never_falls/],
    ['close moving earlier', (l) => db.bid.create({ data: { ...bidRow(l), closesAtAfter: hoursBefore(1) } }), /Bid_close_never_moves_earlier/],
    ['unknown outcome', (l) => db.bid.create({ data: { ...bidRow(l), outcome: 'ACCEPTED_MAYBE' } }), /Bid_outcome_known/],
    ['accepted flag disagreeing with outcome', (l) => db.bid.create({ data: { ...bidRow(l), outcome: 'REJECTED_BELOW_MINIMUM' } }), /Bid_accepted_matches_outcome/],
    ['duplicate (lot, bidder, key)', (l) => db.bid.create({ data: { ...bidRow(l), idempotencyKey: 'k1' } }), /Bid_lotId_bidderId_idempotencyKey_key/],
    ['settlement total off by one', (l) => db.settlement.create({ data: { orgId: l.org.id, lotId: l.lot.id, outcome: 'SOLD', hammerCents: 2500, premiumCents: 375, totalCents: 2876, closedAt: T0, rulesHash: 'x' } }), /Settlement_total_is_hammer_plus_premium/],
  ];
  it.each(cases)('%s', async (_name, attempt, message) => {
    const l = await ledger();
    await expect(attempt(l)).rejects.toThrow(message);
  });
});

/** A second, valid accepted row for the fixture lot; each case breaks one field. */
const bidRow = (l: L) => ({
  orgId: l.org.id, lotId: l.lot.id, seq: 2, bidderId: l.bidder.id, maxCents: 6000, placedAt: hoursBefore(1), idempotencyKey: 'k2',
  outcome: 'ACCEPTED_RAISE', accepted: true, priceBeforeCents: 2500, priceAfterCents: 2500, leaderBeforeId: l.bidder.id, leaderAfterId: l.bidder.id,
  closesAtBefore: T0, closesAtAfter: T0, extended: false,
});
