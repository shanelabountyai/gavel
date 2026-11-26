"""Gavel — the auction rules made executable (test oracle, never product code).

Implements docs/domain-brief.md sections 5–8 exactly: increment table, proxy (max) bidding,
tie-break, reserve, soft close with a hard cap, idempotent replay, and settlement. Every quantity is
an integer: cents, basis points, epoch milliseconds. Time is a parameter; nothing here reads a clock.

The TypeScript engine in src/auction/ is written from the brief, not from this file, and must agree
with it on every submission in fixtures/ and every golden in golden_answers.py.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, replace
from typing import Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RULES_PATH = os.path.join(ROOT, "rules", "auction.v2.json")  # D-90: v2; auction.v1.json stays for the old rows' hashes

ACCEPTED = ("ACCEPTED_LEAD", "ACCEPTED_OUTBID", "ACCEPTED_RAISE")
VOIDED = "VOIDED"  # D-96: a staff void of one bidder's standing bids; a ledger row, never accepted
VOID_REFUSALS = ("VOID_LOT_NOT_OPEN", "VOID_NO_LIVE_BIDS")  # D-96 (b): refused voids write nothing


def round_half_up(numerator: int, denominator: int) -> int:
    """Round a non-negative exact rational to an integer, half up. The one rounding rule."""
    if numerator < 0 or denominator <= 0:
        raise ValueError("round_half_up: non-negative numerator and positive denominator only")
    return (2 * numerator + denominator) // (2 * denominator)


@dataclass(frozen=True)
class Rules:
    tables: dict  # name -> ((lo, hi_or_None, inc), ...)  (D-90: named increment tables; a sale picks one)
    default_table: str
    soft_close_window_ms: int
    max_extension_ms: int
    premium_bands: tuple  # the default schedule: ((lo, hi_or_None, bps), ...)

    @property
    def bands(self) -> tuple:
        return self.tables[self.default_table]

    @property
    def buyer_premium_bps(self) -> int:
        return self.premium_bands[0][2]

    @staticmethod
    def load(path: str = RULES_PATH) -> "Rules":
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        tables = {}
        for name, raw in data["increments"]["tables"].items():
            bands = [(int(b["lo_cents"]), None if b["hi_cents"] is None else int(b["hi_cents"]), int(b["increment_cents"])) for b in raw]
            _check_bands(bands)
            tables[name] = tuple(bands)
        d = data["defaults"]
        return Rules(
            tables=tables,
            default_table=data["increments"]["default_table"],
            soft_close_window_ms=int(d["soft_close_window_seconds"]) * 1000,
            max_extension_ms=int(d["max_extension_seconds"]) * 1000,
            premium_bands=premium_bands_from(d["premium_bands"]),
        )


def premium_bands_from(raw: list) -> tuple:
    """[{lo_cents, hi_cents, bps}] -> ((lo, hi, bps), ...), checked: contiguous from 0, last open, bps in 0..10000."""
    bands = tuple((int(b["lo_cents"]), None if b["hi_cents"] is None else int(b["hi_cents"]), int(b["bps"])) for b in raw)
    if not bands or bands[0][0] != 0 or bands[-1][1] is not None:
        raise ValueError("premium bands must start at 0 and end open")
    for i in range(len(bands) - 1):
        if bands[i][1] is None or bands[i][1] <= bands[i][0] or bands[i][1] != bands[i + 1][0]:
            raise ValueError("premium bands must be contiguous and non-empty")
    for _, _, bps in bands:
        if not 0 <= bps <= 10000:
            raise ValueError("premium bps must be in 0..10000")
    return bands


def premium_for(hammer_cents: int, bands: tuple) -> int:
    """D-90: each band's rate on the slice of the hammer inside it, summed exactly, rounded half up once."""
    numerator = 0
    for lo, hi, bps in bands:
        top = hammer_cents if hi is None else min(hammer_cents, hi)
        if top > lo:
            numerator += (top - lo) * bps
    return round_half_up(numerator, 10000)


def _check_bands(bands: list) -> None:
    if not bands or bands[0][0] != 0 or bands[-1][1] is not None:
        raise ValueError("bands must start at 0 and end open")
    for i in range(len(bands) - 1):
        if bands[i][1] != bands[i + 1][0]:
            raise ValueError("bands must be contiguous")
        if bands[i][2] > bands[i + 1][2]:
            raise ValueError("increments must be non-decreasing")
    for lo, hi, inc in bands:
        if inc <= 0:
            raise ValueError("increment must be positive")


