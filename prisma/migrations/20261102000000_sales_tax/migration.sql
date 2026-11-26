-- D-78 (AX-09, R-09): sales tax as per-sale configuration and a per-bidder exemption certificate. Nothing is stored
-- that is derived: the tax amount is computed on read by invoice() (the third rounding site, GB-27), never written.
-- Configuration, not advice: which base applies where a sale happens is a question for counsel.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
ALTER TABLE "Auction" ADD COLUMN "taxBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "taxBase" TEXT NOT NULL DEFAULT 'HAMMER';
ALTER TABLE "Bidder" ADD COLUMN "taxExemptRef" TEXT;

-- Hand-written. Whole basis points within 0..10000; one of the two bases; a certificate reference is never blank.
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_taxBps_range" CHECK ("taxBps" >= 0 AND "taxBps" <= 10000);
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_taxBase_known" CHECK ("taxBase" IN ('HAMMER', 'HAMMER_PLUS_PREMIUM'));
ALTER TABLE "Bidder" ADD CONSTRAINT "Bidder_taxExemptRef_not_blank" CHECK ("taxExemptRef" IS NULL OR length(trim("taxExemptRef")) > 0);

-- The tax terms are fixed with the payment and pickup terms once the sale has a bid (D-71 b): a bidder bids on the
-- invoice they will get. Same function, two more columns in the tuple.
CREATE OR REPLACE FUNCTION auction_terms_fixed_after_bid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."paymentDueAt", NEW."pickupText", NEW."pickupWindowText", NEW."taxBps", NEW."taxBase")
     IS DISTINCT FROM (OLD."paymentDueAt", OLD."pickupText", OLD."pickupWindowText", OLD."taxBps", OLD."taxBase")
     AND EXISTS (SELECT 1 FROM "Bid" b JOIN "Lot" l ON l."id" = b."lotId" WHERE l."auctionId" = NEW."id") THEN
    RAISE EXCEPTION 'Auction % has bids: payment, pickup and tax terms are fixed', NEW."name";
  END IF;
  RETURN NEW;
END $$;
