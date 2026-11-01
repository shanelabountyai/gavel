-- D-90 (AX-18, R-18): rules v2. A sale picks a named increment table and may carry a tiered buyer's premium. Both are
-- copied onto every Settlement row that depends on them, so each row stays recomputable from itself (D-44 a). A row
-- written before this migration has no bands, which is the flat rate it was settled at: no backfill, V8 unchanged.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
ALTER TABLE "Auction" ADD COLUMN "incrementTable" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN "premiumBands" JSONB;
ALTER TABLE "Settlement" ADD COLUMN "premiumBands" JSONB;

-- Hand-written. The names are rules/auction.v2.json's tables; a new table is a rules change, a D entry and this CHECK.
-- Bands are validated in full by checkPremiumBands at the boundary and recomputed by V8; the database holds the shape
-- that keeps one representation per schedule: null (flat) or at least two bands whose first rate is the row's rate.
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_incrementTable_known" CHECK ("incrementTable" IN ('standard', 'equipment', 'estate'));
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_premiumBands_shape" CHECK (
  "premiumBands" IS NULL OR (jsonb_typeof("premiumBands") = 'array' AND jsonb_array_length("premiumBands") >= 2
    AND ("premiumBands" -> 0 ->> 'bps')::int = "buyerPremiumBps"));
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_premiumBands_shape" CHECK (
  "premiumBands" IS NULL OR (jsonb_typeof("premiumBands") = 'array' AND jsonb_array_length("premiumBands") >= 2
    AND ("premiumBands" -> 0 ->> 'bps')::int = "premiumBps"));

-- The increment table and the premium are fixed with the other terms once the sale has a bid (D-71 b): a bidder bids
-- on the steps and the premium they were shown. Same function, three more columns in the tuple.
CREATE OR REPLACE FUNCTION auction_terms_fixed_after_bid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."paymentDueAt", NEW."pickupText", NEW."pickupWindowText", NEW."taxBps", NEW."taxBase", NEW."requiresApproval",
      NEW."incrementTable", NEW."buyerPremiumBps", NEW."premiumBands")
     IS DISTINCT FROM (OLD."paymentDueAt", OLD."pickupText", OLD."pickupWindowText", OLD."taxBps", OLD."taxBase", OLD."requiresApproval",
      OLD."incrementTable", OLD."buyerPremiumBps", OLD."premiumBands")
     AND EXISTS (SELECT 1 FROM "Bid" b JOIN "Lot" l ON l."id" = b."lotId" WHERE l."auctionId" = NEW."id") THEN
    RAISE EXCEPTION 'Auction % has bids: payment, pickup, tax, approval, increment and premium terms are fixed', NEW."name";
  END IF;
  RETURN NEW;
END $$;
