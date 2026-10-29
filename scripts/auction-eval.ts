// auction:eval, engine half (task 1.6): replay fixtures/submissions.jsonl through the pure engine per lot in
// arrival order, settle every lot as of --as-of (default: one hour after the last hard close, the oracle's
// default), and diff the result against fixtures/expected_bids.csv and expected_lots.csv column for column.
// Prints the brief §10 table and the rules hash; exits 1 naming the first differing row and column.
// Column order is tools/reference_replay.py's. Then the database half (task 1.9): the same submissions through
// placeBid with a scripted clock, auction:close, and the same diff over the tables. The only reader of an expected file (CLAUDE.md rule 10).
import { readFileSync } from 'node:fs';
import { type Lot, type LotState, type Settlement, type Submission, replay, reserveMet, settle, fold, hardCloseMs, openState } from '../src/auction/engine/engine';
import { loadRules } from '../src/auction/load-rules';

const FIXTURES = 'fixtures';
const BID_COLS = 'submission_id,lot_id,seq,bidder_id,max_cents,placed_at_ms,idempotency_key,row_written,outcome,accepted,price_before_cents,price_after_cents,leader_before,leader_after,closes_before_ms,closes_after_ms,extended';
const LOT_COLS = 'lot_id,auction_id,kind,start_cents,reserve_cents,scheduled_end_ms,hard_close_ms,bid_count,accepted_count,rejected_count,replays,mismatches,price_cents,leader,leader_max_cents,leader_seq,reserve_met,closes_at_ms,extension_count,extension_total_ms,outcome,winner,winning_seq,hammer_cents,premium_cents,total_cents';

type Cell = string | number | boolean | null;
const cell = (v: Cell): string => (v === null ? '' : typeof v === 'boolean' ? String(v) : String(v));
const line = (cells: Cell[]) => cells.map(cell).join(',');

type AuctionsJson = {
  seed: number;
  bidders: { bidder_id: string; email: string; name: string; paddle: number }[];
  auctions: {
    auction_id: string;
    name: string;
    opens_at_ms: number;
    soft_close_window_seconds: number;
    max_extension_seconds: number;
    buyer_premium_bps: number;
    lots: { lot_id: string; kind: string; lot_number: number; title: string; start_cents: number; reserve_cents: number | null; opens_at_ms: number; scheduled_end_ms: number; withdrawn_at_ms?: number }[];
  }[];
};

type FixtureLot = { lot_id: string; auction_id: string; kind: string; lot_number: number; title: string; lot: Lot };
type FileSub = { submission_id: string; lot_id: string; bidder_id: string; max_cents: number; placed_at_ms: number; idempotency_key: string };

function loadFixtures(asOfArg?: number) {
  const data: AuctionsJson = JSON.parse(readFileSync(`${FIXTURES}/auctions.json`, 'utf8'));
  const lots: FixtureLot[] = data.auctions
    .flatMap((a) => a.lots.map((l) => ({ lot_id: l.lot_id, auction_id: a.auction_id, kind: l.kind, lot_number: l.lot_number, title: l.title, lot: {
      startCents: l.start_cents, reserveCents: l.reserve_cents, opensAtMs: l.opens_at_ms, scheduledEndMs: l.scheduled_end_ms,
      softCloseWindowMs: a.soft_close_window_seconds * 1000, maxExtensionMs: a.max_extension_seconds * 1000, buyerPremiumBps: a.buyer_premium_bps,
      withdrawnAtMs: l.withdrawn_at_ms ?? null, // D-73: the WITHDRAWN lots carry the instant; every other lot has no key
    } as Lot })))
    .sort((a, b) => (a.lot_id < b.lot_id ? -1 : 1));
  const fileOrder: FileSub[] = readFileSync(`${FIXTURES}/submissions.jsonl`, 'utf8').trim().split('\n').map((raw) => JSON.parse(raw));
  const subs = new Map<string, FileSub[]>();
  for (const s of fileOrder) (subs.get(s.lot_id) ?? subs.set(s.lot_id, []).get(s.lot_id)!).push(s);
  const asOf = asOfArg ?? Math.max(...lots.map((l) => hardCloseMs(l.lot))) + 3_600_000;
  return { data, lots, fileOrder, subs, asOf };
}