def increment_for(price_cents: int, rules: Rules, table: Optional[str] = None) -> int:
    if price_cents < 0:
        raise ValueError("negative price")
    for lo, hi, inc in rules.tables[table or rules.default_table]:
        if price_cents >= lo and (hi is None or price_cents < hi):
            return inc
    raise AssertionError("unreachable: bands cover [0, inf)")


@dataclass(frozen=True)
class Lot:
    lot_id: str
    auction_id: str
    start_cents: int
    reserve_cents: Optional[int]  # None = no reserve
    opens_at_ms: int
    scheduled_end_ms: int
    soft_close_window_ms: int
    max_extension_ms: int
    buyer_premium_bps: int
    # R-04 (D-73): the instant staff withdrew the lot, or None. CLOSED from it; a second input to the
    # outcome beside the ledger. Read under the same row lock as a bid; never changes once set.
    withdrawn_at_ms: Optional[int] = None
    # R-18 (D-90): the sale's increment table by name (None = the rules' default) and its premium schedule
    # ((lo, hi, bps), ...); None = flat at buyer_premium_bps, which is the one-band schedule.
    increment_table: Optional[str] = None
    premium_bands: Optional[tuple] = None

    @property
    def premium_schedule(self) -> tuple:
        return self.premium_bands if self.premium_bands is not None else ((0, None, self.buyer_premium_bps),)

    @property
    def hard_close_ms(self) -> int:
        return self.scheduled_end_ms + self.max_extension_ms


@dataclass(frozen=True)
class LotState:
    """The projection one row holds. Everything here is a fold over the accepted bids."""
    price_cents: int = 0
    leader: Optional[str] = None
    leader_max_cents: int = 0
    leader_seq: Optional[int] = None
    bid_count: int = 0  # every written row, accepted or rejected
    accepted_count: int = 0
    closes_at_ms: int = 0
    extension_count: int = 0

    def reserve_met(self, lot: Lot) -> bool:
        if self.leader is None:
            return False
        return lot.reserve_cents is None or self.leader_max_cents >= lot.reserve_cents


def open_state(lot: Lot) -> LotState:
    return LotState(closes_at_ms=lot.scheduled_end_ms)


def min_next_bid(lot: Lot, state: LotState, rules: Rules) -> int:
    """What a non-leader must bid at least. Before any bid: the start price."""
    if state.leader is None:
        return lot.start_cents
    return state.price_cents + increment_for(state.price_cents, rules, lot.increment_table)


@dataclass(frozen=True)
class BidResult:
    outcome: str
    accepted: bool
    state: LotState
    price_before: int
    price_after: int
    leader_before: Optional[str]
    leader_after: Optional[str]
    closes_before_ms: int
    closes_after_ms: int
    extended: bool
    min_next_before: int


def apply_bid(lot: Lot, state: LotState, bidder: str, max_cents: int, now_ms: int, rules: Rules) -> BidResult:
    """One submission against one lot at one instant. Pure. The caller holds the row lock."""
    if not isinstance(max_cents, int) or isinstance(max_cents, bool) or max_cents <= 0:
        raise ValueError("max_cents must be a positive integer; the boundary rejects anything else before this")
    before = state
    min_next = min_next_bid(lot, state, rules)
    seq = state.bid_count + 1

    def rejected(code: str) -> BidResult:
        s = replace(state, bid_count=seq)
        return BidResult(code, False, s, before.price_cents, before.price_cents, before.leader, before.leader,
                         before.closes_at_ms, before.closes_at_ms, False, min_next)

    if lot.withdrawn_at_ms is not None and now_ms >= lot.withdrawn_at_ms:  # half-open, as the close; checked first
        return rejected("REJECTED_LOT_WITHDRAWN")
    if now_ms < lot.opens_at_ms:
        return rejected("REJECTED_LOT_NOT_OPEN")
    if now_ms >= state.closes_at_ms:  # half-open [opens_at, closes_at)
        return rejected("REJECTED_LOT_CLOSED")

    if state.leader == bidder:
        # Raising one's own max: price does not move, no extension, not a competitive bid.
        if max_cents <= state.leader_max_cents:
            return rejected("REJECTED_NOT_ABOVE_OWN_MAX")
        s = replace(state, leader_max_cents=max_cents, leader_seq=seq, bid_count=seq, accepted_count=state.accepted_count + 1)
        s = _apply_reserve(lot, s)
        return BidResult("ACCEPTED_RAISE", True, s, before.price_cents, s.price_cents, before.leader, s.leader,
                         before.closes_at_ms, s.closes_at_ms, False, min_next)

    if max_cents < min_next:
        return rejected("REJECTED_BELOW_MINIMUM")

    if state.leader is None:
        s = replace(state, price_cents=lot.start_cents, leader=bidder, leader_max_cents=max_cents, leader_seq=seq)
        outcome = "ACCEPTED_LEAD"
    elif max_cents > state.leader_max_cents:
        price = min(max_cents, state.leader_max_cents + increment_for(state.leader_max_cents, rules, lot.increment_table))
        s = replace(state, price_cents=price, leader=bidder, leader_max_cents=max_cents, leader_seq=seq)
        outcome = "ACCEPTED_LEAD"
    else:
        # max_cents <= leader_max: the earlier max keeps the lead (tie goes to the earlier seq).
        price = min(state.leader_max_cents, max_cents + increment_for(max_cents, rules, lot.increment_table))
        s = replace(state, price_cents=price)
        outcome = "ACCEPTED_OUTBID"
    s = replace(s, bid_count=seq, accepted_count=state.accepted_count + 1)
    s = _apply_reserve(lot, s)

    # Soft close, one rule: the close becomes now + W (never past the hard close) when that is later than it
    # is now. A bid at exactly closes - W changes nothing; a bid one ms later extends by one ms.
    extended = False
    new_close = min(now_ms + lot.soft_close_window_ms, lot.hard_close_ms)
    if new_close > s.closes_at_ms:
        s = replace(s, closes_at_ms=new_close, extension_count=s.extension_count + 1)
        extended = True
    return BidResult(outcome, True, s, before.price_cents, s.price_cents, before.leader, s.leader,
                     before.closes_at_ms, s.closes_at_ms, extended, min_next)


