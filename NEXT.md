# NEXT

## ▶ Next session: task 1.5 (`incrementFor`, `minNextBid`, `openState`, `applyBid` in `src/auction/engine/engine.ts`)

Write it from `docs/domain-brief.md` §5–§6 only (never `tools/auctionlib.py` line for line). The test is a vitest table of GB-00..GB-14, GB-17, GB-19, GB-22, GB-23 from brief §9 with exact values. `applyBid(lot, state, bidderId, maxCents, nowMs, rules)` takes the `Rules` value from `parseRules` (D-33); a non-integer cents or ms throws (`assertCents` from `money.ts`) before anything else. `rules:lint` must stay OK: no `/`, no decimal literal, no clock in the engine. Then 1.6 (`replay`, `fold`, `settle`, `lotStatus`, the engine half of `auction:eval`) before any Prisma.

**2026-10-19 (Session 2, Mac): task 1.4 done (D-33).** `src/auction/engine/rules.ts` (pure parser, `RULES_V1_HASH`, outcome constants and unions), `src/auction/load-rules.ts` (the one file read; refuses a non-D-23 hash), `scripts/rules-lint.ts` (schema + hash, banned-name grep, float lint; `npm run rules:lint` is now this script), `tests/unit/rules.test.ts` (39 tests: hash match, one-byte copy refused, 17 schema refusals, 15 banned patterns flagged, comments ignored, the `money.ts` `/` allowance).

**Gate at the end of Session 2:** `npm run lint` 0 errors (the template's 1 `orgId` warning), `npm run typecheck` clean, unit tests touched 82/82 (`rules`, `money`, `fixtures-untouched`), `rules:lint` OK (7 bands, hash = D-23, engine clean), `fixtures:check` unchanged, `auction:verify` and `auction:eval` still stubs. Full `npm test` not re-run (CI runs it on push). No throughput number exists yet; the first is `docs/LOAD.md` from task 1.11.

**Open for Shane:** build-log card #17 (by hand, see `KICKOFF.md`); task 1.1 is left unticked only because `foundation:check-modules` has not been run locally (CI's `modules-removed` job runs it).

**Not done, on purpose:** `src/auction/engine/engine.ts`, `prisma/schema/gavel.prisma`, `placeBid`, the `LotState` barrier tests, the load script, `docs/LOAD.md`.
