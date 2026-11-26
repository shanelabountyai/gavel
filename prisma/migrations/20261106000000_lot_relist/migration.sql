-- D-89 (AX-17, R-17): relist an unsold lot in a later sale. The new lot names the original; one relist per lot (unique),
-- so an unsold relist is relisted again from the relist, and the chain follows. The original row is not touched.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
ALTER TABLE "Lot" ADD COLUMN "relistOfLotId" UUID;
CREATE UNIQUE INDEX "Lot_relistOfLotId_key" ON "Lot"("relistOfLotId");
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_relistOfLotId_fkey" FOREIGN KEY ("relistOfLotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written. relistLot refuses each of these with the form's sentence; this is the guard. The original is in the same
-- house, in another sale, for the same consignor, and its current settlement (the row nothing supersedes) is unsold.
-- Whether the target sale has opened is judged against @/core/clock in relistLot, not here (D-15: the DB has no clock).
CREATE FUNCTION lot_relist_of_unsold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Lot % relist link is set at creation and never changed', OLD."number"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'Lot_relist_of_unsold';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Lot" o JOIN "Settlement" s ON s."lotId" = o."id"
     WHERE o."id" = NEW."relistOfLotId" AND o."orgId" = NEW."orgId" AND o."auctionId" <> NEW."auctionId"
       AND o."consignorId" IS NOT DISTINCT FROM NEW."consignorId" AND o."consignor" = NEW."consignor"
       AND s."outcome" LIKE 'UNSOLD%'
       AND NOT EXISTS (SELECT 1 FROM "Settlement" n WHERE n."supersedesId" = s."id")
  ) THEN
    RAISE EXCEPTION 'Lot % relists a lot that is not an unsold lot of another sale of this house and consignor', NEW."number"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'Lot_relist_of_unsold';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Lot_relist_of_unsold"
  BEFORE INSERT ON "Lot"
  FOR EACH ROW WHEN (NEW."relistOfLotId" IS NOT NULL)
  EXECUTE FUNCTION lot_relist_of_unsold();

CREATE TRIGGER "Lot_relist_fixed"
  BEFORE UPDATE OF "relistOfLotId" ON "Lot"
  FOR EACH ROW WHEN (OLD."relistOfLotId" IS DISTINCT FROM NEW."relistOfLotId")
  EXECUTE FUNCTION lot_relist_of_unsold();