def _apply_reserve(lot: Lot, s: LotState) -> LotState:
    """Reserve floor: once the leading max reaches the reserve, the price is at least the reserve."""
    if lot.reserve_cents is not None and s.leader is not None and s.leader_max_cents >= lot.reserve_cents and s.price_cents < lot.reserve_cents:
        return replace(s, price_cents=lot.reserve_cents)
    return s


@dataclass(frozen=True)
class Submission:
    submission_id: str
    lot_id: str
    bidder: str
    max_cents: int
    placed_at_ms: int
    idempotency_key: str
    void: bool = False  # D-96: a staff void of `bidder`'s live bids (max_cents 0), not a bid


@dataclass
class LedgerRow:
    seq: int
    submission_id: str
    bidder: str
    max_cents: int
    placed_at_ms: int
    idempotency_key: str
    outcome: str
    accepted: bool
    price_before: int
    price_after: int
    leader_before: Optional[str]
    leader_after: Optional[str]
    closes_before_ms: int
    closes_after_ms: int
    extended: bool


@dataclass
class ReplayOutcome:
    submission_id: str
    row_written: bool
    outcome: str  # a bid outcome, REPLAY or IDEMPOTENCY_MISMATCH
    seq: Optional[int]
    price_after: int
    leader_after: Optional[str]
    closes_after_ms: int
    extended: bool


def live_accepted(rows: list) -> list:
    """D-96 (c): accepted rows in seq order, less the dead ones. A row is dead when a VOIDED row for the same bidder has a
    higher seq; a voided bidder's rows after their void are live again."""
    last_void: dict = {}
    for r in rows:
        if r.outcome == VOIDED:
            last_void[r.bidder] = max(last_void.get(r.bidder, 0), r.seq)
    return [r for r in sorted(rows, key=lambda r: r.seq) if r.outcome in ACCEPTED and r.seq > last_void.get(r.bidder, 0)]


def apply_void(lot: Lot, state: LotState, rows: list, bidder: str, now_ms: int, rules: Rules) -> BidResult:
    """D-96 (b), (d): void every live accepted row of `bidder`. Only while OPEN, only with a live row; a refusal writes
    nothing (its state is the state before, bid_count unchanged). Price, leader, leader max and leader seq become the
    re-application of the other live rows, each at its own seq and instant, with the close held where it is now; the
    close, its extension count and the accepted count never move back."""
    seq = state.bid_count + 1
    min_next = min_next_bid(lot, state, rules)

    def out(code: str, s: LotState) -> BidResult:
        return BidResult(code, False, s, state.price_cents, s.price_cents, state.leader, s.leader,
                         state.closes_at_ms, s.closes_at_ms, False, min_next)

    if lot_status(lot, state, now_ms) != "OPEN":
        return out("VOID_LOT_NOT_OPEN", state)
    live = live_accepted(rows)
    if not any(r.bidder == bidder for r in live):
        return out("VOID_NO_LIVE_BIDS", state)
    rb = replace(open_state(lot), closes_at_ms=state.closes_at_ms)
    for r in live:
        if r.bidder != bidder:
            rb = apply_bid(lot, replace(rb, bid_count=r.seq - 1), r.bidder, r.max_cents, r.placed_at_ms, rules).state
    s = replace(state, price_cents=rb.price_cents, leader=rb.leader, leader_max_cents=rb.leader_max_cents,
                leader_seq=rb.leader_seq, bid_count=seq)
    return out(VOIDED, s)


