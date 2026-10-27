# PRD: Gavel — UX gaps (bidder and staff journeys)

**Status:** Draft v1, UX review of the deployed demo build (commit a5230d9), 2026-10-27
**Reviewer lane:** flows, navigation, feedback, empty and error states, onboarding, interaction accessibility, phone use in a lot's final minute. Visual styling and auction business rules belong to the other two reviews; overlaps are flagged in one line.

`docs/decisions.md` outranks this document. Any requirement below that adds a field to the lot read (D-50's closed key set) or changes what a bidder may see needs a decision entry first.

## Scope honesty

Learning project, synthetic data only. Every lot, bidder and bid is generated; nothing is paid and settlement stops at a mock invoice. The live site (gavel.labintelligence.co) is a password-protected demo whose visitors share four bidder accounts (D-65 f), so "the user" in this document is a demo visitor walking a scripted journey, not a measured population. This review was done from the code and from screenshots of the production build, not from user research; no user numbers are claimed or invented.

## Problem Statement

The hot path is proven (row lock, ledger, verifier). The screens around it were built task by task and styled once (D-65 d), and nobody has yet walked a whole journey through them. Walking them end to end from `/demo` finds three kinds of gap:

1. **The ending is missing.** A bidder who led when the lot closed is still told "You are the high bidder." forever, even when the reserve was not met and they did not win. The won notice exists but is capture-only (D-53 g, D-64 e), so on the demo nothing ever says "you won".
2. **The lot page ignores who is looking.** A staff user, an unregistered member and a registered bidder all get the same bid form; two of the three can only fail, and the failure text is a developer string.
3. **The template still shows.** The landing page says "SaaS Foundation", the org home says "Invite your team", and the menu offers Projects and Delete org. On a 375 px phone the menu wraps to three lines above the lot panel.

## Findings

| ID | Sev | Where | What is wrong or missing | Evidence |
|---|---|---|---|---|
| UX-01 | P0 | Lot page, closed | After close the panel keeps `you` = LEADING/OUTBID and says "You are the high bidder." It never says Won / Not won, and a leader under the reserve is told they lead though the lot is unsold. Design brief says bidders see "Won" / "Not won". | `lot-live.tsx:70-72`, `:93`; `lot-view.ts:34`; `docs/design-brief.md` Outcomes table |
| UX-02 | P0 | Lot page, scheduled | A SCHEDULED lot shows "Time left" counting to the **close**, not the open, and the bid form is live; pressing Bid writes a `REJECTED_LOT_NOT_OPEN` row. The view has no `opensAt` to count to. | `lot-live.tsx:81-93`; `lot-view.ts:9-19` |
| UX-03 | P0 | Lot page, unregistered member | Bid form is shown; submitting returns "Register as a bidder first." with no button or link. Registration exists only on the catalog. A visitor who opens a lot link directly is stuck. | `lots/[id]/actions.ts:17`; `catalog/page.tsx:22` |
| UX-04 | P0 | Lot page, staff | Owner/admin see the bid form and can only be refused ("Staff accounts do not bid" is never reached; they get "Register as a bidder first."). No link from the lot page to its history, and the auction page links titles to history only, so staff cannot move between the bidder view and the dispute view. | `lot-live.tsx:93`; `bidder.ts:9`; `auctions/[id]/page.tsx:28` |
| UX-05 | P0 | Bid form errors | `BidError` messages are shown verbatim: "the lot was busy; resend with the same key" (lock timeout, the final-seconds path), "key already used for 15000 cents", "the bidder is not registered and active with this house". The brief's copy ("Connection problem. Press Bid again…") is used only for a thrown fetch. | `lots/[id]/actions.ts:22`; `bid-form.tsx:30-31`; `place-bid.ts:78,91,151` |
| UX-06 | P1 | Catalog, 375 px | Only Lot and Title are visible; Current, Closes and Closed badge are behind a horizontal scroll. A phone bidder cannot see which lots are open or what they cost. | `catalog-phone.png`; `catalog/page.tsx:23-41` |
| UX-07 | P1 | Lot page, bidder | A bidder never sees their own maximum anywhere. When refused `REJECTED_NOT_ABOVE_OWN_MAX`, the message quotes the *minimum next bid*, which is not the number that matters. | `bid-form.tsx:34`; D-50 (no max in the view) |
| UX-08 | P1 | Bid form, phone | Empty input, no placeholder, no one-tap "Bid the minimum". In the last 30 s a phone bidder must read the minimum, open the keyboard and type it. "Your maximum" is never explained; the demo script has to explain proxy bidding aloud. | `bid-form.tsx:58`; `lot-phone.png`; `docs/DEMO.md` step 3.4 |
| UX-09 | P1 | Bidder, across lots | No "my bids" view and no position column in the catalog. With notices capture-only, a bidder outbid on lot 3 while watching lot 1 never finds out. | `catalog/page.tsx:14`; D-53 g |
| UX-10 | P1 | `/demo` | 11 email buttons, no guidance on which to pick for which journey; Globex, `rival@` and `member@` add noise; nothing says the four bidder accounts are shared by every visitor. `owner@acme` belongs to two orgs, so it lands on Your orgs, not on Auctions. | `demo.png`; `demo/page.tsx:16-25`; `demo/signin/route.ts:15-17`; D-65 f |
| UX-11 | P1 | Shell | `/` is titled "SaaS Foundation"; org Home is "Nothing here yet… Invite your team"; menu carries Projects, Members, Delete org (owner) and Your orgs. The menu wraps to 3 lines at 375 px, pushing the lot panel down. | `app/page.tsx:10`; `o/[org]/page.tsx:9-10`; `layout.tsx:16-18`; `lot-phone.png` |
| UX-12 | P1 | Lot page, a11y | The countdown has no live region; entering the final minute and a soft-close extension are not announced (the "+2:00" span is not in a live region and disappears after 8 s). Only price and position are `aria-live`. | `lot-live.tsx:68`, `:82-83`, `:63` |
| UX-13 | P1 | Lot page, phone background | No refresh on `visibilitychange`; a phone returning from the lock screen waits for a throttled timer. While a poll is failing the countdown keeps ticking to 0:00 as if it were authoritative. | `lot-live.tsx:23-41`, `:69` |
| UX-14 | P1 | Lot page after a bid | The bid result is not applied to the board; the form says "not leading ($155.00)" while the board shows $135.00 until the next poll (up to 2 s). Two prices on one screen. | `lot-ada-refused.png`; `bid-form.tsx:34`; `lot-live.tsx:13` |
| UX-15 | P1 | Staff forms | Lot prices are entered in **cents** ("Start price (cents)", 10000 = $100) while bidders type dollars; a slip of two zeros is a $1 lot. Dates are `datetime-local` labelled UTC, but the picker is the browser's local time and nothing previews the UTC instant or "closes in". Creating a lot redirects with no confirmation. | `auctions/[id]/page.tsx:37-39`; `auctions/page.tsx:23`; `auctions/actions.ts:13,66` |
| UX-16 | P1 | Auction page, auctions list | No status, current price, bid count or settled state per lot (brief asks for status); the list has no open/closed state. A closed lot waits for the 06:00 UTC cron (D-65 f) and nothing says "closed, awaiting settlement". Staff cannot "watch it close". | `auctions/[id]/page.tsx:25-29`; `auctions/page.tsx:17` |
| UX-17 | P1 | Invoices | Before any settlement the page reads "0 buyers." and nothing else. Unsold lots appear nowhere (brief: show them as outcomes). Invoice rows do not link to the lot history, the first stop of a dispute. | `invoices/page.tsx:33-46` |
| UX-18 | P2 | History | Extended rows are marked by tint and left border only (brief: not colour alone). "Corrected by" prints a raw user id. Close after and Placed at are off-screen at 1280 px. | `history.png`; `history/page.tsx:48`, `:68` |
| UX-19 | P2 | Wayfinding | No link from a lot page to its catalog or auction, none from history back to the auction. | `lots/[id]/page.tsx:20-27`; `history/page.tsx:35` |
| UX-20 | P2 | Lot page, closed | Polling never stops: after close, `closesAt - now` is negative, so the loop polls every 1 s for as long as the tab is open. | `lot-live.tsx:38` |
| UX-21 | P2 | Catalog | Close times are ISO UTC only, no "closes in 4 min"; a closed lot shows just "Closed", no final price or your result. | `catalog/page.tsx:36` |
| UX-22 | P2 | Fat-finger confirm | `role="alertdialog"` on a `<p>`; focus does not move to it, so a keyboard or screen-reader user may not reach "Yes, bid". | `bid-form.tsx:61-65` |

Overlaps, one line each: the "accepted, outbid" row that extended the close on lot 6 (history.png, seq 7) is a rules question for the business review; colours, nav density and table styling are the visual review's.

## Goals

1. Every bidder state on the lot page (scheduled, open, final minute, extended, closed-won, closed-not-won, unregistered, staff) has its own text and its own action, testable in Playwright.
2. A phone bidder can go from `/demo` to a placed bid, and rebid after being outbid, without horizontal scrolling or typing a number.
3. A staff user can go from `/demo` to a lot's history and back, and from an invoice row to its history, in one click each.
4. No template-only screen or developer string is reachable from the auction journeys.

## Non-Goals

- Real-time push, presence or sockets (PRD non-goal; polling stays).
- Sending email/push notices; the outbox stays capture-only (D-53 g, D-64 e). An in-app result on the lot page and a "my bids" list replace them for the demo.
- Editing or withdrawing lots, staff "settle now", per-auction increments (business review).
- Visual redesign (visual review).
- Removing foundation modules or editing template-owned paths (`src/core/**`). Shell changes stay in clone-owned files.

## Requirements

### P0

**R1 — Closed lot tells the bidder the result (UX-01).**
- When `status` is CLOSED, the position line reads "You won this lot at $X." / "You did not win this lot." / nothing if the caller never had an accepted bid. "You are the high bidder." never appears on a closed lot.
- A leader with the reserve not met reads "You did not win: the reserve was not met."
- Before the settlement row exists, the result is derived from the folded state by the same pure engine function settlement uses, and the page says "Final once the sale is settled." After settlement it is read from the `Settlement` row.
- Acceptance: e2e on the production build closes a lot with Ada leading (reserve met) and with Ben leading under reserve; Ada sees "You won", Ben sees "reserve was not met", a third member sees no position line.

**R2 — Scheduled lot counts to the open (UX-02).**
- SCHEDULED shows "Opens in" with a countdown to `opensAt`, and the bid button is disabled with text "Bidding opens at <time>".
- When the poll returns OPEN the button enables without a reload.
- Acceptance: e2e with a scripted clock before `opensAt` finds the disabled button and zero `Bid` rows after clicking it; after the clock passes `opensAt`, a bid is accepted.

**R3 — Register from the lot page (UX-03).**
- A member with no paddle sees "Register to bid" in place of the bid form; one press registers and shows the form with "You bid as paddle N."
- Acceptance: e2e as a fresh member opens a lot URL directly, registers, bids, and is accepted, never visiting the catalog.

**R4 — The lot page knows the viewer's role (UX-04).**
- Owner/admin see no bid form; they see "Staff view: staff accounts do not bid" and a "Bid history" link to `/lots/[id]/history`.
- The auction page lot table links the title to the lot page and adds a "History" link.
- Acceptance: e2e as owner finds no `form[aria-label="Place a bid"]` and reaches history in one click; as member finds no history link (it is `audit.read`).

**R5 — Bidder-facing copy for every bid error (UX-05).**
- A map from `BidError` code to bidder text lives beside `outcome-labels.ts`: `BID_TIMED_OUT` → "The lot is busy. Press Bid again; your bid will not be placed twice."; `BIDDER_NOT_ACTIVE` → R3's register prompt; `IDEMPOTENCY_MISMATCH` → "That bid was already sent with a different amount. Enter your maximum again."; unknown codes → a generic line. The code stays in a `data-code` attribute for tests.
- Acceptance: unit test that every `BidError` code has a mapped message containing no lowercase-first sentence and no "key"/"cents"; e2e forcing `BID_TIMED_OUT` (lock held by a raw connection) shows the mapped text and the resend writes one row.

### P1

**R6 — Catalog readable at 375 px (UX-06).** Below 30rem each lot is one block: title, current price or "No bids", and "Closes in …" or "Closed". Acceptance: Playwright at 375×812 asserts `document.documentElement.scrollWidth <= 375` on the catalog and that the first lot's price is visible.

**R7 — Show the caller their own maximum (UX-07).** Needs a decision entry amending D-50: caller-only `yourMaxCents`, never another bidder's. Position line adds "Your maximum: $X". `REJECTED_NOT_ABOVE_OWN_MAX` reads "Your maximum is already $X; enter more to raise it." Acceptance: lot-view unit test that the field is the caller's only and null for staff; e2e raise-refused message names the max.

**R8 — One-tap minimum bid and a one-line explainer (UX-08).** A second button "Bid $<minNext>" submits the current minimum with a fresh idempotency key (same rules as the typed form, D-52 b). The input placeholder is the minimum. One line under the label: "Enter the most you will pay. We bid for you, one step at a time, only as high as needed." Acceptance: e2e bids with one tap, the row's `maxCents` equals the shown minimum; a double tap writes one row.

**R9 — "My bids" (UX-09).** `/o/[org]/my-bids` for members with a paddle: each lot they bid on with Leading / Outbid / Won / Not won and the lot's close time; the menu links it. Catalog rows show the same position badge. Acceptance: e2e Ada outbid on lot 3 sees "Outbid" on my-bids without opening lot 3.

**R10 — Demo page that routes by journey (UX-10).** Two groups: "Bid" (Ada, Ben, Cal, Dee, with "shared with other visitors; another visitor may be bidding as Ada") and "Run the sale" (owner, admin). Other accounts collapsed under "Other seeded accounts". A staff sign-in with several orgs lands on the auctions of the org that has the live sale. Acceptance: e2e `/demo` → "Bid as Ada" lands on the catalog; "Run the sale" lands on `/o/acme/auctions`.

**R11 — Remove template leftovers from the auction journeys (UX-11).** `/` names Gavel, carries the scope banner and links to `/demo`; org Home redirects members to the catalog and staff to auctions; Projects is unlinked; Delete org leaves the menu (still reachable under settings); at 375 px the menu fits on one line or collapses behind a `<details>` "Menu". All changes in clone-owned files. Acceptance: e2e finds no "SaaS Foundation" or "Nothing here yet" text; at 375 px the lot price's top is within the first 300 px.

**R12 — Announce the moments that matter, not the ticks (UX-12).** A single polite live region announces "Under one minute left", "Extended by a late bid; now closes in 2:00", "Bidding has closed" once each. The countdown itself is not live. The extension stays visible as text ("Extended 3 times") after the 8 s highlight. Acceptance: component test that the region text changes once per event and not on each 250 ms tick.

**R13 — Fresh state on return; honest countdown when stale (UX-13).** On `visibilitychange` to visible, poll immediately. While stale, the countdown shows "Reconnecting…" beside it and the bid form stays usable (the server judges the time). Acceptance: e2e emulates a hidden→visible transition and sees a request within 200 ms; with the route blocked, "Reconnecting…" appears.

**R14 — Bid result updates the board at once (UX-14).** On a definitive answer the board takes `priceCents`, `minNextCents` and position from the action's response, then the next poll confirms. Acceptance: e2e outbid-on-entry shows one price on screen immediately after the response.

**R15 — Staff forms in dollars with a time preview (UX-15).** Start and reserve take dollars (`150` or `150.50`), parsed as text into integer cents by the same rule as the bid form (D-52 d), never through a float. Under each date field: "= 2026-10-28 17:04 UTC, closes in 20 min". After create, a notice "Lot 9 published" and the new row highlighted. Acceptance: e2e enters `100` and the stored `startCents` is 10000; `100.5` is 10050; `1e2` is refused.

**R16 — Auction status at a glance (UX-16).** Auctions list shows Scheduled / Open / Closed per sale. The auction lot table adds Status (Scheduled, Open, Closed – awaiting settlement, Settled: Sold / No bids / Reserve not met), current price and bids, all derived. Acceptance: e2e with a closed unsettled lot reads "awaiting settlement"; after `auction:close` reads "Settled: Sold".

**R17 — Invoices that explain themselves (UX-17).** Empty state: "No lots settled yet. Lots settle after they close (daily at 06:00 UTC on the demo)." A section "Not sold" lists unsold lots with their outcome. Each lot cell links to its history. Acceptance: e2e on an unsettled sale reads the empty text; on the fixtures sale lists 5 unsold lots (3 no bids, 2 reserve not met) and the lot 1 link opens its history.

### P2

**R18 — History legible without colour (UX-18).** An "Extended +m:ss" text badge on each extending row; "Corrected by" shows the user's name or email; the table's first column (Seq) stays visible on horizontal scroll. Acceptance: e2e lot 6 finds 3 "Extended" badges.

**R19 — Back links (UX-19).** Lot page: "← <auction name> catalog"; history: "← <auction name>" and "Bidder view". Acceptance: one click each in e2e.

**R20 — Stop polling a closed lot (UX-20).** After a CLOSED response the loop stops (or drops to 30 s while unsettled, to pick up the result for R1). Acceptance: e2e counts state requests over 10 s after close: at most 1.

**R21 — Relative close time in the catalog (UX-21).** "Closes in 4 min" with the UTC time in a `<time title>`; closed rows show final price and, for the caller, Won / Not won. Acceptance: e2e reads both.

**R22 — Accessible fat-finger confirm (UX-22).** Focus moves to the confirm on open and back to the input on cancel; Escape cancels. Acceptance: keyboard-only e2e confirms a 50× bid with Tab/Enter.

## Success Metrics

All measured by a Playwright spec on the production build, so they are repeatable numbers, not user claims.
- Bidder taps from `/demo` to an accepted bid: today 4 taps plus typing (sign in, lot, input, Bid); target 3 taps, no typing (R8, R10).
- Staff clicks from `/demo` to lot 6 history: today 5 (sign in lands on Your orgs → fixtures org → Auctions → sale → lot); target 3 (R10, R4).
- Lot-page states with distinct position text: today 3 (leading, outbid, none); target 7 (adds scheduled, won, not won, reserve not met).
- Pages with horizontal page scroll at 375 px among catalog, lot, my-bids: today 1 (catalog); target 0.
- Developer strings reachable in the bid form: today 3 BidError messages; target 0 (unit test over the code list).
- State requests per closed lot page per minute: today about 60; target at most 2.

## Open Questions

1. R1: before settlement, is a derived "You won" acceptable, or must the page wait for the `Settlement` row and say "Result pending"? Default: derived, labelled "final once settled", because the demo settles only at 06:00 UTC.
2. R7: does showing the caller their own maximum need anything beyond a D-50 amendment? Default: caller-only, staff null.
3. R10: should the demo stop sharing bidder accounts (per-visitor throwaway bidders)? Default: no, label the sharing; per-visitor accounts are a seed change for the business review.
4. R11: delete the Projects route or only unlink it? Default: unlink; removal follows the foundation's module switch (D-2).
5. R9: a member page or a catalog filter? Default: a separate page, so the menu can name it.

## Build notes

| Req | Files | Non-negotiable it brushes |
|---|---|---|
| R1 | `src/auction/lot-view.ts`, `lots/[id]/lot-live.tsx`, `src/app/api/lots/[id]/state/route.ts` | NN-5/D-21: result is derived from the fold, never stored or set; NN-8: reuse the pure `settle`, no second implementation; D-50 key set amended by decision. ETag must change on settlement, or the 304 freezes the result |
| R2 | `lot-view.ts` (add `opensAt`), `lot-live.tsx`, `bid-form.tsx` | NN-3: a disabled button sends nothing, so no attempt is lost; any request that does arrive is still recorded. NN-4: countdown keeps the server-clock offset (D-51 b) |
| R3 | `lot-live.tsx`, `lots/[id]/page.tsx`, reuse `catalog/actions.ts` `registerBidderAction` | none |
| R4 | `lots/[id]/page.tsx` (pass role), `lot-live.tsx`, `auctions/[id]/page.tsx` | none |
| R5 | new `src/auction/error-labels.ts` beside `outcome-labels.ts`, `lots/[id]/actions.ts`, `bid-form.tsx` | NN-2: `BID_TIMED_OUT` stays retryable with the same key; the copy must not suggest changing the amount |
| R6, R21 | `catalog/page.tsx`, `globals.css` (one media rule) | visual review owns the look |
| R7 | `lot-view.ts`, `bid-form.tsx`, `docs/decisions.md` | D-50 closed key set; caller-only |
| R8 | `bid-form.tsx` | D-52 b/d: one key per submission, cents from integers only |
| R9 | new `o/[org]/my-bids/page.tsx`, `layout.tsx`, `catalog/page.tsx` | read-only, no lock (D-50 e) |
| R10 | `(public)/demo/page.tsx`, `(public)/demo/signin/route.ts` | INV-27: still 404 without `DEMO_MODE`. `src/core/auth/demo` is template-owned; group in the page, not in core |
| R11 | `app/page.tsx`, `o/[org]/page.tsx`, `o/[org]/layout.tsx` | template-owned paths untouched; record any foundation patch in `FOUNDATION_PATCHES.md` |
| R12, R13, R14, R20 | `lot-live.tsx`, `bid-form.tsx` | D-51: poll interval rules; client clock only ticks |
| R15 | `auctions/actions.ts`, `auctions/page.tsx`, `auctions/[id]/page.tsx` | NN-6: integer cents, no float; reuse the bid form's text parser, do not write a second |
| R16 | `auctions/page.tsx`, `auctions/[id]/page.tsx` | NN-5/D-21: status derived via `lotStatus`, nothing set by hand |
| R17 | `auctions/[id]/invoices/page.tsx` | NN-8: totals still from `invoicesForAuction` only |
| R18, R19 | `lots/[id]/history/page.tsx`, `lots/[id]/page.tsx` | NN-3: history stays read-only, every row shown |
| R22 | `bid-form.tsx` | O-7 stays client-side only (D-52 c) |

No new dependency is needed for any requirement (CLAUDE.md: ask before adding one). Each requirement ships with its e2e spec on the production build and ends with `auction:verify` OK.
