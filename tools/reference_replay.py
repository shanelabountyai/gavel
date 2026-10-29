"""Gavel — reference replay (test oracle, never product code).

Runs every submission in fixtures/submissions.jsonl through tools/auctionlib.py in arrival order,
per lot, then settles every lot as of --as-of (default: one hour after the last hard close). Prints
the brief section 10 table. With --write-expected it also writes fixtures/expected_bids.csv and
fixtures/expected_lots.csv, which `npm run auction:eval` must reproduce column for column.

Usage: python3 tools/reference_replay.py [--fixtures DIR] [--write-expected] [--as-of MS]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from auctionlib import Lot, Rules, Submission, fold, replay, settle  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

BID_COLS = ["submission_id", "lot_id", "seq", "bidder_id", "max_cents", "placed_at_ms", "idempotency_key", "row_written",
            "outcome", "accepted", "price_before_cents", "price_after_cents", "leader_before", "leader_after",
            "closes_before_ms", "closes_after_ms", "extended"]
LOT_COLS = ["lot_id", "auction_id", "kind", "start_cents", "reserve_cents", "scheduled_end_ms", "hard_close_ms", "bid_count",
            "accepted_count", "rejected_count", "replays", "mismatches", "price_cents", "leader", "leader_max_cents", "leader_seq",
            "reserve_met", "closes_at_ms", "extension_count", "extension_total_ms", "outcome", "winner", "winning_seq",
            "hammer_cents", "premium_cents", "total_cents"]


def load(fixtures: str):
    data = json.load(open(os.path.join(fixtures, "auctions.json"), encoding="utf-8"))
    lots = {}
    for a in data["auctions"]:
        for l in a["lots"]:
            lots[l["lot_id"]] = (Lot(l["lot_id"], a["auction_id"], l["start_cents"], l["reserve_cents"], l["opens_at_ms"], l["scheduled_end_ms"],
                                     a["soft_close_window_seconds"] * 1000, a["max_extension_seconds"] * 1000, a["buyer_premium_bps"],
                                     l.get("withdrawn_at_ms")), l)
    subs = defaultdict(list)
    with open(os.path.join(fixtures, "submissions.jsonl"), encoding="utf-8") as f:
        for line in f:
            s = json.loads(line)
            subs[s["lot_id"]].append(Submission(s["submission_id"], s["lot_id"], s["bidder_id"], s["max_cents"], s["placed_at_ms"], s["idempotency_key"]))
    return data, lots, subs


def b(v) -> str:
    return "true" if v else "false"


def n(v) -> str:
    return "" if v is None else str(v)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default=os.path.join(ROOT, "fixtures"))
    ap.add_argument("--write-expected", action="store_true")
    ap.add_argument("--as-of", type=int, default=None)
    args = ap.parse_args()
    rules = Rules.load()
    data, lots, subs = load(args.fixtures)
    as_of = args.as_of if args.as_of is not None else max(l.hard_close_ms for l, _ in lots.values()) + 3600 * 1000

    bid_rows, lot_rows = [], []
    outcomes = Counter()
    kinds = Counter()
    ext_by_lot = {}
    for lot_id in sorted(lots):
        lot, meta = lots[lot_id]
        state, rows, outs = replay(lot, subs.get(lot_id, []), rules)
        folded = fold(lot, rows, rules)
        assert folded == state, f"{lot_id}: fold != replay state"
        by_sub = {r.submission_id: r for r in rows}
        for s, o in zip(subs.get(lot_id, []), outs):
            r = by_sub.get(s.submission_id)
            outcomes[o.outcome] += 1
            bid_rows.append({
                "submission_id": s.submission_id, "lot_id": lot_id, "seq": n(o.seq), "bidder_id": s.bidder, "max_cents": s.max_cents,
                "placed_at_ms": s.placed_at_ms, "idempotency_key": s.idempotency_key, "row_written": b(o.row_written), "outcome": o.outcome,
                "accepted": b(r.accepted if r else False), "price_before_cents": n(r.price_before if r else ""), "price_after_cents": o.price_after,
                "leader_before": n(r.leader_before if r else ""), "leader_after": n(o.leader_after), "closes_before_ms": n(r.closes_before_ms if r else ""),
                "closes_after_ms": o.closes_after_ms, "extended": b(o.extended)})
        st = settle(lot, state, as_of)
        assert st is not None
        kinds[(meta["kind"], st.outcome)] += 1
        ext_by_lot[lot_id] = state.closes_at_ms - lot.scheduled_end_ms
        lot_rows.append({
            "lot_id": lot_id, "auction_id": lot.auction_id, "kind": meta["kind"], "start_cents": lot.start_cents, "reserve_cents": n(lot.reserve_cents),
            "scheduled_end_ms": lot.scheduled_end_ms, "hard_close_ms": lot.hard_close_ms, "bid_count": state.bid_count, "accepted_count": state.accepted_count,
            "rejected_count": state.bid_count - state.accepted_count, "replays": sum(1 for o in outs if o.outcome == "REPLAY"),
            "mismatches": sum(1 for o in outs if o.outcome == "IDEMPOTENCY_MISMATCH"), "price_cents": state.price_cents, "leader": n(state.leader),
            "leader_max_cents": state.leader_max_cents, "leader_seq": n(state.leader_seq), "reserve_met": b(state.reserve_met(lot)),
            "closes_at_ms": state.closes_at_ms, "extension_count": state.extension_count, "extension_total_ms": state.closes_at_ms - lot.scheduled_end_ms,
            "outcome": st.outcome, "winner": n(st.winner), "winning_seq": n(st.winning_seq), "hammer_cents": st.hammer_cents,
            "premium_cents": st.premium_cents, "total_cents": st.total_cents})

    # The brief section 10 table.
    print(f"Gavel reference replay — seed {data['seed']}, rules {rules.buyer_premium_bps} bps default premium, as_of {as_of}")
    print(f"lots {len(lots)}  bidders {len(data['bidders'])}  submissions {len(bid_rows)}  rows written {sum(1 for r in bid_rows if r['row_written'] == 'true')}")
    print("outcomes: " + ", ".join(f"{k} {v}" for k, v in sorted(outcomes.items())))
    sold = [r for r in lot_rows if r["outcome"] == "SOLD"]
    print(f"settlement: SOLD {len(sold)}  UNSOLD_NO_BIDS {sum(1 for r in lot_rows if r['outcome'] == 'UNSOLD_NO_BIDS')}  "
          f"UNSOLD_RESERVE_NOT_MET {sum(1 for r in lot_rows if r['outcome'] == 'UNSOLD_RESERVE_NOT_MET')}  "
          f"UNSOLD_WITHDRAWN {sum(1 for r in lot_rows if r['outcome'] == 'UNSOLD_WITHDRAWN')}")
    print(f"hammer total {sum(r['hammer_cents'] for r in sold)} cents  premium total {sum(r['premium_cents'] for r in sold)} cents  "
          f"grand total {sum(r['total_cents'] for r in sold)} cents")
    ext = [r for r in lot_rows if r["extension_count"] > 0]
    print(f"extended lots {len(ext)}  extensions {sum(r['extension_count'] for r in lot_rows)}  "
          f"at hard cap {sum(1 for r in lot_rows if r['closes_at_ms'] == r['hard_close_ms'])}  "
          f"max extension {max(ext_by_lot.values()) // 1000} s")
    print("kind -> outcome: " + ", ".join(f"{k}/{o} {v}" for (k, o), v in sorted(kinds.items())))
    for r in lot_rows:
        print(f"  {r['lot_id']} {r['auction_id']} {r['kind']:<16} bids {r['bid_count']:>3} acc {r['accepted_count']:>3} price {r['price_cents']:>8} "
              f"leader {r['leader'] or '-':<5} ext {r['extension_count']:>2} ({r['extension_total_ms'] // 1000:>4} s) {r['outcome']:<22} total {r['total_cents']}")

    if args.write_expected:
        with open(os.path.join(args.fixtures, "expected_bids.csv"), "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=BID_COLS, lineterminator="\n")
            w.writeheader()
            w.writerows(bid_rows)
        with open(os.path.join(args.fixtures, "expected_lots.csv"), "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=LOT_COLS, lineterminator="\n")
            w.writeheader()
            w.writerows(lot_rows)
        print("wrote expected_bids.csv and expected_lots.csv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
