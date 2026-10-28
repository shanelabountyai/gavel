-- D-70 (AX-05): suspend and reinstate as an insert-only history. Bidder.status stays the column placeBid's
-- boundary reads; it is the projection of the latest row here, and only setBidderStatus writes either.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
CREATE TABLE "BidderStatusChange" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "status" "BidderStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "byUserId" UUID NOT NULL,
    "changedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BidderStatusChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BidderStatusChange_bidderId_changedAt_idx" ON "BidderStatusChange"("bidderId", "changedAt");
CREATE INDEX "BidderStatusChange_orgId_idx" ON "BidderStatusChange"("orgId");

ALTER TABLE "BidderStatusChange" ADD CONSTRAINT "BidderStatusChange_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "Bidder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written.
ALTER TABLE "BidderStatusChange" ADD CONSTRAINT "BidderStatusChange_reason_not_blank" CHECK (btrim("reason") <> '');

CREATE TRIGGER "BidderStatusChange_append_only"
  BEFORE UPDATE OR DELETE ON "BidderStatusChange"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();
