-- D-74 (AX-07, R-07): consignors, their per-sale contracts, and the consignor statement (derived on read, never
-- stored, like invoices). Consignor is reference data; ConsignmentContract is insert-only with a superseding row for
-- changes (supersedesId unique, so a chain cannot fork). Lot gains a nullable consignorId; the free-text column stays
-- for older rows. Nothing here touches the bid path, the ledger, LotState or Settlement.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
CREATE TABLE "Consignor" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consignor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Consignor_orgId_code_key" ON "Consignor"("orgId", "code");
CREATE INDEX "Consignor_orgId_idx" ON "Consignor"("orgId");

ALTER TABLE "Consignor" ADD CONSTRAINT "Consignor_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ConsignmentContract" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "consignorId" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "supersedesId" UUID,
    "commissionBps" INTEGER NOT NULL,
    "lotFeeCents" INTEGER NOT NULL,
    "unsoldFeeCents" INTEGER NOT NULL,
    "byUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ConsignmentContract_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConsignmentContract_supersedesId_key" ON "ConsignmentContract"("supersedesId");
CREATE INDEX "ConsignmentContract_consignorId_auctionId_idx" ON "ConsignmentContract"("consignorId", "auctionId");
CREATE INDEX "ConsignmentContract_auctionId_idx" ON "ConsignmentContract"("auctionId");
CREATE INDEX "ConsignmentContract_orgId_idx" ON "ConsignmentContract"("orgId");

ALTER TABLE "ConsignmentContract" ADD CONSTRAINT "ConsignmentContract_consignorId_fkey" FOREIGN KEY ("consignorId") REFERENCES "Consignor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsignmentContract" ADD CONSTRAINT "ConsignmentContract_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsignmentContract" ADD CONSTRAINT "ConsignmentContract_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ConsignmentContract"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "Lot" ADD COLUMN "consignorId" UUID;
CREATE INDEX "Lot_consignorId_idx" ON "Lot"("consignorId");
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_consignorId_fkey" FOREIGN KEY ("consignorId") REFERENCES "Consignor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written.
ALTER TABLE "Consignor" ADD CONSTRAINT "Consignor_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "Consignor" ADD CONSTRAINT "Consignor_code_not_blank" CHECK (btrim("code") <> '');

ALTER TABLE "ConsignmentContract" ADD CONSTRAINT "ConsignmentContract_commissionBps_range" CHECK ("commissionBps" BETWEEN 0 AND 10000);
ALTER TABLE "ConsignmentContract" ADD CONSTRAINT "ConsignmentContract_fees_nonneg" CHECK ("lotFeeCents" >= 0 AND "unsoldFeeCents" >= 0);
ALTER TABLE "ConsignmentContract" ADD CONSTRAINT "ConsignmentContract_no_self_supersede" CHECK ("supersedesId" IS DISTINCT FROM "id");

-- A contract row is never edited or removed; a change is a superseding row (D-74, as D-44 for settlements).
CREATE TRIGGER "ConsignmentContract_append_only"
  BEFORE UPDATE OR DELETE ON "ConsignmentContract"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();

-- A superseding row names a contract of the same consignor and sale, so a chain cannot cross sales.
CREATE FUNCTION consignment_contract_same_pair() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."supersedesId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ConsignmentContract" p
     WHERE p."id" = NEW."supersedesId" AND p."consignorId" = NEW."consignorId" AND p."auctionId" = NEW."auctionId" AND p."orgId" = NEW."orgId"
  ) THEN
    RAISE EXCEPTION 'Contract % supersedes a row of another consignor or sale: refused', NEW."id";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ConsignmentContract_same_pair"
  BEFORE INSERT ON "ConsignmentContract"
  FOR EACH ROW EXECUTE FUNCTION consignment_contract_same_pair();
