# NEXT

## ▶ Next session: task 1.7 (schema and migrations)

`prisma/schema/gavel.prisma`: `Auction` (org, name, `softCloseWindowSeconds`, `maxExtensionSeconds`, `buyerPremiumBps`, `opensAt`), `Lot` (auction, number, title, description, imageUrl, consignor text, `startCents`, `reserveCents?`, `scheduledEnd`), `LotState` (1:1 with `Lot`, the D-16 columns, created in the same transaction as the lot), `Bidder` (user × org, paddle, status), `Bid` (D-14 columns; unique `(lotId, seq)`; unique `(lotId, bidderId, idempotencyKey)`), `Settlement` (D-22 columns, `rulesHash`, unique `lotId`). Hand-written SQL in the migration: append-only triggers on `Bid` and `Settlement` (UPDATE/DELETE raise), DELETE refused on `LotState`, the CHECKs listed in `docs/phase-1-tasks.md` 1.7. Every table carries `orgId`. *Acceptance:* a migration test applies from scratch on an empty database; UPDATE and DELETE on a `Bid` row fail with the trigger's message; `foundation:drift` clean. First Prisma in the project: read `docs/portfolio-overlap.md` for the donor schema and migration shapes (LoanBook's ledger triggers) before writing. The engine's `LedgerRow` and `FoldRow` types in `src/auction/engine/engine.ts` name the `Bid` columns task 1.9 will read back; keep the Prisma column names camelCase to match them.

**2026-10-19 (Session 4, Mac): task 1.6 done (D-35).** `replay`, `fold`, `lotStatus`, `settle` appended to `src/auction/engine/engine.ts`; `scripts/auction-eval.ts` (`npm run auction:eval`) replays the fixtures through the engine and diffs both expected files column for column; `tests/unit/replay.test.ts` (13 tests). First run matched the oracle on all 220 submissions and 36 lots; the §10 table it prints is line-for-line the oracle's `fixtures/samples/reference_replay.output.txt`.

**Gate at the end of Session 4:** `auction:eval` OK (220 rows, 36 lots, rules sha256 = D-23), `rules:lint` OK, `tsc --noEmit` clean, eslint clean on the touched files, unit tests touched 115/115 (`replay`, `engine`, `rules`, `money`, `fixtures-untouched`), `fixtures:check` OK. Full `npm test` not re-run (CI runs it on push). `auction:verify` still a stub (task 1.9). No throughput number exists yet.

**Pre-push secret grep** prints `src/core/auth/secret-box.ts` and `tests/invariants/inv-10-11-16-cron-secrets.test.ts` besides nothing else: both are template-owned source files that match on the word "secret", not credentials, and have been tracked since the clone. CLAUDE.md says the grep should print only `.env.example` (which is not tracked under that name here); tighten the rule text or accept these two.

**Earlier sessions:** Session 3 task 1.5 (D-34, `applyBid` and 19 goldens); Session 2 task 1.4 (D-33, rules loader and `rules:lint`); Sessions 0–1 ports and plan (D-26..D-32).

**Open for Shane:** build-log card #17 (by hand, see `KICKOFF.md`); task 1.1 is left unticked only because `foundation:check-modules` has not been run locally (CI's `modules-removed` job runs it).

**Not done, on purpose:** `prisma/schema/gavel.prisma`, `placeBid`, the `LotState` barrier tests, the load script, `docs/LOAD.md`.
