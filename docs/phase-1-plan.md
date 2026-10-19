# Phase 1 plan (Session 0, 2026-10-19) — for review before any engine, schema or bid-path code

Written at the end of KICKOFF steps 1–10. Task 1.1 is scaffolded (stubs, CI, banner, module switch, port). Nothing under `src/auction/` exists. The questions at the end change what gets built; defaults are stated so a bare "go" means something.

## Order (tasks 1.2 → 1.12) and why

| # | Task | Donor read first | Note |
|---|---|---|---|
| 1.2 | Fixtures verified | — | Already true: `fixtures:check` is real (not a stub) and runs in CI. Remaining: a test that fails if product code writes under `fixtures/` (a grep of `src/` for `fixtures/` plus the `git status --porcelain fixtures/` guard already in the script) |
| 1.3 | Ports with lineage | LoanBook `src/ledger/money.ts` → `src/auction/engine/money.ts` (whole: `assertCents`, `assertBps`, `roundHalfUp(bigint, bigint)`, `formatCents`; `MoneyError` codes kept). Bookable `packages/db/testing/row-lock.ts` → `tests/contention/row-lock.ts` (`behindRowLock`, header kept, table generalised to `"LotState"`). Bookable `packages/db/booking/races.test.ts` → `barrier()` and `RACE_TIMEOUT = 20_000` into `tests/contention/barrier.test.ts`. Bookable `packages/db/errors.ts` → the error-shape lesson for `src/auction/errors.ts` (see spike S-2 below: the SQLSTATE is at `meta.driverAdapterError.cause.code`, not on the error). Adjuster `src/rules/canonical.ts` → **Q3**: proposed not to port (one hash, the raw-file sha256 in D-23, is the only one anything compares against) | Each port gets a D-entry with the donor path |
| 1.4 | Rules loader + lint | Bracketry `eslint.config.mjs` L-002 block (engine-scoped import ban) for the shape of `rules:lint` | `rules:lint` becomes a tsx script: schema check, raw sha256 = D-23, grep of `src/auction/engine/` for the banned names, float lint (see Q5 on `/`) |
| 1.5 | `incrementFor`, `minNextBid`, `applyBid` | brief §5–§6 only (never `auctionlib.py` line for line) | GB-00..14, 17, 19, 22, 23 as a vitest table from §9 |
| 1.6 | `replay`, `fold`, `settle`, `lotStatus`; `auction:eval` engine half | — | Reads `fixtures/auctions.json` + `submissions.jsonl`, writes the §11 columns to a temp dir, diffs both CSVs byte for byte, prints the §10 table and the hash |
| 1.7 | Schema + migration | Template `20260923100000_audit_append_only` and LoanBook `20260929000000_ledger_init` (`ledger_append_only`, `ERRCODE restrict_violation`) for the trigger SQL | `prisma/schema/gavel.prisma`; migration via `prisma migrate dev --create-only` then the hand-written SQL appended. **Q4:** billing's tables are still in the migration history and gone from the schema, so `migrate dev` will want to drop them; proposed: let the first Gavel migration carry those DROPs (the template README sanctions it) |
| 1.8 | `placeBid` under the lock | Bookable `packages/db/booking/book.ts` (`{ timeout: 15_000 }` comment, `findByIdempotencyKey`) | See *Clock* and *Connections* below; errors mapped from the spike's shapes |
| 1.9 | DB replay, `auction:close`, `auction:verify` | LoanBook `scripts/ledger-verify.ts` for the gate's shape | `src/auction/verify-sql.ts` V1–V9 as SQL strings run by `pg` (shared with the barrier test and the load script) |
| 1.10 | Barrier test | Bookable tests 1, 1b, 1c | See *Determinism* below (Q2) |
| 1.11 | Load script → `docs/LOAD.md` | — | See *Lock wait* below |
| 1.12 | CI gate + red/green proof | LoanBook `ci.yml` (already ported) | `auction:eval` and `rules:lint` go red on a throwaway branch with `increment_cents` 100 → 150; both run links in `NEXT.md` |

## Clock inside `placeBid` (task 1.8 → 1.9)

`placeBid(input, deps = { clock: () => now().getTime() })`. The clock is a function; it is called **once, after `FOR UPDATE` returns** (D-15), never before. Production passes nothing. The database replay (1.9) passes `{ clock: () => submission.placed_at_ms }` per submission, so `placedAt` equals the fixture's millisecond exactly (an `advanceClock` offset would drift by the ms between setting it and the read under the lock, and `expected_bids.csv` compares `placed_at_ms` exactly). The barrier test passes `() => T - 1000` to every writer. The load script passes nothing (real clock). V6 still checks `placedAt` non-decreasing by seq in every case.

## Connections: the pool cap vs N writers (Q1, the one that changes the design)

`placeBid` as described runs inside `db.$transaction` on the foundation's Prisma pool, capped at `connection_limit=10` (house rule, D-2). N = 50 writers calling it would hold at most 10 open transactions; the other 40 wait for a pool slot (`pool_timeout=20` s), never reach the row lock, and `behindRowLock`'s "poll `pg_locks` until N are queued" can never see more than 10. The load script's 200 writers have the same ceiling. D-2 and D-18 already say the writers use raw `pg` connections outside the pool, but `placeBid` cannot run on them unless its transaction body is written against a connection interface.

