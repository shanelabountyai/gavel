# Gavel — demo script

Synthetic data only. No real sale, bidder or payment; settlement stops at a mock invoice. Every number below was read off a command in this repo; the throughput line names its hardware.

**Time:** about 12 minutes. **Machine:** the Mac, Postgres 17 running locally, `gavel_test` database.

## Setup (once, before the audience arrives)

Order matters: the barrier test and `load:bids` truncate and reseed `gavel_test`, so run them **after** the screens, or run step 1 again.

```bash
cd ~/Projects/gavel
lsof -ti :6100                 # prints nothing; if it prints a pid, stop that server
sysctl -n kern.memorystatus_level   # want well above 30; a loaded Mac makes the contention numbers lie
uptime                         # 1-minute load average below 3 before any timing run

# 1. Load the frozen fixtures into gavel_test and replay them through the engine and the database path
npm run auction:eval           # ends: OK: expected_bids.csv (233 rows) and expected_lots.csv (39 rows) reproduced column for column

# 2. Demo accounts (two orgs; owner, admin, member each)
npm run seed:demo:test

# 3. Give the demo owner a seat in the fixtures house (no script does this; the e2e specs do it in code)
psql gavel_test -c "INSERT INTO \"Membership\" (\"orgId\",\"userId\",role,\"updatedAt\") SELECT o.id, u.id, 'owner', now() FROM \"Org\" o, \"User\" u WHERE o.slug='gavel-fixtures' AND u.email='owner@acme.demo.test' ON CONFLICT DO NOTHING"

# 4. Check the ledger before showing anything
npm run auction:verify         # auction:verify: OK, 39 lots (39 settled), V1–V9

# 5. Serve the production build with the demo sign-in on (builds first; about a minute cold)
DEMO_MODE=1 npm run e2e:server
```

When `curl -s localhost:6100/api/health` prints `{"ok":true}`, open <http://localhost:6100/demo>.

**Accounts.** Sign-in is the one-click page at `/demo`; no password is typed. They exist only because `DEMO_MODE=1` and `isDemo` is set by `scripts/seed-demo.ts`. Owners and admins are TOTP-enrolled but `/demo` skips it. The fixed public TOTP secret is `DEMO_TOTP_SECRET` in `scripts/seed-demo.ts` (safe only because a demo session cannot change its email or TOTP).

| Account | Role | Use it for |
|---|---|---|
| `owner@acme.demo.test` | owner of Acme Studio and of "Gavel fixtures (synthetic)" | staff screens, invoices, history |
| `member@acme.demo.test` | member of Acme Studio | bidding |
| `bidder-ada@` … `bidder-dee@acme.demo.test` | members of Acme Studio, paddles 1–4 (`npm run seed:live`) | bidding against each other: two windows, two bidders, one lot |

## 1. The oracle (2 min)

*Say:* "The rules are written down twice: a Python oracle and the TypeScript engine. They have to agree on every one of 233 submissions."

```bash
python3 tools/golden_answers.py          # ends with OK
python3 tools/verify_fixtures.py         # ends with OK
npm run rules:lint                       # rules file hash matches D-23
npm run auction:eval | tail -3           # engine half and database half, both OK
```

Point at: 39 lots, 31 sold, 3 no bids, 2 reserve not met, 3 withdrawn by staff; hammer 10 730 200 cents, premium 1 248 403 cents. Integers throughout.

## 2. The staff view: a sold lot and its invoice (3 min)

Sign in at `/demo` as `owner@acme.demo.test`, then:

1. `/o/gavel-fixtures/auctions` → **Harlan farm estate (online only)**: 12 lots, starts, hidden reserves (staff only).
2. **Invoices**: 9 buyers, premium 15.00 % of hammer. Paddle 102 bought lot 1, the oak roll-top desk: hammer $160.00, premium $24.00, total $184.00. That hammer equals `price 16000` for L001 in the eval table.
3. Back, click **Oak roll-top desk**, the lot 1 link: that is the history page, every ledger row in sequence order, accepted or rejected, with price and leader before and after.
4. Open **Box lot of hand tools** (lot 6, L006 in the eval table: 7 bids, 3 extensions, 269 s). *Say:* "Three late bids each pushed the close out. The history shows `placedAt` to the millisecond; the verifier checks they are in order."

5. Optional, if the audience sells rather than buys: **Consignors** in the menu → add one (code `EST-1`, any name) → back on **Live demo sale** (or any sale) set its contract (1250 bps, 500, 1500) → **Consignor statements**. The seeded sales carry no consignor, so the statement is empty until a lot made with that consignor settles; *say:* "same ledger, same settlements as the invoice, drawn on read; the commission is the only other rounding in the project, golden GB-25."
6. Optional, if the audience collects money: on **Invoices for this sale**, each buyer carries a status badge (Unpaid / Overdue / Part paid / Paid / Credit due / In default), computed from the recorded marks against the current total, never typed. **Record payment** takes dollars and cents and turns them into whole cents without a float. A sale whose due date has passed shows **Declare default** on an overdue invoice: it suspends the buyer and writes one second-chance offer per won lot that has an underbidder, at the price the underbidder's own last bid reached (D-44). **Accept** writes the settlement correction in the same transaction; the lot moves to the underbidder's invoice and the defaulter's paid marks show as a credit. *Say:* "nothing here is stored that can be derived: the status comes from the marks, the offer price from the ledger, expiry from the clock. Payments are a mark, never a charge." The seeded sales have a due date in the future, so make a sale with a past due date first if you want to show the default.

