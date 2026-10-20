# NEXT

## ▶ Next session: task 1.6 (`replay`, `fold`, `settle`, `lotStatus` in the engine; the engine half of `auction:eval`)

`replay(lot, submissions, rules)` applies D-17 before `applyBid` (same `(bidderId, key)` and amount → REPLAY with the prior seq, no row; different amount → IDEMPOTENCY_MISMATCH, no row; another bidder's same key string is a new bid). `fold(lot, rows)` rebuilds `LotState` from ledger rows and refuses a seq gap or a row whose outcome disagrees with re-applying it. `settle(lot, state, nowMs)` per D-22 with `roundHalfUp(hammer × bps, 10000)` from `money.ts`, `null` while open, `rulesHash` on the row. `lotStatus` per D-21. Then `scripts/auction-eval.ts` reads `fixtures/auctions.json` + `submissions.jsonl`, replays every lot, diffs against `expected_bids.csv` / `expected_lots.csv` column for column (220 submissions, 36 lots), prints the brief §10 table and the hash, exits non-zero on a difference. Goldens: GB-15, GB-16, GB-18, GB-20, GB-21; a determinism test replays twice. Read `tools/reference_replay.py` for the CSV column order only. Still no Prisma.

**2026-10-19 (Session 3, Mac): task 1.5 done (D-34).** `src/auction/engine/engine.ts` (`Lot`, `LotState`, `BidResult`, `hardCloseMs`, `openState`, `incrementFor`, `minNextBid`, `reserveMet`, `applyBid`), `tests/unit/engine.test.ts` (19 tests: the task's goldens with the oracle's exact values, integer refusals, no-mutation determinism). `rules:lint` no longer counts `/` inside `import` lines (the engine's `./money` and `./rules` specifiers tripped it); the banned-name grep still sees imports.

**Gate at the end of Session 3:** `rules:lint` OK (7 bands, hash = D-23, engine clean), `tsc --noEmit` clean, eslint clean on the touched files, unit tests touched 102/102 (`engine`, `rules`, `money`, `fixtures-untouched`), `fixtures:check` OK. Full `npm test` not re-run (CI runs it on push). `auction:verify` and `auction:eval` still stubs. No throughput number exists yet.

**2026-10-19 (Session 2, Mac): task 1.4 done (D-33).** `src/auction/engine/rules.ts` (pure parser, `RULES_V1_HASH`, outcome constants and unions), `src/auction/load-rules.ts` (the one file read; refuses a non-D-23 hash), `scripts/rules-lint.ts` (schema + hash, banned-name grep, float lint; `npm run rules:lint` is now this script), `tests/unit/rules.test.ts` (39 tests: hash match, one-byte copy refused, 17 schema refusals, 15 banned patterns flagged, comments ignored, the `money.ts` `/` allowance).

**Gate at the end of Session 2:** `npm run lint` 0 errors (the template's 1 `orgId` warning), `npm run typecheck` clean, unit tests touched 82/82 (`rules`, `money`, `fixtures-untouched`), `rules:lint` OK (7 bands, hash = D-23, engine clean), `fixtures:check` unchanged, `auction:verify` and `auction:eval` still stubs. Full `npm test` not re-run (CI runs it on push). No throughput number exists yet; the first is `docs/LOAD.md` from task 1.11.

**Open for Shane:** build-log card #17 (by hand, see `KICKOFF.md`); task 1.1 is left unticked only because `foundation:check-modules` has not been run locally (CI's `modules-removed` job runs it).

**Not done, on purpose:** `prisma/schema/gavel.prisma`, `placeBid`, the `LotState` barrier tests, the load script, `docs/LOAD.md`.
