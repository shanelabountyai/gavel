# NEXT

## ▶ Next session: task 1.11 (load script and `docs/LOAD.md`)

`scripts/load-bids.ts` per D-19: M writers (default 200) over L lots (default 4) whose `scheduledEnd` is 10 s out, real clock, real `placeBid` over raw `pg` clients (`pgRunner`, `application_name` set), each writer bidding until its lot closes with a fresh key per attempt; prints outcome counts, bids/sec, p50/p95/p99 ms around `placeBid`, max `wait_event` duration seen in `pg_stat_activity`, then the hardware block (CPU, cores, memory, Node, Postgres `version()`, git SHA, command line), writes `docs/LOAD.md`, runs `auction:verify` last and fails if it fails. *Acceptance:* `docs/LOAD.md` committed from the first run on the Mac; `NEXT.md` quotes the line verbatim. Read first: `docs/phase-1-tasks.md` 1.11, brief §8 "The measurement", D-19, `tests/contention/barrier.test.ts` (raw clients, `RAW_APP`), `scripts/auction-verify.ts`. 200 raw connections exceed the default `max_connections` 100: decide pooling for the writers (or a smaller default) before writing, and record it.

**2026-10-19 (Session 8, Mac): task 1.10 done (D-39).** `tests/contention/barrier.test.ts`: N ∈ {2, 10, 25, 50} raw writers behind one holder on `LotState`, clock pinned at T − 1 s; §8 list, resend pass, `verifyLot`, raw connection count; the rollback-no-gap test; the V6 clock-order test (gate before `FOR UPDATE`, 2 s scripted hold). Red proof on `throwaway/v6-red` (deleted): clock read above the lock → `V6: seq 2 … placedAt 11:59:00, previous 11:59:01`. Green three runs in a row, N = 50 in 7.6 s.

**Gate at the end of Session 8:** `npm test` 320/320 (40 files), `tsc --noEmit` clean, eslint clean on `tests/contention`, `rules:lint` OK, `fixtures:check` OK, `auction:eval` OK, `auction:verify` OK (36 lots, 36 settled). No throughput number exists yet.

**For Shane to check (D-39):** the connection-leak check counts `application_name = 'gavel-contention'`, not every connection to the database, because the Prisma pool grows under 50 concurrent boundary lookups and stays open. The maxes are chosen within one increment so the outcome table does not depend on the lock order. Say so if you want widely spaced maxes and a per-run derived `acceptedCount` instead.

**For Shane to check (D-38):** V8's "no row with seq > bidCount at settlement" is not checked literally, because `Settlement` stores no bidCount and a late rejected row after settlement is legitimate. Accepted-after-close is caught by V6 and anything outcome-changing by the field comparison. Say so if you want a `bidCountAtSettlement` column instead.

**Pre-push secret grep** prints `src/core/auth/secret-box.ts` and `tests/invariants/inv-10-11-16-cron-secrets.test.ts` besides nothing else: both are template-owned source files that match on the word "secret", not credentials, and have been tracked since the clone. CLAUDE.md says the grep should print only `.env.example` (which is not tracked under that name here); tighten the rule text or accept these two.

**Earlier sessions:** Session 7 task 1.9 (D-38); Session 6 task 1.8 (D-37, `placeBid` under the lock); Session 5 task 1.7 (D-36, schema and migration); Session 4 task 1.6 (D-35, replay/fold/settle and `auction:eval`); Session 3 task 1.5 (D-34, `applyBid` and 19 goldens); Session 2 task 1.4 (D-33, rules loader and `rules:lint`); Sessions 0–1 ports and plan (D-26..D-32).

**Open for Shane:** build-log card #17 (by hand, see `KICKOFF.md`); task 1.1 is left unticked only because `foundation:check-modules` has not been run locally (CI's `modules-removed` job runs it).

**Not done, on purpose:** the load script and `docs/LOAD.md` (1.11), any HTTP route (Phase 3).
