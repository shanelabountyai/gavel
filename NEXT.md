# NEXT

## ▶ Next session: task 1.4 (rules loader + `rules:lint` as a real script) — then 1.5, 1.6 before any Prisma

`docs/phase-1-plan.md` is the order; D-31 holds Shane's answers (port 6000, Tx interface, two barrier designs, no `canonical.ts`, billing DROPs in the first Gavel migration, the float lint excusing the one bigint `/` in `money.ts`). 1.4 reads Bracketry `eslint.config.mjs` (L-002 block) for the shape of the engine-scoped import ban; `rules:lint` becomes a tsx script (schema check, raw sha256 = D-23, banned-name grep of `src/auction/engine/`, float lint per Q5).

**2026-10-19 (Session 1, Mac): task 1.3 done, task 1.2 closed (D-32).** `src/auction/engine/money.ts` ported from LoanBook (`MoneyError`, `assertCents`, `assertBps`, `roundHalfUp`, `formatCents`; three display/read helpers deliberately left behind), 42 unit tests including GB-16. `tests/contention/row-lock.ts` ported from Bookable (`behindRowLock` with the table as a parameter, `barrier()`, `RACE_TIMEOUT`); `tests/contention/barrier.test.ts` proves the `pg_locks` barrier on the template's `Org` row with N raw `pg` writers: passed at N=10 (130 ms) and N=50 (179 ms) on the Mac, Homebrew Postgres 17.11, `max_connections` 100; connection count equal before and after. `src/auction/errors.ts`: `sqlState()` for the two driver shapes from D-30 (not yet exercised against a database; 1.8 is its first caller). `tests/unit/fixtures-untouched.test.ts`: nothing under `src/` mentions `fixtures/` or an expected file.

**Gate at the end of Session 1:** `npm run lint` 0 errors (the template's 1 `orgId` warning), `npm run typecheck` clean, new tests 51/51, `fixtures:check` OK, `rules:lint` OK (still the hash-only stub), `auction:verify` and `auction:eval` still stubs. Full `npm test` not re-run this session (Session 0: 30 files / 154 tests, 264.8 s); CI runs it on push. No throughput number exists yet; the first is `docs/LOAD.md` from task 1.11.

**Open for Shane:** build-log card #17 (by hand, see `KICKOFF.md`); task 1.1 is left unticked only because `foundation:check-modules` has not been run locally (CI's `modules-removed` job runs it).

**Not done, on purpose:** `src/auction/engine/rules.ts`, `engine.ts`, `prisma/schema/gavel.prisma`, `placeBid`, the `LotState` barrier tests, the load script, `docs/LOAD.md`.
