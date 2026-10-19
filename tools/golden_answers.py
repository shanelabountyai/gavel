"""Gavel — kickoff answer key (test oracle, never product code).

Re-derives every worked example in docs/domain-brief.md section 9 (GB goldens: increments, proxy
bidding, ties, reserve, soft close, the chain to the cap, idempotent replay, settlement and rounding)
from tools/auctionlib.py and checks each against the value worked by hand in the brief. Prints one
line per example and ends with OK, or exits 1 naming the first mismatch.

The hand-derived values are the EXPECTED column. If auctionlib disagrees, the brief and auctionlib
are out of step: fix them deliberately, never this file's expected value to make it pass.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from auctionlib import (Lot, Rules, Submission, apply_bid, fold, increment_for, min_next_bid,  # noqa: E402
                        open_state, replay, round_half_up, settle, LedgerRow)

FAILS = 0
R = Rules.load()
T = 3_600_000  # scheduled end of the golden lot, ms after open
W = 120_000
CAP = 600_000
G = Lot("G", "A", 10000, None, 0, T, W, CAP, 1500)            # start $100, no reserve
RES = Lot("R", "A", 10000, 25000, 0, T, W, CAP, 1500)        # start $100, reserve $250


def check(label: str, got, exp) -> None:
    global FAILS
    ok = got == exp
    FAILS += not ok
    print(f"{'ok ' if ok else 'BAD'} {label}: got {got!r}" + ("" if ok else f" expected {exp!r}"))


def bid(lot, state, who, m, t):
    return apply_bid(lot, state, who, m, t, R)


def main() -> int:
    print("-- GB-17 increment table (cents)")
    check("GB-17", [increment_for(p, R) for p in (0, 9999, 10000, 49999, 50000, 99999, 100000, 499999, 500000, 2499999, 2500000, 99999999)],
          [100, 100, 500, 500, 1000, 1000, 2500, 2500, 5000, 10000, 25000, 25000])

    print("-- GB-01..07 proxy bidding on one lot (start 10000, no reserve, well before the window)")
    s = open_state(G)
    check("GB-00 min_next before any bid", min_next_bid(G, s, R), 10000)
    r = bid(G, s, "A", 15000, 100_000)
    check("GB-01 first bid leads at the start price", (r.outcome, r.state.price_cents, r.state.leader, r.state.leader_max_cents, r.state.closes_at_ms, r.extended),
          ("ACCEPTED_LEAD", 10000, "A", 15000, T, False))
    s = r.state
    check("GB-01 min_next after", min_next_bid(G, s, R), 10500)
    r = bid(G, s, "B", 12000, 200_000)
    check("GB-02 under the leader's max: outbid at one increment over the bid", (r.outcome, r.state.price_cents, r.state.leader), ("ACCEPTED_OUTBID", 12500, "A"))
    s = r.state
    r = bid(G, s, "C", 20000, 300_000)
    check("GB-03 over the leader's max: new leader at old max + increment", (r.outcome, r.state.price_cents, r.state.leader, r.state.leader_seq), ("ACCEPTED_LEAD", 15500, "C", 3))
    s = r.state
    r = bid(G, s, "D", 20000, 400_000)
    check("GB-04 equal max: the earlier bid keeps the lead at the full max", (r.outcome, r.state.price_cents, r.state.leader, r.state.leader_seq), ("ACCEPTED_OUTBID", 20000, "C", 3))
    s = r.state
    r = bid(G, s, "E", 20400, 500_000)
    check("GB-05 one increment short: rejected, row still written", (r.outcome, r.accepted, r.state.bid_count, r.state.price_cents, r.min_next_before), ("REJECTED_BELOW_MINIMUM", False, 5, 20000, 20500))
    s = r.state
    r = bid(G, s, "C", 30000, 600_000)
    check("GB-06 leader raises own max: price unchanged, no extension", (r.outcome, r.state.price_cents, r.state.leader_max_cents, r.state.leader_seq, r.extended), ("ACCEPTED_RAISE", 20000, 30000, 6, False))
    s = r.state
    r = bid(G, s, "C", 30000, 700_000)
    check("GB-07 leader 'raises' to the same max: rejected", (r.outcome, r.state.bid_count), ("REJECTED_NOT_ABOVE_OWN_MAX", 7))
    s = r.state
    after_gb07 = s

    print("-- GB-15/16 settlement and rounding")
    st = settle(G, after_gb07, T)
    check("GB-15 settle: hammer = price, premium 15%, winner's latest max row", (st.outcome, st.winner, st.winning_seq, st.hammer_cents, st.premium_cents, st.total_cents, st.closed_at_ms),
          ("SOLD", "C", 6, 20000, 3000, 23000, T))
    check("GB-15 settle one ms early is None", settle(G, after_gb07, T - 1), None)
    check("GB-16 premium rounds half up once", [round_half_up(10020 * 1250, 10000), round_half_up(10010 * 1250, 10000), round_half_up(33333 * 1500, 10000), round_half_up(1, 2)],
          [1253, 1251, 5000, 1])

    print("-- GB-08/09/22 reserve")
    s = open_state(RES)
    r = bid(RES, s, "A", 20000, 100_000)
    check("GB-08a under reserve: leads at start, reserve not met", (r.outcome, r.state.price_cents, r.state.reserve_met(RES)), ("ACCEPTED_LEAD", 10000, False))
    under = r.state
    r = bid(RES, under, "B", 26000, 200_000)
    check("GB-08b clears reserve: price jumps to the reserve", (r.outcome, r.state.price_cents, r.state.leader, r.state.reserve_met(RES)), ("ACCEPTED_LEAD", 25000, "B", True))
    check("GB-08c min_next after the jump", min_next_bid(RES, r.state, R), 25500)
    st = settle(RES, under, T)
    check("GB-09 reserve not met at close: unsold, no money", (st.outcome, st.winner, st.hammer_cents, st.total_cents), ("UNSOLD_RESERVE_NOT_MET", None, 0, 0))
    r = bid(RES, open_state(RES), "A", 30000, 100_000)
    check("GB-22 first bid over the reserve: price is the reserve at once", (r.outcome, r.state.price_cents), ("ACCEPTED_LEAD", 25000))

    print("-- GB-10/11/13/14 soft close on the injected clock")
    r = bid(G, open_state(G), "A", 15000, T - 30_000)
    check("GB-10 bid inside the window extends to t + W", (r.outcome, r.extended, r.state.closes_at_ms, r.state.extension_count), ("ACCEPTED_LEAD", True, T + 90_000, 1))
    r2 = bid(G, r.state, "A", 20000, T + 80_000)
    check("GB-11 own raise inside the window does not extend", (r2.outcome, r2.extended, r2.state.closes_at_ms), ("ACCEPTED_RAISE", False, T + 90_000))
    s = bid(G, open_state(G), "A", 15000, 1_000_000).state
    r = bid(G, s, "B", 50000, T - 1_000)
    check("GB-13 snipe at T-1s: accepted, price old max + increment, close moves to T-1s+W", (r.outcome, r.state.price_cents, r.state.closes_at_ms, r.extended), ("ACCEPTED_LEAD", 15500, T + 119_000, True))
    r = bid(G, s, "B", 50000, T)
    check("GB-14a bid at exactly closes_at is closed (half-open)", (r.outcome, r.state.bid_count), ("REJECTED_LOT_CLOSED", 2))
    r = bid(G, s, "B", 50000, T - 1)
    check("GB-14b one ms before closes_at is open", r.outcome, "ACCEPTED_LEAD")
    r = bid(G, s, "B", 50000, T - W)
    check("GB-14c exactly W before close: t + W equals the close, nothing to extend", (r.extended, r.state.closes_at_ms), (False, T))
    r = bid(G, s, "B", 50000, T - W + 1)
    check("GB-14d one ms later extends by one ms", (r.extended, r.state.closes_at_ms), (True, T + 1))

    print("-- GB-12 extensions chain to the cap and stop there")
    s = open_state(G)
    closes = []
    who = ["A", "B"]
    m = 10000
    for i in range(7):
        m += 1000
        r = bid(G, s, who[i % 2], m, s.closes_at_ms - 1_000)
        s = r.state
        closes.append((r.outcome, r.extended, s.closes_at_ms))
    check("GB-12 chain", closes, [
        ("ACCEPTED_LEAD", True, 3_719_000), ("ACCEPTED_LEAD", True, 3_838_000), ("ACCEPTED_LEAD", True, 3_957_000),
        ("ACCEPTED_LEAD", True, 4_076_000), ("ACCEPTED_LEAD", True, 4_195_000), ("ACCEPTED_LEAD", True, 4_200_000),
        ("ACCEPTED_LEAD", False, 4_200_000)])
    check("GB-12 extension count stops at 6", s.extension_count, 6)
    r = bid(G, s, "A", m + 1000, 4_200_000)
    check("GB-12 bid at the hard close is closed", r.outcome, "REJECTED_LOT_CLOSED")

    print("-- GB-18 idempotent replay")
    subs = [Submission("s1", "G", "A", 15000, 100_000, "k1"), Submission("s2", "G", "A", 15000, 200_000, "k1"),
            Submission("s3", "G", "A", 16000, 300_000, "k1"), Submission("s4", "G", "B", 15000, 400_000, "k1")]
    state, rows, outs = replay(G, subs, R)
    check("GB-18 outcomes", [(o.outcome, o.row_written, o.seq) for o in outs],
          [("ACCEPTED_LEAD", True, 1), ("REPLAY", False, 1), ("IDEMPOTENCY_MISMATCH", False, None), ("ACCEPTED_OUTBID", True, 2)])
    check("GB-18 rows written, price", (len(rows), state.price_cents, state.leader), (2, 15000, "A"))

    print("-- GB-19 before open")
    L = Lot("E", "A", 10000, None, 1000, T, W, CAP, 1500)
    check("GB-19", (bid(L, open_state(L), "A", 20000, 999).outcome, bid(L, open_state(L), "A", 20000, 1000).outcome), ("REJECTED_LOT_NOT_OPEN", "ACCEPTED_LEAD"))

    print("-- GB-20 fold equals replay; a seq gap is refused")
    check("GB-20 fold == replay", fold(G, rows, R), state)
    gapped = [rows[0], LedgerRow(3, *list(vars(rows[1]).values())[1:])]
    try:
        fold(G, gapped, R)
        check("GB-20 gap", "no error", "ValueError")
    except ValueError as e:
        check("GB-20 gap", str(e), "seq gap at 3")

    print("-- GB-21 no bids")
    check("GB-21", (settle(G, open_state(G), T).outcome, settle(G, open_state(G), T - 1)), ("UNSOLD_NO_BIDS", None))

    print("-- GB-23 band crossing: the increment follows the max it is added to")
    s = bid(G, open_state(G), "A", 49800, 100_000).state
    s = bid(G, s, "B", 49800, 200_000).state
    check("GB-23a tie at 49800", (s.price_cents, s.leader), (49800, "A"))
    r = bid(G, s, "C", 60000, 300_000)
    check("GB-23b 60000 beats 49800: price 49800 + 500, next minimum + 1000", (r.state.price_cents, min_next_bid(G, r.state, R)), (50300, 51300))

    print("OK" if FAILS == 0 else f"FAIL: {FAILS}")
    return 0 if FAILS == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
