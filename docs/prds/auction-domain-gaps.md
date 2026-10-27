# PRD: Gavel — Auction-House Domain Gaps

**Status:** Draft v0.1, 2026-10-27. An operations review written from the point of view of a regional US house that runs timed online estate and equipment sales. It has not been decided. `docs/decisions.md` outranks this document, and where a requirement here would change a decision it says which one.
**Reads with:** `prd-gavel.md`, `docs/domain-brief.md`, `docs/decisions.md`, `rules/auction.v1.json`, `CLAUDE.md` (non-negotiables 1–11).

## ⚠️ Scope Honesty (read first)

Gavel is a learning project. Its data is synthetic and it is never used for a real sale. It is deployed only as a password-protected demo (D-64). This PRD lists what a working house would expect from an auction platform, so the gap between the demo and a real operation is written down rather than implied. **It makes no claim about any state's auction, sales-tax, consumer-protection or licensing law.** Where a rule depends on the law (sales tax, terms of sale, bid retraction, consignor trust funds, buyer's-premium disclosure, shill bidding) this PRD says *check with counsel / local law*. It does not say what the law requires. Nothing here adds real payments, real tax filing or real money movement. "Mark paid" means a staff member records that payment arrived somewhere else. No throughput claim is made or implied (D-24).

## Problem Statement

The hot path in Gavel is built properly. Bids on one lot are serialized under one row lock, the ledger is append-only and every attempt is in it, the close is anti-sniped on an injected clock, and settlement can be recomputed from the ledger. A house manager would trust that part.

The rest of the sale is thin. A house's working week is consignor intake, cataloguing, registering bidders, the close, then invoices, pickup, chasing non-payers, and paying consignors. A house manager who sat down at the demo today would find:

- Bidders see a wrong count, and on some lots a wrong price.
- A bidder cannot see their own maximum.
- There are no terms of sale to accept.
- A lot cannot be withdrawn.
- A bidder cannot be banned from a screen.
- A buyer cannot see their own invoice.
- The consignor, who is the house's actual client, is a text field and gets no statement.

None of these is hard, and almost all of them can be built as derived reads, new append-only rows or boundary checks, without touching the lock. That is why they belong in the project. They show that the ledger-first design carries the whole sale, not just the last ninety seconds.

## What Gavel already gets right (keep)

- An equal maximum goes to the earlier bid (D-9).
- A leader raising their own maximum does not extend the close (D-10).
- The hard cap ends the sale (D-12).
- Time comes from the server, read under the lock (D-15).
- A resent bid is a replay, not a second bid (D-17).
- The reserve amount is never shown (D-11, O-5).
- Staff accounts cannot bid (D-25, D-49).
- Corrections are superseding rows with a reason (D-44).
- A staff dispute view shows every attempt (D-45).
- The 10× confirm guards against a mistyped maximum (D-52).

A house would sign off on all of these as they stand.

## Findings

**Severity** is what a real house would say: **P0** means a house would not run a sale without it; **P1** means it costs staff hours every sale; **P2** is nice to have or specialist. The requirement priorities below use the same letters but also weigh how well each item fits the project.

