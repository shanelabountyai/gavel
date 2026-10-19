"""Gavel — synthetic auction fixture generator (test oracle, never product code).

Writes fixtures/auctions.json (auctions, lots, bidders), fixtures/submissions.jsonl (every bid
submission in arrival order, including replays, late and early attempts) and fixtures/MANIFEST.json.
Deterministic under --seed; `tools/verify_fixtures.py` regenerates to a temp dir and compares sha256.

Every bidder, lot and amount is invented. Names come from fixed lists; there are no real people,
estates or sales here. Lot kinds (docs/domain-brief.md section 3) say what each lot is designed to
exercise; the expected outcomes are computed by tools/reference_replay.py from tools/auctionlib.py.

Usage: python3 tools/build_fixtures.py --seed 20261019 [--out DIR]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
from typing import Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from auctionlib import Lot, Rules, Submission, min_next_bid, replay  # noqa: E402  (the generator asks the rules where the price stands)

# 2026-11-07 14:00:00 UTC, an invented Saturday sale; everything is relative to it.
T0_MS = 1794060000000
HOUR = 3600 * 1000
MIN = 60 * 1000
SEC = 1000

FIRST = ["Avery", "Blake", "Casey", "Dana", "Ellis", "Finley", "Gray", "Harper", "Indy", "Jules", "Kai", "Lane",
         "Morgan", "Noor", "Oakley", "Parker", "Quinn", "Reese", "Sage", "Tatum", "Umber", "Vale", "Wren", "Xen"]
LAST = ["Abbott", "Barlow", "Cole", "Dunn", "Ellery", "Frost", "Garner", "Hale", "Irwin", "Judd", "Kerr", "Lowe",
        "Mercer", "Nash", "Orr", "Pike", "Quill", "Rowe", "Stone", "Tate", "Usher", "Vance", "Webb", "York"]

ESTATE_TITLES = ["Oak roll-top desk", "Set of six Windsor chairs", "Cast-iron skillet lot (4)", "Pendulum wall clock",
                 "Hand-stitched quilt, c. 1960", "Box lot of hand tools", "Brass floor lamp", "Walnut dresser with mirror",
                 "Stoneware crock, 5 gal", "Vintage sewing machine in cabinet", "Framed farm print", "Cedar chest"]
EQUIP_TITLES = ["Skid steer, 2,100 hrs", "Zero-turn mower, 61 in deck", "Portable air compressor, 60 gal",
                "Utility trailer, 16 ft tandem", "Wood chipper, 6 in", "Pallet jack, 5,500 lb", "Welder, MIG 210",
                "Generator, 12 kW", "Pressure washer, 4,000 psi", "Post-hole auger with 3 bits", "Table saw, 10 in cabinet",
                "Pickup toolbox, aluminum"]


def sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class Gen:
    def __init__(self, seed: int):
        self.seed = seed
        self.rng = random.Random(seed)
        self.subs: list = []
        self.sub_n = 0
        self.rules = Rules.load()

    def bidders(self, n: int) -> list:
        out = []
        pairs = [(f, l) for f in FIRST for l in LAST]
        self.rng.shuffle(pairs)
        for i in range(n):
            f, l = pairs[i]
            out.append({"bidder_id": f"B{i + 1:03d}", "paddle": 100 + i, "name": f"{f} {l}",
                        "email": f"{f.lower()}.{l.lower()}@example.com"})
        return out

    def state(self, lot: dict, a: dict):
        """Replay this lot's submissions so far (in time order) and return (state, min_next)."""
        L = Lot(lot["lot_id"], a["auction_id"], lot["start_cents"], lot["reserve_cents"], lot["opens_at_ms"], lot["scheduled_end_ms"],
                a["soft_close_window_seconds"] * 1000, a["max_extension_seconds"] * 1000, a["buyer_premium_bps"])
        subs = [Submission(s["submission_id"], s["lot_id"], s["bidder_id"], s["max_cents"], s["placed_at_ms"], s["idempotency_key"])
                for s in self.subs if s["lot_id"] == lot["lot_id"]]
        subs.sort(key=lambda x: x.placed_at_ms)
        state, _, _ = replay(L, subs, self.rules)
        return state, min_next_bid(L, state, self.rules)

    def submit(self, lot: dict, bidder: str, max_cents: int, at_ms: int, key: Optional[str] = None) -> dict:
        self.sub_n += 1
        sid = f"S{self.sub_n:05d}"
        s = {"submission_id": sid, "lot_id": lot["lot_id"], "bidder_id": bidder, "max_cents": int(max_cents),
             "placed_at_ms": int(at_ms), "idempotency_key": key or f"k-{sid}"}
        self.subs.append(s)
        return s


