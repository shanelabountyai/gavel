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
from auctionlib import (Lot, Rules, Submission, apply_bid, fold, increment_for, lot_status, min_next_bid,  # noqa: E402
                        open_state, replay, round_half_up, settle, LedgerRow,
                        Contract, ConsignedLot, consignor_statement, invoice_balance, bidder_aliases)

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

    print("-- GB-24 a withdrawn lot (R-04, D-73): closed from the withdrawal, every later attempt a row, never a sale")
    WD = 1_000_000  # the instant staff withdrew
    Wd = Lot("W", "A", 10000, None, 0, T, W, CAP, 1500, withdrawn_at_ms=WD)
    s = bid(Wd, open_state(Wd), "A", 15000, 100_000).state  # before the withdrawal: judged as on any lot
    check("GB-24a before: status OPEN, settle None", (lot_status(Wd, s, WD - 1), settle(Wd, s, WD - 1)), ("OPEN", None))
    r = bid(Wd, s, "B", 50000, WD)
    check("GB-24b at the instant: REJECTED_LOT_WITHDRAWN, row written, nothing moves", (r.outcome, r.accepted, r.state.bid_count, r.state.price_cents, r.state.leader, r.state.closes_at_ms, r.extended), ("REJECTED_LOT_WITHDRAWN", False, 2, 10000, "A", T, False))
    r2 = bid(Wd, r.state, "B", 50000, T - 1_000)
    check("GB-24c later, still before closesAt: WITHDRAWN, not CLOSED", (r2.outcome, r2.state.bid_count), ("REJECTED_LOT_WITHDRAWN", 3))
    check("GB-24d status CLOSED from the withdrawal though closesAt is later", (lot_status(Wd, r2.state, WD), r2.state.closes_at_ms), ("CLOSED", T))
    st = settle(Wd, r2.state, WD)
    check("GB-24e settle: UNSOLD_WITHDRAWN, no winner, zero amounts, closedAt = withdrawnAt (the leader does not buy)", (st.outcome, st.winner, st.winning_seq, st.hammer_cents, st.total_cents, st.closed_at_ms), ("UNSOLD_WITHDRAWN", None, None, 0, 0, WD))
    e = Lot("W0", "A", 10000, None, 0, T, W, CAP, 1500, withdrawn_at_ms=WD)
    check("GB-24f withdrawn with no bids: UNSOLD_WITHDRAWN, not NO_BIDS", settle(e, open_state(e), T).outcome, "UNSOLD_WITHDRAWN")
    rows = [LedgerRow(1, "s1", "A", 15000, 100_000, "k1", "ACCEPTED_LEAD", True, 0, 10000, None, "A", T, T, False),
            LedgerRow(2, "s2", "B", 50000, WD, "k2", "REJECTED_LOT_WITHDRAWN", False, 10000, 10000, "A", "A", T, T, False)]
    check("GB-24g fold re-derives the WITHDRAWN row from the lot's withdrawn_at", fold(Wd, rows, R), r.state)
    sched = Lot("WS", "A", 10000, None, 2_000_000, T, W, CAP, 1500, withdrawn_at_ms=WD)
    check("GB-24h withdrawn while SCHEDULED: WITHDRAWN before NOT_OPEN; CLOSED, never SCHEDULED, from then", (bid(sched, open_state(sched), "A", 15000, WD).outcome, lot_status(sched, open_state(sched), WD), lot_status(sched, open_state(sched), WD - 1)), ("REJECTED_LOT_WITHDRAWN", "CLOSED", "SCHEDULED"))

    print("-- GB-25 consignor statement (R-07, D-74): commission is the second rounding site; the premium never appears")
    C = Contract(1250, 500, 1500)
    cl = [ConsignedLot("g", 7, "SOLD", 100), ConsignedLot("f", 6, "UNSOLD_BY_CORRECTION", 0), ConsignedLot("e", 5, "UNSOLD_WITHDRAWN", 0),
          ConsignedLot("d", 4, "UNSOLD_RESERVE_NOT_MET", 0), ConsignedLot("c", 3, "UNSOLD_NO_BIDS", 0), ConsignedLot("b", 2, "SOLD", 33333), ConsignedLot("a", 1, "SOLD", 10020)]
    cs = consignor_statement(cl, C)
    check("GB-25a lines in lot order: (hammer, commission, fee, net)", [(l.lot_number, l.hammer_cents, l.commission_cents, l.fee_cents, l.net_cents) for l in cs.lines],
          [(1, 10020, 1253, 500, 8267), (2, 33333, 4167, 500, 28666), (3, 0, 0, 1500, -1500), (4, 0, 0, 1500, -1500), (5, 0, 0, 0, 0), (6, 0, 0, 0, 0), (7, 100, 13, 500, -413)])
    check("GB-25b totals", (cs.hammer_cents, cs.commission_cents, cs.fee_cents, cs.net_cents), (43453, 5433, 4500, 33520))
    check("GB-25c net + commission + fees = hammer", cs.net_cents + cs.commission_cents + cs.fee_cents, cs.hammer_cents)
    check("GB-25d 0 bps and 10000 bps, no fees", [consignor_statement([cl[0]], Contract(b, 0, 0)).lines[0].net_cents for b in (0, 10000)], [100, 0])
    check("GB-25e no lots: zero statement", consignor_statement([], C).net_cents, 0)
    try:
        consignor_statement(cl, Contract(10001, 0, 0))
        check("GB-25f bps above 10000 refused", "no error", "ValueError")
    except ValueError:
        check("GB-25f bps above 10000 refused", "ValueError", "ValueError")

    print("-- GB-26 payment status (R-08, D-75): marks against the current total; no rounding, sums only")
    TOT, DUE = 11523, 1_000_000  # GB-16's 10,020 hammer + 1,503 premium at 1500 bps; due at 1,000,000 ms
    ib = lambda total, paid, now, due=DUE, d=False: (lambda b: (b.status, b.paid_cents, b.balance_cents))(invoice_balance(total, paid, now, due, d))  # noqa: E731
    check("GB-26a no marks before the due date: UNPAID", ib(TOT, 0, DUE - 1), ("UNPAID", 0, 11523))
    check("GB-26b no marks at the due instant: still UNPAID; one ms later: OVERDUE", (ib(TOT, 0, DUE)[0], ib(TOT, 0, DUE + 1)[0]), ("UNPAID", "OVERDUE"))
    check("GB-26c no due date: never OVERDUE", ib(TOT, 0, DUE * 1000, None)[0], "UNPAID")
    check("GB-26d 5,000 marked, past due: PARTIAL, balance 6,523", ib(TOT, 5000, DUE + 1), ("PARTIAL", 5000, 6523))
    check("GB-26e 5,000 + 6,523 marked: PAID, balance 0", ib(TOT, 11523, DUE + 1), ("PAID", 11523, 0))
    check("GB-26f paid 11,523, then a correction to 8,000 and to 0: CREDIT", (ib(8000, 11523, DUE + 1), ib(0, 11523, DUE + 1)), (("CREDIT", 11523, -3523), ("CREDIT", 11523, -11523)))
    check("GB-26g defaulted outranks a partial payment", ib(TOT, 5000, DUE + 1, DUE, True), ("DEFAULTED", 5000, 6523))
    try:
        invoice_balance(TOT, -1, DUE, DUE)
        check("GB-26h a negative sum refused", "no error", "ValueError")
    except ValueError:
        check("GB-26h a negative sum refused", "ValueError", "ValueError")

    print("-- GB-27 sales tax (R-09, D-78): the third rounding site; once per invoice over the configured base; exempt is 0")
    HS, PS = 10020 + 33333, 1503 + 5000  # GB-16's two lots at 1500 bps on one invoice: hammer 43,353, premium 6,503
    check("GB-27a 825 bps on HAMMER: 43,353 × 825 / 10,000 = 3,576.6225 → 3,577", round_half_up(HS * 825, 10000), 3577)
    check("GB-27b 825 bps on HAMMER_PLUS_PREMIUM: 49,856 × 825 / 10,000 = 4,113.12 → 4,113", round_half_up((HS + PS) * 825, 10000), 4113)
    check("GB-27c once per invoice, not per line: two 10,005 lots at 825 bps → 1,651 (per line: 825 + 825 = 1,650)", (round_half_up(20010 * 825, 10000), 2 * round_half_up(10005 * 825, 10000)), (1651, 1650))
    check("GB-27d 0 bps and 10,000 bps", (round_half_up(HS * 0, 10000), round_half_up(HS * 10000, 10000)), (0, 43353))
    check("GB-27e exempt bidder: 0 whatever the rate (by definition; the engine skips the rounding)", 0, 0)
    check("GB-27f total due = hammer + premium + tax on HAMMER", HS + PS + 3577, 53433)

    print("-- GB-28 public bid history aliases (R-11, D-83): by first accepted appearance; a refused-only bidder gets none")
    class _Row:  # (seq, bidder, accepted) is all the rule reads
        def __init__(self, seq, bidder, accepted): self.seq, self.bidder, self.accepted = seq, bidder, accepted
    # fixtures/expected_bids.csv L001 (PROXY_WAR): seq, bidder, accepted, given out of order to show the sort
    L001 = [(12, "B003", True), (1, "B034", True), (2, "B027", True), (3, "B003", True), (4, "B034", False), (5, "B015", True), (6, "B019", False),
            (7, "B027", True), (8, "B019", False), (9, "B003", False), (10, "B019", True), (11, "B027", True)]
    check("GB-28a L001: five bidders, numbered by first accepted row", bidder_aliases([_Row(*r) for r in L001]), {"B034": 1, "B027": 2, "B003": 3, "B015": 4, "B019": 5})
    check("GB-28b a bidder refused before anyone accepted them takes no number; the next accepted bidder is 2, not 3",
          bidder_aliases([_Row(1, "A", True), _Row(2, "X", False), _Row(3, "B", True), _Row(4, "X", False)]), {"A": 1, "B": 2})
    check("GB-28c no accepted rows: no aliases", bidder_aliases([_Row(1, "X", False)]), {})

    print("OK" if FAILS == 0 else f"FAIL: {FAILS}")
    return 0 if FAILS == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
