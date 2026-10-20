/**
 * The contention suite (D-18). A race test SPECIFIES an interleaving, never
 * samples one: every ordering constraint is a database condition or an
 * explicit `await`, each test carries a hard timeout, and a hang fails.
 *
 * `fileParallelism: false` (vitest.config.ts) is load-bearing here: the
 * `pg_locks` waiter count that releases the barrier is database-wide, so a
 * second test file running alongside could satisfy it with its own waiters.
 *
 * Task 1.3: the barrier mechanism itself, on a template table. Task 1.10: N raw
 * `pg` writers through `placeBid` on one `LotState` row (brief §8), a writer
 * that rolls back after the lock, and the clock read under the lock (V6).
 */
import { Client as PgClient } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openState } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';
import { pgRunner, pgTx, placeBid, prismaTx, type BidResponse, type Runner, type Tx } from '@/auction/place-bid';
import { verifyLot } from '@/auction/verify-sql';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';
import { RACE_TIMEOUT, RAW_APP, barrier, behindRowLock } from './row-lock';

// O-10: every size up to GAVEL_BARRIER_N (CI sets 25; locally all four, up to 50).
const SIZES = [2, 10, 25, 50].filter((n) => n <= Number(process.env.GAVEL_BARRIER_N ?? 50));
const { rules } = loadRules();
const q = prismaTx(db as unknown as Prisma.TransactionClient);

const T = Date.parse('2026-11-06T12:00:00Z'); // the lot's scheduledEnd
const W = 120_000; // soft-close window
const START = 10_000; // first band: increment 500 up to 49,999
const maxOf = (i: number) => 20_000 + 10 * i; // distinct, all above the opening minimum, all within one increment of each other

beforeEach(resetAuthTables);
afterAll(() => db.$disconnect());

const raw = async () => {
  const c = new PgClient({ connectionString: process.env.DATABASE_URL, application_name: RAW_APP });
  await c.connect();
  return c;
};
const rawConnections = async () =>
  Number((await db.$queryRawUnsafe<{ n: bigint }[]>('SELECT count(*) AS n FROM pg_stat_activity WHERE application_name = $1', RAW_APP))[0]!.n);