| ID | Sev | Lifecycle area | What a house expects | What Gavel does today (evidence) |
|---|---|---|---|---|
| AX-01 | P0 | Bidding display | "Bids" counts accepted bids. A lot with no accepted bid shows "No bids" and the opening bid. | The lot page's "Bids" and the catalog's "Current" use `LotState.bidCount`, which counts **every** attempt, rejected ones included (D-14, D-16). A lot whose only attempt was rejected (below start, or too early) shows "Bids 1" and a price of **$0.00**, because a new lot's state starts at price 0 (`engine.ts:47`). Evidence: `lots/[id]/lot-live.tsx:78,89`, `catalog/page.tsx:35`. The BELOW_MIN and EARLY fixture lots reach this state after their first submission. |
| AX-02 | P0 | Bidding display | A bidder always sees "Your max: $X" and can raise it. | The bidder sees only `you: LEADING / OUTBID`. The closed key set leaves out the caller's own maximum (D-50, `src/auction/lot-view.ts`). A bidder cannot tell what they already committed to. |
| AX-03 | P0 | Registration / terms | Each sale has terms of sale: buyer's premium %, payment deadline, pickup window, "as is, where is", and default consequences. The bidder accepts them before bidding, and the house can show who accepted which version. | There are no terms. Registration is once per house, by the bidder alone, with no approval (D-47 Q2, D-49). `(public)/legal/terms` is the template's site terms, not terms of sale. |
| AX-04 | P0 | Cataloguing / bidding | The house can withdraw a lot before it closes (damage, title problem, consignor pulled it), and the withdrawal is on the record. | Not possible. Publish is refused once a lot has a bid (D-21). The `LotState` DELETE trigger refused even a demo rebuild (D-65 a). Brief §3 lists "a lot withdrawn" as not generated. After the close only a correction to `UNSOLD_BY_CORRECTION` exists (D-44). |
| AX-05 | P0 | Registration / banning | Staff can suspend a bidder, for non-payment or abuse, with a reason, and later reinstate them. | `BidderStatus.SUSPENDED` exists and `placeBid` refuses a bidder who is not ACTIVE (`place-bid.ts:77`), but nothing in `src/` sets it. There is no screen and no action. |
| AX-06 | P0 | Settlement / buyer | The buyer gets their invoice right after the close. It shows lots, hammer, premium, total, payment due date and pickup instructions. | Invoices exist but are staff-only (`audit.read`, D-43; `auctions/[id]/invoices/page.tsx:16`). The `won` notice carries hammer and total but no invoice (D-53), and it is never sent (O-11). There is no due date and no pickup text anywhere. |
| AX-07 | P0 | Consignor settlement | The consignor contract sets commission (often tiered), lot fees and unsold fees. After the sale the consignor gets a statement: hammer per lot, less commission and fees, equals net, plus the unsold lots to collect or relist. | The consignor is a free-text field on `Lot` (D-25, `gavel.prisma` `Lot.consignor`). There is no contract, no commission and no statement. Half of the house's clients are invisible. |
| AX-08 | P1 | Collections | Each invoice has a status: unpaid, paid, or defaulted. A buyer who misses the deadline is defaulted and suspended, and the lot is offered to the underbidder (second-chance offer). | There is no payment status. Payments are a non-goal (PRD Non-Goals). A winner reassignment can be *recorded* as a correction (D-42 Q2, D-44), but the offer, deadline and reply are P1 and unbuilt (O-9). |
| AX-09 | P1 | Settlement / tax | The invoice shows sales tax, or "exempt" with a resale certificate on file. Which base is taxed (hammer only, or hammer plus premium) and at what rate depends on where the sale happens. **Check with counsel.** | Tax is a non-goal (PRD Non-Goals, brief §1). There is no tax line and no exemption flag. |
| AX-10 | P1 | Cataloguing | Closings are staggered automatically: first close plus N seconds per lot number. | Staff type each lot's `scheduledEnd` by hand (`auctions/[id]/page.tsx:39`). Only the fixtures are staggered (brief §3). |
| AX-11 | P1 | Bidding transparency | Bidders can see the lot's bid history: time, price after each bid, and an anonymised bidder number. Never anyone's maximum. Most disputes end there. | The history is staff-only (D-45). The brief says the response never shows another bidder's identity beyond lead/outbid (brief §4). |
| AX-12 | P1 | Display | Close times are shown in the house's local time, with the zone named. | Everything is UTC in the forms and the catalog (D-48 c, `catalog/page.tsx`). The countdown is correct (D-51 b), but a printed close time in UTC is a missed-lot complaint waiting to happen. |
| AX-13 | P1 | Reserve display | "NO RESERVE" is a selling point and is advertised. Reserve lots show "Reserve not met" until it is met. | `reserveMet` is true when there is no reserve, so a no-reserve lot and a met reserve look the same (D-50 d, O-5). |
| AX-14 | P1 | Close / reserve | Reserve not met: the house may ask the consignor to accept the high bid after the close (a "subject to approval" sale). | `UNSOLD_RESERVE_NOT_MET` is final. A correction that sets a winner below the reserve is refused (D-44 c: "the new price must meet the reserve"). |
| AX-15 | P1 | Reporting | A sale recap: lots offered and sold, sell-through, gross hammer, premium, unsold by reason, per-consignor totals, a CSV of each lot's ledger. | There are invoices and per-lot history only. The CSV export is a PRD P1, unbuilt. |
| AX-16 | P1 | Registration | Equipment and high-value sales need approval per sale (staff approve, sometimes after a card or deposit check that happens outside the system). | Anyone in the house who self-registers can bid on any sale (D-47 Q2). |
| AX-17 | P1 | Unsold lots | An unsold lot can be relisted in the next sale, linked to the original so the consignor statement and history follow it. | There is no relist. Staff would retype it, and nothing links the two lots. |
| AX-18 | P1 | Rules | Premium tiers (for example 15% up to $5,000 and 10% above), and a separate increment table for equipment and for estate sales. | Both are PRD P1 and "not modeled" (decisions §Not modeled). Increments are global in v1 (D-7). |
| AX-19 | P2 | Bidding | Staff can void a bid, such as a bidder's documented typo or a suspended bidder's standing maximum, with a reason, before the close. | Not possible. The ledger is append-only and the price chain is monotone (V4). Brief §3 lists "a bid voided by staff" as not generated. |
| AX-20 | P2 | Registration | A bidder credit limit: total exposure across open lots, capped. | None. |
| AX-21 | P2 | Cataloguing | Estimates (low/high), condition notes, category, and a "sold as is" flag per lot. | Title, description and image URL only (PRD Non-Goals). |
| AX-22 | P2 | Integrity | A report of bids on a lot by any bidder linked to that lot's consignor. Shill bidding is the commonest integrity complaint. **The law varies; check with counsel.** | Not possible: the consignor is text, so there is nothing to link a bidder to. Fraud and shill detection are non-goals (PRD). |
| AX-23 | P2 | Engagement | A watchlist and "closing soon" notices. | The watchlist is a PRD P1, unbuilt. Only outbid and won notices exist (D-53). |

