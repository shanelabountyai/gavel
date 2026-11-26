-- D-88 (AX-16, R-16): per-sale registration approval. A sale with requiresApproval refuses a bid at placeBid's boundary
-- (NOT_APPROVED_FOR_SALE, nothing written, no lock) unless the bidder's latest AuctionRegistration row is APPROVED.
-- Version 1 is the bidder's request; staff append APPROVED or DECLINED. A sale without the flag reads nothing here.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
ALTER TABLE "Auction" ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AuctionRegistration" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "byUserId" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AuctionRegistration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuctionRegistration_auctionId_bidderId_version_key" ON "AuctionRegistration"("auctionId", "bidderId", "version");
CREATE INDEX "AuctionRegistration_orgId_idx" ON "AuctionRegistration"("orgId");

ALTER TABLE "AuctionRegistration" ADD CONSTRAINT "AuctionRegistration_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuctionRegistration" ADD CONSTRAINT "AuctionRegistration_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "Bidder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written. The request is version 1 and is the only PENDING row; a decline carries its reason.
ALTER TABLE "AuctionRegistration" ADD CONSTRAINT "AuctionRegistration_status_known" CHECK ("status" IN ('PENDING', 'APPROVED', 'DECLINED'));
ALTER TABLE "AuctionRegistration" ADD CONSTRAINT "AuctionRegistration_pending_first" CHECK ("version" >= 1 AND ("version" = 1) = ("status" = 'PENDING'));
ALTER TABLE "AuctionRegistration" ADD CONSTRAINT "AuctionRegistration_decline_reason" CHECK ("status" <> 'DECLINED' OR length(trim("note")) > 0);

CREATE TRIGGER "AuctionRegistration_append_only"
  BEFORE UPDATE OR DELETE ON "AuctionRegistration"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();

-- Whether the sale needs approval is fixed with the payment, pickup and tax terms once it has a bid (D-71 b): turning it
-- on mid-sale would lock out bidders who already bid. Same function, one more column in the tuple.
CREATE OR REPLACE FUNCTION auction_terms_fixed_after_bid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."paymentDueAt", NEW."pickupText", NEW."pickupWindowText", NEW."taxBps", NEW."taxBase", NEW."requiresApproval")
     IS DISTINCT FROM (OLD."paymentDueAt", OLD."pickupText", OLD."pickupWindowText", OLD."taxBps", OLD."taxBase", OLD."requiresApproval")
     AND EXISTS (SELECT 1 FROM "Bid" b JOIN "Lot" l ON l."id" = b."lotId" WHERE l."auctionId" = NEW."id") THEN
    RAISE EXCEPTION 'Auction % has bids: payment, pickup, tax and approval terms are fixed', NEW."name";
  END IF;
  RETURN NEW;
END $$;
