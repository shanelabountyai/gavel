// auction:eval, engine half (task 1.6): replay fixtures/submissions.jsonl through the pure engine per lot in
// arrival order, settle every lot as of --as-of (default: one hour after the last hard close, the oracle's
// default), and diff the result against fixtures/expected_bids.csv and expected_lots.csv column for column.
// Prints the brief §10 table and the rules hash; exits 1 naming the first differing row and column.
// Column order is tools/reference_replay.py's; the values are the TypeScript engine's. The database half
// (placeBid with a scripted clock) is task 1.9. The only reader of an expected file (CLAUDE.md rule 10).
import { readFileSync } from 'node:fs';
import { type Lot, type Submission, replay, reserveMet, settle, fold, hardCloseMs } from '../src/auction/engine/engine';
import { loadRules } from '../src/auction/load-rules';

const FIXTURES = 'fixtures';
const BID_COLS = 'submission_id,lot_id,seq,bidder_id,max_cents,placed_at_ms,idempotency_key,row_written,outcome,accepted,price_before_cents,price_after_cents,leader_before,leader_after,closes_before_ms,closes_after_ms,extended';
const LOT_COLS = 'lot_id,auction_id,kind,start_cents,reserve_cents,scheduled_end_ms,hard_close_ms,bid_count,accepted_count,rejected_count,replays,mismatches,price_cents,leader,leader_max_cents,leader_seq,reserve_met,closes_at_ms,extension_count,extension_total_ms,outcome,winner,winning_seq,hammer_cents,premium_cents,total_cents';

type Cell = string | number | boolean | null;
const cell = (v: Cell): string => (v === null ? '' : typeof v === 'boolean' ? String(v) : String(v));
const line = (cells: Cell[]) => cells.map(cell).join(',');

type AuctionsJson = {
  seed: number;
  bidders: unknown[];
  auctions: {
    auction_id: string;
    soft_close_window_seconds: number;
    max_extension_seconds: number;
    buyer_premium_bps: number;
    lots: { lot_id: string; kind: string; start_cents: number; reserve_cents: number | null; opens_at_ms: number; scheduled_end_ms: number }[];
  }[];
};

