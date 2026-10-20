# NEXT

## ▶ Next session: task 2.4 (Shane reads six ledgers by hand), then 2.5

2.4 is yours, not mine: open `/o/gavel-fixtures/lots/<id>/history` for L005, L017, L027 (CHAIN_TO_CAP) and L006, L018, L028 (SNIPE) and say per row whether a bidder at the screen would have agreed (brief §6). Sign in at `/demo` as owner@acme.demo.test; the spec's `beforeAll` adds that owner to the `gavel-fixtures` org, or run `npm run auction:eval` against the dev DB and add the membership by hand. Any disagreement stops the phase and goes to the oracle first. Then 2.5 (confirm the database half of `auction:eval` on the 2.2 schema in CI), and write `docs/phase-3-tasks.md`.

**2026-10-20 (Session 13, Mac): task 2.3 done (D-45).** `src/app/o/[org]/lots/[id]/history/page.tsx`; `e2e/lot-history.spec.ts` (L006, 7 rows). Gate: `npm test` 345/345 (44 files), `tsc --noEmit` clean, eslint clean on the new files, Playwright spec green on the production build. Not re-run this session: `fixtures:check`, `rules:lint`, `auction:eval`, `auction:verify` (no engine, schema or fixture change). The 2.1 invoices page is still not opened by any spec.

**2026-10-19 (Session 12, Mac): task 2.2 done (D-44).** Migration `20261021000000_settlement_corrections`; pure `resettle` in `engine.ts`; `correctSettlement` in `src/auction/correct.ts`; V8 walks the chain; invoices read the chain tip. Tests: `tests/unit/correction.test.ts` (8), `tests/integration/correction.test.ts` (5, the race behind `behindRowLock` on `LotState`, green 3 runs in a row).
- **For Shane to check (D-44 c):** an underbidder's price is **min(price their last accepted row reached, their own max)**, not the raw row price D-42 Q2 says: an outbid row's price is above that bidder's max. Say so if you want the raw price.
- **For Shane to check (D-44 b):** a withdrawn sale is the new correction-only outcome `UNSOLD_BY_CORRECTION` (DB CHECK only, not in the rules file, hash unchanged).
- **Migration applied to `gavel_test` only.** Run `npm run db:migrate` against the dev database when you next use it.