/** One lot's outcome, with bidder ids already mapped to fixture ids; both halves produce these. */
type LotResult = { f: FixtureLot; state: LotState; bidLines: string[]; outcomes: string[]; st: Settlement | null };

/** The engine half (task 1.6): replay per lot in arrival order, settle as of asOf. */
export function run(asOfArg?: number): { ok: boolean; report: string } {
  const { rules, hash } = loadRules();
  const { data, lots, subs, asOf } = loadFixtures(asOfArg);
  const results: LotResult[] = [];
  for (const f of lots) {
    const list: Submission[] = (subs.get(f.lot_id) ?? []).map((s) => ({ submissionId: s.submission_id, bidderId: s.bidder_id, maxCents: s.max_cents, placedAtMs: s.placed_at_ms, idempotencyKey: s.idempotency_key }));
    const { state, rows, outcomes: outs } = replay(f.lot, list, rules);
    const folded = fold(f.lot, rows, rules);
    if (JSON.stringify(folded) !== JSON.stringify(state)) return { ok: false, report: `${f.lot_id}: fold != replay state\n${JSON.stringify(folded)}\n${JSON.stringify(state)}` };
    const bidLines = list.map((s, i) => {
      const o = outs[i]!;
      const r = o.row;
      return line([s.submissionId, f.lot_id, o.seq, s.bidderId, s.maxCents, s.placedAtMs, s.idempotencyKey, r !== null, o.outcome, r?.accepted ?? false,
        r ? r.priceBefore : null, o.priceAfter, r ? r.leaderBefore : null, o.leaderAfter, r ? r.closesBeforeMs : null, o.closesAfterMs, r?.extended ?? false]);
    });
    results.push({ f, state, bidLines, outcomes: outs.map((o) => o.outcome), st: settle(f.lot, state, asOf) });
  }
  return report('engine', data, hash, asOf, results);
}

/**
 * The database half (task 1.9): truncate the Gavel tables, load the fixtures as one house, drive every submission
 * through placeBid in file order with the clock pinned to its placed_at_ms, auction:close as of asOf, then read
 * the Bid, LotState and Settlement tables back and diff them as the engine half does. Run against .env.test.
 */
