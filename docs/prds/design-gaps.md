# PRD: Gavel — Design gaps after the first styling pass

**Reviewer lens:** visual and product design only (hierarchy, type, colour and contrast, spacing, components, states, responsive layout). UX flows and auction business features are reviewed separately; overlaps get one line each.
**Inputs:** `docs/design-brief.md`, `src/app/globals.css`, the screens under `src/app/o/[org]/`, the template pages under `src/app/`, and the screenshots in the session scratchpad (`shots/*.png`, `brief-shots/*.png`). The deployed demo was not opened (it is behind a password).
**Status:** Draft v1, 2026-10-27

`docs/decisions.md` outranks this document wherever they differ.

---

## Scope Honesty (read first)

Learning project, synthetic data only. This PRD covers how the screens look and read, not what the engine does. Each contrast figure below was computed from the hex tokens in `src/app/globals.css` with the WCAG 2.x relative-luminance formula, in both themes. Each pixel position was read off a screenshot taken at the stated width. Nothing in this PRD claims anything about speed or capacity, and nothing it asks for may put such a claim on screen. Constraints carried over from the brief: plain CSS in one stylesheet, no new dependencies, server components with small client islands, WCAG AA, no gavel clip art or real branding.

## Problem Statement

The first pass got the foundations right. Text contrast passes everywhere (the lowest text pair is muted on baize-soft at 4.92:1). Figures are tabular, tables are real tables, and the price board is loud in the right place. But the brief asks for more than a styled default. It asks for *the last two minutes* on a phone, and for outcomes a reader can explain. Measured against that, the important states are missing or collapsed into one look:

- **Phone, lot page.** At 375×667 the Bid button sits below the fold. The nav alone takes three lines.
- **Phone, catalog.** At 375 px the catalog shows only Lot and Title. Price and closing time are hidden behind a horizontal scroll that nothing hints at.
- **Bid results.** All four result messages render as the same bold paragraph.
- **Closed lots.** There is no won or not-won state, so a closed lot still says "You are the high bidder."
- **Lot history.** The rows that extended the close are highlighted in the same green as the Leading badge, so the badges disappear into those rows.
- **Template screens.** These were never designed. The public landing page still reads "SaaS Foundation".

## Findings