def replay(lot: Lot, submissions: list, rules: Rules) -> tuple:
    """Submissions in arrival order through the idempotency check then apply_bid. Returns (state, rows, outcomes)."""
    state = open_state(lot)
    rows: list = []
    outcomes: list = []
    by_key: dict = {}
    for sub in submissions:
        key = (sub.bidder, sub.idempotency_key)
        if key in by_key:
            prior = by_key[key]
            if prior.max_cents == sub.max_cents:
                outcomes.append(ReplayOutcome(sub.submission_id, False, "REPLAY", prior.seq, state.price_cents, state.leader, state.closes_at_ms, False))
            else:
                outcomes.append(ReplayOutcome(sub.submission_id, False, "IDEMPOTENCY_MISMATCH", None, state.price_cents, state.leader, state.closes_at_ms, False))
            continue
        if sub.void:
            r = apply_void(lot, state, rows, sub.bidder, sub.placed_at_ms, rules)
            if r.outcome in VOID_REFUSALS:
                outcomes.append(ReplayOutcome(sub.submission_id, False, r.outcome, None, state.price_cents, state.leader, state.closes_at_ms, False))
                continue
        else:
            r = apply_bid(lot, state, sub.bidder, sub.max_cents, sub.placed_at_ms, rules)
        row = LedgerRow(r.state.bid_count, sub.submission_id, sub.bidder, sub.max_cents, sub.placed_at_ms, sub.idempotency_key,
                        r.outcome, r.accepted, r.price_before, r.price_after, r.leader_before, r.leader_after,
                        r.closes_before_ms, r.closes_after_ms, r.extended)
        rows.append(row)
        by_key[key] = row
        state = r.state
        outcomes.append(ReplayOutcome(sub.submission_id, True, r.outcome, row.seq, r.price_after, r.leader_after, r.closes_after_ms, r.extended))
    return state, rows, outcomes


def fold(lot: Lot, rows: list, rules: Rules) -> LotState:
    """Recompute the projection from the ledger alone (what auction:verify does)."""
    state = open_state(lot)
    done: list = []
    for row in sorted(rows, key=lambda r: r.seq):
        if row.seq != state.bid_count + 1:
            raise ValueError(f"seq gap at {row.seq}")
        if row.outcome == VOIDED:  # D-96 (e): a void re-derives the state from the live rows before it
            r = apply_void(lot, state, done, row.bidder, row.placed_at_ms, rules)
        else:
            r = apply_bid(lot, state, row.bidder, row.max_cents, row.placed_at_ms, rules)
        if r.outcome != row.outcome:
            raise ValueError(f"ledger row {row.seq} says {row.outcome}, fold says {r.outcome}")
        state = r.state
        done.append(row)
    return state


def bidder_aliases(rows: list) -> dict:
    """Public bid history (R-11, D-83): per-lot aliases 'Bidder N', N by first ACCEPTED appearance in seq order.
    A bidder whose rows were all refused gets none: refused rows are never shown, and a numbering gap would reveal one."""
    aliases: dict = {}
    for row in sorted(rows, key=lambda r: r.seq):
        if row.accepted and row.bidder not in aliases:
            aliases[row.bidder] = len(aliases) + 1
    return aliases


@dataclass(frozen=True)
class Settlement:
    outcome: str
    winner: Optional[str]
    winning_seq: Optional[int]
    hammer_cents: int
    premium_cents: int
    total_cents: int
    closed_at_ms: int


def lot_status(lot: Lot, state: LotState, now_ms: int) -> str:
    if lot.withdrawn_at_ms is not None and now_ms >= lot.withdrawn_at_ms:
        return "CLOSED"
    if now_ms < lot.opens_at_ms:
        return "SCHEDULED"
    if now_ms < state.closes_at_ms:
        return "OPEN"
    return "CLOSED"