const untilQueued = async (n: number) => {
  for (;;) {
    const [r] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pg_locks WHERE locktype IN ('tuple', 'transactionid') AND NOT granted`);
    if (Number(r!.n) >= n) return;
  }
};

/** One house, one lot closing at T (W = 120 s, cap 600 s), its LotState, and `n` ACTIVE bidders. */
async function house(n: number) {
  const org = await makeOrg('barrier');
  const auction = await db.auction.create({
    data: { orgId: org.id, name: 'Barrier', softCloseWindowSeconds: W / 1000, maxExtensionSeconds: 600, buyerPremiumBps: 1500, opensAt: new Date(T - 3_600_000) },
  });
  const s = openState({ startCents: START, reserveCents: null, opensAtMs: T - 3_600_000, scheduledEndMs: T, softCloseWindowMs: W, maxExtensionMs: 600_000, buyerPremiumBps: 1500 });
  const lot = await db.lot.create({
    data: {
      orgId: org.id, auctionId: auction.id, number: 1, title: 'Lot 1', startCents: START, reserveCents: null, scheduledEnd: new Date(T),
      state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: s.bidCount, acceptedCount: s.acceptedCount, closesAt: new Date(s.closesAtMs), extensionCount: s.extensionCount } },
    },
  });
  const bidders: string[] = [];
  for (let i = 0; i < n; i++) {
    const user = await db.user.create({ data: { email: `b${i}@example.com` } });
    bidders.push((await db.bidder.create({ data: { orgId: org.id, userId: user.id, paddle: i + 1 } })).id);
  }
  const bid = (i: number, deps: { run: Runner; now: () => Date }) =>
    placeBid({ orgId: org.id, lotId: lot.id, bidderId: bidders[i]!, maxCents: maxOf(i), idempotencyKey: `k${i}` }, deps);
  return { lotId: lot.id, bidders, bid };
}

/** pgRunner with a pause after the body: the transaction keeps the row lock until `release`, then ends with `end`. */
const pausingRunner =
  (c: PgClient, end: 'COMMIT' | 'ROLLBACK', judged: () => void, release: Promise<void>): Runner =>
  async (body) => {
    await c.query('BEGIN');
    try {
      const result = await body(pgTx(c));
      judged();
      await release;
      await c.query(end);
      return result;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }
  };

/** pgRunner that stops just before the `FOR UPDATE` until `open`: the bid is past the boundary but holds no lock. */
const gatedRunner =
  (c: PgClient, atGate: () => void, open: Promise<void>): Runner =>
  (body) =>
    pgRunner(c)((tx) => {
      const gated: Tx = {
        query: async (sql, params) => {
          if (sql.includes('FOR UPDATE')) {
            atGate();
            await open;
          }
          return tx.query(sql, params);
        },
      };
      return body(gated);
    });

describe('behindRowLock', () => {
  it(
    'queues 10 raw writers on one row; all read the same state before any wrote; no connection leaks',
    async () => {
      const n = 10;
      const orgId = (await makeOrg('barrier-org')).id;
      const before = await rawConnections();
      const reads: string[] = [];

      const writer = async (i: number) => {
        const c = await raw();
        try {
          await c.query('BEGIN');
          const { rows } = await c.query<{ name: string }>('SELECT name FROM "Org" WHERE id = $1', [orgId]);
          reads.push(rows[0]?.name ?? '(no row)'); // MVCC: never blocks, sees the pre-race state
          await c.query('UPDATE "Org" SET name = name || $2 WHERE id = $1', [orgId, `.${i}`]);
          await c.query('COMMIT');
        } finally {
          await c.end();
        }
      };

      await behindRowLock('Org', orgId, n, () => Promise.all(Array.from({ length: n }, (_, i) => writer(i))));

      expect(reads).toHaveLength(n);
      expect(new Set(reads).size).toBe(1);
      const after = await db.org.findUniqueOrThrow({ where: { id: orgId } });
      expect(after.name.split('.')).toHaveLength(n + 1); // every writer's suffix landed, in lock order
      expect(await rawConnections()).toBe(before);
    },
    RACE_TIMEOUT,
  );
});

describe('the contention proof (brief §8, D-18)', () => {
  it.each(SIZES)(
    'N=%i writers queued behind one holder on the LotState row, the clock pinned at T − 1 s',
    async (n) => {
      const h = await house(n);
      const before = await rawConnections();
      const pinned = () => new Date(T - 1000);
      const clients = await Promise.all(Array.from({ length: n }, raw));
      let first: BidResponse[];
      let again: BidResponse[];
      try {
        first = await behindRowLock('LotState', h.lotId, n, () => Promise.all(clients.map((c, i) => h.bid(i, { run: pgRunner(c), now: pinned }))), 'lotId');
        expect(await verifyLot(q, h.lotId, rules)).toBeNull(); // V1–V9
        // The resend pass: every writer sends its key again, concurrently; still N rows, every answer a replay.
        again = await Promise.all(clients.map((c, i) => h.bid(i, { run: pgRunner(c), now: pinned })));
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }

      const rows = await db.bid.findMany({ where: { lotId: h.lotId }, orderBy: { seq: 'asc' } });
      const st = await db.lotState.findUniqueOrThrow({ where: { lotId: h.lotId } });
      expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: n }, (_, k) => k + 1)); // N attempts, N rows, no gap
      expect(first.map((r) => r.seq).sort((a, b) => a - b)).toEqual(rows.map((r) => r.seq));
      expect(first.every((r) => !r.replayed)).toBe(true);
      expect(rows.every((r) => r.placedAt.getTime() === T - 1000)).toBe(true);
      expect(new Set(rows.map((r) => r.bidderId)).size).toBe(n);

      // Whatever the lock order: seq 1 leads at the start price and extends the close; seq 2 is above the new
      // minimum (every max is) and is accepted, leaving the price at the higher of the two maxes; every later max
      // is then below price + 500 and is rejected. Only seq 2's LEAD/OUTBID depends on the order.
      const maxes = rows.map((r) => r.maxCents);
      expect(rows[0]).toMatchObject({ outcome: 'ACCEPTED_LEAD', priceAfterCents: START, extended: true, closesAtAfter: new Date(T - 1000 + W) });
      if (n >= 2) expect(['ACCEPTED_LEAD', 'ACCEPTED_OUTBID']).toContain(rows[1]!.outcome);
      expect(rows.slice(2).every((r) => r.outcome === 'REJECTED_BELOW_MINIMUM')).toBe(true);
      expect(rows.slice(1).every((r) => !r.extended)).toBe(true);
      const top = rows[maxes.indexOf(Math.max(...maxes.slice(0, 2)))]!;
      expect(st).toMatchObject({
        bidCount: n,
        acceptedCount: Math.min(n, 2),
        leaderBidderId: top.bidderId, // exactly one leader
        leaderSeq: top.seq,
        priceCents: n >= 2 ? top.maxCents : START,
        closesAt: new Date(T - 1000 + W),
        extensionCount: 1,
      });

      expect(again.every((r) => r.replayed)).toBe(true);
      expect(again.map((r) => [r.seq, r.outcome])).toEqual(first.map((r) => [r.seq, r.outcome]));
      expect(await db.bid.count({ where: { lotId: h.lotId } })).toBe(n);
      expect(await verifyLot(q, h.lotId, rules)).toBeNull();
      expect(await rawConnections()).toBe(before);

      const count = (o: string) => rows.filter((r) => r.outcome === o).length;
      console.info(
        `barrier N=${n}: rows ${rows.length}, accepted ${st.acceptedCount} (LEAD ${count('ACCEPTED_LEAD')}, OUTBID ${count('ACCEPTED_OUTBID')}), ` +
          `REJECTED_BELOW_MINIMUM ${count('REJECTED_BELOW_MINIMUM')}, closesAt T−1000+W, extensionCount ${st.extensionCount}, replays ${again.length}, verify OK`,
      );
    },
    RACE_TIMEOUT,
  );

  it(
    'a writer that rolls back after taking the lock leaves no gap: the writer queued behind it takes seq 1',
    async () => {
      const h = await house(2);
      const pinned = () => new Date(T - 1000);
      const [rc, wc] = [await raw(), await raw()];
      try {
        const judged = barrier();
        const release = barrier();
        const rolled = h.bid(0, { run: pausingRunner(rc, 'ROLLBACK', judged.release, release.reached), now: pinned });
        rolled.catch(() => {});
        await judged.reached; // it holds the row and has inserted seq 1, uncommitted
        const next = h.bid(1, { run: pgRunner(wc), now: pinned });
        next.catch(() => {});
        await untilQueued(1);
        release.release();
        expect((await rolled).seq).toBe(1); // what it judged, then threw away
        expect(await next).toMatchObject({ seq: 1, outcome: 'ACCEPTED_LEAD', replayed: false });
      } finally {
        await Promise.all([rc.end(), wc.end()]);
      }
      const rows = await db.bid.findMany({ where: { lotId: h.lotId } });
      expect(rows.map((r) => [r.seq, r.bidderId])).toEqual([[1, h.bidders[1]]]);
      expect((await db.lotState.findUniqueOrThrow({ where: { lotId: h.lotId } })).bidCount).toBe(1);
      expect(await verifyLot(q, h.lotId, rules)).toBeNull();
    },
    RACE_TIMEOUT,
  );

  it(
    'V6: a bid that reached the lock before another was judged, and waited out a 2 s hold, is stamped after the hold',
    async () => {
      const h = await house(2);
      const T0 = T - 60_000;
      let t = T0; // the scripted clock; the test advances it, nothing reads the system clock
      const clock = () => new Date(t);
      const [wc, hc] = [await raw(), await raw()];
      try {
        const atGate = barrier();
        const open = barrier();
        const judged = barrier();
        const release = barrier();
        // W is past the boundary at T0 and about to lock; a clock read before the lock would stamp T0.
        const w = h.bid(0, { run: gatedRunner(wc, atGate.release, open.reached), now: clock });
        w.catch(() => {});
        await atGate.reached;
        t = T0 + 1000; // H takes the row first and is judged at T0 + 1 s
        const hb = h.bid(1, { run: pausingRunner(hc, 'COMMIT', judged.release, release.reached), now: clock });
        hb.catch(() => {});
        await judged.reached;
        open.release();
        await untilQueued(1); // W is queued behind H
        t = T0 + 3000; // H holds the row for 2 s
        release.release();
        expect(await hb).toMatchObject({ seq: 1 });
        expect(await w).toMatchObject({ seq: 2 });
      } finally {
        await Promise.all([wc.end(), hc.end()]);
      }
      const rows = await db.bid.findMany({ where: { lotId: h.lotId }, orderBy: { seq: 'asc' } });
      expect(await verifyLot(q, h.lotId, rules)).toBeNull();
      expect(rows.map((r) => r.placedAt.getTime())).toEqual([T0 + 1000, T0 + 3000]);
    },
    RACE_TIMEOUT,
  );
});