def inc_for(price: int, bands: list) -> int:
    for lo, hi, inc in bands:
        if price >= lo and (hi is None or price < hi):
            return inc
    raise AssertionError


def build(seed: int) -> dict:
    g = Gen(seed)
    rng = g.rng
    with open(os.path.join(ROOT, "rules", "auction.v1.json"), encoding="utf-8") as f:
        rules = json.load(f)
    bands = [(b["lo_cents"], b["hi_cents"], b["increment_cents"]) for b in rules["increments"]["bands"]]

    bidders = g.bidders(40)
    ids = [b["bidder_id"] for b in bidders]

    auctions = [
        {"auction_id": "A1", "name": "Harlan farm estate (online only)", "soft_close_window_seconds": 120,
         "max_extension_seconds": 1800, "buyer_premium_bps": 1500, "opens_at_ms": T0_MS - 72 * HOUR, "titles": ESTATE_TITLES},
        {"auction_id": "A2", "name": "County surplus equipment", "soft_close_window_seconds": 180,
         "max_extension_seconds": 900, "buyer_premium_bps": 1000, "opens_at_ms": T0_MS - 48 * HOUR, "titles": EQUIP_TITLES},
        {"auction_id": "A3", "name": "Mill Street contents, no reserve", "soft_close_window_seconds": 60,
         "max_extension_seconds": 600, "buyer_premium_bps": 1250, "opens_at_ms": T0_MS - 24 * HOUR, "titles": ESTATE_TITLES[::-1]},
    ]
    # Each lot is designed to exercise one thing. Kinds are listed in the brief section 3.
    kinds = ["PROXY_WAR", "TIE", "RESERVE_NOT_MET", "RESERVE_MET", "CHAIN_TO_CAP", "SNIPE", "NO_BIDS", "OWN_RAISE",
             "LATE", "REPLAY", "BELOW_MIN", "EARLY"]
    lot_n = 0
    for a in auctions:
        a["lots"] = []
        plan = kinds[:] if a["auction_id"] != "A3" else [k for k in kinds if "RESERVE" not in k] + ["PROXY_WAR", "SNIPE"]
        for i, kind in enumerate(plan):
            lot_n += 1
            start = rng.choice([2500, 5000, 10000, 20000, 50000]) if a["auction_id"] != "A2" else rng.choice([50000, 100000, 250000])
            reserve = None
            if kind == "RESERVE_NOT_MET":
                reserve = start * 6
            elif kind == "RESERVE_MET":
                reserve = start * 3
            # Lots close two minutes apart, staggered within the sale, each opens with its auction.
            sched_end = T0_MS + (lot_n - 1) * 2 * MIN
            lot = {"lot_id": f"L{lot_n:03d}", "auction_id": a["auction_id"], "lot_number": i + 1,
                   "title": a["titles"][i % len(a["titles"])], "kind": kind, "start_cents": start, "reserve_cents": reserve,
                   "opens_at_ms": a["opens_at_ms"], "scheduled_end_ms": sched_end}
            a["lots"].append(lot)
            script(g, lot, a, bands, ids)
    for a in auctions:
        del a["titles"]

    # Arrival order within a lot is placed_at then generation order; the service assigns seq under the lock in that order.
    order = {s["submission_id"]: i for i, s in enumerate(g.subs)}
    g.subs.sort(key=lambda s: (s["lot_id"], s["placed_at_ms"], order[s["submission_id"]]))
    return {"seed": seed, "t0_ms": T0_MS, "bidders": bidders, "auctions": auctions, "submissions": g.subs}