**2026-10-19 (Session 11, Mac): task 2.1 done (D-43).** Pure `invoice(settled)` in `engine.ts`; `invoicesForAuction` in `src/auction/invoice.ts`; staff page `/o/[org]/auctions/[id]/invoices` (`audit.read`, owner and admin). Tests: `tests/unit/invoice.test.ts` (8) and `tests/integration/invoice.test.ts` (4); expected totals are summed from `expected_lots.csv` inside each test.
- **Gate:** `npm test` 332/332 (42 files) once the guard-first invariant fix was in (the first sweep caught `requireOrg` not being the page's first await); `tsc --noEmit` clean; eslint clean on the new files; `fixtures:check` OK; `rules:lint` OK; `auction:eval` OK (both halves); `auction:verify` OK (36 lots, 36 settled).
- **Not checked in a browser:** the page is typechecked and passes the invariant, but no Playwright spec renders it yet. The 2.3 spec can open it on the same seeded org.

**2026-10-19 (Session 10, Mac): task 1.12 done (D-41).**
- **Why CI was red since D-33:** only the Playwright step failed. `next start -p 6000` refuses with `Bad port: "6000" is reserved for x11`, and Chrome blocks 6000 too. Every gate step was already green. The port moved to **6100** in `package.json`, `playwright.config.ts`, `ci.yml`, `.env.test`, `.env.local`, README and the `~/.claude/CLAUDE.md` row; the next free port is now 6200.
- **The four gate steps now run independently**, so one push shows every red; any failure still fails the job.
- **Green run:** https://github.com/shanelabountyai/gavel/actions/runs/39356276875 (f43447e), the first fully green CI run, Playwright included.
- **Red run:** https://github.com/shanelabountyai/gavel/actions/runs/39356292823 (draft PR #1, first band `increment_cents` 100 → 150, closed unmerged, branch deleted). `rules:lint`, `auction:eval`, `auction:verify` red on the D-23 hash refusal; `fixtures:check` red on `golden_answers.py`.
- **Local extra proof:** with the hash constant also updated, `rules:lint` passes and `auction:eval` still fails: `DIFF: expected_bids.csv line 19 (S00018) column price_after_cents: got "2950", expected "2900"`.

**Phase 1 gate output (CI run 39356276875):** lint, typecheck, migrations, `fixtures:check`, `rules:lint`, `auction:eval` (engine and database halves), `auction:verify`, vitest (barrier at N = 25), Playwright, `foundation:check-modules`: all green. Latest `docs/LOAD.md` line unchanged from Session 9 below.

**For Shane:** the template's `CLONES.md` row still says 6000 (D-31 Q6 makes that commit yours). Task 1.1 can now be ticked if you accept CI's `modules-removed` job as the `foundation:check-modules` run.

**2026-10-19 (Session 9, Mac): task 1.11 done (D-40).** `scripts/load-bids.ts` and `npm run load:bids`; 200 logical writers share a raw `pg.Pool` of 40 (Shane's call: `max_connections` 100 is machine-wide). The first number, verbatim from `docs/LOAD.md`:

`2026-10-20T01:50:26.585Z 1ad8c4f: 200 writers, 40 connections, 4 lots, 10 s + soft close: 68360 ledger rows in 15.9 s = 4293 bids/s; placeBid p50 5.1 / p95 28.9 / p99 68.7 ms; end to end p50 41.7 / p95 77.1 / p99 113.2 ms; max lock wait 204.4 ms; 0 timeouts; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

Latency is around `placeBid` with a connection in hand, same process, no HTTP; the end-to-end figure includes the wait for one of the 40 pooled connections. Max lock wait is a 100 ms-sampled upper bound. 0 timeouts, verify OK over 42 lots. The soft-close window for the load auction is 2 s with a 6 s cap so the run is bounded.

**Gate at the end of Session 9:** see the commit; `load:bids` exit 0 with `auction:verify` OK (42 lots, 42 settled).

**2026-10-19 (Session 8, Mac): task 1.10 done (D-39).** `tests/contention/barrier.test.ts`: N ∈ {2, 10, 25, 50} raw writers behind one holder on `LotState`, clock pinned at T − 1 s; §8 list, resend pass, `verifyLot`, raw connection count; the rollback-no-gap test; the V6 clock-order test (gate before `FOR UPDATE`, 2 s scripted hold). Red proof on `throwaway/v6-red` (deleted): clock read above the lock → `V6: seq 2 … placedAt 11:59:00, previous 11:59:01`. Green three runs in a row, N = 50 in 7.6 s.

**Gate at the end of Session 8:** `npm test` 320/320 (40 files), `tsc --noEmit` clean, eslint clean on `tests/contention`, `rules:lint` OK, `fixtures:check` OK, `auction:eval` OK, `auction:verify` OK (36 lots, 36 settled). No throughput number exists yet.

**For Shane to check (D-39):** the connection-leak check counts `application_name = 'gavel-contention'`, not every connection to the database, because the Prisma pool grows under 50 concurrent boundary lookups and stays open. The maxes are chosen within one increment so the outcome table does not depend on the lock order. Say so if you want widely spaced maxes and a per-run derived `acceptedCount` instead.

**For Shane to check (D-38):** V8's "no row with seq > bidCount at settlement" is not checked literally, because `Settlement` stores no bidCount and a late rejected row after settlement is legitimate. Accepted-after-close is caught by V6 and anything outcome-changing by the field comparison. Say so if you want a `bidCountAtSettlement` column instead.

**Pre-push secret grep** prints `src/core/auth/secret-box.ts` and `tests/invariants/inv-10-11-16-cron-secrets.test.ts` besides nothing else: both are template-owned source files that match on the word "secret", not credentials, and have been tracked since the clone. CLAUDE.md says the grep should print only `.env.example` (which is not tracked under that name here); tighten the rule text or accept these two.

**Earlier sessions:** Session 7 task 1.9 (D-38); Session 6 task 1.8 (D-37, `placeBid` under the lock); Session 5 task 1.7 (D-36, schema and migration); Session 4 task 1.6 (D-35, replay/fold/settle and `auction:eval`); Session 3 task 1.5 (D-34, `applyBid` and 19 goldens); Session 2 task 1.4 (D-33, rules loader and `rules:lint`); Sessions 0–1 ports and plan (D-26..D-32).

**Open for Shane:** build-log card #17 (by hand, see `KICKOFF.md`); task 1.1 is left unticked only because `foundation:check-modules` has not been run locally (CI's `modules-removed` job runs it).

**Not done, on purpose:** any HTTP route and the HTTP latency number (Phase 3); the lock-strategy experiments (Phase 4).
