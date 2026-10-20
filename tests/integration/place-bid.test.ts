// Task 1.8 acceptance (D-37). Every test pins or injects the clock; none reads the system clock. The two race
// tests specify their interleaving with pg_locks as the happens-before edge (D-18), never a timer.
import { readFileSync } from 'node:fs';
import { Client as PgClient } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { openState } from '@/auction/engine/engine';
import { BidError } from '@/auction/errors';
import { placeBid, type BidResponse } from '@/auction/place-bid';
import { db } from '@/core/db';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';
import { RACE_TIMEOUT } from '../contention/row-lock';

beforeEach(resetAuthTables);

type FixtureLot = { lot_id: string; kind: string; start_cents: number; reserve_cents: number | null; opens_at_ms: number; scheduled_end_ms: number };
type FixtureAuction = { auction_id: string; soft_close_window_seconds: number; max_extension_seconds: number; buyer_premium_bps: number; lots: FixtureLot[] };
const fixtures: { auctions: FixtureAuction[] } = JSON.parse(readFileSync('fixtures/auctions.json', 'utf8'));

/** One house with fixture auction A1's settings; bidders and lots are created on demand by fixture id. */
async function house() {
  const org = await makeOrg('house');
  const a1 = fixtures.auctions.find((a) => a.auction_id === 'A1')!;
  const auction = await db.auction.create({
    data: { orgId: org.id, name: 'A1', softCloseWindowSeconds: a1.soft_close_window_seconds, maxExtensionSeconds: a1.max_extension_seconds, buyerPremiumBps: a1.buyer_premium_bps, opensAt: new Date(a1.lots[0]!.opens_at_ms) },
  });
  const bidders = new Map<string, string>(); // fixture id → uuid
  const fixtureIdOf = new Map<string, string>(); // uuid → fixture id
  const bidder = async (fid: string) => {
    if (!bidders.has(fid)) {
      const user = await db.user.create({ data: { email: `${fid.toLowerCase()}@example.com` } });
      const b = await db.bidder.create({ data: { orgId: org.id, userId: user.id, paddle: Number(fid.slice(1)) } });
      bidders.set(fid, b.id);
      fixtureIdOf.set(b.id, fid);
    }
    return bidders.get(fid)!;
  };
  const lot = async (fid: string) => {
    const l = a1.lots.find((x) => x.lot_id === fid)!;
    const s = openState({ startCents: l.start_cents, reserveCents: l.reserve_cents, opensAtMs: l.opens_at_ms, scheduledEndMs: l.scheduled_end_ms, softCloseWindowMs: 0, maxExtensionMs: 0, buyerPremiumBps: 0 });
    return db.lot.create({
      data: {
        orgId: org.id, auctionId: auction.id, number: Number(fid.slice(1)), title: fid, startCents: l.start_cents, reserveCents: l.reserve_cents, scheduledEnd: new Date(l.scheduled_end_ms),
        state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: s.bidCount, acceptedCount: s.acceptedCount, closesAt: new Date(s.closesAtMs), extensionCount: s.extensionCount } },
      },
    });
  };
  return { org, auction, bidder, lot, fixtureIdOf: (id: string | null) => (id === null ? '' : fixtureIdOf.get(id)!) };
}

