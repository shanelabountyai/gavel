// load:bids -- [--writers 200] [--lots 4] [--seconds 10] [--connections 40]: the D-19 measurement.
// M logical writers over L lots whose scheduledEnd is `seconds` out, on the real clock, through the real placeBid,
// each writer bidding with a fresh key per attempt until its lot answers REJECTED_LOT_CLOSED. The writers share
// one raw pg.Pool of `connections` (D-40: 200 connections do not fit under max_connections = 100), so latency is
// reported twice: around placeBid with a connection in hand, and end to end including the wait for one. No HTTP
// (Phase 3 adds that number beside this one). Appends the run to docs/LOAD.md; runs auction:verify last and
// exits 1 if it fails. The soft-close window is 2 s with a 6 s cap so a run is bounded at seconds + 6.
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { Client as PgClient, Pool } from 'pg';
import { closeLots } from '../src/auction/close';
import { openState } from '../src/auction/engine/engine';
import { BidError } from '../src/auction/errors';
import { loadRules } from '../src/auction/load-rules';
import { INT4_MAX, type BidResponse, pgRunner, placeBid, prismaTx } from '../src/auction/place-bid';
import { verifyAll } from '../src/auction/verify-sql';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';

const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > 0 ? Number(process.argv[i + 1]) : dflt;
  if (!Number.isInteger(v) || v <= 0) throw new Error(`--${name} must be a positive integer`);
  return v;
};
const WRITERS = arg('writers', 200);
const LOTS = arg('lots', 4);
const SECONDS = arg('seconds', 10);
const CONNECTIONS = arg('connections', 40);
const WINDOW_S = 2;
const CAP_S = 6;
const START_CENTS = 10_000;
const APP = 'gavel-load';
const OUT = 'docs/LOAD.md';

const pct = (xs: number[], p: number) => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil((p / 100) * xs.length) - 1)]!);
const ms = (x: number) => x.toFixed(1);

// 1. One house: an auction open since a minute ago, L lots closing `seconds` out, one ACTIVE bidder per writer.
const runId = new Date().toISOString();
const org = await db.org.create({ data: { slug: `load-${runId}`, name: `Load run ${runId} (synthetic)` } });
const t0 = Date.now();
const auction = await db.auction.create({
  data: { orgId: org.id, name: 'Load', softCloseWindowSeconds: WINDOW_S, maxExtensionSeconds: CAP_S, buyerPremiumBps: 1500, opensAt: new Date(t0 - 60_000) },
});
const lotIds: string[] = [];
for (let n = 1; n <= LOTS; n++) {
  const s = openState({ startCents: START_CENTS, reserveCents: null, opensAtMs: t0 - 60_000, scheduledEndMs: t0 + SECONDS * 1000, softCloseWindowMs: WINDOW_S * 1000, maxExtensionMs: CAP_S * 1000, buyerPremiumBps: 1500 });
  const lot = await db.lot.create({
    data: {
      orgId: org.id, auctionId: auction.id, number: n, title: `Lot ${n}`, startCents: START_CENTS, reserveCents: null, scheduledEnd: new Date(t0 + SECONDS * 1000),
      state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: s.bidCount, acceptedCount: s.acceptedCount, closesAt: new Date(s.closesAtMs), extensionCount: s.extensionCount } },
    },
  });
  lotIds.push(lot.id);
}
const bidderIds: string[] = [];
for (let i = 0; i < WRITERS; i++) {
  const user = await db.user.create({ data: { email: `load-${runId}-w${i}@example.test` } });
  bidderIds.push((await db.bidder.create({ data: { orgId: org.id, userId: user.id, paddle: i + 1 } })).id);
}

