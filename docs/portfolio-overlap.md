# Gavel — Portfolio Overlap Check

Checked 2026-10-19 against the build-log card list and the sibling repos readable from the kickoff workspace: `bookable-appointment-service`, `loanbook`, `adjuster`, `bracketry`, `saas-foundation`, `triage` (kit), `housefile` (kit), `boxloop`, `showcall`. **The source trees of Bookable, LoanBook, Adjuster, Bracketry and saas-foundation were read**; the "Where" column names real paths that existed on that date. Purpose: keep Gavel from re-teaching what a sibling built, and keep the comfortable parts (a catalog, a lot page, a countdown) from eating the new part (N writers on one row, judged in order, proven).

## Verdict

The card lists four chips. Read literally, one is partly built:

| Card chip | Already in the portfolio? | What Gavel does instead |
|---|---|---|
| high contention | **Partly, at N = 2.** Bookable A-009 proves two concurrent bookings of one slot yield one appointment, with an exclusion constraint as the arbiter and a deterministic barrier (`packages/db/testing/row-lock.ts`, `packages/db/booking/races.test.ts`) | **New:** N writers (up to 50) on one *existing* row whose correct answer depends on every writer before it; `SELECT … FOR UPDATE` as the arbiter (not a constraint, which answers "is this unique", not "is this in order"); a gap-free sequence; a fold the verifier recomputes; a load script with hardware |
| proxy bidding | **No.** Nothing in the portfolio bids on anyone's behalf | **New:** the second-price-plus-increment rule with the increment table as data, ties by sequence, a hidden reserve floor, and 23 goldens the oracle and the engine both pass |
| soft close | **No.** Bracketry's clock is injected and its engine pure, but no sibling moves a deadline in response to a write | **New:** `closesAt ← min(now + W, hardClose)` on the injected clock read under the lock, chained to a cap, with the before/after close on every ledger row |
| auction settlement | **Partly.** LoanBook's payoff and BoxLoop's invoices compute money as integers from a ledger | Settlement as a pure function of the fold (winner, hammer, premium with one half-up rounding), insert-only, recomputed by the verifier; the unsold outcomes as first-class results |

Suggested card chips once it ships: `N-writer barrier test on one row (N stated)` · `FOR UPDATE, READ COMMITTED, no retry loop` · `proxy bidding, increments as data` · `soft close on the injected clock, capped` · `append-only bid ledger with before/after` · `settlement recomputed by the verifier` · `bids/sec and p95 with the hardware`.

## Reuse — port, do not rebuild