| ID | Sev | Screen / file | What is wrong or missing | Evidence |
|---|---|---|---|---|
| DS-01 | P0 | Lot page, 375 px | The Bid button is below the first screen (top ≈667 px, bottom ≈715 px) with no position banner and no result message showing. A banner adds 54 px. Brief: price, position, countdown and Bid all fit on the first screen. | `shots/lot-phone.png`; brief §2 |
| DS-02 | P0 | Org nav, 375 px | The nav wraps to 3 lines (≈107 px, 16% of a 667 px screen). Separators are left dangling at line ends ("Catalog ·"). The template "Projects" link shows to bidders. | `shots/catalog-phone.png`; `o/[org]/layout.tsx:14-18` |
| DS-03 | P0 | Catalog, 375 px | `.table-scroll table { min-width: 56rem }` hides Start, Current and Closes off-screen, with no scroll affordance. The brief asks for cards at 375 px. | `globals.css:71`; `shots/catalog-phone.png` |
| DS-04 | P0 | Lot page, closed | There is no Won / Not won treatment. The closed board keeps the live-state banner ("You are the high bidder.") and adds a plain "Bidding has closed" line. This is brief deliverable 3. | `lot-live.tsx:70-74,93`; `globals.css:127` |
| DS-05 | P0 | Bid form results | Leading, accepted-but-outbid, refused and connection problem all render as one bold `role=status` paragraph in ink. Nothing tells them apart in colour, icon or badge. Validation errors look the same too. This is brief deliverable 4. | `bid-form.tsx:67`; `globals.css:126`; compare `shots/lot-ada-refused.png` and `shots/live-ben-leading.png` |
| DS-06 | P0 | Landing `/` | The h1 reads "SaaS Foundation". The string "Gavel" appears nowhere in any nav. Demo and login pages have no header at all. | `src/app/page.tsx:10`; `shots/demo.png` |
| DS-07 | P1 | All `ActionForm` forms | `ActionForm` wraps the fields in a `<fieldset>`, so the form's flex `gap` applies to that single child. Labels stack with 0 px between an input and the next label, and the button sits flush under the last input. | `core/ui/action-form.tsx` (fieldset); `globals.css:75`; `shots/auctions.png` |
| DS-08 | P1 | Destructive actions | "Delete my account", "Delete org", "Remove" and "Revoke" all use the primary baize button, the same weight as "Bid". There is no danger variant. | `account/security/page.tsx:68`; `settings/danger/page.tsx:17`; `settings/members/page.tsx:46` |
| DS-09 | P1 | Badges | There are only 3 tones. The plain badge border is `--rule` at 1.43:1 (light) and 1.37:1 (dark), so a plain badge reads as loose grey text. "Closed" is a plain badge for lot status in the catalog but a red badge for `REJECTED_LOT_CLOSED`: one word, two meanings. Lot status (Scheduled / Open / Closed / Settled) has no badge set. | `globals.css:95-97`; `outcome-labels.ts:9`; `catalog/page.tsx:36` |
| DS-10 | P1 | History, extended rows | The extended-row fill is `--baize-soft`, the same token as the good badge, so Leading badges on those rows lose their pill (1.00:1). The fill sits at 1.19:1 against an ordinary row, so the 4 px bar is the only real cue. Green also says "good", but an extension is neutral. | `globals.css:96,98`; `shots/history.png` rows 5–7 |
| DS-11 | P1 | History, columns | At 1280 px the "Close after" and "Placed at" columns are cut off, with no scroll hint. "Close before" and "Close after" repeat an identical 24-character ISO string on most rows. The format is `2026-11-07T14:10:00.000Z`, not the brief's `2026-10-27 14:03:07.412Z`. No row shows by how much it extended the close. | `history/page.tsx:51`; `shots/history.png`; brief §5 |
| DS-12 | P1 | History, settlement | Rows run oldest first ("Settled", then "Correction 1"). The brief asks for newest first with older versions marked superseded. "Corrected by" prints a raw user id. | `history/page.tsx:64-69`; brief §5 |
| DS-13 | P1 | Lot page, final minute | The only change in the final minute is the clock turning oxblood, a colour cue alone (WCAG 1.4.1). Oxblood also means "outbid", so a leading bidder sees a green banner over a red clock. | `globals.css:114`; `lot-live.tsx:68` |
| DS-14 | P1 | Lot page, extended | The "+2:00" note is a small baize line that fades for 1.6 s. It uses the "good" colour for a neutral event, and the countdown itself shows no jump. | `globals.css:115-116`; `lot-live.tsx:84` |
| DS-15 | P1 | Lot page, scheduled | A scheduled lot shows "Time left" to the close and a live Bid form, the same look as an open lot. Only the small facts row says "Not open yet". | `lot-live.tsx:82,87,93` |
| DS-16 | P1 | Lot page, stale | The connection alert borrows `.board-closed`, so it looks like a closed-lot note. The price stays at full weight while it may be stale. | `lot-live.tsx:69` |
| DS-17 | P1 | Lot page, no bids | "No bids" is set at price size (5.5 rem) as a headline. The number the bidder can act on, the opening or minimum bid, sits small in the facts row. | `shots/lot-ada-leading.png`; `lot-live.tsx:78` |
| DS-18 | P1 | Times everywhere | Every time is UTC ISO, and the lot board shows `2026-10-28 17:04:00 UTC`. The brief's "local time, UTC in a tooltip" is not met anywhere. | `catalog/page.tsx:36`; `lot-live.tsx:91`; `auctions/page.tsx:17`; `auctions/[id]/page.tsx:22,28` |
| DS-19 | P1 | Invoices | Column edges differ from buyer to buyer: the Hammer header sits at x≈737, 821, 763, 741, 855 and 786 in six consecutive tables, despite `table-layout: fixed`. There is no sale summary (sold / no bids / reserve not met), so unsold lots are invisible rather than shown as outcomes. | `shots/invoices.png`; `globals.css:140-142`; brief §4 |
| DS-20 | P1 | Auction (staff) | The lots table has no Status column, which the brief requires. Titles link only to history, never to the lot page. Auction index is a bullet list. | `auctions/[id]/page.tsx:25-28`; `auctions/page.tsx:15-19` |
| DS-21 | P1 | Template screens | Org Home is "Nothing here yet". The demo page shows 11 solid primary buttons with list bullets, the role text sits below the button baseline, and staff accounts are not grouped apart from bidders. Members table has no header row. | `o/[org]/page.tsx:9`; `shots/demo.png`; `settings/members/page.tsx:25` |
| DS-22 | P2 | Lot page, desktop | The board stops at 46 rem, leaving ≈40% of a 1280 px screen empty to its right. There is no image placeholder or lot detail column. | `globals.css:105`; `shots/lot-ada-outbid.png` |
| DS-23 | P2 | Catalog / lot imagery | There is no image or placeholder slot, so catalog rows read as a ledger, not a sale. The data has no image field. | `catalog/page.tsx`; `lot/[id]/page.tsx` |
| DS-24 | P2 | System tokens | There is no spacing, type-size or radius scale (0.6, 0.85 and 1.15 rem are used ad hoc; radii are 6 and 12 px literals) and no warning or info tone. | `globals.css` throughout |
| DS-25 | P2 | Button states | Hover is `brightness(1.08)`, about 1.1:1 against rest, which is invisible. Disabled is `opacity: .6`, so "Sending…" sits at 2.91:1 (light) and 3.91:1 (dark). `cursor: progress` also lands on fieldset-disabled buttons that are not in progress. | `globals.css:86-87` |
| DS-26 | P2 | Loading / error | There is no `loading.tsx` anywhere. `global-error.tsx` renders its own `<html>` with no styles. | `find src/app -name loading.tsx` (none); `global-error.tsx` |
| DS-27 | P2 | Countdown type | Unit letters are set at digit size and weight ("23 h 59 m", "6 d 0 h"), so they read as one blob. Under an hour the format is `0:42`, while the brief says mm:ss. | `globals.css:113`; `lot-live.tsx:99-103` |
| DS-28 | P2 | Shell alignment, banner | The nav's left edge is x=64 and the content's is x=80 (a 16 px offset at 1280 px). The footer rule and its text are misaligned the same way. The banner text is not verbatim: it reads "Scope honesty: learning…" with no bold label. | `globals.css:48,53,136`; `layout.tsx:15`; brief §1 |

