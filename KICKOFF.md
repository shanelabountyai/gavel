# Kickoff — Gavel (Build Log #17, Auction Platform, main track)

Paste the block below into Claude Code started in `~/Projects`, on Fable (`/model claude-fable-5-1`). The kit is the repo itself: `shanelabountyai/gavel` holds the docs, tools, the rules file and the frozen fixtures; nothing has been cloned, installed or run in TypeScript yet.

```
Gavel — online auction platform: proxy bidding, soft close, N writers on one row (Build Log #17,
main track). The kickoff kit is the repo at ~/Projects/gavel (clone shanelabountyai/gavel if it
is not there). Nothing exists yet besides the kit: docs, tools/*.py, rules/auction.v1.json and
fixtures/. The saas-foundation clone has not been made.

Read, in order: CLAUDE.md, prd-gavel.md, docs/decisions.md (authoritative),
docs/domain-brief.md, docs/portfolio-overlap.md, docs/phase-1-tasks.md.

Steps, in order:
1. Port check. Read the port table in ~/.claude/CLAUDE.md. If 5600 is claimed, stop and tell
   me which port is free. If not, continue; you will add the row in step 3.
2. Clone the template and merge the kit into it (the kit repo has its own history; keep it):
   move ~/Projects/gavel (the kit checkout) to ~/Projects/gavel-kit; git clone
   "~/Projects/saas foundation" ~/Projects/gavel at tag v1.3.0 (git checkout v1.3.0, then
   git switch -c main); rename that remote to `template`; npm run new-project -- gavel 5600
   (once; FR-11 refuses a second run); commit the rewrite. Then git remote add origin
   <the kit repo URL or ~/Projects/gavel-kit>, git fetch origin, git merge
   --allow-unrelated-histories origin/main. Conflicts to resolve by hand: README.md (keep the
   template's "Cloned from saas-foundation v1.3.0. Port 5600" line at the top, then the kit's
   README with the banner verbatim), .gitignore (union), .claude/settings.json (merge the model
   pin; keep anything the template put there), .env.example (the template's entries plus the
   kit's). Everything else from the kit lands untouched: CLAUDE.md, KICKOFF.md, NEXT.md,
   prd-gavel.md, docs/, tools/, rules/, fixtures/. Delete ~/Projects/gavel-kit only after
   git log shows both histories.
3. Add the port row (gavel -> 5600) in ~/.claude/CLAUDE.md and the clone row in
   saas-foundation/CLONES.md (v1.3.0, 2026-10-19, "timed online auctions; N-writer row-lock
   contention, proxy bidding, soft close, settlement; synthetic only; not deployed"). Put
   ?connection_limit=10&pool_timeout=20 on the local DATABASE_URLs. Confirm vercel.json has the
   house ignoreCommand. Module switch per D-2: billing and share links removed or recorded as
   unwired in docs/decisions.md.
4. npm ci, then npm run db:setup. Confirm the template is unchanged:
   npm run foundation:drift and npm test pass before any Gavel code exists.
5. Oracle check: python3 tools/golden_answers.py ends with OK. Then
   python3 tools/verify_fixtures.py ends with OK. Compare the sha256 values it prints with
   docs/domain-brief.md section 11, docs/decisions.md D-23 and fixtures/MANIFEST.json, and
   python3 tools/reference_replay.py (no --write-expected) with
   fixtures/samples/reference_replay.output.txt. Report any mismatch; do not fix either side.
6. Run the reuse check from ~/Projects/_templates/STARTUP-REUSE-CHECK.md against
   docs/phase-1-tasks.md (it may not parse a task list; record the result either way) and
   record it in docs/decisions.md.
7. Read the donors named in docs/portfolio-overlap.md (bookable-appointment-service, loanbook,
   adjuster, bracketry, saas foundation) at the paths given. List any path that does not exist
   or whose code does not match the description. Don't resolve these yourself.
8. Read every doc. List anything that contradicts itself or can't be built as written,
   including anything in docs/decisions.md that disagrees with rules/auction.v1.json or with
   what Prisma 7 / Postgres 17 can do (SET LOCAL lock_timeout inside an interactive
   transaction, FOR UPDATE through $queryRaw, the trigger SQL).
9. Scaffold (task 1.1 only): the scripts in CLAUDE.md as stubs that exit 0, the CI workflow
   ported from loanbook's with no secrets, the README banner. No other dependency.
10. Commit in three commits, naming files explicitly (never git add -A):
    (a) the module-switch deletions and the script stubs (package.json, the removed module
        paths, src/app/required-modules.ts if the template uses it);
    (b) the merged config after the kit merge (README.md, .claude/settings.json, .gitignore,
        .env.example, vercel.json, the CI workflow);
    (c) docs/decisions.md with the reuse-check result and the module-switch outcome; confirm
        the D-23 hash equals sha256sum's on rules/auction.v1.json and say so in the commit
        message.
    Then in ~/Projects/saas foundation commit CLONES.md; show me the diff first.
    Before each push: git ls-files | grep -iE "\.env$|secret|credential|\.pem$|\.key$" prints
    only .env.example.
11. Plan first: write the Phase 1 plan as the order you will do tasks 1.2 to 1.12 in, which
    donor you will read for each port in 1.3, how you will pin the clock inside placeBid for
    the database replay in 1.9, what N and what Postgres max_connections you expect in CI for
    1.10, and what you need from me. Stop and show me the plan, the step 5 output, the step 7
    and 8 lists and the reuse-check result before writing any engine, schema or bid-path code.

Stop there. Do not write src/auction/, the Prisma models, placeBid, the barrier test or the
load script before I have reviewed the plan. Update NEXT.md before you stop.

Rules from the first commit: src/auction/engine/ imports no Prisma, @/core, @/app, Date.now,
new Date, Math.random, process.env, fetch or setTimeout; a bid is judged under SELECT ... FOR
UPDATE on LotState at READ COMMITTED with no retry loop; every well-formed attempt is one
append-only Bid row with a gap-free seq; placedAt is the injected clock read after the lock;
LotState is a projection that auction:verify must reproduce from the ledger; integers only
(cents, bps, ms) with one roundHalfUp in settle; rules are data in rules/auction.v1.json;
fixtures are never generated or read by product code; never edit an expected value to pass a
test; never edit template-owned paths (src/core/**, tests/invariants/**, core migrations); no
new dependencies without asking; no "handles", "scales", "fast" or "optimal" anywhere without
the number and the hardware; nothing committed that matches .env, secret, credential, .pem or
.key except .env.example.
```

## Still to do by hand

- Private GitHub repo `shanelabountyai/gavel`; push the kit (`git remote add origin <url>`); before the first push, `git ls-files | grep -iE "\.env$|secret|credential|\.pem$|\.key$"` (only `.env.example` may appear).
- Build-log card #17: name **Gavel**, PRD and repo links, status `in progress`, chips per `docs/portfolio-overlap.md` "Suggested card chips".
- Phase 1 task 1.11: run `npm run load:bids` once on the Mac and commit `docs/LOAD.md`; that is the first throughput number anywhere in the project.
- Phase 2: read the ledgers of L005, L017, L027 (CHAIN_TO_CAP) and L006, L018, L028 (SNIPE) row by row and say, per row, whether a bidder at the screen would have agreed; the PRD build note.
- Decide O-1..O-12 when they come up; defaults are in force.