## Goals

1. Fix the two places where the bidder screen shows something wrong (AX-01, AX-02) without changing the ledger.
2. Make a sale defensible: published terms accepted per bidder, a recorded withdrawal, a recorded suspension, and an approval gate. Each is an append-only row that the dispute view can show.
3. Finish the money paths as derived reads: the buyer's own invoice, the consignor statement, and tax and payment status. All of them are pure functions with goldens in integer cents, with every rounding site named.
4. Keep every non-negotiable intact. Each change below is a boundary check that runs before the lock, a new append-only table, a derived read, or a rules-data change that goes through D-23. Where one cannot be done that way, it says so and stays P2.

## Non-Goals (and why)

- **Moving money.** No card capture, ACH, deposit holds, consignor payouts or refunds. "Paid" is a recorded mark (R-08). BoxLoop owns the mock-provider lesson.
- **A tax engine or tax filing.** R-09 applies one configured rate to one configured base. It does not look up jurisdictions and gives no advice. Rates in fixtures are invented.
- **Choice lots, "times the money" quantity lots, buy-now, Dutch and sealed bids.** Each one breaks "one lot, one winner, one state row" (D-16). Each would be a different engine.
- **Linked or group close** (no lot closes until the one before it has, or every lot extends together). This needs several rows locked at once, which contradicts non-negotiable 2. Per-lot soft close (D-12) is the common timed-sale convention and stays.
- **Pre-bidding before open, absentee bids, live and webcast clerking, phone bids.** In a timed sale the lot opens with the catalog. Pre-bidding is a live-sale habit (decisions §Not modeled).
- **Photos and media hosting, shipping quotes, freight.** These stay out (PRD). R-06 carries pickup text, not logistics.
- **Fraud scoring and KYC.** R-22 is a report a person reads, not detection.
- **Any statement that a rule is legally required.**