**Contrast, measured** (light / dark). Passing: ink/paper 14.64 / 15.02; muted/paper 5.34 / 7.20; muted/surface 5.85 / 6.51; muted/baize-soft 4.92 / 5.48; baize/surface 8.06 / 7.83; oxblood/surface 8.35 / 6.65; oxblood/oxblood-soft 6.90 / 6.01; paper on baize (buttons, leading banner) 7.37 / 8.66; paper on oxblood 7.63 / 7.36; focus/paper 4.40 / 7.67. Failing or weak: rule/surface 1.43 / 1.37 (fine for dividers, too faint for a badge border); baize-soft fill/surface 1.19 / 1.19 (extended-row fill); disabled button text 2.91 / 3.91; focus ring on baize 1.68 / 1.13 (acceptable only because the 2 px offset lands the ring on paper; keep the offset).

## Goals

1. **The last two minutes work on a phone.** At 375×667 a bidder sees price, position, countdown, minimum next bid and the Bid button without scrolling, in every lot state.
2. **Every state has a look.** Open, final minute, just extended, scheduled, stale, closed-won, closed-not-won and no-bids are each recognisable in greyscale.
3. **One badge vocabulary.** The 11 outcomes and the 4 lot statuses map to a fixed label and tone set, used the same way on bidder and staff screens.
4. **The history page reads as the record.** Extensions stand out without hiding outcomes, every column is reachable, and corrections read newest first.
5. **No screen looks unfinished**, the template screens included, and the product is called Gavel everywhere.

## Non-Goals

- New dependencies, CSS frameworks, icon fonts or a component library. Plain CSS in `globals.css` stays the system.
- Real photography or uploaded lot images. A neutral placeholder only (adding image storage is a feature; see the business review).
- A manual theme switch. `prefers-color-scheme` stays the only theme control.
- Changes to the polling cadence, bid logic, labels' wording in `outcome-labels.ts` beyond tone, or route structure. Overlap: the "my bids" view, cents-denominated staff inputs, the scheduled-lot countdown target, and the Projects nav link belong to the UX review.
- Any figure about speed, latency or capacity on screen.

## Requirements

### P0

