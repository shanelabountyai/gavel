# Phase 3 — Surfaces

Draft for Shane's review, written at the Phase 2 gate (2026-10-20). Not started. Phase 2 exit: 2.1–2.6 ticked, Shane's six-ledger reading recorded (D-46), CI green.

Phase 1 proved the bid path and Phase 2 made results usable by staff. Phase 3 puts a screen in front of a bidder and finally measures the HTTP path. The engine and the lock do not change: every screen calls the existing `placeBid`, `correctSettlement` and read functions. Polling is a seam, not a shortcut (PRD non-goal: no WebSockets, SSE or presence). Still no payment and nothing sent anywhere.

- [x] **3.1 Staff catalog.** (D-48) Create auction (settings per O-3/O-4), create lots (kind, start, reserve, consignor text), publish. Server actions behind the foundation's org guard; the reserve and start checks already in the DB (D-11) surface as typed form errors. *Acceptance:* a Playwright spec creates an auction and a lot, publishes it, and the lot appears in the bidder catalog; a reserve below start is refused on screen and writes nothing.
- [ ] **3.2 Bidder registration.** A user registers in an org and gets a `Bidder` row with the next paddle number, status ACTIVE (D-25). *Acceptance:* two registrations get distinct paddles under a concurrent submit (unique index, not an app check); a staff role does not get a bid form.
- [ ] **3.3 Lot read endpoint with ETag.** `GET /api/lots/[id]/state`: price, next minimum, closesAt, status, "reserve not met" boolean (O-5), and for the caller only "you lead" / "outbid". Never any max, the reserve amount or another bidder's identity (brief §4). ETag from `bidCount`; `304` when unchanged. *Acceptance:* a test that no response body for another bidder contains a max or a paddle; a second poll with the ETag returns 304.
- [ ] **3.4 Bidder lot page.** Current price, next minimum, leader state, countdown computed from the server's `closesAt` (never the client clock), polling every 1–2 s with the ETag. *Acceptance:* Playwright on the production build: a second bidder's bid appears on the first bidder's page within two polls; the countdown follows an extension.
- [ ] **3.5 Bid form and the O-7 confirmation.** Client-generated idempotency key per submission, resent on retry; `BID_TIMED_OUT` shown as retryable (D-13). A max above 10× the current price asks for confirmation (O-7); the engine caps nothing. *Acceptance:* double-click writes one row; a 50× max shows the confirmation and a cancelled one writes nothing.
- [ ] **3.6 Outbid and won notices through the outbox (O-11).** Written in the same transaction as the ledger row that outbids someone and at settlement; delivered by the foundation's outbox to the captured-message sink, never sent anywhere. Registered templates (Callboard pattern). *Acceptance:* N bids produce exactly the outbid notices their rows imply; a rolled-back bid leaves no outbox row.
- [ ] **3.7 HTTP latency next to the Phase 1 number.** Extend `load:bids` with an HTTP mode against the production build; `docs/LOAD.md` gets a second line, same hardware, with the connection count and the Phase 1 line beside it. *Acceptance:* the line states writers, connections, p50/p95/p99, max lock wait, timeouts, hardware and versions; `auction:verify` OK last. Revisit O-8 (5000 ms) here with the number.
- [ ] **3.8 Gate.** `auction:verify` over everything the screens created; CI runs the new specs on the production build; every Phase 1 and 2 check still in the workflow.

**Exit criteria:** a bidder can register, bid, be outbid and see it by polling; no response leaks a max, the reserve or another identity; notices are exactly the ones the ledger implies; the HTTP latency line is in `docs/LOAD.md` with its hardware; CI green.

**Review answers (D-47, 2026-10-20): all four as proposed.**

**Questions as asked:**
1. Polling interval: 1 s or 2 s? (proposal 1 s near the close, 2 s otherwise, from `closesAt`)
2. Do bidders register themselves (proposed) or do staff approve them first?
3. Notice wording: terse (proposed: price, lot, close time) or with a link to the lot page?
4. O-13: model house bids by staff? Proposal: no, still out of scope.