## Requirements

Each requirement lists what it changes, using these labels:

- **Rule data:** `rules/auction.vN.json`, and so the D-23 hash.
- **Schema:** new tables, columns or CHECK constraints, and their triggers.
- **Ledger:** the `Bid` table or its invariants V1–V9.
- **Settlement:** `settle`, `resettle` or `Settlement` rows.
- **Process:** whether it needs a `docs/decisions.md` entry (**D**), a golden (**G**), and regenerated fixtures (**F**) through brief §11.

"Boundary" means stage 1 of brief §4. A refusal there is typed and writes nothing, which is consistent with D-14.

### P0

**R-01 Accepted-bid count and the no-bid price (AX-01).**
- [ ] The lot page's "Bids", the catalog's "Current", and the lot-view `bidCount` field shown to bidders use `LotState.acceptedCount`.
- [ ] A lot whose `acceptedCount` is 0 shows "No bids" and the opening bid (`minNextCents`), never `priceCents`.
- [ ] The ETag stays `bidCount-status`, so a rejected attempt still refreshes pollers (D-50 c).
- [ ] Test: a lot with one `REJECTED_BELOW_MINIMUM` row shows "Bids 0", "No bids" and the start price. An e2e test does the same for an EARLY-kind lot.
- *Changes:* display only. No rules, schema, ledger or settlement change. D: a one-line amendment to D-50, because a field's meaning changes. G/F: none.

**R-02 Your own maximum (AX-02).**
- [ ] The lot view adds `yourMaxCents` for the caller only. It is the caller's highest accepted `maxCents` on the lot, or null.
- [ ] The page shows "Your max: $X", and when the caller is outbid it shows "Your max $X was exceeded".
- [ ] It is never present in another caller's response. The INV-style test compares two callers' bodies.
- *Changes:* lot-view read only. D: amends D-50's closed key set. G/F: none.

**R-03 Terms of sale, accepted before bidding (AX-03).**
- [ ] New insert-only table `AuctionTerms` (`auctionId`, `version`, `text`, `sha256`).
- [ ] New insert-only table `TermsAcceptance` (`auctionId`, `bidderId`, `termsSha256`, `acceptedAt` from `@/core/clock`), unique on `(auctionId, bidderId, termsSha256)`.
- [ ] Terms cannot be changed once any lot in the auction has a `Bid` row, mirroring D-21's publish refusal.
- [ ] `placeBid` refuses at the boundary with `TERMS_NOT_ACCEPTED` when no acceptance exists for the auction's current terms hash. Nothing is written and no lock is taken.
- [ ] The staff dispute view shows the hash and acceptance time for each bidder in the lot.
- *Changes:* schema (two tables, append-only triggers). Ledger unchanged, because the check happens before the lock. D (new boundary refusal; amends D-47 Q2). G/F: none. The engine is untouched.

