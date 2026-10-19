# CLAUDE.md — Gavel

Learning project: a timed online auction platform for estates and equipment where many writers fight over one row in the final seconds. Proxy (max) bidding with the increment table as data, soft-close anti-sniping on an injected clock with a hard cap, a bid accepted or rejected under one row lock and recorded either way in an append-only ledger, idempotent submission, and settlement (winner, second price plus increment, buyer's premium in integer cents) as a pure function the verifier recomputes from the ledger. **Synthetic data only. Never a real sale, bidder or payment. No claim about any auction law or any capacity: every throughput number names its hardware and the script that measured it.** Keep the scope-honesty banner verbatim in README.md.

Read first: `prd-gavel.md` (what), `docs/decisions.md` (authoritative; outranks the PRD), `docs/domain-brief.md` (vocabulary, lot kinds, bid rules, soft close, settlement, invariants, goldens, measurements), `docs/portfolio-overlap.md` (what to port, what not to build). Current work: `docs/phase-1-tasks.md`. Session state: `NEXT.md`.

## Non-negotiables
1. **`src/auction/engine/` is pure** (`engine.ts`, `rules.ts`, `money.ts`, `canonical.ts`; the service files `place-bid.ts`, `close.ts`, `verify.ts` sit beside it under `src/auction/` and may import Prisma and the clock). No Prisma, `@/core`, `@/app`, `Date.now`, `new Date`, `Math.random`, `process.env`, `fetch`, `setTimeout`. Lot, state, bid and `nowMs` in; outcome and new state out. Same inputs, same outcome; a test replays the fixtures twice and diffs nothing. `rules:lint` enforces the import list.
2. **One row, one lock, no retry loop.** A bid is judged inside one transaction that holds `SELECT … FOR UPDATE` on the lot's `LotState` row, at READ COMMITTED (D-13). No optimistic version column, no advisory lock, no SERIALIZABLE retry on the product path; those are Phase 4 measurements. `lock_timeout` is set; a timeout is `BID_TIMED_OUT`, retryable with the same key.
3. **Every well-formed attempt is one ledger row, and the ledger is append-only.** Accepted or rejected, each attempt takes the next gap-free `seq` and records price, leader and close before and after it (D-14). UPDATE and DELETE on `Bid` and `Settlement` are refused by trigger. A correction is a superseding row. N attempts, N rows: the barrier test counts them.
4. **Time is injected and read under the lock.** `placedAt` is `now()` from `@/core/clock`, called after `FOR UPDATE` returns, once per bid (D-15). A client never supplies a time. A test that reads the system clock is wrong even when it passes.
5. **`LotState` is a verified projection, never stored truth.** It exists so the hot path locks one row; `auction:verify` folds the ledger and fails on any column that differs (D-16). Nothing but `placeBid` writes it. Lot status (SCHEDULED / OPEN / CLOSED / SETTLED) is derived; nothing sets a state by hand (D-21).
6. **Integers only.** Cents, basis points, epoch milliseconds. One money module (ported from LoanBook), one `roundHalfUp`, used once, in `settle` for the premium. A non-integer at the boundary is a typed refusal that writes nothing. A float in a cents, bps or ms path fails lint.
7. **Rules are data.** Increments, soft-close defaults and premium live in `rules/auction.v1.json` (content-hashed, hash in D-23, on every settlement row); per-auction settings on the `Auction` row. Adding a rule, outcome or band needs a `docs/decisions.md` entry, a golden and regenerated fixtures.
8. **Settlement is recomputable.** `settle(fold(ledger))` must equal every stored `Settlement` row; `auction:verify` checks it (V8). The hammer is the final price; the premium is one half-up rounding; unsold is an outcome, not an error.
9. **Never "handles", "scales", "fast" or "optimal" without the number and the hardware.** Screens, commit messages and write-ups say N writers, bids per second, p95 ms, CPU, Postgres version and the `docs/LOAD.md` line. The kit records no throughput number; the first run on the Mac is the first number.
10. **Fixtures are frozen; never edit an expected value to pass a test.** `fixtures/` is generated once by `tools/build_fixtures.py --seed 20261019` + `tools/reference_replay.py --write-expected`; `tools/verify_fixtures.py` prints OK in CI. If TypeScript disagrees with the oracle, stop and show the owner both derivations. Product code never reads an expected file; only `auction:eval` does.
11. **`auction:verify` gates everything** and runs in CI on every push, at the end of the barrier test and at the end of the load script. If it fails, nothing else merges.

## Working rules
- **TDD order:** money and canonical hash → rules loader and lint → `incrementFor` and `applyBid` (GB) → `replay`, `fold`, `settle` and the engine half of `auction:eval` → schema and triggers → `placeBid` under the lock with idempotency and the clock → database replay, `auction:close`, `auction:verify` → the barrier test → the load script → CI gate → (Phase 2) invoices, corrections, dispute view → (Phase 3) screens with polling and outbox notices → (Phase 4) lock-strategy experiments. Write the failing test against a committed fixture or golden first.
- **Fixtures:** tests read `fixtures/`; code never generates them. To change one, change `docs/decisions.md` first, regenerate with the two tools in brief §11, confirm `tools/verify_fixtures.py` and `tools/golden_answers.py` print OK, update the hashes in brief §11 and D-23, review the diff.
- `tools/*.py` are test oracles, not product code. Don't import or port them line for line; `auctionlib.py` is the spec made executable, the TypeScript engine is written from `docs/domain-brief.md` §5–§7 and must agree with it on every submission.
- **Port before you write.** Donors are listed in `docs/portfolio-overlap.md` with real paths. Read the donor, port it, record the lineage in `docs/decisions.md`.
- **Race tests specify an interleaving; they never sample one.** Explicit barriers, `pg_locks` as the happens-before edge, a hard timeout, raw connections closed in `finally`, `fileParallelism: false` for the contention suite. A "flaky" contention test is a broken one, not a retry candidate (Bookable A-009).
- Phase gate: don't start the next phase until the current phase's exit criteria pass. Phases: 1 engine + ledger + lock + proof → 2 operate (invoices, corrections, dispute view) → 3 surfaces (catalog, bidder page with polling, outbox notices) → 4 experiments (optional). Write the next phase's task list at the gate and stop for review.
- Small commits, one concern each, naming specific files (never `git add -A`). Note seams for non-goals (payments, push, fraud) but don't build them.
- Ask before adding dependencies. The foundation's `pg` client is enough for the raw connections; no load-testing library, no scheduler, no socket library.
- **Model is pinned to Claude Fable 5.1 (`claude-fable-5-1`)** in `.claude/settings.json` (D-3). Money and concurrency logic stay on Fable; drop to Sonnet only for an item with no new logic.
- Public repo (D-5): before every push, `git ls-files | grep -iE "\.env$|secret|credential|\.pem$|\.key$"` must print only `.env.example`.
- End each session by updating `NEXT.md`: what was built, decided, left open, the gate output, and the latest `docs/LOAD.md` line if one exists.

## Session 0 — reuse check (run before sequencing the backlog)

Before any task is scoped or built, run the reuse scan against the task list and act on the output:

    cd ~/Projects
    python3 reuse-scan.py check "gavel/docs/phase-1-tasks.md" "gavel"

Three buckets come back:

- **🟢 REUSE** — already built elsewhere. Do NOT rebuild. Port the implementation, mark the task done, and cite the donor item ID (e.g. "lifted from bookable `packages/db/testing/row-lock.ts`") so the lineage survives.
- **🟡 ADAPT** — close to something built. Read the existing implementation before writing. Then either extend the shared module or fork it *with a written reason* recorded in `docs/decisions.md`.
- **🔵 NEW** — no prior implementation. This is the real size of the project. Sequence only these.

**Record the outcome in `docs/decisions.md`** as a dated decision: what was reused, from where, and which project governs when the two diverge. `docs/decisions.md` outranks any PRD text. The scanner indexes markdown backlog tables and may not parse a checkbox task list; record the result either way. Re-run the check after the task list is re-sequenced.

## Stack
TypeScript on a clone of saas-foundation v1.3.0: Next.js 16, Prisma 7, PostgreSQL 17, vitest, Playwright. **Port 5600** (proposed; confirm against the port table in `~/.claude/CLAUDE.md` and add the row in the same commit as the config — O-1). The auction house is the org; a bidder is a user with a `Bidder` row. Foundation modules: keep orgs, roles, invites, audit, notifications (outbox, Phase 3); remove or leave unwired billing and share links (D-2). Clone tables in `prisma/schema/gavel.prisma` with their own migrations; triggers and CHECKs as hand-written SQL. Template-owned paths (`src/core/**`, `tests/invariants/**`, core migrations) are never edited here. Local `DATABASE_URL`s carry `?connection_limit=10&pool_timeout=20`; the contention test's writers are raw `pg` clients outside that pool. Python 3 (stdlib only) in `tools/`. CI runs with a non-UTC `TZ` on the Postgres service.

## Commands (create in Phase 1, task 1.1)
- `npm test` — vitest against the local `gavel_test` database; the contention suite runs serially
- `npm run auction:eval` — replays `fixtures/submissions.jsonl` through the engine (and, from task 1.9, through `placeBid` with a scripted clock) and diffs against `fixtures/expected_bids.csv` and `expected_lots.csv`; prints the brief §10 table and the rules hash; exits non-zero on any difference. Prints `0 lots` and exits 0 until task 1.6
- `npm run auction:verify` — V1–V9 (brief §8) over every lot; exits non-zero naming the first lot and check
- `npm run auction:close -- --as-of <iso>` — settles every closed, unsettled lot as of the given instant; idempotent
- `npm run load:bids -- [--writers 200] [--lots 4] [--seconds 10]` — the D-19 measurement; writes `docs/LOAD.md`; runs `auction:verify` last
- `npm run fixtures:check` — `python3 tools/verify_fixtures.py && python3 tools/golden_answers.py && git diff --exit-code fixtures/ && test -z "$(git status --porcelain fixtures/)"`
- `npm run rules:lint` — validates `rules/auction.v1.json`, checks its hash against D-23, greps `src/auction/engine/` for the banned imports and float operations

## Definition of done (any task)
Tests green, `auction:eval` matching the expected files exactly, `auction:verify` OK, `fixtures:check` OK, `rules:lint` OK, no float and no forbidden import under `src/auction/engine/`, decisions doc updated if a rule changed, `NEXT.md` updated, numbers with their hardware (not adjectives) in the commit message when a measurement changed.
