# Gavel: design brief

For Claude Design. Everything you need is in this file; you won't have the codebase.

## What it is

Gavel runs timed online auctions for a fictional regional house that sells estates and equipment. Each lot has a closing time. Bidders enter a **maximum**, and the system bids for them one increment at a time, only as far as it needs to (proxy bidding). A bid in the last two minutes pushes the close out by two minutes (soft close), up to a hard cap of 30 extra minutes, so nobody wins by sniping. Every bid attempt, accepted or refused, goes into an append-only ledger. When a lot closes, settlement works out the winner, the hammer price and the buyer's premium from that ledger.

It is a **learning project with synthetic data only**. No real sale, bidder or money; settlement stops at a mock invoice. This banner appears on every screen, word for word:

> **Scope honesty:** Learning project, synthetic data only. No real sale, consignor, buyer or money. Nothing is paid: settlement produces a mock invoice and stops. The bid rules are one house's conventions written down as data, not an industry standard, and no claim is made about any state's auction law.

A live demo runs at gavel.labintelligence.co behind a shared password, with one-click demo sign-in.

## Who uses it

- **Bidder** (a member of the auction house's site): browses the catalog, registers once for a paddle number, and bids on lots. They come back in the final minutes of a lot they want, often on a phone, and need to see at a glance whether they're winning and how long is left.
- **Staff** (owner or admin of the house): create auctions and lots, watch them close, and after the sale read the invoices and, if a buyer disputes a result, the lot's full bid history. They work on a desktop.

## The idea the design should carry

**The last two minutes.** The lot page is the product. Everything a bidder needs to act in the final seconds should be visible without scrolling: the current price, the minimum next bid, the time left, and whether *you* are leading. The page polls the server (every second near the close) and updates in place. When a late bid extends the close, the countdown jumps back up, and that moment should be noticeable without being frantic. The tone is a well-run saleroom: calm, legible and fair. Not a casino, not a countdown-timer marketing page.

**Every outcome can be explained.** A disputed result is settled by the ledger, so the history page should read as the authoritative record: one row per attempt, in order, with what each attempt changed. Refused bids are shown, not hidden.

## Screens

The app already has an org shell: a top nav with the house name and links (Home, Catalog, Auctions for staff, Members, Your orgs, Account). Design the content area of these screens.

### 1. Catalog (bidder and staff)
- A **Register to bid** button until the user has a paddle, then "Paddle 3" in its place. Staff accounts can't bid and never see the button.
- Open lots, one row or card each: auction name, lot number, title, start price, closing time (UTC today; local time with UTC in a tooltip would be better), and the current price if there is one. Links to the lot page.
- Sample (the live demo sale): Brass ship's clock (start $50.00, reserve $120.00, closes in 1 day), Walnut drop-leaf table, Pair of cast-iron andirons (no reserve), Nine-patch quilt, Craftsman tool chest, Stoneware crock, Mahogany mantel clock, John Deere pedal tractor (closes in 30 days).

### 2. Lot page (bidder): the main screen
- Title, lot number, auction name, consignor.
- **Live panel**, updated by polling: status (Scheduled, Open or Closed), current price (or "No bids"), minimum next bid, number of bids, time to close, and the reserve as **met / not met** only (the amount is never shown to bidders, and "no reserve" displays the same as "met").
- **Your position**: "You are the high bidder." or "You have been outbid.", or nothing if you haven't bid. This needs to be the strongest signal on the page after the price.
- **Bid form**: "Your maximum" (dollars, e.g. `150` or `150.50`), a Bid button, and an inline result. The messages it can show:
  - `Bid accepted. You lead at $150.00.`
  - `Bid accepted, but you are not leading ($205.00).` (another bidder's maximum was higher)
  - Refused: lot not open yet, lot closed, below the minimum next bid (show the minimum), or not above your own current maximum.
  - `Connection problem. Press Bid again to resend the same bid.` (resending is safe: a resent bid is never written twice)
  - While sending: `Sending…`, with the button disabled.
- Closing states: time left over a minute, under a minute (polling every second), just extended by a late bid (show "+2:00" or similar), and closed.
- Must work at 375 px. The price, your position, the countdown and the bid button all fit on the first screen.

### 3. Auction page (staff)
- Name, opening time, soft-close settings (2-minute window, 30-minute cap) and buyer's premium (15.00 %).
- Lots table: lot number, title, start, reserve (staff can see it), closing time, status. A **New lot** form below: title, consignor, start price, reserve (optional), closing time.
- Link to the invoices.

### 4. Invoices (staff)
- One block per buyer, headed "Paddle 102". Rows: lot, title, hammer, premium, total; a **Due** row at the bottom.
- Sample: Paddle 102 bought lot 1, the oak roll-top desk: hammer $160.00, premium $24.00, total $184.00.
- The sale as a whole (fixtures house): 36 lots, 31 sold, 3 with no bids, 2 with the reserve not met. Unsold lots aren't errors; show them as outcomes.

### 5. Lot history (staff): the dispute view
- One row per attempt, in sequence order: seq, bidder (paddle), maximum, outcome, price before → after, leader before → after, close before → after, placed at (to the millisecond).
- Then a **Settlement** block: outcome, winner, hammer, premium, total. If the settlement was corrected, every version is shown, newest first, with the older ones marked as superseded (never edited).
- Up to a few hundred rows. Accepted and refused rows must be distinguishable without colour alone. A row that extended the close should stand out, because those rows are what a dispute is usually about.
- Sample: **Box lot of hand tools** (lot 6): 7 bids, 3 extensions, closed 269 s after its scheduled end.

## Outcomes

These are computed by the system, never set by hand. Each needs a consistent badge: a human label, with the key visible to staff.

| Key | Label | Shown to |
|---|---|---|
| `ACCEPTED_LEAD` | Leading | bidder, staff |
| `ACCEPTED_OUTBID` | Accepted, outbid | bidder, staff |
| `ACCEPTED_RAISE` | Maximum raised | bidder, staff |
| `REJECTED_LOT_NOT_OPEN` | Not open yet | bidder, staff |
| `REJECTED_LOT_CLOSED` | Closed | bidder, staff |
| `REJECTED_BELOW_MINIMUM` | Below minimum | bidder, staff |
| `REJECTED_NOT_ABOVE_OWN_MAX` | Not above your maximum | bidder, staff |
| `REJECTED_LOT_WITHDRAWN` | Lot withdrawn | bidder, staff (D-73) |
| `SOLD` | Sold | staff (bidders see "Won" / "Not won") |
| `UNSOLD_NO_BIDS` | No bids | staff |
| `UNSOLD_RESERVE_NOT_MET` | Reserve not met | staff |
| `UNSOLD_WITHDRAWN` | Withdrawn | staff (bidders read "withdrawn from the sale"; D-73) |

Lot status, also derived: Scheduled, Open, Closed, Settled; a withdrawn lot shows Withdrawn where Closed would be (D-73).

## Money and time display rules

- Always dollars and cents, `$1,067.82`, with tabular figures and right-aligned number columns. Never abbreviated ("$1.1k") and never rounded.
- The buyer's premium is a percentage to two decimals (stored in basis points: 1500 → 15.00 %).
- The increment depends on the price: $1 under $100, $5 to $500, $10 to $1,000, $25 to $5,000, $50 to $10,000, $100 to $25,000, and $250 above that. The bidder doesn't need the table; they need the minimum next bid stated plainly.
- Times in tables are ISO, UTC (`2026-10-27 14:03:07.412Z` on the history page). The countdown on the lot page is `mm:ss` under an hour, then `1 h 12 m`, then days.

## Constraints

- Built with Next.js server components and plain semantic HTML. Client JavaScript is limited to small islands: the live panel (polling), the bid form and the countdown. The app has **no styling at all** today (browser defaults), so propose the system as well as the screens: tokens, type, tables, badges, buttons, form fields and the live panel.
- Light and dark themes.
- Accessibility: WCAG AA contrast; outcome and leading/outbid conveyed in text as well as colour; real `<table>` semantics with header cells; price changes announced politely to screen readers (`aria-live="polite"`), never on every poll tick.
- No real auction-house branding, logos, gavel clip art or "trusted by" seals. Name the app "Gavel" and use a neutral demo house such as "Harlan & Pike Auctioneers".
- No throughput or speed claims anywhere on screen.

## What to send back

1. A small design system: colour and type tokens, table style, outcome badges, money cell, button and field states.
2. The five screens at desktop width, plus the lot page and the catalog at 375 px.
3. The lot page's live panel in four states: open with time to spare, under a minute, just extended, and closed (won and not won).
4. The bid form's result messages: accepted and leading, accepted but outbid, below minimum (showing the minimum), and connection problem.
5. A history-page excerpt showing an accepted row, a refused row and a row that extended the close, plus a corrected settlement.