**R-04 Withdraw a lot before the close (AX-04).**
- [ ] New insert-only table `LotWithdrawal` (`lotId` unique, `reason` not blank, `byUserId`, `withdrawnAt`).
- [ ] The staff action takes `FOR UPDATE` on the lot's `LotState` row, the same single lock (non-negotiable 2), then reads `now()` under it (non-negotiable 4) and inserts the withdrawal. **It does not write `LotState`** (non-negotiable 5 holds).
- [ ] The engine's `Lot` gains `withdrawnAtMs: number | null`, read from the join. `lotStatus` is CLOSED from that instant. `applyBid` returns a new `REJECTED_LOT_WITHDRAWN`, written as a row like every other rejection. `settle` returns a new `UNSOLD_WITHDRAWN` with `closedAt = withdrawnAt` and zero amounts.
- [ ] Withdrawal is refused once the lot is CLOSED; that case is R-14 or D-44's correction.
- [ ] The leader at the time of withdrawal gets an outbox notice.
- [ ] V6 gains: accepted rows have `placedAt < withdrawnAt`. V8 recomputes `UNSOLD_WITHDRAWN`.
- [ ] Test: a barrier test with N writers queued behind a holder that withdraws. Every one of the N is `REJECTED_LOT_WITHDRAWN`, there are N rows, and verify is clean.
- *Changes:* rule data (two outcomes, so a new hash in D-23 and V9). Schema. Ledger invariant V6. Settlement. D, G (withdraw before, at, and after a bid), F (a new `WITHDRAWN` fixture kind). **Contradicts brief §2** ("nothing on [a lot] changes once it has a bid"). The `Lot` row is unchanged, but the lot's outcome now has a second input; record that in the D entry.

**R-05 Suspend and reinstate a bidder (AX-05).**
- [ ] A staff screen (`results.write`) lists bidders with paddle, status and accepted-bid count, and offers Suspend and Reinstate, each with a required reason.
- [ ] Each change is an audit event, and a `BidderStatusChange` insert-only row keeps the history. `Bidder.status` is its projection, and a test asserts the two agree.
- [ ] A suspended bidder's new attempts are refused at the boundary, as today (`place-bid.ts:77`).
- [ ] The screen states in plain words that **standing maximums stay live** until R-19 exists, and that the remedy after the close is a D-44 correction.
- *Changes:* schema (one table). No rules, ledger or settlement change. D (states the race honestly: a bid that passed the boundary before the suspension committed is judged normally). G/F: none.

**R-06 The buyer's own invoice, with due date and pickup (AX-06).**
- [ ] The `Auction` row gains `paymentDueAt`, `pickupText` and `pickupWindowText`, editable until the first bid.
- [ ] A new route lists the caller's invoices across auctions. It reuses `invoicesForAuction` filtered to the caller's `Bidder` and reads the current settlement rows, so corrections show up with no extra step (D-42 Q1).
- [ ] The `won` notice adds the due date and pickup text.
- [ ] Another bidder's invoice returns 404.
- *Changes:* schema (three columns), read only. Settlement unchanged. D. G: none, because invoice goldens already exist (D-43).

### P1

**R-07 Consignors, contracts and the consignor statement (AX-07).**
- [ ] New `Consignor` table (`orgId`, `name`, `code`). `Lot.consignorId` is a foreign key, and the text field is kept for older rows.
- [ ] New `ConsignmentContract` table (`consignorId`, `auctionId`, `commissionBps`, `lotFeeCents`, `unsoldFeeCents`), insert-only, with a superseding row for changes.
- [ ] Pure `consignorStatement(currentSettlements, contract)` in `engine.ts`:
  - Per SOLD lot: hammer, then `commission = roundHalfUp(hammer × bps, 10000)`, then fee, giving net.
  - Per unsold lot: unsold fee and status (collect / relisted, from R-17).
  - Totals.
  - **The buyer's premium is never in the consignor's numbers.**
- [ ] Derived on read, never stored, like invoices.
- [ ] Lines are split into "buyer paid" and "awaiting buyer payment" using R-08.
- [ ] Optional `commission_bands` in rules v2 for tiered commission.
- *Changes:* schema, engine (pure), rule data if tiered. D, G (commission rounding cases like GB-16, plus tier boundaries), F (contracts added to `auctions.json`).
- **Contradicts non-negotiable 6** ("one `roundHalfUp`, used once, in `settle`"). Proposed rewording: one rounding per derived money amount, each at a named site with its own golden. Shane decides.

