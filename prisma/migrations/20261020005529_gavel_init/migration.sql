/*
  Warnings:

  - You are about to drop the `BillingAccount` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StripeEvent` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "BidderStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- DropForeignKey
ALTER TABLE "BillingAccount" DROP CONSTRAINT "BillingAccount_orgId_fkey";

-- DropTable
DROP TABLE "BillingAccount";

-- DropTable
DROP TABLE "StripeEvent";

-- CreateTable
CREATE TABLE "Auction" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "softCloseWindowSeconds" INTEGER NOT NULL,
    "maxExtensionSeconds" INTEGER NOT NULL,
    "buyerPremiumBps" INTEGER NOT NULL,
    "opensAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "consignor" TEXT NOT NULL DEFAULT '',
    "startCents" INTEGER NOT NULL,
    "reserveCents" INTEGER,
    "scheduledEnd" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotState" (
    "lotId" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "leaderBidderId" UUID,
    "leaderMaxCents" INTEGER NOT NULL,
    "leaderSeq" INTEGER,
    "bidCount" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL,
    "closesAt" TIMESTAMPTZ(6) NOT NULL,
    "extensionCount" INTEGER NOT NULL,

    CONSTRAINT "LotState_pkey" PRIMARY KEY ("lotId")
);

-- CreateTable
CREATE TABLE "Bidder" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "paddle" INTEGER NOT NULL,
    "status" "BidderStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bidder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "bidderId" UUID NOT NULL,
    "maxCents" INTEGER NOT NULL,
    "placedAt" TIMESTAMPTZ(6) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "priceBeforeCents" INTEGER NOT NULL,
    "priceAfterCents" INTEGER NOT NULL,
    "leaderBeforeId" UUID,
    "leaderAfterId" UUID,
    "closesAtBefore" TIMESTAMPTZ(6) NOT NULL,
    "closesAtAfter" TIMESTAMPTZ(6) NOT NULL,
    "extended" BOOLEAN NOT NULL,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "winnerBidderId" UUID,
    "winningSeq" INTEGER,
    "hammerCents" INTEGER NOT NULL,
    "premiumCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "closedAt" TIMESTAMPTZ(6) NOT NULL,
    "rulesHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Auction_orgId_idx" ON "Auction"("orgId");

-- CreateIndex
CREATE INDEX "Lot_orgId_idx" ON "Lot"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_auctionId_number_key" ON "Lot"("auctionId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Bidder_orgId_userId_key" ON "Bidder"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Bidder_orgId_paddle_key" ON "Bidder"("orgId", "paddle");

-- CreateIndex
CREATE INDEX "Bid_orgId_idx" ON "Bid"("orgId");

-- CreateIndex
CREATE INDEX "Bid_bidderId_idx" ON "Bid"("bidderId");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_lotId_seq_key" ON "Bid"("lotId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_lotId_bidderId_idempotencyKey_key" ON "Bid"("lotId", "bidderId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_lotId_key" ON "Settlement"("lotId");

-- CreateIndex
CREATE INDEX "Settlement_orgId_idx" ON "Settlement"("orgId");

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotState" ADD CONSTRAINT "LotState_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bidder" ADD CONSTRAINT "Bidder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bidder" ADD CONSTRAINT "Bidder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "Bidder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------
-- Hand-written (task 1.7, D-36). Prisma cannot say CHECKs or triggers; everything below is the ledger's
-- integrity. Held by tests/integration/gavel-schema.test.ts. The billing DROPs above are D-31 Q4.

ALTER TABLE "Lot"
  ADD CONSTRAINT "Lot_startCents_positive" CHECK ("startCents" > 0),
  ADD CONSTRAINT "Lot_reserve_at_least_start" CHECK ("reserveCents" IS NULL OR "reserveCents" >= "startCents");

-- D-14. `outcome` is the closed set in rules/auction.v1.json: a new outcome is a decisions entry, a golden,
-- regenerated fixtures and a migration that extends this list.
ALTER TABLE "Bid"
  ADD CONSTRAINT "Bid_seq_from_one" CHECK ("seq" >= 1),
  ADD CONSTRAINT "Bid_maxCents_positive" CHECK ("maxCents" > 0),
  ADD CONSTRAINT "Bid_price_never_falls" CHECK ("priceAfterCents" >= "priceBeforeCents"),
  ADD CONSTRAINT "Bid_close_never_moves_earlier" CHECK ("closesAtAfter" >= "closesAtBefore"),
  ADD CONSTRAINT "Bid_outcome_known" CHECK ("outcome" IN (
    'ACCEPTED_LEAD', 'ACCEPTED_OUTBID', 'ACCEPTED_RAISE',
    'REJECTED_LOT_NOT_OPEN', 'REJECTED_LOT_CLOSED', 'REJECTED_BELOW_MINIMUM', 'REJECTED_NOT_ABOVE_OWN_MAX'
  )),
  ADD CONSTRAINT "Bid_accepted_matches_outcome" CHECK ("accepted" = ("outcome" LIKE 'ACCEPTED%'));

-- D-22. The verifier recomputes every field (V8); the database only refuses the arithmetic that cannot be.
ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_outcome_known" CHECK ("outcome" IN ('SOLD', 'UNSOLD_NO_BIDS', 'UNSOLD_RESERVE_NOT_MET')),
  ADD CONSTRAINT "Settlement_total_is_hammer_plus_premium"
    CHECK ("hammerCents" >= 0 AND "premiumCents" >= 0 AND "totalCents" = "hammerCents" + "premiumCents");

-- Bid and Settlement are append-only (D-14, D-22): a correction is a superseding row. LotState is updated by
-- placeBid alone and never deleted (D-16). One function. The default SQLSTATE (P0001) is deliberate: Prisma
-- maps 23001 to P2003 and drops the message, and the message is what a caller sees. TRUNCATE is left alone,
-- as for AuditEvent: row triggers do not fire on it, so tests can still empty the tables. A Lot or Org that
-- owns a LotState therefore cannot be deleted through the cascade either; that is intended.
CREATE FUNCTION gavel_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % refused; a correction is a superseding row', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER "Bid_append_only"
  BEFORE UPDATE OR DELETE ON "Bid"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();

CREATE TRIGGER "Settlement_append_only"
  BEFORE UPDATE OR DELETE ON "Settlement"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();

CREATE TRIGGER "LotState_no_delete"
  BEFORE DELETE ON "LotState"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();

-- scheduledEnd > opensAt crosses two tables, so it is a trigger, checked from both sides.
CREATE FUNCTION lot_ends_after_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Lot' THEN
    IF NEW."scheduledEnd" <= (SELECT "opensAt" FROM "Auction" WHERE "id" = NEW."auctionId") THEN
      RAISE EXCEPTION 'Lot % closes at or before its auction opens', NEW."number"
        USING ERRCODE = 'check_violation', CONSTRAINT = 'Lot_scheduledEnd_after_opensAt';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM "Lot" WHERE "auctionId" = NEW."id" AND "scheduledEnd" <= NEW."opensAt") THEN
    RAISE EXCEPTION 'Auction % would open at or after one of its lots closes', NEW."name"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'Lot_scheduledEnd_after_opensAt';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Lot_ends_after_open"
  BEFORE INSERT OR UPDATE OF "scheduledEnd", "auctionId" ON "Lot"
  FOR EACH ROW EXECUTE FUNCTION lot_ends_after_open();

CREATE TRIGGER "Auction_opens_before_lots_end"
  BEFORE UPDATE OF "opensAt" ON "Auction"
  FOR EACH ROW EXECUTE FUNCTION lot_ends_after_open();