- **R-01 Phone lot board fits.** At 375×667 the Bid button's bottom edge is ≤ 667 px from the top of the page in all four cases (no banner, leading banner, outbid banner, banner plus a one-line result). Price, position, countdown, minimum next bid and Bid are all visible. *Accept:* a Playwright check at 375×667 asserts `getBoundingClientRect().bottom ≤ 667` for `[data-testid=price]`, `[data-testid=countdown]`, `[data-testid=min-next]` and the submit button in each case.
- **R-02 Compact phone nav.** Below 30 rem the org nav is one line ≤ 56 px tall: the house name plus a native `<details>` menu, with no dangling separators. *Accept:* nav height ≤ 56 px at 375 px. The separators are CSS (`li + li::before`), not text nodes.
- **R-03 Catalog cards at 375 px.** Below 40 rem the catalog renders one card per lot: lot number, title, auction, status badge, current price (or "Opening bid $X"), and time left or closing time. *Accept:* `document.documentElement.scrollWidth ≤ 375` on the catalog at 375 px. Every card shows all six fields. Desktop keeps the table.
- **R-04 Closed-lot result.** A closed lot shows exactly one of three banners in the `.board-you` slot: **Won** (baize, "You won this lot at $X."), **Not won** (neutral, "This lot sold to another bidder." / "This lot closed unsold."), or none for a non-bidder. It never says "You are the high bidder." once closed. *Accept:* screenshots of all three, each with its label word first, pass greyscale review. Overlap: needs a won/not-won value from `lot-view` (business review).
- **R-05 Four bid-result treatments.** The result is a callout with a leading badge word and a tone: Leading (lead), Accepted, outbid (outbid), Refused with the minimum stated (refused), Connection problem (warning, keeps the resend wording). Validation errors use the refused tone and set `aria-invalid` and the error border on the input. *Accept:* the four callouts tell apart in greyscale by badge word and border style. Text ≥ 4.5:1 and borders ≥ 3:1 in both themes.
- **R-06 Gavel identity.** `/` reads "Gavel" with a one-line description and the Sign in and Demo links. A text-only "Gavel" wordmark (no glyph) leads the org nav and a minimal header on the public pages (login, demo, legal). *Accept:* no rendered page contains "SaaS Foundation". Every page shows "Gavel" above the fold.

### P1

- **R-07 Form layout.** Fields inside `ActionForm` get the same flex/gap layout as a bare `form`. *Accept:* on the Auctions page, ≥ 12 px between an input's bottom and the next label, and the button bottom-aligns with the inputs on a wide screen. The fix lives in `globals.css` (`form > fieldset`), not in template-owned `src/core/ui/action-form.tsx`.
- **R-08 Danger button.** `button[data-variant='danger']`: oxblood outline at rest, oxblood fill on hover and focus. It is applied to delete-account, delete-org, remove-member and revoke actions. *Accept:* no destructive action uses the baize fill. Text ≥ 4.5:1 both themes.
- **R-09 Badge system.** There are five tones: lead, outbid, refused, neutral, info (extension and scheduled). Every badge border is ≥ 3:1 against its background. Lot status has its own badge set (Scheduled info, Open lead-outline, Closed neutral, Settled neutral-solid), used in the catalog, the auction table and the board. The lot-status "Closed" and the refusal are told apart by tone and context; the refusal keeps the label "Closed" from the brief. *Accept:* a unit test renders all 15 badges and checks each tone pair: ≥ 4.5:1 for text and ≥ 3:1 for the border, in both themes.
- **R-10 Extended rows.** History rows that extended the close use a new `--info` tone (not baize), shown as a 4 px left bar, a bold "Close after", and a "+m:ss" chip. Badge pills keep a ≥ 3:1 border so they survive any row fill. *Accept:* on the lot 6 fixture, rows 5–7 show "+" chips, and Leading badges in them have visible borders.
- **R-11 History columns.** At ≥ 80 rem all columns fit without scrolling. Below that, a sticky first column and an edge shadow signal the scroll. Times are formatted `2026-10-27 14:03:07.412Z`. "Close before" is dropped or muted when it equals the previous row's "Close after". *Accept:* at 1280 px, "Placed at" is fully visible for the lot 6 fixture.
- **R-12 Settlement chain.** Newest first. Older versions are muted and carry a "Superseded" neutral badge, never struck through (they are records, not mistakes). "Corrected by" shows a name or email, not an id. *Accept:* a corrected fixture renders the current row first and its predecessor marked "Superseded".
- **R-13 Final minute without colour alone.** Under 60 s the label changes to "Final minute". The board gets a 3 px oxblood top rule and the clock stays ink. *Accept:* the final state is distinguishable from the open state in greyscale. Clock text ≥ 7:1.
- **R-14 Extended moment.** On extension the countdown gets a 1-cycle outline pulse (none under `prefers-reduced-motion`) and an info-tone chip "Extended +2:00 by a late bid" that stays for 8 s (as now). *Accept:* the chip uses the info tone, not baize. It is visible without motion.
- **R-15 Scheduled board.** A scheduled lot shows a "Scheduled" badge, "Opens" with the opening time in place of the countdown label, and the Bid form in a disabled look with a one-line reason. *Accept:* a screenshot of a scheduled lot differs from an open one in label, badge and form state. Overlap: what the countdown counts to is the UX review's call.
- **R-16 Stale board.** While stale, a warning callout sits at the top ("Connection problem; retrying. Last updated hh:mm:ss.") and price and clock drop to `--muted`. *Accept:* stale styling clears on the next 200 or 304 response. Its text ≥ 4.5:1.
- **R-17 No-bids board.** With no bids the big number is the opening bid ("Opening bid" label, `$50.00`), and "No bids yet" sits at label size. *Accept:* `[data-testid=price]` never contains a word at display size.
- **R-18 Local time.** A small client `<LocalTime>` island renders the viewer's local time with `title` set to the UTC ISO string. It is used in the catalog, the board, the auction pages and the invoices header. Server render falls back to UTC with a "UTC" suffix. *Accept:* with `TZ=America/Chicago`, the catalog shows Chicago times and hovering shows UTC. The history page stays UTC on purpose (it is the record).
- **R-19 Invoices.** Column edges line up across every buyer table to ±1 px (`<colgroup>` widths). A sale summary strip above the invoices shows lots, sold, no bids and reserve not met, each with its outcome badge. *Accept:* the Hammer header's x is identical across every table on the fixtures-house invoices page. Summary counts match the fixture (36 / 31 / 3 / 2).
- **R-20 Auction page.** Auction index becomes a table (name, opens, lots, status). The lots table adds a Status badge column, and each title links to the lot page with a separate "History" link. *Accept:* every row shows a status badge. Both links are present.
- **R-21 Template screens.** Org Home shows a real landing: for bidders, their paddle and the catalog link; for staff, links to Auctions. The demo page groups accounts into "Staff" and "Bidders", uses one secondary button per row in a two-column table, and drops the bullets. Members table gets a header row. *Accept:* no page reads "Nothing here yet". Demo shows ≤ 1 primary-weight element. Overlap: what Home *should* contain is the UX review's call.