def script(g: Gen, lot: dict, a: dict, bands: list, ids: list) -> None:
    rng = g.rng
    W = a["soft_close_window_seconds"] * SEC
    cap = a["max_extension_seconds"] * SEC
    end = lot["scheduled_end_ms"]
    start = lot["start_cents"]
    kind = lot["kind"]
    pool = rng.sample(ids, 8)
    quiet_from = lot["opens_at_ms"] + 10 * MIN
    quiet_to = end - W - 10 * MIN  # well before the soft-close window

    def t_between(lo: int, hi: int) -> int:
        return rng.randrange(lo, hi)

    def ladder(n: int, lo: int, hi: int, bidders: list) -> None:
        """n maxes rising in rough steps, placed in time order, from the given bidders cycling."""
        ts = sorted(t_between(lo, hi) for _ in range(n))
        m = start
        for i, t in enumerate(ts):
            m = m + rng.randrange(1, 6) * inc_for(m, bands) * rng.choice([1, 1, 2, 3])
            g.submit(lot, bidders[i % len(bidders)], m, t)

    if kind == "PROXY_WAR":
        # 10-16 competitive bids well before the window: raises above the leader's max, bids under it (outbid at
        # one increment over the bid, or a tie), and the odd attempt under the minimum. Each is placed against the
        # state the rules say stands at that moment, so the kind is exact rather than hoped for.
        ts = sorted(t_between(quiet_from, quiet_to) for _ in range(rng.randrange(10, 17)))
        last_bidder = None
        for t in ts:
            state, min_next = g.state(lot, a)
            others = [b for b in pool[:5] if b != state.leader and b != last_bidder]
            bidder = rng.choice(others)
            roll = rng.random()
            if state.leader is None or roll < 0.55:
                m = state.leader_max_cents + rng.randrange(1, 5) * inc_for(max(state.leader_max_cents, start), bands) if state.leader else min_next + rng.randrange(0, 4) * inc_for(min_next, bands)
                m = max(m, min_next)
            elif roll < 0.85 and state.leader_max_cents >= min_next:
                m = rng.randrange(min_next, state.leader_max_cents + 1)  # under or equal to the leader's max
            elif roll < 0.92:
                m = state.leader_max_cents  # an exact tie
            else:
                m = max(1, min_next - rng.randrange(1, 3) * inc_for(min_next, bands))  # under the minimum
            g.submit(lot, bidder, m, t)
            last_bidder = bidder
    elif kind == "TIE":
        m = start * 4
        g.submit(lot, pool[0], m, quiet_from + 5 * MIN)
        g.submit(lot, pool[1], m, quiet_from + 6 * MIN)  # same max, later: loses the tie
        g.submit(lot, pool[2], m, quiet_from + 7 * MIN)  # a third at the same max: now under the minimum
        g.submit(lot, pool[1], m + inc_for(m, bands), quiet_from + 8 * MIN)  # one increment more takes it
    elif kind == "RESERVE_NOT_MET":
        ladder(5, quiet_from, quiet_to, pool[:3])  # maxes stay under start*6
    elif kind == "RESERVE_MET":
        reserve = lot["reserve_cents"]
        g.submit(lot, pool[0], start * 2, quiet_from + 3 * MIN)                               # under reserve
        g.submit(lot, pool[1], reserve + 3 * inc_for(reserve, bands), quiet_from + 9 * MIN)   # clears reserve: price jumps to reserve
        g.submit(lot, pool[2], reserve + inc_for(reserve, bands), quiet_from + 15 * MIN)      # exactly the new minimum, under the leader's max: outbid
    elif kind == "CHAIN_TO_CAP":
        ladder(3, quiet_from, quiet_to, pool[:2])
        # then a bid 1 s before every close until the hard cap, then two more
        closes = end
        hard = end + cap
        m = start * 20
        i = 0
        while True:
            t = closes - 1 * SEC
            m += inc_for(m, bands) * 2
            g.submit(lot, pool[2 + (i % 4)], m, t)
            i += 1
            new_close = min(t + W, hard)
            if new_close <= closes:
                break
            closes = new_close
            if i > 60:
                raise AssertionError("chain did not reach the cap")
        g.submit(lot, pool[7], m + inc_for(m, bands) * 2, hard)  # exactly at the hard close: rejected
    elif kind == "SNIPE":
        ladder(4, quiet_from, quiet_to, pool[:2])
        m = start * 30
        g.submit(lot, pool[5], m, end - 1 * SEC)  # T-1s by a new bidder: extends
        g.submit(lot, pool[6], m + 3 * inc_for(m, bands), end + 30 * SEC)  # inside the extension, beats the max: extends again
        g.submit(lot, pool[0], m + 2 * inc_for(m, bands), end + W + 29 * SEC)  # 1 s before the new close, under the max: outbid, extends a third time
    elif kind == "NO_BIDS":
        pass
    elif kind == "OWN_RAISE":
        ladder(3, quiet_from, quiet_to, pool[:2])
        last = g.subs[-1]
        leader = last["bidder_id"]
        g.submit(lot, leader, last["max_cents"] + 5 * inc_for(last["max_cents"], bands), end - 5 * SEC)  # own raise in window: no extension
        g.submit(lot, leader, last["max_cents"], end - 4 * SEC)  # not above own max
    elif kind == "LATE":
        ladder(3, quiet_from, quiet_to, pool[:2])
        m = start * 50
        g.submit(lot, pool[3], m, end)             # exactly at close: rejected
        g.submit(lot, pool[4], m, end + 1 * SEC)   # after: rejected
    elif kind == "REPLAY":
        ladder(2, quiet_from, quiet_to, pool[:2])
        s = g.submit(lot, pool[2], start * 10, quiet_from + 20 * MIN)
        g.submit(lot, pool[2], start * 10, quiet_from + 21 * MIN, key=s["idempotency_key"])  # same key, same amount: replay
        g.submit(lot, pool[2], start * 11, quiet_from + 22 * MIN, key=s["idempotency_key"])  # same key, new amount: mismatch
        g.submit(lot, pool[3], start * 10, quiet_from + 23 * MIN, key=s["idempotency_key"])  # same key string, other bidder: a new bid
    elif kind == "BELOW_MIN":
        g.submit(lot, pool[0], start - 1, quiet_from + 2 * MIN)   # under start
        g.submit(lot, pool[0], start, quiet_from + 3 * MIN)       # exactly start: accepted
        g.submit(lot, pool[1], start + inc_for(start, bands) - 1, quiet_from + 4 * MIN)  # one cent under the minimum
        g.submit(lot, pool[1], start + inc_for(start, bands), quiet_from + 5 * MIN)      # exactly the minimum
    elif kind == "EARLY":
        g.submit(lot, pool[0], start * 2, lot["opens_at_ms"] - 1 * SEC)  # before open
        g.submit(lot, pool[0], start * 2, lot["opens_at_ms"])            # at open: accepted
    else:
        raise AssertionError(kind)