// 2. The shared raw pool and a sampler for the longest lock wait any backend was seen in (an upper bound:
// now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms).
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: CONNECTIONS, application_name: APP });
const sampler = new PgClient({ connectionString: process.env.DATABASE_URL, application_name: `${APP}-sampler` });
await sampler.connect();
let maxLockWaitMs = 0;
const sampling = setInterval(() => {
  sampler
    .query<{ w: string }>(`SELECT coalesce(max(extract(epoch FROM (now() - query_start)) * 1000), 0) AS w FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)
    .then(({ rows }) => (maxLockWaitMs = Math.max(maxLockWaitMs, Number(rows[0]!.w))), () => {});
}, 100);

// 3. The writers. Each bids `minNextCents` plus 0–2 increments over what its last answer said, so the mix holds
// leads, outbids, raises and stale-minimum rejections; a BID_TIMED_OUT is resent with the same key (D-13).
const outcomes = new Map<string, number>();
const bidMs: number[] = [];
const totalMs: number[] = [];
let timeouts = 0;
let firstStart = Infinity;
let lastEnd = 0;

async function writer(i: number) {
  const lotId = lotIds[i % LOTS]!;
  let maxCents = START_CENTS + (i % 5) * 100;
  for (;;) {
    const key = randomUUID();
    let r: BidResponse | undefined;
    for (;;) {
      const a = performance.now();
      firstStart = Math.min(firstStart, a);
      const c = await pool.connect();
      const b = performance.now();
      try {
        r = await placeBid({ orgId: org.id, lotId, bidderId: bidderIds[i]!, maxCents, idempotencyKey: key }, { run: pgRunner(c) });
      } catch (error) {
        if (error instanceof BidError && error.code === 'BID_TIMED_OUT') {
          timeouts++;
          continue;
        }
        throw error;
      } finally {
        c.release();
        const e = performance.now();
        lastEnd = Math.max(lastEnd, e);
        bidMs.push(e - b);
        totalMs.push(e - a);
      }
      break;
    }
    outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1);
    if (r.outcome === 'REJECTED_LOT_CLOSED') return;
    const step = Math.max(100, r.minNextCents - r.priceCents);
    maxCents = r.minNextCents + Math.floor(Math.random() * 3) * step;
    if (maxCents > INT4_MAX) return; // D-36: the lot has outgrown int4; the writer stops rather than be refused at the boundary
  }
}

console.log(`load:bids: ${WRITERS} writers over ${LOTS} lots closing in ${SECONDS} s (window ${WINDOW_S} s, cap ${CAP_S} s), ${CONNECTIONS} raw connections…`);
const results = await Promise.allSettled(Array.from({ length: WRITERS }, (_, i) => writer(i)));
clearInterval(sampling);
await sampler.end();
await pool.end();
const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
for (const f of failed) console.error('writer failed:', f.reason);

// 4. Settle, verify, report.
const q = prismaTx(db as unknown as Prisma.TransactionClient);
const { rules } = loadRules();
const closed = await closeLots(new Date(), q);
const verify = await verifyAll(q, rules);
const rows = await db.bid.count({ where: { orgId: org.id } });
const states = await db.lotState.findMany({ where: { orgId: org.id }, orderBy: { lot: { number: 'asc' } } });
await db.$disconnect();

const elapsedS = (lastEnd - firstStart) / 1000;
const sha = execSync('git rev-parse --short HEAD').toString().trim();
const pg = (await (async () => {
  const c = new PgClient({ connectionString: process.env.DATABASE_URL, application_name: `${APP}-version` });
  await c.connect();
  const v = (await c.query<{ v: string }>('SELECT version() AS v')).rows[0]!.v;
  await c.end();
  return v;
})()).split(' on ')[0];
const hw = `${os.cpus()[0]!.model}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB; Node ${process.version}; ${pg}`;
const verdict = verify.failure ? `FAILED: lot ${verify.failure.lotId} (#${verify.failure.lotNumber}) ${verify.failure.check}: ${verify.failure.detail}` : `OK, ${verify.lots} lots (${verify.settled} settled), V1–V9`;
const line =
  `${runId} ${sha}: ${WRITERS} writers, ${CONNECTIONS} connections, ${LOTS} lots, ${SECONDS} s + soft close: ${rows} ledger rows in ${elapsedS.toFixed(1)} s = ` +
  `${(rows / elapsedS).toFixed(0)} bids/s; placeBid p50 ${ms(pct(bidMs, 50))} / p95 ${ms(pct(bidMs, 95))} / p99 ${ms(pct(bidMs, 99))} ms; ` +
  `end to end p50 ${ms(pct(totalMs, 50))} / p95 ${ms(pct(totalMs, 95))} / p99 ${ms(pct(totalMs, 99))} ms; max lock wait ${ms(maxLockWaitMs)} ms; ` +
  `${timeouts} timeouts; ${hw}`;

const report = [
  `## ${runId} — \`${sha}\``,
  '',
  `\`${line}\``,
  '',
  `- Command: \`npm run load:bids -- ${process.argv.slice(2).join(' ')}\` → writers ${WRITERS}, lots ${LOTS}, seconds ${SECONDS}, connections ${CONNECTIONS}; soft-close window ${WINDOW_S} s, cap ${CAP_S} s, start ${START_CENTS} cents, no reserve.`,
  `- Ledger rows: ${rows} (N attempts, N rows; timeouts resent with the same key: ${timeouts}; writer failures: ${failed.length}).`,
  `- Outcomes: ${[...outcomes.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ')}.`,
  `- Bids per second: ${(rows / elapsedS).toFixed(1)} over ${elapsedS.toFixed(2)} s from the first attempt's start to the last attempt's end.`,
  `- Latency around \`placeBid\` with a connection in hand (same process as the server code; no HTTP): p50 ${ms(pct(bidMs, 50))} ms, p95 ${ms(pct(bidMs, 95))} ms, p99 ${ms(pct(bidMs, 99))} ms, max ${ms(Math.max(...bidMs))} ms, n = ${bidMs.length}.`,
  `- Latency end to end including the wait for one of the ${CONNECTIONS} pooled connections: p50 ${ms(pct(totalMs, 50))} ms, p95 ${ms(pct(totalMs, 95))} ms, p99 ${ms(pct(totalMs, 99))} ms.`,
  `- Max lock wait seen: ${ms(maxLockWaitMs)} ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).`,
  `- Per lot (bidCount / acceptedCount / price cents / extensions): ${states.map((s) => `${s.bidCount}/${s.acceptedCount}/${s.priceCents}/${s.extensionCount}`).join(', ')}; settled ${closed.settled}.`,
  `- Hardware: ${os.cpus()[0]!.model}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM; Node ${process.version}; ${pg}; git ${sha}; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).`,
  `- auction:verify: ${verdict}`,
  '',
].join('\n');

if (!existsSync(OUT)) {
  writeFileSync(OUT, '# LOAD\n\nEvery throughput number Gavel quotes comes from `npm run load:bids` (D-19, D-24) and is appended here by the script with the hardware it ran on. Nothing in this file is typed by hand. Newest run last.\n\n');
}
appendFileSync(OUT, report);
console.log(report);
console.log(`auction:verify: ${verdict}`);
if (verify.failure || failed.length > 0) process.exit(1);