const raw = async () => {
  const c = new PgClient({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
};

/** The happens-before edge: a transaction is queued on a lock (D-18). */
async function untilQueued(c: PgClient, n = 1) {
  for (;;) {
    const { rows } = await c.query<{ n: string }>(`SELECT count(*) AS n FROM pg_locks WHERE locktype IN ('tuple', 'transactionid') AND NOT granted`);
    if (Number(rows[0]!.n) >= n) return;
  }
}

describe('placeBid: the sequential replay of the REPLAY and OWN_RAISE lots matches expected_bids.csv', () => {
  it.each(['L008', 'L010'])('%s', async (lotFid) => {
    const h = await house();
    const lot = await h.lot(lotFid);
    const subs = readFileSync('fixtures/submissions.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((s) => s.lot_id === lotFid);
    const expected = readFileSync('fixtures/expected_bids.csv', 'utf8').trim().split('\n').filter((l) => l.split(',')[1] === lotFid);
    const got: string[] = [];
    for (const s of subs) {
      const bidderId = await h.bidder(s.bidder_id);
      let r: BidResponse | null = null;
      let mismatch = false;
      try {
        r = await placeBid({ orgId: h.org.id, lotId: lot.id, bidderId, maxCents: s.max_cents, idempotencyKey: s.idempotency_key }, { now: () => new Date(s.placed_at_ms) });
      } catch (e) {
        if (!(e instanceof BidError) || e.code !== 'IDEMPOTENCY_MISMATCH') throw e;
        mismatch = true;
      }
      const written = r !== null && !r.replayed;
      const st = await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } });
      const row = written ? await db.bid.findUniqueOrThrow({ where: { lotId_seq: { lotId: lot.id, seq: r!.seq } } }) : null;
      // The eval script's columns (BID_COLS), in its order, from the response, the Bid row and the projection.
      got.push([
        s.submission_id, lotFid, mismatch ? '' : r!.seq, s.bidder_id, s.max_cents, s.placed_at_ms, s.idempotency_key, written,
        mismatch ? 'IDEMPOTENCY_MISMATCH' : r!.replayed ? 'REPLAY' : r!.outcome, row?.accepted ?? false,
        row ? row.priceBeforeCents : '', row ? row.priceAfterCents : st.priceCents, row ? h.fixtureIdOf(row.leaderBeforeId) : '', row ? h.fixtureIdOf(row.leaderAfterId) : h.fixtureIdOf(st.leaderBidderId),
        row ? row.closesAtBefore.getTime() : '', row ? row.closesAtAfter.getTime() : st.closesAt.getTime(), row?.extended ?? false,
      ].join(','));
      if (row) {
        expect(row.placedAt.getTime()).toBe(s.placed_at_ms); // the injected clock, read under the lock
        expect(r!.priceCents).toBe(st.priceCents);
        expect(r!.closesAt).toEqual(st.closesAt);
        expect(r!.youLead).toBe(st.leaderBidderId === bidderId);
      }
    }
    expect(got).toEqual(expected);
    expect(await db.bid.count({ where: { lotId: lot.id } })).toBe(expected.filter((l) => l.split(',')[7] === 'true').length);
  });
});