def write(data: dict, out: str) -> None:
    os.makedirs(out, exist_ok=True)
    subs = data.pop("submissions")
    with open(os.path.join(out, "auctions.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write("\n")
    with open(os.path.join(out, "submissions.jsonl"), "w", encoding="utf-8") as f:
        for s in subs:
            f.write(json.dumps(s, sort_keys=True) + "\n")
    manifest = {"seed": data["seed"], "generator": "tools/build_fixtures.py", "rules_sha256": sha(os.path.join(ROOT, "rules", "auction.v1.json")),
                "counts": {"auctions": len(data["auctions"]), "lots": sum(len(a["lots"]) for a in data["auctions"]),
                           "bidders": len(data["bidders"]), "submissions": len(subs)},
                "sha256": {n: sha(os.path.join(out, n)) for n in ("auctions.json", "submissions.jsonl")}}
    with open(os.path.join(out, "MANIFEST.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
        f.write("\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--out", default=os.path.join(ROOT, "fixtures"))
    args = ap.parse_args()
    data = build(args.seed)
    write(data, args.out)
    m = json.load(open(os.path.join(args.out, "MANIFEST.json"), encoding="utf-8"))
    print(json.dumps(m["counts"]))
    for n, h in m["sha256"].items():
        print(f"{h}  {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
