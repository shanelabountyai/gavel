# NEXT

## ▶ Next session: task 1.12 (CI gate and the red/green proof)

CI runs `rules:lint`, `fixtures:check`, migrations, `auction:eval`, `auction:verify`, vitest including the barrier test at N = 25 (`GAVEL_BARRIER_N`), with a float lint over `src/auction/engine/` (no `/`, `Math.round`, `toFixed`, `parseFloat` in a cents, bps or ms path). Prove it on a throwaway branch by changing `increment_cents` of the first band to 150 (then revert): `rules:lint` and `auction:eval` must both go red. *Acceptance:* the red run and the green run are both linked in `NEXT.md`. Read first: `docs/phase-1-tasks.md` 1.12, `.github/workflows/ci.yml` as it stands, `scripts/rules-lint.ts` (what the float lint already covers). Then the Phase 1 gate: write the Phase 2 task list and stop for review.

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