### P2

- **R-22 Desktop lot layout.** At ≥ 64 rem the board and a lot detail column (image placeholder, consignor, description) sit side by side. The board stays first in DOM order.
- **R-23 Image placeholder.** A neutral 4:3 tile: `--paper` ground, a 1 px `--rule` border, and the lot number in large muted figures. No icon or clip art. Used in catalog cards and the lot detail column.
- **R-24 Tokens.** Add `--space-1..6` (4/8/12/16/24/40 px), `--text-xs..display`, `--radius-sm/lg`, and `--warn`, `--warn-soft`, `--info`, `--info-soft` in both themes. Existing rules migrate to the tokens.
- **R-25 Button states.** Hover changes the background by a visible step (baize → `--baize-strong`, ≥ 1.3:1 against rest). Disabled uses a solid `--rule` background with `--muted` text (≥ 4.5:1) instead of opacity. `cursor: progress` only applies under `[aria-busy=true]`.
- **R-26 Loading and error.** `loading.tsx` skeletons for the catalog, lot and history pages, using `--rule` blocks at the final layout's size so nothing jumps. `global-error.tsx` gets inline minimal styles.
- **R-27 Countdown type.** Units at 0.5 em and weight 600. Under an hour the format is `mm:ss` (`00:42`).
- **R-28 Shell polish.** The nav and content share one left edge (both `max-width: 72rem` with `margin: auto`). The scope banner matches the brief word for word, with a bold "Scope honesty:" label.
- **R-29 Print.** `@media print` for invoices and history: no nav, black on white, no row fills (extension conveyed by the "+" chip), and page breaks between buyers.

## Proposed token and component changes (CSS-level)