describe('placeBid: boundary refusals write nothing and take no lock', () => {
  it.each([
    ['MISSING_KEY', { idempotencyKey: '' }],
    ['INVALID_AMOUNT', { maxCents: 2500.5 }],
    ['INVALID_AMOUNT', { maxCents: 0 }],
    ['INVALID_AMOUNT', { maxCents: 2147483648 }],
    ['LOT_NOT_FOUND', { lotId: '00000000-0000-0000-0000-000000000000' }],
    ['LOT_NOT_FOUND', { lotId: 'not-a-uuid' }],
    ['BIDDER_NOT_ACTIVE', { bidderId: '00000000-0000-0000-0000-000000000000' }],
  ] as const)('%s', async (code, patch) => {
    const h = await house();
    const lot = await h.lot('L008');
    const bidderId = await h.bidder('B028');
    const input = { orgId: h.org.id, lotId: lot.id, bidderId, maxCents: 25000, idempotencyKey: 'k', ...patch };
    await expect(placeBid(input, { now: () => new Date(0) })).rejects.toMatchObject({ name: 'BidError', code, retryable: false });
    expect(await db.bid.count()).toBe(0);
  });

  it('a SUSPENDED bidder and a lot of another house are refused', async () => {
    const h = await house();
    const lot = await h.lot('L008');
    const bidderId = await h.bidder('B028');
    await db.bidder.update({ where: { id: bidderId }, data: { status: 'SUSPENDED' } });
    await expect(placeBid({ orgId: h.org.id, lotId: lot.id, bidderId, maxCents: 25000, idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'BIDDER_NOT_ACTIVE' });
    const other = await makeOrg('other');
    await expect(placeBid({ orgId: other.id, lotId: lot.id, bidderId, maxCents: 25000, idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'LOT_NOT_FOUND' });
    expect(await db.bid.count()).toBe(0);
  });
});

describe('placeBid under contention (D-13, D-15, D-17)', () => {
  it(
    'a lock held longer than lock_timeout is BID_TIMED_OUT (retryable, a BidError, not a Prisma error) and writes no row',
    async () => {
      const h = await house();
      const lot = await h.lot('L008');
      const bidderId = await h.bidder('B028');
      const holder = await raw();
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT 1 FROM "LotState" WHERE "lotId" = $1 FOR UPDATE`, [lot.id]);
        // Held until the refusal arrives: lock_timeout (5 s) fires on the waiter while the holder still has the row.
        const error = await placeBid({ orgId: h.org.id, lotId: lot.id, bidderId, maxCents: 25000, idempotencyKey: 'k' }, { now: () => new Date(0) }).then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(BidError);
        expect(error).toMatchObject({ code: 'BID_TIMED_OUT', retryable: true });
        await holder.query('ROLLBACK');
      } finally {
        await holder.end();
      }
      expect(await db.bid.count()).toBe(0);
      expect((await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } })).bidCount).toBe(0);
    },
    RACE_TIMEOUT,
  );

  it(
    'the clock is read after the lock is granted: a bid that waited is stamped after the release',
    async () => {
      const h = await house();
      const lot = await h.lot('L008');
      const bidderId = await h.bidder('B028');
      const T = new Date('2026-11-06T12:00:00Z');
      let released = false;
      let readAfterRelease: boolean | null = null;
      const holder = await raw();
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT 1 FROM "LotState" WHERE "lotId" = $1 FOR UPDATE`, [lot.id]);
        const pending = placeBid(
          { orgId: h.org.id, lotId: lot.id, bidderId, maxCents: 25000, idempotencyKey: 'k' },
          { now: () => { readAfterRelease = released; return T; } },
        );
        pending.catch(() => {});
        await untilQueued(holder); // the bid is waiting on the row
        released = true;
        await holder.query('COMMIT');
        const r = await pending;
        expect(r).toMatchObject({ outcome: 'ACCEPTED_LEAD', seq: 1, replayed: false, youLead: true, priceCents: 20000 });
      } finally {
        await holder.end();
      }
      expect(readAfterRelease).toBe(true); // a clock read before the lock would have seen `released` false
      const [bid] = await db.bid.findMany({ where: { lotId: lot.id } });
      expect(bid!.placedAt).toEqual(T);
    },
    RACE_TIMEOUT,
  );

  // Only a writer that skips the lock can race the idempotency read; the unique index is the second line (D-17).
  // LotState says seq 1 exists so the raw row (seq 1) and the bid's insert (seq 2) collide on the key index alone.
  it.each([
    ['same amount: answered as a replay of the committed row', 5000, { outcome: 'ACCEPTED_LEAD', seq: 1, replayed: true }],
    ['different amount: IDEMPOTENCY_MISMATCH', 6000, null],
  ])('a duplicate key committed by a raw connection mid-transaction; %s', async (_name, maxCents, want) => {
    const h = await house();
    const lot = await h.lot('L008');
    const bidderId = await h.bidder('B028');
    const T0 = new Date('2026-11-06T12:00:00Z');
    await db.lotState.update({ where: { lotId: lot.id }, data: { priceCents: 20000, leaderBidderId: bidderId, leaderMaxCents: 5000, leaderSeq: 1, bidCount: 1, acceptedCount: 1 } });
    const other = await raw();
    try {
      await other.query('BEGIN');
      await other.query(
        `INSERT INTO "Bid" ("id","orgId","lotId","seq","bidderId","maxCents","placedAt","idempotencyKey","outcome","accepted","priceBeforeCents","priceAfterCents","leaderBeforeId","leaderAfterId","closesAtBefore","closesAtAfter","extended")
         VALUES (gen_random_uuid(), $1, $2, 1, $3, 5000, $4, 'k', 'ACCEPTED_LEAD', true, 0, 20000, NULL, $3, $5, $5, false)`,
        [h.org.id, lot.id, bidderId, T0, new Date(fixtures.auctions[0]!.lots[7]!.scheduled_end_ms)],
      );
      const pending = placeBid({ orgId: h.org.id, lotId: lot.id, bidderId, maxCents, idempotencyKey: 'k' }, { now: () => new Date(T0.getTime() + 1000) });
      pending.catch(() => {});
      await untilQueued(other); // the bid's INSERT is blocked on the uncommitted index entry
      await other.query('COMMIT');
      if (want) expect(await pending).toMatchObject(want);
      else await expect(pending).rejects.toMatchObject({ name: 'BidError', code: 'IDEMPOTENCY_MISMATCH' });
    } finally {
      await other.end();
    }
    expect(await db.bid.count({ where: { lotId: lot.id } })).toBe(1);
  }, RACE_TIMEOUT);
});