**R-08 Payment marks, default, and the second-chance offer (AX-08).**
- [ ] New insert-only table `PaymentMark` (`auctionId`, `bidderId`, `amountCents`, `method` as text, `byUserId`, `markedAt`).
- [ ] Invoice status is derived:
  - PAID when Σ marks = invoice total.
  - PARTIAL when Σ marks is above zero but below the total.
  - UNPAID when there are no marks and `now ≤ paymentDueAt`.
  - OVERDUE when there are no marks and `now > paymentDueAt`.
- [ ] A later correction that changes the total shows "balance due" or "credit". The mark is never edited.
- [ ] "Declare default" does two things: it suspends the bidder (R-05) and writes a `SecondChanceOffer` row (`lotId`, `bidderId`, `priceCents` from `resettle`, `expiresAt`) for the underbidder.
- [ ] Acceptance writes the D-44 correction, with the offer id as its reason. Expiry and decline are rows too.
- [ ] Late fees are out of scope. **Check with counsel.**
- *Changes:* schema (three tables). Settlement through the existing `resettle` (no new money rule). D (closes O-9's P1 and supersedes "no underbidder offer"). G (offer price = `resettle` price for an OUTBID underbidder, which D-44 already covers). F: none.

**R-09 Sales tax and exemption (AX-09).**
- [ ] The `Auction` row gains `taxBps` and `taxBase` (`HAMMER` or `HAMMER_PLUS_PREMIUM`). These are configuration, not advice. **Which one applies is a question for counsel.**
- [ ] The `Bidder` row gains `taxExempt`, `exemptCertificateRef` (text) and `exemptUntil`.
- [ ] Pure `invoice()` adds `taxCents = roundHalfUp(Σ base × bps, 10000)` once per invoice. The per-invoice versus per-line choice is an open question.
- [ ] Exempt bidders get 0 tax, and the certificate reference is printed on the invoice.
- *Changes:* schema, engine. D, G (rounding at invoice level, exempt case, both bases), F (invented rates in `auctions.json`).
- **Contradicts the PRD Non-Goal "tax"** and non-negotiable 6 (a second rounding site; see R-07).

**R-10 Generated staggered closes (AX-10).** The auction form takes `firstCloseAt` and `staggerSeconds`. `createLot` sets `scheduledEnd = firstCloseAt + (number − 1) × stagger` when no end is given. An explicit end still wins. *Changes:* schema (two `Auction` columns), catalog only. D. G/F: none.

**R-11 Public bid history (AX-11).**
- [ ] The bidder lot page lists accepted rows in seq order with: time, price after the bid, whether it extended the close, and a per-lot alias ("Bidder 3", assigned by first appearance).
- [ ] The caller's own rows say "you".
- [ ] It never shows a maximum, a rejected row or a paddle.
- [ ] The list is read from the ledger and needs no lock.
- *Changes:* read only. D (amends brief §4's "never another bidder's identity"). G: an alias-assignment golden on a PROXY_WAR fixture lot. F: none.

**R-12 Local time display (AX-12).** The `Auction` row gains `timeZone` (IANA). Every printed time renders in that zone with the zone named. Storage, the engine and the countdown stay UTC/epoch ms. *Changes:* schema (one column), display. D (amends D-48 c). G/F: none.

**R-13 "No reserve" label (AX-13).** The lot view adds `hasReserve`. The page shows "No reserve", "Reserve not met" or "Reserve met". The amount is never shown. *Changes:* read only. D (changes O-5's default and D-50 d). G/F: none.

**R-14 Subject-to-approval sale below reserve (AX-14).**
- [ ] On an `UNSOLD_RESERVE_NOT_MET` lot, staff may record a correction to SOLD to the high bidder at their reached price, which is still capped at their own maximum as in D-44.
- [ ] A reason and a consignor approval reference are required.
- [ ] Whether the high bidder must also accept is an open question. If yes, reuse R-08's offer rows.
- *Changes:* settlement (`resettle` gains a below-reserve path, only with approval). D. G (the price equals `settle`'s reached price, and the reserve is not applied). **Contradicts D-44 c** ("the new price must meet the reserve").

**R-15 Sale recap and ledger CSV (AX-15).**
- [ ] A staff page and a CSV, derived on read: lots offered, sold, and unsold by outcome; sell-through as integer bps; Σ hammer, Σ premium; extensions; per-consignor totals once R-07 exists.
- [ ] The CSV of a lot's ledger has the D-45 columns.
- [ ] Numbers on the fixtures equal brief §10. That comparison is the test.
- *Changes:* read only. D. G: brief §10 is the golden. F: none.

**R-16 Per-sale registration approval (AX-16).**
- [ ] The `Auction` row gains `requiresApproval`.
- [ ] New table `AuctionRegistration` (`auctionId`, `bidderId`, status `PENDING | APPROVED | DECLINED` as insert-only rows; the latest one wins).
- [ ] The boundary refuses with `NOT_APPROVED_FOR_SALE` before the lock.
- [ ] Any card or deposit check happens outside the system and appears only as a staff note.
- *Changes:* schema. D (amends D-47 Q2). G/F: none.

**R-17 Relist an unsold lot (AX-17).** A "Relist" action on a lot whose current settlement is unsold creates a new lot in a chosen auction that has not opened yet, with `relistOfLotId`. The original's history and the consignor statement link to it. *Changes:* schema (one column). D. G/F: none.

**R-18 Rules v2: premium tiers and per-auction increment tables (AX-18).**
- [ ] A new `rules/auction.v2.json` adds `premium_bands`. The premium is applied per band and rounded once, which is a golden at each boundary.
- [ ] It adds named increment tables. `Auction.incrementTable` picks one.
- [ ] v1 settlements stay verifiable under v1: V9 accepts the set of hashes listed in D-23.
- *Changes:* rule data, engine, settlement. D, G, F (the whole set regenerated, and v1 kept for the old rows). This is the existing PRD P1, re-stated so a house sees it.

### P2

**R-19 Staff void of a standing bid (AX-19).** A `VOID` ledger row that references a seq, written under the lot's lock. The state becomes the fold of the ledger without the voided bidder's rows. *Changes:* ledger. V4's monotone price chain no longer holds and must be rewritten. V1's fold changes. D-14, D-16 and non-negotiable 3's "a correction is a superseding row" all need amending. D, G, F. **This is the largest change in the document.** It stays P2 until Shane chooses to take on the invariant rewrite.

**R-20 Bidder credit limit (AX-20).** A cap on Σ the bidder's leading prices across open lots. Enforcing it exactly needs a second lock (the bidder row, with a fixed lock order of bidder then lot). **That contradicts non-negotiable 2.** A boundary check without a lock would be approximate and racy, and must be labelled that way. Propose it only as a Phase 4-style measured experiment. D.

**R-21 Estimates, condition and category (AX-21).** `Lot` gains `estimateLowCents` and `estimateHighCents` (CHECK low ≤ high), `conditionText`, `category`, and `asIs` (default true). They appear in the catalog and on the lot page, and no rule reads them. *Changes:* schema. D. G/F: none.

**R-22 Consignor-linked bidding report (AX-22).** Depends on R-07. Staff record a link between a consignor and a bidder. The report lists accepted rows on that consignor's lots by linked bidders. It is a report only, with no automatic action. **Whether any of this is prohibited is for counsel.** D.

**R-23 Watchlist and closing-soon notices (AX-23).** New `Watch` table (`bidderId`, `lotId`). An outbox notice goes out N minutes before `closesAt`, written by the cron, deduplicated per (lot, bidder, closesAt). It is still never sent (O-11). D.

## Success Metrics

- R-01: on the frozen fixtures, every lot with `acceptedCount = 0` (the 3 NO_BIDS lots, plus any lot whose rows are all rejected) shows "No bids". No screen shows a price of $0.00.
- R-03, R-05, R-16: every boundary refusal is typed, writes zero `Bid` rows, and is counted in a test. `auction:eval` is unchanged: 220 submissions and 214 rows, until fixtures are deliberately regenerated.
- R-04: the withdrawal barrier test passes at N = 25 in CI. `auction:verify` is clean, including the new V6 clause.
- R-06, R-07, R-08, R-09: each money output equals a golden to the cent, computed by `tools/` and by hand. Σ consignor net + Σ commission + Σ fees = Σ hammer on every sale, as an assertion in verify or the test.
- The D-23 hash changes only in the commits for R-04, R-07 (if tiered) and R-18, and each has its regenerated fixtures and a D entry.
- Zero new floats, and zero forbidden imports under `src/auction/engine/` (`rules:lint`).

## Open Questions for a real auctioneer

1. Commission is it charged on hammer only? Does any of the buyer's premium ever go to the consignor in your contracts?
2. When reserve is not met, do you offer the high bidder the sale at their reached price or at their maximum, and must they accept? (R-14)
3. When a buyer defaults, is the second-chance offer at the underbidder's reached price or their own maximum, and how long do they have? (R-08; D-44 uses min(reached, max).)
4. When you suspend a bidder mid-sale, do you void their standing maximums or let them ride and deal with it after the close? (R-05, R-19)
5. Is sales tax computed per line or per invoice, and on hammer or hammer plus premium where you sell? (R-09: **counsel**.)
6. Do bidders see paddle numbers in bid history, or an alias? (R-11)
7. Do you advertise "No reserve" on absolute lots, or say nothing? (R-13)
8. Stagger interval: one lot per minute, two, or more? Do you stagger by lot number or by group? (R-10)
9. Do you ever withdraw a lot that has bids, and do you tell the bidders why? (R-04)
10. Is approval per sale or per bidder, and is a card or deposit check the trigger? (R-16)
11. Do terms change between sales often enough that per-version acceptance matters, or is per-house acceptance enough? (R-03)

## Build notes

- **Order:**
  1. R-01 and R-02. Display only, with a one-line D amendment each. Sonnet is enough.
  2. R-05, R-06 and R-03. Boundary checks and new append-only tables.
  3. R-04. The only P0 that touches rules data, ledger invariants and fixtures. Stay on the pinned model (D-3).
  4. Then the P1 money group (R-07, R-08, R-09), each test-first against a new golden in `tools/golden_answers.py` before any TypeScript.
- **Every new check sits at the boundary, before `FOR UPDATE`, or under the one existing lock.** None takes a second lock, retries, or reads the client's clock. R-20 is the exception and is labelled as such.
- **Every new table that records a fact is insert-only by trigger,** like `Bid` and `Settlement`. Status is derived from rows, never set by hand (D-21).
- **Rule changes follow brief §11:** D entry first, then regenerate, then `verify_fixtures.py` and `golden_answers.py` OK, then update the hashes in brief §11 and D-23. Never edit an expected value (non-negotiable 10).
- **Contradictions to decide before building:**
  - R-04 against brief §2.
  - R-07 and R-09 against non-negotiable 6 and the PRD tax non-goal.
  - R-08 against O-9 / D-42.
  - R-11 against brief §4.
  - R-12 against D-48 c.
  - R-13 against O-5 / D-50 d.
  - R-14 against D-44 c.
  - R-16 against D-47 Q2.
  - R-19 against D-14 / D-16 / V4.
  - R-20 against non-negotiable 2.
- Template-owned paths (`src/core/**`) stay untouched. New staff screens use the existing `results.write` and `audit.read` permissions (D-43 c, D-48 g).