def settle(lot: Lot, state: LotState, now_ms: int) -> Optional[Settlement]:
    """None while the lot is open. Otherwise the outcome, recomputable from the ledger at any later time."""
    if lot_status(lot, state, now_ms) != "CLOSED":
        return None
    if lot.withdrawn_at_ms is not None:  # withdrawn: no sale whatever the ledger says; closed at the withdrawal
        return Settlement("UNSOLD_WITHDRAWN", None, None, 0, 0, 0, lot.withdrawn_at_ms)
    if state.leader is None:
        return Settlement("UNSOLD_NO_BIDS", None, None, 0, 0, 0, state.closes_at_ms)
    if not state.reserve_met(lot):
        return Settlement("UNSOLD_RESERVE_NOT_MET", None, None, 0, 0, 0, state.closes_at_ms)
    hammer = state.price_cents
    premium = premium_for(hammer, lot.premium_schedule)  # one band = the v1 formula, exactly
    return Settlement("SOLD", state.leader, state.leader_seq, hammer, premium, hammer + premium, state.closes_at_ms)


# ---- Consignor statement (R-07 / AX-07, D-74): derived on read from a consignor's current settlements ----

UNSOLD_FEE_OUTCOMES = ("UNSOLD_NO_BIDS", "UNSOLD_RESERVE_NOT_MET")  # a withdrawn or corrected-away lot carries no fee


@dataclass(frozen=True)
class Contract:
    commission_bps: int
    lot_fee_cents: int
    unsold_fee_cents: int


@dataclass(frozen=True)
class ConsignedLot:
    lot_id: str
    lot_number: int
    outcome: str
    hammer_cents: int


@dataclass(frozen=True)
class StatementLine:
    lot_id: str
    lot_number: int
    outcome: str
    hammer_cents: int
    commission_cents: int
    fee_cents: int
    net_cents: int


@dataclass(frozen=True)
class ConsignorStatement:
    lines: tuple
    hammer_cents: int
    commission_cents: int
    fee_cents: int
    net_cents: int


def consignor_statement(lots: list, contract: Contract) -> ConsignorStatement:
    """Per SOLD lot: hammer, commission = round_half_up(hammer x bps, 10000) (the second rounding site, D-74),
    the lot fee, net = hammer - commission - fee. Per unsold-at-the-block lot: the unsold fee, net = -fee.
    Withdrawn or corrected-away: nothing. The buyer's premium never appears. Lines in lot-number order."""
    if not (0 <= contract.commission_bps <= 10000) or contract.lot_fee_cents < 0 or contract.unsold_fee_cents < 0:
        raise ValueError("consignor_statement: bps in 0..10000, fees >= 0")
    lines = []
    for lot in sorted(lots, key=lambda l: l.lot_number):
        if lot.outcome == "SOLD":
            commission = round_half_up(lot.hammer_cents * contract.commission_bps, 10000)
            fee = contract.lot_fee_cents
            lines.append(StatementLine(lot.lot_id, lot.lot_number, lot.outcome, lot.hammer_cents, commission, fee, lot.hammer_cents - commission - fee))
        else:
            fee = contract.unsold_fee_cents if lot.outcome in UNSOLD_FEE_OUTCOMES else 0
            lines.append(StatementLine(lot.lot_id, lot.lot_number, lot.outcome, 0, 0, fee, -fee))
    total = lambda k: sum(getattr(l, k) for l in lines)  # noqa: E731
    return ConsignorStatement(tuple(lines), total("hammer_cents"), total("commission_cents"), total("fee_cents"), total("net_cents"))


# ---- Payment status (R-08 / AX-08, D-75): derived from the marks against the current total, never stored ----

PAYMENT_STATUSES = ("PAID", "PARTIAL", "UNPAID", "OVERDUE", "DEFAULTED", "CREDIT")


@dataclass(frozen=True)
class InvoiceBalance:
    status: str
    paid_cents: int
    balance_cents: int  # total - paid; negative is a credit the house owes the buyer


def invoice_balance(total_cents: int, paid_cents: int, now_ms: int, due_at_ms: Optional[int], defaulted: bool = False) -> InvoiceBalance:
    """Sum of marks against the current invoice total. DEFAULTED outranks everything; paid above total is CREDIT (a
    correction lowered the total after a payment); equal is PAID; some is PARTIAL (whatever the date); none is OVERDUE
    strictly after the due date, else UNPAID. A sale with no due date never goes overdue. No rounding: sums only."""
    for v in (total_cents, paid_cents):
        if not isinstance(v, int) or isinstance(v, bool) or v < 0:
            raise ValueError("invoice_balance: cents are non-negative integers")
    balance = total_cents - paid_cents
    if defaulted:
        status = "DEFAULTED"
    elif paid_cents > total_cents:
        status = "CREDIT"
    elif paid_cents == total_cents:
        status = "PAID"
    elif paid_cents > 0:
        status = "PARTIAL"
    elif due_at_ms is not None and now_ms > due_at_ms:
        status = "OVERDUE"
    else:
        status = "UNPAID"
    return InvoiceBalance(status, paid_cents, balance)