- **Tones.** Light: `--info:#2c5a85; --info-soft:#e4edf6; --warn:#7a5200; --warn-soft:#f7eedb`. Dark: `--info:#8db8e8; --info-soft:#1c2a38; --warn:#e3b765; --warn-soft:#33291a`. Each text-on-soft pair must be verified ≥ 4.5:1 before merge (same script as this review).
- **Badge.** `.badge { border: 1px solid currentColor }` for every tone, so the pill survives any row fill. `[data-tone]` takes lead / outbid / refused / neutral / info. The neutral tone uses `--muted` text and a `--muted` border (5.85:1).
- **Callout.** `.callout { border-left: 4px solid var(--tone); background: var(--tone-soft); padding: var(--space-3) var(--space-4) }`, starting with a `.badge`. Used for bid results, the stale state and the scheduled reason.
- **Board.** `[data-phase=final]` adds `border-top: 3px solid var(--oxblood)` and the label "Final minute"; the clock keeps `--ink`. `[data-state=won|lost|scheduled|stale]` drive the banner and dimming. Phone (< 30 rem): the price at `clamp(2.5rem, 13vw, 3.5rem)` and the clock share one row (`grid-template-columns: 1fr auto`); the facts row becomes a 2×2 grid; the form becomes sticky at the bottom of the board's own viewport (`position: sticky; bottom: 0`) so Bid is always reachable.
- **Nav.** `nav ul { display:flex; list-style:none }` with `li + li::before { content:"·" }`. Below 30 rem, links move into `<details class="nav-menu">`.
- **Catalog card.** `.lot-card { display:grid; grid-template-columns: 4.5rem 1fr; gap: var(--space-3) }`, with the placeholder in column 1 and price and time on one line with `justify-content: space-between`.
- **History.** `tr.extended td:first-child { box-shadow: inset 4px 0 0 var(--info) }`, no row fill; `tr.refused td { color: var(--muted) }` with the badge kept at full tone; `.table-scroll` gets `position: sticky; left: 0` on the first column and a right-edge gradient shadow.
- **Invoices.** `<colgroup>` with fixed widths (4.5rem / auto / 9rem ×3); drop the `nth-child` width rules.

## Success Metrics

- At 375×667, the R-01 check passes in 4 of 4 board cases. Catalog `scrollWidth` ≤ 375.
- Every token pair used for text is ≥ 4.5:1, and every badge border, focus ring and state indicator is ≥ 3:1, in both themes. The contrast script output gets committed next to this PRD.
- Each of the brief's 5 deliverables has a matching screenshot in `docs/` (DS-04, DS-05, DS-11 and DS-12 closed).
- Greyscale review: a reader can name the lot state and every bid result from a desaturated screenshot alone.
- Zero rendered pages contain "SaaS Foundation" or "Nothing here yet".

## Open Questions

1. Should Won use the baize fill like Leading, or a calmer outline? A fill matches "strongest signal". An outline avoids a casino feel after the sale.
2. Should the final minute tint the whole board, or only the top rule? This PRD proposes only the rule. Owner to confirm the tone.
3. Is a sticky bid form on phones acceptable, or does it hide the facts row? The alternative is a smaller price clamp.
4. Local time in the catalog only, or everywhere a bidder sees a time? Staff tables arguably stay UTC.
5. Should the image placeholder appear before any lot has an image field, or wait for that feature?

## Build notes (files touched)

- `src/app/globals.css`: tokens, badge, callout, board states, nav, catalog cards, history, invoices, print, button states.
- `src/app/layout.tsx`: banner text, header wordmark slot.
- `src/app/page.tsx`: Gavel landing (R-06).
- `src/app/o/[org]/layout.tsx`: nav as a list, phone menu.
- `src/app/o/[org]/page.tsx`: org home (R-21).
- `src/app/o/[org]/catalog/page.tsx`: card markup, status badge, `<LocalTime>`.
- `src/app/o/[org]/lots/[id]/lot-live.tsx`: `data-state`, final label, no-bids, scheduled, stale, won / not won.
- `src/app/o/[org]/lots/[id]/bid-form.tsx`: callout markup, `aria-invalid`.
- `src/app/o/[org]/lots/[id]/history/page.tsx`: extension chip, time format, refused class, settlement order.
- `src/app/o/[org]/auctions/page.tsx`, `auctions/[id]/page.tsx`, `auctions/[id]/invoices/page.tsx`: tables, status, colgroup, summary.
- `src/app/(public)/demo/page.tsx`: grouped table.
- `src/app/o/[org]/settings/members/page.tsx`, `src/app/account/security/page.tsx`, `src/app/o/[org]/settings/danger/page.tsx`: danger variant, thead.
- New: `src/app/o/[org]/local-time.tsx` (client island), `loading.tsx` for the catalog, lot and history pages.
- `src/auction/outcome-labels.ts`: tone values only (lead / outbid / refused / neutral / info). No label changes.
- Not touched: `src/core/**` (template-owned); R-07 is solved in CSS.
