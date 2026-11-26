# Gap PRDs (2026-10-27)

Three reviews of the deployed demo, each written by a separate reviewer from the code, docs and screenshots. `docs/decisions.md` still outranks all three; each flags where it would contradict a decision.

| PRD | Findings | Requirements (P0 / P1 / P2) |
|---|---|---|
| [ux-gaps.md](ux-gaps.md) | UX-01..UX-22 | 5 / 12 / 5 |
| [design-gaps.md](design-gaps.md) | DS-01..DS-28 | 6 / 15 / 8 |
| [auction-domain-gaps.md](auction-domain-gaps.md) | AX-01..AX-23 | 6 / 12 / 5 |

## Where they agree (merged P0s)

| # | Gap | Sources | Verified in code |
|---|---|---|---|
| 1 | A closed lot never says won / not won; the leader keeps seeing "You are the high bidder." even under the reserve | UX-01, DS-04 | yes: `lot-view.ts` sets `you` from the leader alone |
| 2 | "Bids" and the catalog's price use every attempt, rejected included: one refused attempt shows "Bids 1" and $0.00 | AX-01 | yes: `bidCount` is every written row (`engine.ts:24`) |
| 3 | A scheduled lot counts down to its close and still offers a bid form | UX-02 | — |
| 4 | The lot page treats every viewer alike: no register button there, staff get a bid form, no link to or from the history | UX-03, UX-04 | — |
| 5 | Bidders can see raw developer error text (e.g. the lock-timeout message) | UX-05 | — |
| 6 | Bid results (leading, outbid, refused, connection problem) all look the same | DS-05 | — |
| 7 | On a 375×667 phone the Bid button is below the first screen; the nav wraps to 3 lines; the catalog hides price and close behind a sideways scroll | DS-01, DS-03, UX-06 | — |
| 8 | A bidder cannot see their own maximum (needs a D-50 change) | UX R7, AX-02 | — |
| 9 | Template leftovers: "SaaS Foundation", "Nothing here yet", Projects, Delete org | UX-11, design | — |
| 10 | Extended-close row fill equals the Leading badge fill, so the badge vanishes (1.00:1) | DS-10 | yes: both `--baize-soft` |

Not a bug: UX's note that an accepted-but-outbid bid extended the close on lot 6 is the written rule (brief §6: a bid that challenges the leader extends the close, whether or not it takes the lead).

Domain P0s with no UX or design overlap (each needs a decisions entry; several touch fixtures): withdraw a lot before close (AX-04), buyer-visible invoices with due date and pickup text (AX-06), consignor contracts and statements (AX-07), terms of sale accepted before bidding (AX-03), bidder suspension in the app (AX-05).
