// load:bids -- [--writers 200] [--lots 4] [--seconds 10] [--connections 40]: the D-19 measurement.
// M logical writers over L lots whose scheduledEnd is `seconds` out, on the real clock, through the real placeBid,
// each writer bidding with a fresh key per attempt until its lot answers REJECTED_LOT_CLOSED. The writers share
// one raw pg.Pool of `connections` (D-40: 200 connections do not fit under max_connections = 100), so latency is
// reported twice: around placeBid with a connection in hand, and end to end including the wait for one.
// `--http http://localhost:6100` (task 3.7) sends the same bids as POST /api/lots/[id]/bids with a session cookie per
// writer against a production build started separately (`npm run e2e:server`, same .env.test database); the latency
// is then the HTTP round trip and the connections are the server's Prisma pool. Appends the run to docs/LOAD.md;
// runs auction:verify last and exits 1 if it fails. The soft-close window is 2 s with a 6 s cap so a run is bounded
// at seconds + 6.
// `--lock advisory|version|serializable` (task 4.2, D-58) swaps the product's FOR UPDATE for a variant under
// scripts/lock-variants/; the default `row` is the product path. In-process only.
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { Client as PgClient, Pool } from 'pg';
import { SESSION_COOKIE } from '../src/core/auth/session';
import { hashToken, newToken } from '../src/core/tokens';
import { closeLots } from '../src/auction/close';
import { openState } from '../src/auction/engine/engine';
import { BidError } from '../src/auction/errors';
import { loadRules } from '../src/auction/load-rules';
import { INT4_MAX, type BidResponse, judge, pgRunner, placeBid, prismaTx } from '../src/auction/place-bid';
import { verifyAll } from '../src/auction/verify-sql';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';
import type { Variant } from './lock-variants/variant';

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
const HTTP = process.argv.includes('--http') ? process.argv[process.argv.indexOf('--http') + 1] : undefined;
if (HTTP !== undefined && !URL.canParse(HTTP)) throw new Error('--http needs a base URL, e.g. http://localhost:6100');
const LOCK = process.argv.includes('--lock') ? process.argv[process.argv.indexOf('--lock') + 1]! : 'row';
if (!['row', 'advisory', 'version', 'serializable'].includes(LOCK)) throw new Error('--lock must be row, advisory, version or serializable');
if (HTTP && LOCK !== 'row') throw new Error('--lock is in-process only; the server runs the product path');
const rowStats = { judgements: 0, conflicts: 0 };
const variant: Variant =
  LOCK === 'row'
    ? { stats: rowStats, judge: (...a) => (rowStats.judgements++, judge(...a)) }
    : ((await import(`./lock-variants/${LOCK}.ts`)) as { variant: Variant }).variant;
// What the server's Prisma pool is capped at, read from the DATABASE_URL this script shares with `npm run start:test`.
const SERVER_POOL = new URL(process.env.DATABASE_URL!).searchParams.get('connection_limit') ?? 'default';
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
const tokens: string[] = []; // HTTP mode: one session per writer, the row written here, the raw token in the cookie
for (let i = 0; i < WRITERS; i++) {
  const user = await db.user.create({ data: { email: `load-${runId}-w${i}@example.test` } });
  bidderIds.push((await db.bidder.create({ data: { orgId: org.id, userId: user.id, paddle: i + 1 } })).id);
  if (HTTP) {
    await db.membership.create({ data: { orgId: org.id, userId: user.id, role: 'member' } }); // the route checks membership (INV-02)
    const token = newToken();
    await db.session.create({ data: { hash: hashToken(token), userId: user.id, authAt: new Date(t0), mfaAt: new Date(t0), createdAt: new Date(t0), expiresAt: new Date(t0 + 3600_000) } });
    tokens.push(token);
  }
}
if (HTTP) {
  const h = await fetch(`${HTTP}/api/health`).catch((e: unknown) => { throw new Error(`no server at ${HTTP}: ${String(e)}; start one with npm run e2e:server`); });
  if (!h.ok) throw new Error(`${HTTP}/api/health answered ${h.status}`);
}