Proposed (A): the bid transaction body (`SET LOCAL lock_timeout`, `SELECT … FOR UPDATE`, clock read, idempotency read, `applyBid`, `INSERT Bid`, `UPDATE LotState`) is one function over a 4-method `Tx` interface (`query(sql, params)`), implemented by Prisma's interactive transaction (`$queryRawUnsafe`/`$executeRawUnsafe`) **and** by a `pg.Client` (`BEGIN … COMMIT`). Production and the sequential replay use the Prisma implementation; the barrier test and the load script use one raw `pg` client per writer, so N real transactions queue on the row lock. Same body, two wrappers; `auction:verify` runs after both.

Alternatives: (B) raise `connection_limit` to N + 10 in `.env.test` only (breaks the house cap, still cannot reach 200); (C) keep `placeBid` Prisma-only and cap N at 10 (the card's claim dies).

## Determinism of the barrier test's outcome table (Q2)

Postgres grants a row lock to waiters in queue order, but the order in which N racing clients *enter* the queue is not controlled. With distinct maxes, whether a bid is accepted depends on which maxes landed before it (start 1,000: order {100,000, 50,000, 50,500} ends at price 51,000 with 50,500 rejected; order {100,000, 50,500, 50,000} ends at 51,500 with 50,000 rejected; and the highest max can even lose the lead if it arrives last within one increment), so "the same outcome table three runs in a row" (task 1.10) is not achievable with distinct maxes. Proposed: two designs in the test. (i) All N maxes equal: exactly 1 `ACCEPTED_LEAD`, 1 `ACCEPTED_OUTBID` (price = the max), N − 2 `REJECTED_BELOW_MINIMUM`, `extensionCount` 1, leader = seq 1 — order-independent, so the table is asserted exactly. (ii) Distinct maxes: assert only the order-independent invariants (N rows, seq 1..N, one leader, V1–V7, the fold, the resend pass). Task 1.10's wording is amended in `docs/decisions.md` when this is accepted.

## CI sizes (task 1.10, O-10)

`GAVEL_BARRIER_N=25` is already in `ci.yml`. The `postgres:17` image defaults to `max_connections = 100`; CI holds 25 writers + 1 holder + the Prisma pool (≤ 10) + the verifier (1) ≈ 37. Locally (Homebrew 17.11, `max_connections = 100`): N = 50 → ≈ 62, which is why the test asserts the `pg_stat_activity` baseline afterwards and why no sibling sweep may run alongside it. GitHub `ubuntu-latest` is 4 vCPU / 16 GB; N = 25 is a correctness run there, not a measurement.

## Lock wait in the load script (task 1.11)

D-19 says "max lock wait from `pg_stat_activity.wait_event`", but that view has no duration column; sampling it gives a lower bound at the sampler's granularity. Proposed: measure each bid's lock wait in-process (time from the `FOR UPDATE` statement start to its return, exact per bid) and report its max and p95 beside the latency numbers, and sample `pg_locks.waitstart` (Postgres 14+) once per 100 ms as the cross-check. `docs/LOAD.md` says which number is which.

## Spike results (Prisma 7.10 + `@prisma/adapter-pg`, Postgres 17.11, 2026-10-19; throwaway script, not committed)

- S-1 `SET LOCAL lock_timeout = '1500ms'` inside `db.$transaction` is visible to `SHOW lock_timeout` on the same connection, the transaction runs at `read committed`, `SELECT … FOR UPDATE` through `$queryRaw` returns the row, and the setting is back to 0 after commit.
- S-2 A waiter behind a held row lock fails after 1,689 ms with `PrismaClientKnownRequestError` code `P2010`; the SQLSTATE `55P03` is at `meta.driverAdapterError.cause.code` (`originalMessage: canceling statement due to lock timeout`). The error mapping reads that path.
- S-3 With Prisma's default 5 s transaction timeout and a 7 s lock hold, the wait is **not** interrupted: the statement acquires the lock at 7 s, the body runs, then `COMMIT` is refused with `P2028` ("expired transaction", `timeTaken: 7016`). So an unraised timeout does not abort a queued bid early; it judges and writes the bid and then rolls it back with a non-retryable error. D-13's "raise the timeout above the lock wait" stands; the review-log sentence "would abort a bid … before `lock_timeout` ever fired" describes the wrong moment.
- S-4 A `BEFORE UPDATE OR DELETE` trigger raising with `ERRCODE = 'restrict_violation'` refuses the write through Prisma (`P2010`, `cause.code 23001`) and through `pg` (`code 23001`).

## What I need from Shane (defaults in force on a bare "go")

| Q | Question | Default |
|---|---|---|
| Q0 | Port: 5600 was taken; the clone is on **6000** (table row and `CLONES.md` row written) | Keep 6000 |
| Q1 | Connections: (A) one transaction body over a `Tx` interface with Prisma and `pg` wrappers, (B) raise the test pool cap, (C) cap N at 10 | **A** |
| Q2 | Barrier outcome table: equal-max design asserted exactly + distinct-max design asserting invariants only | Yes, amend task 1.10 |
| Q3 | Port Adjuster's `canonical.ts`? One hash (raw sha256, D-23) is what the manifest, `rules:lint`, `auction:eval` and the `Settlement` row compare | **Do not port**; hash the file bytes |
| Q4 | First Gavel migration carries the DROPs of the removed billing tables | Yes |
| Q5 | Float lint: ban `Math.round`, `toFixed`, `parseFloat`, `Number.parseFloat`, and `/` everywhere under `src/auction/engine/` except the one bigint `/` in `money.ts`'s `roundHalfUp` (ported whole) | Yes |
| Q6 | Commit `CLONES.md` in `saas foundation` (diff shown in the Session 0 report; it also carries the pre-existing uncommitted footnote row) | Shane commits |
