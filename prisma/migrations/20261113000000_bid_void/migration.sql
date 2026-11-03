-- D-96 (AX-19, R-19): a staff void of one bidder's live bids on an open lot is a ledger row, outcome VOIDED.
-- Hand-written: the CHECKs are amended in place; Bid stays append-only (gavel_append_only is untouched).

ALTER TABLE "Bid" ADD COLUMN "voidReason" TEXT, ADD COLUMN "voidByUserId" UUID; -- no FK, as AuditEvent's actor

-- Set iff the row is a void. Both sides are non-null booleans, so the comparison never passes on NULL (the D-91 lesson).
ALTER TABLE "Bid"
  ADD CONSTRAINT "Bid_void_fields" CHECK (("outcome" = 'VOIDED') = ("voidReason" IS NOT NULL AND "voidByUserId" IS NOT NULL)),
  ADD CONSTRAINT "Bid_void_reason_not_blank" CHECK ("voidReason" IS NULL OR btrim("voidReason") <> '');

ALTER TABLE "Bid" DROP CONSTRAINT "Bid_outcome_known";
ALTER TABLE "Bid"
  ADD CONSTRAINT "Bid_outcome_known" CHECK ("outcome" IN (
    'ACCEPTED_LEAD', 'ACCEPTED_OUTBID', 'ACCEPTED_RAISE',
    'REJECTED_LOT_NOT_OPEN', 'REJECTED_LOT_CLOSED', 'REJECTED_BELOW_MINIMUM', 'REJECTED_NOT_ABOVE_OWN_MAX', 'REJECTED_LOT_WITHDRAWN',
    'VOIDED'
  ));

-- A void names no amount: maxCents is 0 on a VOIDED row and positive on every other.
ALTER TABLE "Bid" DROP CONSTRAINT "Bid_maxCents_positive";
ALTER TABLE "Bid"
  ADD CONSTRAINT "Bid_maxCents_positive" CHECK (CASE WHEN "outcome" = 'VOIDED' THEN "maxCents" = 0 ELSE "maxCents" > 0 END);

-- A void is the only row that may lower the price (brief §8 V4).
ALTER TABLE "Bid" DROP CONSTRAINT "Bid_price_never_falls";
ALTER TABLE "Bid"
  ADD CONSTRAINT "Bid_price_never_falls" CHECK ("outcome" = 'VOIDED' OR "priceAfterCents" >= "priceBeforeCents"),
  ADD CONSTRAINT "Bid_void_keeps_close" CHECK ("outcome" <> 'VOIDED' OR ("closesAtAfter" = "closesAtBefore" AND NOT "extended" AND "priceAfterCents" <= "priceBeforeCents"));