// 2. The shared raw pool and a sampler for the longest lock wait any backend was seen in (an upper bound:
// now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms).
const pool = HTTP ? undefined : new Pool({ connectionString: process.env.DATABASE_URL, max: CONNECTIONS, application_name: APP });
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

// HTTP mode: the same loop over POST /api/lots/[id]/bids; a 503 (O-8) is the timeout, resent with the same key.
async function postBid(i: number, lotId: string, maxCents: number, key: string): Promise<BidResponse> {
  const res = await fetch(`${HTTP}/api/lots/${lotId}/bids`, {
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${tokens[i]}`, 'content-type': 'application/json' },
    body: JSON.stringify({ maxCents, idempotencyKey: key }),
  });
  const body = (await res.json()) as BidResponse & { error?: string; message?: string };
  if (res.status === 503) throw new BidError('BID_TIMED_OUT', body.message ?? 'busy', true);
  if (!res.ok) throw new Error(`POST bids → ${res.status} ${body.error ?? ''}: ${body.message ?? ''}`);
  return body;
}

async function writer(i: number) {
  const lotId = lotIds[i % LOTS]!;
  let maxCents = START_CENTS + (i % 5) * 100;
  for (;;) {
    const key = randomUUID();
    let r: BidResponse | undefined;
    for (;;) {
      const a = performance.now();
      firstStart = Math.min(firstStart, a);
      if (HTTP) {
        try {
          r = await postBid(i, lotId, maxCents, key);
        } catch (error) {
          if (error instanceof BidError && error.code === 'BID_TIMED_OUT') {
            timeouts++;
            continue;
          }
          throw error;
        } finally {
          const e = performance.now();
          lastEnd = Math.max(lastEnd, e);
          bidMs.push(e - a);
          totalMs.push(e - a);
        }
        break;
      }
      const c = await pool!.connect();
      const b = performance.now();
      try {
        r = await placeBid({ orgId: org.id, lotId, bidderId: bidderIds[i]!, maxCents, idempotencyKey: key }, { run: (variant.run ?? pgRunner)(c), judge: variant.judge });
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

const via = HTTP ? `HTTP via ${HTTP} (server Prisma pool connection_limit=${SERVER_POOL})` : `${CONNECTIONS} raw connections`;
console.log(`load:bids: ${WRITERS} writers over ${LOTS} lots closing in ${SECONDS} s (window ${WINDOW_S} s, cap ${CAP_S} s), ${via}…`);
const results = await Promise.allSettled(Array.from({ length: WRITERS }, (_, i) => writer(i)));
clearInterval(sampling);
await sampler.end();
await pool?.end();
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

const judgementsPerRow = rows === 0 ? '0' : (variant.stats.judgements / rows).toFixed(3);
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
const p = (xs: number[]) => `p50 ${ms(pct(xs, 50))} / p95 ${ms(pct(xs, 95))} / p99 ${ms(pct(xs, 99))} ms`;
const line = HTTP
  ? `${runId} ${sha}: HTTP, ${WRITERS} writers, server Prisma pool connection_limit=${SERVER_POOL}, ${LOTS} lots, ${SECONDS} s + soft close: ${rows} ledger rows in ${elapsedS.toFixed(1)} s = ` +
    `${(rows / elapsedS).toFixed(0)} bids/s; HTTP round trip ${p(bidMs)}; max lock wait ${ms(maxLockWaitMs)} ms; ${timeouts} timeouts (503); ${hw}`
  : `${runId} ${sha}: lock=${LOCK}, ${WRITERS} writers, ${CONNECTIONS} connections, ${LOTS} lots, ${SECONDS} s + soft close: ${rows} ledger rows in ${elapsedS.toFixed(1)} s = ` +
    `${(rows / elapsedS).toFixed(0)} bids/s; placeBid ${p(bidMs)}; end to end ${p(totalMs)}; max lock wait ${ms(maxLockWaitMs)} ms; ${timeouts} timeouts; ${judgementsPerRow} judgements per row; ${hw}`;
// HTTP mode puts the latest in-process line beside it (task 3.7: same hardware, the two numbers together).
const inProcessLine = HTTP && existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter((l) => /^`\d{4}-.* writers, \d+ connections, /.test(l)).at(-1) : undefined;
// ...and the latest earlier HTTP line, so a pool-size change reads against the run before it (task 4.1, D-54 c).
const httpLine = HTTP && existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter((l) => /^`\d{4}-.* HTTP, /.test(l)).at(-1) : undefined;

const report = [
  `## ${runId} — \`${sha}\``,
  '',
  `\`${line}\``,
  '',
  `- Command: \`npm run load:bids -- ${process.argv.slice(2).join(' ')}\` → writers ${WRITERS}, lots ${LOTS}, seconds ${SECONDS}, ${HTTP ? `against \`npm run e2e:server\` (production build, same .env.test database)` : `connections ${CONNECTIONS}`}; soft-close window ${WINDOW_S} s, cap ${CAP_S} s, start ${START_CENTS} cents, no reserve.`,
  `- Ledger rows: ${rows} (N attempts, N rows; timeouts resent with the same key: ${timeouts}; writer failures: ${failed.length}).`,
  ...(HTTP ? [] : [`- Lock strategy: ${LOCK}; judgements ${variant.stats.judgements} for ${rows} ledger rows (${judgementsPerRow} per row); ${LOCK === 'serializable' ? '40001 retries' : LOCK === 'version' ? 'version conflicts (guarded UPDATE matched 0 rows)' : 'conflicts'} ${variant.stats.conflicts}${variant.stats.seqCollisions === undefined ? '' : `; seq-index 23505 retries ${variant.stats.seqCollisions}`}.`]),
  `- Outcomes: ${[...outcomes.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ')}.`,
  `- Bids per second: ${(rows / elapsedS).toFixed(1)} over ${elapsedS.toFixed(2)} s from the first attempt's start to the last attempt's end.`,
  ...(HTTP
    ? [
        `- Latency is the HTTP round trip of POST /api/lots/[id]/bids (session cookie → requireUser → placeBid under the lock → JSON), one keep-alive socket per writer, the server's Prisma pool capped at connection_limit=${SERVER_POOL}: ${p(bidMs)}, max ${ms(Math.max(...bidMs))} ms, n = ${bidMs.length}.`,
        `- Beside it, the latest in-process line (same hardware, no HTTP): ${inProcessLine ?? 'none in this file'}`,
        `- Beside it, the latest earlier HTTP line: ${httpLine ?? 'none in this file'}`,
      ]
    : [
        `- Latency around \`placeBid\` with a connection in hand (same process as the server code; no HTTP): p50 ${ms(pct(bidMs, 50))} ms, p95 ${ms(pct(bidMs, 95))} ms, p99 ${ms(pct(bidMs, 99))} ms, max ${ms(Math.max(...bidMs))} ms, n = ${bidMs.length}.`,
        `- Latency end to end including the wait for one of the ${CONNECTIONS} pooled connections: p50 ${ms(pct(totalMs, 50))} ms, p95 ${ms(pct(totalMs, 95))} ms, p99 ${ms(pct(totalMs, 99))} ms.`,
      ]),
  `- Max lock wait seen: ${ms(maxLockWaitMs)} ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).`,
  `- Per lot (bidCount / acceptedCount / price cents / extensions): ${states.map((s) => `${s.bidCount}/${s.acceptedCount}/${s.priceCents}/${s.extensionCount}`).join(', ')}; settled ${closed.settled}.`,
  `- Hardware: ${os.cpus()[0]!.model}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM; Node ${process.version}; ${pg}; git ${sha}; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=${SERVER_POOL}).`,
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