| Capability | Donor | Where to read first | Gavel use |
|---|---|---|---|
| Deterministic barrier for a row-lock race: hold the lock on a separate connection, start the writers, poll `pg_locks` for `granted = false` until N are queued, release; no timers | Bookable | `packages/db/testing/row-lock.ts` (`behindRowLock`), header comment on why `pg_locks` is the happens-before edge and why it needs serial test files | `tests/contention/barrier.test.ts` with the table generalised to `LotState` and N raised to 50 (D-18) |
| Race tests that specify an interleaving instead of sampling one; explicit `barrier()` promises; hard `RACE_TIMEOUT`; the "flaky = broken" rule | Bookable | `packages/db/booking/races.test.ts` (tests 1, 1b, 1c), CLAUDE.md "The gate" | The same discipline; 1c's "a rolled-back attempt leaves no phantom" becomes "a rolled-back bid leaves no seq gap" |
| SQL invariant run after a race and by a nightly fuzz (`overlappingPairs`) | Bookable | `packages/db/booking/races.test.ts` `overlappingPairs`, CLAUDE.md "The race tests are deterministic" | `src/auction/verify-sql.ts` V1–V9, used by the test and by `auction:verify` |
| Transaction-scoped lock that is released at COMMIT or ROLLBACK with nothing to forget; the reasons for `_xact_`; raising Prisma's interactive-transaction timeout above the lock wait | Bookable | `packages/db/booking/book.ts` (`lockProviderDay`, the comment above it, the `timeout` comment near line 274) | D-13 chooses `FOR UPDATE` over the advisory lock and says why; the Prisma timeout lesson is task 1.8's acceptance |
| Idempotency key on the write path: `findByIdempotencyKey` before the write, `@@unique([businessId, idempotencyKey])` | Bookable | `packages/db/booking/book.ts` (`findByIdempotencyKey`, line ~172), `packages/db/prisma/schema.prisma` (`idempotencyKey`, `@@unique`) | D-17, scoped `(lotId, bidderId, key)`, with the mismatch case added |
| Error mapping that handles more than one shape of the same database refusal (SQLSTATE at statement end vs constraint name at commit) | Bookable | CLAUDE.md "A-078 added a second half to that rule", `packages/db/errors.ts` | `lock_timeout` (55P03) and the unique-index refusal (23505) on the idempotency index are both mapped and both provoked in tests |
| Money as integers, one module, one rounding rule, boundary guards that refuse non-integers; `roundHalfUp(numerator, denominator)` over bigints | LoanBook | `src/ledger/money.ts` (`assertCents`, `assertBps`, `roundHalfUp`, `formatCents`) | `src/auction/engine/money.ts`, ported whole; the premium is the one rounding |
| Append-only by trigger (UPDATE/DELETE raise), as hand-written SQL in a Prisma migration; deferred constraint trigger pattern | LoanBook | `prisma/migrations/20260929000000_ledger_init/migration.sql` (`ledger_entry_check`, the append-only trigger block); Bracketry `prisma/migrations/20261008000000_league_init/migration.sql` line ~516 | `Bid` and `Settlement` append-only; `LotState` DELETE refused |
| `ledger:verify` as the CI gate that nothing merges past; fixtures frozen by a Python oracle; "never edit a fixture to pass" | LoanBook | CLAUDE.md non-negotiables 7 and "Fixtures are frozen"; `.github/workflows/ci.yml` (Postgres 17 service with a non-UTC `TZ`, `fixtures:check` then `ledger:verify` before vitest) | `auction:verify`, `fixtures:check`, the same CI shape with `TZ=America/Chicago` on the service |
| Canonical JSON + sha256 content hash; safe integers only, floats throw | Adjuster | `src/rules/canonical.ts` (`canonicalJson`, `sha256Hex`) | The rules-file hash in D-23 and on every `Settlement` row |
| Rules as data with a closed vocabulary; a rule the code cannot express is a vocabulary change | Adjuster | CLAUDE.md non-negotiable 1, `docs/decisions.md` D1 | `rules/auction.v1.json`, `rules:lint` over `src/auction/engine/` |
| Injected clock: `now()` from `@/core/clock`, `advanceClock` in tests; the engine takes `now` as a parameter and never reads a clock | saas-foundation, Bracketry | `src/core/clock.ts`; Bracketry `src/lib/league/types.ts` header, `docs/prds/07-decisions.md` D-3, `src/app/o/[org]/seasons/result-actions.ts` (`now()` at the action, never in the engine) | D-15; `src/auction/engine/engine.ts` takes `nowMs`; `placeBid` reads `now()` after the lock |
| Derived status, computed on read; append-only results with a superseding row as the correction | Bracketry | `docs/prds/07-decisions.md` D-13, D-22 | D-21 lot status; Phase 2 settlement corrections |
| Pure engine with a lint that bans `Date.now`, `Math.random`, Prisma and app imports | Bracketry | CLAUDE.md "The engine rules", the lint rule from L-002 | `rules:lint` over `src/auction/engine/` |
| Foundation clone procedure, module switch, `CLONES.md` row, `foundation:drift` | saas-foundation | `scripts/new-project.ts`, `scripts/foundation-modules.ts` (`MODULES`: billing, notifications), `CLONES.md` | KICKOFF steps 2–4; D-2 |
| Outbox for notices that are never sent; templates registered at runtime | Callboard (via `CLONES.md` note), saas-foundation | `src/modules/notifications/` | O-11, Phase 3 |
| Frozen fixtures + Python oracle + golden answers + two-run hash check | Housefile and Triage kits | `tools/build_fixtures.py`, `verify_fixtures.py`, `golden_answers.py`, `reference_*.py`; brief §12 | Same workflow: `build_fixtures.py`, `reference_replay.py`, `golden_answers.py`, `verify_fixtures.py` |
| "Never optimal / never accurate without the number"; measured values with their denominators | Bracketry, Housefile | their CLAUDE.md rules | CLAUDE.md non-negotiable 9, D-24 |
| Mock payment provider, never real money | BoxLoop | CLAUDE.md "Mock payment provider only" | Not even that: settlement stops at an invoice (non-goal) |

## New — each with the fixture that proves it

