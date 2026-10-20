# NEXT

## ▶ Next session: task 1.10 (the barrier test)

`tests/contention/barrier.test.ts` per D-18 and brief §8, for N in {2, 10, 25, 50} (CI: 25 via `GAVEL_BARRIER_N`, O-10): a lot with `closesAt = T`, the clock pinned to `T − 1000`, N raw `pg` clients each calling `placeBid(..., { run: pgRunner(client), now })` queued on the `LotState` row behind a holder, released together once `pg_locks` shows N waiters; assert the §8 list (V1–V7, `bidCount = N`, one leader, `closesAt = T − 1000 + W`, `extensionCount = 1`, `acceptedCount` as computed), then the resend pass (still N rows, every response `replayed: true`), then `verifyLot(pgTx(c), lotId, rules)` from `src/auction/verify-sql.ts` returns null, then `pg_stat_activity` count back to the pre-test count. Plus: one writer rolls back after the lock and the next seq has no gap. *Acceptance:* green at N = 50 locally three runs in a row with the same outcome table; a `placeBid` with the clock read before the lock is caught by V6, proved on a throwaway branch. Read first: `docs/phase-1-tasks.md` 1.10, brief §8 "The contention proof", D-18, `tests/contention/row-lock.ts` (`behindRowLock`, `RACE_TIMEOUT`), the race tests in `tests/integration/place-bid.test.ts`.

**2026-10-19 (Session 7, Mac): task 1.9 done (D-38).** `src/auction/verify-sql.ts` (`loadLot`, `verifyLot`, `verifyAll`: V2, V1 by fold, V3–V7 in SQL, V8 by settle, V9), `src/auction/close.ts` (`closeLots`, per lot under `FOR UPDATE`, idempotent), `scripts/auction-verify.ts`, `scripts/auction-close.ts`, `runDb()` in `scripts/auction-eval.ts`. The three npm scripts now load `.env.test` first. `tests/integration/verify.test.ts` (5): replay matches both files, close idempotent, V1, V8, V2. Red proof: premium + 1 in close → eval DIFF and V8 naming lot and field.

**Gate at the end of Session 7:** `npm test` 314/314 (40 files), `tsc --noEmit` clean, eslint clean on the touched files, `rules:lint` OK, `fixtures:check` OK, `auction:eval` OK on both halves (220 rows, 36 lots, rules sha256 = D-23), `auction:verify` OK (36 lots, 36 settled). No throughput number exists yet.

**For Shane to check (D-38):** V8's "no row with seq > bidCount at settlement" is not checked literally, because `Settlement` stores no bidCount and a late rejected row after settlement is legitimate. Accepted-after-close is caught by V6 and anything outcome-changing by the field comparison. Say so if you want a `bidCountAtSettlement` column instead.

**Pre-push secret grep** prints `src/core/auth/secret-box.ts` and `tests/invariants/inv-10-11-16-cron-secrets.test.ts` besides nothing else: both are template-owned source files that match on the word "secret", not credentials, and have been tracked since the clone. CLAUDE.md says the grep should print only `.env.example` (which is not tracked under that name here); tighten the rule text or accept these two.

**Earlier sessions:** Session 6 task 1.8 (D-37, `placeBid` under the lock); Session 5 task 1.7 (D-36, schema and migration); Session 4 task 1.6 (D-35, replay/fold/settle and `auction:eval`); Session 3 task 1.5 (D-34, `applyBid` and 19 goldens); Session 2 task 1.4 (D-33, rules loader and `rules:lint`); Sessions 0–1 ports and plan (D-26..D-32).

**Open for Shane:** build-log card #17 (by hand, see `KICKOFF.md`); task 1.1 is left unticked only because `foundation:check-modules` has not been run locally (CI's `modules-removed` job runs it).

**Not done, on purpose:** the `LotState` barrier tests (1.10), the load script and `docs/LOAD.md` (1.11), any HTTP route (Phase 3).