## 3. A live lot (4 min)

In a second browser profile (or private window) sign in as `member@acme.demo.test`. In the first window, as the owner:

1. `/o/acme/auctions` → Name `Live demo sale`, Opens (UTC) `2020-01-01T10:00` → **Create auction**.
2. Title `Demo mantel clock`, Start price ($) `100`, Reserve ($) `150`, Closes (UTC) 20 minutes from now (the line under the field shows the UTC instant and "closes in 20 min") → **Create and publish lot**; the page says `Lot 1 published.` and marks the row.

As the member:

3. `/o/acme/catalog` → **Register to bid** (paddle 1) → open **Demo mantel clock**. The lot page shows `Current price: No bids`, `Reserve: not met` (the amount is never shown to bidders).
4. Your maximum `150` → **Bid** → `Bid accepted. You lead at $150.00.` (The **Bid $…** button beside it bids the shown minimum in one tap; the board updates from the answer, not the next poll.) *Say:* "Only one bidder, so why $150? The reserve is $150 and this max clears it, so the price is floored at the reserve. Proxy bidding with a hidden floor." Double-click does not write two rows (one idempotency key per submission).
5. **Your bids** in the menu lists the clock as `Leading` and the catalog row carries the same badge (D-80); outbid elsewhere, a bidder finds out here without opening the lot.
6. Check the ledger: `psql gavel_test -c "select seq, outcome, \"maxCents\", \"priceAfterCents\" from \"Bid\" b join \"Lot\" l on l.id=b.\"lotId\" where l.title='Demo mantel clock'"`: one row per attempt.

## 4. Settle and verify (1 min)

```bash
npm run auction:close -- --as-of 2031-01-01T00:00:00Z   # settles every closed, unsettled lot as of that instant; idempotent
npm run auction:verify                                  # OK over every lot; V8 recomputes each settlement from the ledger
```

## 5. The contention proof and the number (stop the server first, 3 min)

Both commands wipe and reseed `gavel_test`. Run them last, with a quiet machine (`uptime` below 3), one at a time.

```bash
lsof -ti :6100 | xargs -r kill
npx dotenv -e .env.test -e .env.local -- vitest run tests/contention/barrier.test.ts   # 7 tests: N = 2, 10, 25, 50 writers behind one lock
npm run load:bids                                       # 200 writers, 4 lots, 10 s + soft close; appends one line to docs/LOAD.md; runs auction:verify last
```

*Say the number with its hardware*, from `docs/LOAD.md` (never from memory): last in-process line, Apple M4, 10 cores, 24 GB, Node v26.3.1, PostgreSQL 17.11 (Homebrew). The 2026-10-22 quiet-gate comparison is in the README table *Lock strategies side by side*: row lock median 5038 bids/s against 1345 for SERIALIZABLE, each with its range. `git checkout docs/LOAD.md` if you do not want the demo run committed.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/demo` is a 404 | server started without `DEMO_MODE=1` | restart with `DEMO_MODE=1 npm run e2e:server` |
| Port 6100 busy / Playwright adopts a stale app | another server on 6100 | `lsof -ti :6100 \| xargs -r kill` |
| Catalog empty, `Your orgs` has no "Gavel fixtures" | step 1 or 3 skipped, or a barrier/load run truncated the database | re-run setup steps 1–4 |
| Barrier test times out at N = 10/25/50, load numbers tiny (p50 seconds, 1.6 bids/s) | machine under load (load average 40+ from other test sweeps) | wait for `uptime` below 3, rerun alone |
| `Bad port: "6000"` | port 6000 is reserved by Next.js | the project uses 6100 |
| Member's bid says `Bid not accepted (...)` | lot already closed or maximum under the minimum | create a lot closing later; read the shown minimum |
| Production build fails or serves old pages | stale `.next` | `rm -rf .next` and rerun the server command |

## Concede before you're asked

- **Synthetic everything.** Names are from fixed lists, emails are `example.com`; nobody paid anything and there is no payment path, only a mock invoice.
- **The live site is a click-through, not the measurement rig.** <https://gavel.labintelligence.co> (shared password, D-64) runs on Vercel and Neon; no throughput number was taken there. Visitors share the demo accounts, so one visitor's bids are another's ledger. Closed lots settle once a day on the cron, not at the moment they close.
- **Numbers are one machine's.** Every throughput figure is Apple M4, 10 cores, 24 GB, Postgres 17.11 local. They are not a capacity claim, and a loaded machine produces wrong ones (a 64 load average gave 1.6 bids/s in the run that wrote this script).
- **Rules are one house's.** Increments, soft close and premium are data in `rules/auction.v1.json`, not an industry standard and not a statement about any state's auction law.
- **HTTP is slower than in process.** The same bids over the HTTP route measured 1016 bids/s against about 4300 to 5200 in process, because the server's 10-connection Prisma pool is the queue (D-54, D-57).
- **Not covered:** a correction that moves the winner sends no notice (D-53 f); no real-time push, polling only; two bids in the same millisecond exist only in the barrier test.
- **Demo sign-in is a shortcut** that exists only under `DEMO_MODE=1`.