export async function runDb(asOfArg?: number): Promise<{ ok: boolean; report: string }> {
  const { db } = await import('../src/core/db');
  const { placeBid, prismaTx } = await import('../src/auction/place-bid');
  const { closeLots } = await import('../src/auction/close');
  const { withdrawLot } = await import('../src/auction/withdraw');
  const { loadLot } = await import('../src/auction/verify-sql');
  const { BidError } = await import('../src/auction/errors');
  const { rules, hash } = loadRules();
  const { data, lots, fileOrder, subs, asOf } = loadFixtures(asOfArg);
  const q = prismaTx(db as unknown as Parameters<typeof prismaTx>[0]);

  await db.$executeRawUnsafe('TRUNCATE "ConsignmentContract", "Consignor", "Settlement", "Bid", "LotWithdrawal", "LotState", "Lot", "Auction", "BidderStatusChange", "TermsAcceptance", "AuctionTerms", "Bidder"');
  const org = await db.org.upsert({ where: { slug: 'gavel-fixtures' }, update: {}, create: { slug: 'gavel-fixtures', name: 'Gavel fixtures (synthetic)' } });
  const bidderUuid = new Map<string, string>();
  const fid = new Map<string, string>(); // uuid → fixture bidder id
  const asFid = (id: string | null) => (id === null ? null : fid.get(id)!);
  for (const b of data.bidders) {
    const user = await db.user.upsert({ where: { email: b.email }, update: {}, create: { email: b.email, name: b.name } });
    const row = await db.bidder.create({ data: { orgId: org.id, userId: user.id, paddle: b.paddle } });
    bidderUuid.set(b.bidder_id, row.id);
    fid.set(row.id, b.bidder_id);
  }
  const lotUuid = new Map<string, string>();
  for (const a of data.auctions) {
    const auction = await db.auction.create({ data: { orgId: org.id, name: a.name, softCloseWindowSeconds: a.soft_close_window_seconds, maxExtensionSeconds: a.max_extension_seconds, buyerPremiumBps: a.buyer_premium_bps, opensAt: new Date(a.opens_at_ms) } });
    for (const l of a.lots) {
      const s = openState(lots.find((x) => x.lot_id === l.lot_id)!.lot);
      const row = await db.lot.create({ data: {
        orgId: org.id, auctionId: auction.id, number: l.lot_number, title: l.title, startCents: l.start_cents, reserveCents: l.reserve_cents, scheduledEnd: new Date(l.scheduled_end_ms),
        state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: s.bidCount, acceptedCount: s.acceptedCount, closesAt: new Date(s.closesAtMs), extensionCount: s.extensionCount } },
      } });
      lotUuid.set(l.lot_id, row.id);
    }
  }

  // Drive. A not-written outcome (REPLAY, IDEMPOTENCY_MISMATCH) reports the projection as it stood after the call.
  // D-73: a WITHDRAWN lot is withdrawn through the staff path with the clock pinned to its withdrawn_at_ms, just before
  // the first submission at or after that instant (the oracle's half-open rule), or after the file when none follows.
  const STAFF = '00000000-0000-4000-8000-000000000073'; // byUserId carries no FK
  const withdrawn = new Set<string>();
  const withdraw = async (f: FixtureLot) => {
    withdrawn.add(f.lot_id);
    await withdrawLot({ orgId: org.id, lotId: lotUuid.get(f.lot_id)!, reason: `fixture kind ${f.kind}`, userId: STAFF }, { now: () => new Date(f.lot.withdrawnAtMs!) });
  };
  const seen = new Map<string, { outcome: string; seq: number | null; written: boolean; price: number; leader: string | null; closesMs: number }>();
  for (const s of fileOrder) {
    const lotId = lotUuid.get(s.lot_id)!;
    const f = lots.find((x) => x.lot_id === s.lot_id)!;
    if (f.lot.withdrawnAtMs !== null && !withdrawn.has(f.lot_id) && f.lot.withdrawnAtMs <= s.placed_at_ms) await withdraw(f);
    let r: Awaited<ReturnType<typeof placeBid>> | null = null;
    try {
      r = await placeBid({ orgId: org.id, lotId, bidderId: bidderUuid.get(s.bidder_id)!, maxCents: s.max_cents, idempotencyKey: s.idempotency_key }, { now: () => new Date(s.placed_at_ms), rules });
    } catch (e) {
      if (!(e instanceof BidError) || e.code !== 'IDEMPOTENCY_MISMATCH') throw e;
    }
    const st = await db.lotState.findUniqueOrThrow({ where: { lotId } });
    seen.set(s.submission_id, { outcome: r === null ? 'IDEMPOTENCY_MISMATCH' : r.replayed ? 'REPLAY' : r.outcome, seq: r?.seq ?? null, written: r !== null && !r.replayed,
      price: st.priceCents, leader: asFid(st.leaderBidderId), closesMs: st.closesAt.getTime() });
  }
  for (const f of lots) if (f.lot.withdrawnAtMs !== null && !withdrawn.has(f.lot_id)) await withdraw(f);
  await closeLots(new Date(asOf), q, { rules, hash });

  // Read back: the Bid table row by row, LotState and Settlement per lot.
  const results: LotResult[] = [];
  for (const f of lots) {
    const id = lotUuid.get(f.lot_id)!;
    const loaded = await loadLot(q, id);
    const bids = new Map((await db.bid.findMany({ where: { lotId: id } })).map((b) => [b.seq, b]));
    const list = subs.get(f.lot_id) ?? [];
    const bidLines = list.map((s) => {
      const x = seen.get(s.submission_id)!;
      const b = x.written ? bids.get(x.seq!)! : null;
      if (b) {
        return line([s.submission_id, f.lot_id, b.seq, asFid(b.bidderId), b.maxCents, b.placedAt.getTime(), b.idempotencyKey, true, b.outcome, b.accepted,
          b.priceBeforeCents, b.priceAfterCents, asFid(b.leaderBeforeId), asFid(b.leaderAfterId), b.closesAtBefore.getTime(), b.closesAtAfter.getTime(), b.extended]);
      }
      return line([s.submission_id, f.lot_id, x.seq, s.bidder_id, s.max_cents, s.placed_at_ms, s.idempotency_key, false, x.outcome, false, null, x.price, null, x.leader, null, x.closesMs, false]);
    });
    if (bids.size !== list.filter((s) => seen.get(s.submission_id)!.written).length) return { ok: false, report: `${f.lot_id}: ${bids.size} Bid rows, ${list.length} submissions` };
    const st = loaded.settlement && { ...loaded.settlement, winner: asFid(loaded.settlement.winner) };
    results.push({ f, state: { ...loaded.state!, leader: asFid(loaded.state!.leader) }, bidLines, outcomes: list.map((s) => seen.get(s.submission_id)!.outcome), st });
  }
  return report('database', data, hash, asOf, results);
}

