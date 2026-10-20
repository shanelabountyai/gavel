-- Task 2.2 (D-42 Q2, D-44): settlement corrections as superseding rows. The append-only trigger stays; the lot's
-- current settlement is the row no other row supersedes.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
ALTER TABLE "Settlement"
  ADD COLUMN "supersedesId" UUID,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "correctedByUserId" UUID,
  ADD COLUMN "premiumBps" INTEGER;

-- Rows auction:close wrote before this migration took the auction's rate. The trigger is lifted for this one
-- statement, inside the migration's transaction, and restored before anything else can write.
ALTER TABLE "Settlement" DISABLE TRIGGER "Settlement_append_only";
UPDATE "Settlement" s SET "premiumBps" = a."buyerPremiumBps" FROM "Lot" l JOIN "Auction" a ON a."id" = l."auctionId" WHERE l."id" = s."lotId";
ALTER TABLE "Settlement" ENABLE TRIGGER "Settlement_append_only";
ALTER TABLE "Settlement" ALTER COLUMN "premiumBps" SET NOT NULL;

DROP INDEX "Settlement_lotId_key";
CREATE INDEX "Settlement_lotId_idx" ON "Settlement"("lotId");
CREATE UNIQUE INDEX "Settlement_supersedesId_key" ON "Settlement"("supersedesId");

-- Hand-written. Prisma cannot say a partial unique, a composite self-FK or a CHECK.
-- Exactly one first row per lot: two auction:close runs still collide here (ON CONFLICT ... WHERE).
CREATE UNIQUE INDEX "Settlement_one_first_row_per_lot" ON "Settlement"("lotId") WHERE "supersedesId" IS NULL;
-- The predecessor is in the same lot: (supersedesId, lotId) must name an existing (id, lotId).
CREATE UNIQUE INDEX "Settlement_id_lotId_key" ON "Settlement"("id", "lotId");
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_supersedes_same_lot"
  FOREIGN KEY ("supersedesId", "lotId") REFERENCES "Settlement"("id", "lotId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_outcome_known";
ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_outcome_known"
    CHECK ("outcome" IN ('SOLD', 'UNSOLD_NO_BIDS', 'UNSOLD_RESERVE_NOT_MET', 'UNSOLD_BY_CORRECTION')),
  ADD CONSTRAINT "Settlement_unsold_by_correction_is_a_correction"
    CHECK ("outcome" <> 'UNSOLD_BY_CORRECTION' OR "supersedesId" IS NOT NULL),
  ADD CONSTRAINT "Settlement_correction_names_reason_and_user"
    CHECK (("supersedesId" IS NULL) = ("reason" IS NULL) AND ("supersedesId" IS NULL) = ("correctedByUserId" IS NULL)
       AND ("reason" IS NULL OR btrim("reason") <> '')),
  ADD CONSTRAINT "Settlement_supersedes_not_itself" CHECK ("supersedesId" <> "id"),
  ADD CONSTRAINT "Settlement_premiumBps_nonnegative" CHECK ("premiumBps" >= 0);