export function run(asOfArg?: number): { ok: boolean; report: string } {
  const { rules, hash } = loadRules();
  const data: AuctionsJson = JSON.parse(readFileSync(`${FIXTURES}/auctions.json`, 'utf8'));
  const lots = data.auctions
    .flatMap((a) => a.lots.map((l) => ({ ...l, auction_id: a.auction_id, lot: {
      startCents: l.start_cents, reserveCents: l.reserve_cents, opensAtMs: l.opens_at_ms, scheduledEndMs: l.scheduled_end_ms,
      softCloseWindowMs: a.soft_close_window_seconds * 1000, maxExtensionMs: a.max_extension_seconds * 1000, buyerPremiumBps: a.buyer_premium_bps,
    } as Lot })))
    .sort((a, b) => (a.lot_id < b.lot_id ? -1 : 1));
  const subs = new Map<string, Submission[]>();
  for (const raw of readFileSync(`${FIXTURES}/submissions.jsonl`, 'utf8').trim().split('\n')) {
    const s = JSON.parse(raw);
    const sub: Submission = { submissionId: s.submission_id, bidderId: s.bidder_id, maxCents: s.max_cents, placedAtMs: s.placed_at_ms, idempotencyKey: s.idempotency_key };
    (subs.get(s.lot_id) ?? subs.set(s.lot_id, []).get(s.lot_id)!).push(sub);
  }
  const asOf = asOfArg ?? Math.max(...lots.map((l) => hardCloseMs(l.lot))) + 3_600_000;

  const bidLines = [BID_COLS];
  const lotLines = [LOT_COLS];
  const outcomes = new Map<string, number>();
  const kinds = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const lotRows: { lot_id: string; auction_id: string; kind: string; bid_count: number; accepted_count: number; price_cents: number; leader: string | null; extension_count: number; extension_total_ms: number; at_cap: boolean; outcome: string; hammer: number; premium: number; total: number }[] = [];

  for (const l of lots) {
    const list = subs.get(l.lot_id) ?? [];
    const { state, rows, outcomes: outs } = replay(l.lot, list, rules);
    const folded = fold(l.lot, rows, rules);
    if (JSON.stringify(folded) !== JSON.stringify(state)) return { ok: false, report: `${l.lot_id}: fold != replay state\n${JSON.stringify(folded)}\n${JSON.stringify(state)}` };
    list.forEach((s, i) => {
      const o = outs[i]!;
      const r = o.row;
      bump(outcomes, o.outcome);
      bidLines.push(line([s.submissionId, l.lot_id, o.seq, s.bidderId, s.maxCents, s.placedAtMs, s.idempotencyKey, r !== null, o.outcome, r?.accepted ?? false,
        r ? r.priceBefore : null, o.priceAfter, r ? r.leaderBefore : null, o.leaderAfter, r ? r.closesBeforeMs : null, o.closesAfterMs, r?.extended ?? false]));
    });
    const st = settle(l.lot, state, asOf);
    if (!st) return { ok: false, report: `${l.lot_id}: still open at as_of ${asOf}` };
    bump(kinds, `${l.kind}/${st.outcome}`);
    const ext = state.closesAtMs - l.lot.scheduledEndMs;
    lotLines.push(line([l.lot_id, l.auction_id, l.kind, l.lot.startCents, l.lot.reserveCents, l.lot.scheduledEndMs, hardCloseMs(l.lot), state.bidCount, state.acceptedCount,
      state.bidCount - state.acceptedCount, outs.filter((o) => o.outcome === 'REPLAY').length, outs.filter((o) => o.outcome === 'IDEMPOTENCY_MISMATCH').length,
      state.priceCents, state.leader, state.leaderMaxCents, state.leaderSeq, reserveMet(l.lot, state), state.closesAtMs, state.extensionCount, ext,
      st.outcome, st.winner, st.winningSeq, st.hammerCents, st.premiumCents, st.totalCents]));
    lotRows.push({ lot_id: l.lot_id, auction_id: l.auction_id, kind: l.kind, bid_count: state.bidCount, accepted_count: state.acceptedCount, price_cents: state.priceCents, leader: state.leader,
      extension_count: state.extensionCount, extension_total_ms: ext, at_cap: state.closesAtMs === hardCloseMs(l.lot), outcome: st.outcome, hammer: st.hammerCents, premium: st.premiumCents, total: st.totalCents });
  }

  // The brief §10 table, in the oracle's shape so the two outputs diff cleanly.
  const sold = lotRows.filter((r) => r.outcome === 'SOLD');
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const sorted = (m: Map<string, number>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const extLots = lotRows.filter((r) => r.extension_count > 0);
  const out = [
    `Gavel auction:eval (engine) — seed ${data.seed}, rules sha256 ${hash}, as_of ${asOf}`,
    `lots ${lots.length}  bidders ${data.bidders.length}  submissions ${bidLines.length - 1}  rows written ${sum(lotRows.map((r) => r.bid_count))}`,
    'outcomes: ' + sorted(outcomes).map(([k, v]) => `${k} ${v}`).join(', '),
    `settlement: SOLD ${sold.length}  UNSOLD_NO_BIDS ${lotRows.filter((r) => r.outcome === 'UNSOLD_NO_BIDS').length}  UNSOLD_RESERVE_NOT_MET ${lotRows.filter((r) => r.outcome === 'UNSOLD_RESERVE_NOT_MET').length}`,
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
  const { ok, report } = run(i > 0 ? Number(process.argv[i + 1]) : undefined);
  console.log(report);
  process.exit(ok ? 0 : 1);
}