| # | Lesson | Not in any sibling because | Proven by |
|---|---|---|---|
| 1 | N writers on one existing row, each judged against the state the previous one left, under `FOR UPDATE` at READ COMMITTED with no retry loop | Bookable's arbiter is an exclusion constraint on a row that does not yet exist; its N is 2 | Barrier test at N = 2, 10, 25, 50 (D-18) |
| 2 | The choice between a row lock, an advisory lock, an optimistic version and SERIALIZABLE, written down with the reason for each rejection | Bookable chose the advisory lock for a reason that does not apply here and did not compare | D-13; Phase 4 measures the alternatives |
| 3 | A gap-free per-row sequence assigned under the lock, so "no lost, no duplicated" is a count | No sibling numbers writes per parent | V2; barrier test `bidCount = N` |
| 4 | Every attempt, including rejections, as a ledger row carrying the state before and after it | LoanBook's ledger holds accepted entries only | D-14; V4, V5; the LATE and BELOW_MIN lots |
| 5 | A verified projection: one hot row that must equal the fold of its ledger, checked in CI and after every race | LoanBook forbids the column; Bracketry allows a cache "only with a verify path" and never built one | D-16; V1 |
| 6 | Proxy bidding with the increment as data and the second price capped at the winner's max and floored at the reserve | — | GB-01..GB-09, GB-22, GB-23; the PROXY_WAR, TIE, RESERVE lots |
| 7 | A deadline that moves because of a write, on an injected clock read under the lock, chained to a cap | Bracketry's clock never moves a deadline | GB-10..GB-14; the CHAIN_TO_CAP and SNIPE lots; V5, V6 |
| 8 | Idempotency with a mismatch case and a per-bidder scope | Bookable has the key, not the mismatch | GB-18; the REPLAY lots; the barrier test's resend pass |
| 9 | Settlement as a pure function recomputed from the fold, with the unsold outcomes as results, not errors | LoanBook's payoff is a quote, not a verdict | GB-15, GB-16, GB-21; V8 |
| 10 | A throughput number that cannot be stated without its hardware, written by the script that measured it | Pulseboard states the command and hardware for performance claims (its rule 2); nothing measures contention | D-19; `docs/LOAD.md` |
| 11 | The clock-under-the-lock argument (a waiter must be judged at the time it was judged) | Bookable's `now` is read before the lock; a booking's validity does not change while it waits | D-15; V6 |
| 12 | Shane's reading of six lots' ledgers row by row as the only non-synthetic check | — | Phase 2 by-hand task |

## Guardrails — lessons Gavel must not take

| Lesson | Owner | Rule here |
|---|---|---|
| Exclusion constraints, half-open ranges, DST and the two time axes | Bookable | Gavel's times are instants only (epoch ms); there is no calendar-day axis to cross; no `@db.Date`, no `new Date(string)` all the same |
| Double-entry ledger, accrual, amortization, payment waterfalls | LoanBook | No money moves; the bid ledger records bids, not debits and credits |
| Subscription state machines, proration, dunning, a mock payment provider | BoxLoop | No payment at all; the invoice is a sum |
| Rules engine with versioning, authoring UI, impact diff | Adjuster | One rules file with a closed set of keys; no editor |
| Real-time push, presence, live cueing | Showcall Live | Polling with an ETag; no sockets |
| Scheduling under constraints, tiebreak chains, brackets | Bracketry | Nothing is scheduled; a lot's end is a timestamp |
| Entity resolution, import preview, undo by hash | Housefile | Bidders are registered, never matched |
| Analytics rollups, raw SQL hot paths scoped by org | Pulseboard | The hot path is one transaction; the only raw SQL is the lock, the triggers and the verifier |
| Multi-tenant billing, share links | saas-foundation | Unwired (D-2) |

## How this was checked

- Read: Bookable `packages/db/testing/row-lock.ts`, `packages/db/booking/races.test.ts` (tests 1, 1b, 1c), `packages/db/booking/book.ts` (the D-24 lock, `findByIdempotencyKey`, the transaction-timeout comment), `packages/db/prisma/schema.prisma` (`idempotencyKey` unique), CLAUDE.md; LoanBook `src/ledger/money.ts`, `prisma/migrations/20260929000000_ledger_init/migration.sql`, `.github/workflows/ci.yml`, CLAUDE.md; Adjuster `src/rules/canonical.ts`, CLAUDE.md; Bracketry `src/lib/league/prng.ts`, `types.ts` header, `prisma/migrations/20261008000000_league_init/migration.sql` (append-only block), `docs/prds/07-decisions.md` D-3/D-13/D-22, CLAUDE.md; saas-foundation `src/core/clock.ts`, `src/core/db/index.ts`, `scripts/foundation-modules.ts`, `CLONES.md`, `package.json`, tag `v1.3.0`; the Triage and Housefile kits in full.
- Not readable from the workspace: `~/.claude/CLAUDE.md` (the port table), `~/Projects/reuse-scan.py`. KICKOFF steps 1 and 6 cover both.
