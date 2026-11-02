-- D-95 (amends D-93 a and D-94 d): a pair whose link was retracted can be linked again. The unique on
-- (consignor, bidder) gives way to "one live link per pair": a link with no retraction. History rows stay.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
DROP INDEX "ConsignorBidderLink_consignorId_bidderId_key";
CREATE INDEX "ConsignorBidderLink_consignorId_bidderId_idx" ON "ConsignorBidderLink"("consignorId", "bidderId");

-- Hand-written. Two staff linking the same pair at once serialise on the consignor's row, so the
-- EXISTS below cannot miss a sibling insert still uncommitted (READ COMMITTED).
CREATE FUNCTION consignor_bidder_link_one_live() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "Consignor" WHERE "id" = NEW."consignorId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "ConsignorBidderLink" k
              WHERE k."consignorId" = NEW."consignorId" AND k."bidderId" = NEW."bidderId"
                AND NOT EXISTS (SELECT 1 FROM "ConsignorBidderLinkRetraction" r WHERE r."linkId" = k."id")) THEN
    RAISE EXCEPTION 'That bidder is already linked to this consignor'
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'ConsignorBidderLink_one_live';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ConsignorBidderLink_one_live"
  BEFORE INSERT ON "ConsignorBidderLink"
  FOR EACH ROW EXECUTE FUNCTION consignor_bidder_link_one_live();