/** The brief §10 table and the column-for-column diff, shared by both halves. */
function report(half: string, data: AuctionsJson, hash: string, asOf: number, results: LotResult[]): { ok: boolean; report: string } {
  const bidLines = [BID_COLS];
  const lotLines = [LOT_COLS];
  const outcomes = new Map<string, number>();
  const kinds = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const lotRows: { lot_id: string; auction_id: string; kind: string; bid_count: number; accepted_count: number; price_cents: number; leader: string | null; extension_count: number; extension_total_ms: number; at_cap: boolean; outcome: string; hammer: number; premium: number; total: number }[] = [];

  for (const { f, state, bidLines: bl, outcomes: outs, st } of results) {
    bidLines.push(...bl);
    outs.forEach((o) => bump(outcomes, o));
    if (!st) return { ok: false, report: `${f.lot_id}: still open at as_of ${asOf}` };
    bump(kinds, `${f.kind}/${st.outcome}`);
    const ext = state.closesAtMs - f.lot.scheduledEndMs;
    lotLines.push(line([f.lot_id, f.auction_id, f.kind, f.lot.startCents, f.lot.reserveCents, f.lot.scheduledEndMs, hardCloseMs(f.lot), state.bidCount, state.acceptedCount,
      state.bidCount - state.acceptedCount, outs.filter((o) => o === 'REPLAY').length, outs.filter((o) => o === 'IDEMPOTENCY_MISMATCH').length,
      state.priceCents, state.leader, state.leaderMaxCents, state.leaderSeq, reserveMet(f.lot, state), state.closesAtMs, state.extensionCount, ext,
      st.outcome, st.winner, st.winningSeq, st.hammerCents, st.premiumCents, st.totalCents]));
    lotRows.push({ lot_id: f.lot_id, auction_id: f.auction_id, kind: f.kind, bid_count: state.bidCount, accepted_count: state.acceptedCount, price_cents: state.priceCents, leader: state.leader,
      extension_count: state.extensionCount, extension_total_ms: ext, at_cap: state.closesAtMs === hardCloseMs(f.lot), outcome: st.outcome, hammer: st.hammerCents, premium: st.premiumCents, total: st.totalCents });
  }

  // The brief §10 table, in the oracle's shape so the two outputs diff cleanly.
  const sold = lotRows.filter((r) => r.outcome === 'SOLD');
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const sorted = (m: Map<string, number>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const extLots = lotRows.filter((r) => r.extension_count > 0);
  const out = [
    `Gavel auction:eval (${half}) — seed ${data.seed}, rules sha256 ${hash}, as_of ${asOf}`,
    `lots ${results.length}  bidders ${data.bidders.length}  submissions ${bidLines.length - 1}  rows written ${sum(lotRows.map((r) => r.bid_count))}`,
    'outcomes: ' + sorted(outcomes).map(([k, v]) => `${k} ${v}`).join(', '),
    `settlement: SOLD ${sold.length}  UNSOLD_NO_BIDS ${lotRows.filter((r) => r.outcome === 'UNSOLD_NO_BIDS').length}  UNSOLD_RESERVE_NOT_MET ${lotRows.filter((r) => r.outcome === 'UNSOLD_RESERVE_NOT_MET').length}  UNSOLD_WITHDRAWN ${lotRows.filter((r) => r.outcome === 'UNSOLD_WITHDRAWN').length}`,
    `hammer total ${sum(sold.map((r) => r.hammer))} cents  premium total ${sum(sold.map((r) => r.premium))} cents  grand total ${sum(sold.map((r) => r.total))} cents`,
    `extended lots ${extLots.length}  extensions ${sum(lotRows.map((r) => r.extension_count))}  at hard cap ${lotRows.filter((r) => r.at_cap).length}  max extension ${Math.floor(Math.max(0, ...lotRows.map((r) => r.extension_total_ms)) / 1000)} s`,
    'kind -> outcome: ' + sorted(kinds).map(([k, v]) => `${k} ${v}`).join(', '),
    ...lotRows.map((r) => `  ${r.lot_id} ${r.auction_id} ${r.kind.padEnd(16)} bids ${String(r.bid_count).padStart(3)} acc ${String(r.accepted_count).padStart(3)} price ${String(r.price_cents).padStart(8)} leader ${(r.leader ?? '-').padEnd(5)} ext ${String(r.extension_count).padStart(2)} (${String(Math.floor(r.extension_total_ms / 1000)).padStart(4)} s) ${r.outcome.padEnd(22)} total ${r.total}`),
  ];

  // Column-for-column diff against the frozen expected files.
  const diff = (name: string, actual: string[]): string | null => {
    const expected = readFileSync(`${FIXTURES}/${name}`, 'utf8').trimEnd().split('\n');
    const cols = (expected[0] ?? '').split(',');
    if (actual.length !== expected.length) return `${name}: ${actual.length} lines, expected ${expected.length}`;
    for (let i = 0; i < expected.length; i++) {
      if (actual[i] === expected[i]) continue;
      const a = (actual[i] ?? '').split(',');
      const e = (expected[i] ?? '').split(',');
      const c = cols.findIndex((_, j) => a[j] !== e[j]);
      return `${name} line ${i + 1} (${e[0]}) column ${cols[c] ?? c}: got ${JSON.stringify(a[c])}, expected ${JSON.stringify(e[c])}`;
    }
    return null;
  };
  const problem = diff('expected_bids.csv', bidLines) ?? diff('expected_lots.csv', lotLines);
  out.push(problem ? `DIFF: ${problem}` : `OK: expected_bids.csv (${bidLines.length - 1} rows) and expected_lots.csv (${lotLines.length - 1} rows) reproduced column for column`);
  return { ok: problem === null, report: out.join('\n') };
}

if (process.argv[1]?.endsWith('auction-eval.ts')) {
  const i = process.argv.indexOf('--as-of');
  const asOf = i > 0 ? Number(process.argv[i + 1]) : undefined;
  const engine = run(asOf);
  console.log(engine.report);
  const database = engine.ok ? await runDb(asOf) : { ok: false, report: 'database half skipped: the engine half differs' };
  console.log(`\n${database.report}`);
  await (await import('../src/core/db')).db.$disconnect();
  process.exit(engine.ok && database.ok ? 0 : 1);
}
