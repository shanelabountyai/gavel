-- D-71 (AX-06): payment due date and pickup text on the sale, for the buyer's invoice and the won notice.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
ALTER TABLE "Auction" ADD COLUMN "paymentDueAt" TIMESTAMPTZ(6),
ADD COLUMN "pickupText" TEXT NOT NULL DEFAULT '',
ADD COLUMN "pickupWindowText" TEXT NOT NULL DEFAULT '';

-- Hand-written. Editable until the first bid on any lot of the sale (R-06), so a bidder bids on the terms the
-- invoice will show. The action refuses first with a message; this is the guard.
CREATE FUNCTION auction_terms_fixed_after_bid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."paymentDueAt", NEW."pickupText", NEW."pickupWindowText") IS DISTINCT FROM (OLD."paymentDueAt", OLD."pickupText", OLD."pickupWindowText")
     AND EXISTS (SELECT 1 FROM "Bid" b JOIN "Lot" l ON l."id" = b."lotId" WHERE l."auctionId" = NEW."id") THEN
    RAISE EXCEPTION 'Auction % has bids: payment and pickup terms are fixed', NEW."name";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Auction_terms_fixed_after_bid"
  BEFORE UPDATE ON "Auction"
  FOR EACH ROW EXECUTE FUNCTION auction_terms_fixed_after_bid();
