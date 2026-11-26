-- D-93 (AX-22, R-22): staff record that a bidder is linked to a consignor (family, staff, agent). The consignor
-- report lists accepted bids by linked bidders on that consignor's lots. A report a person reads; nothing acts on it.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
CREATE TABLE "ConsignorBidderLink" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "consignorId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "byUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ConsignorBidderLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConsignorBidderLink_orgId_idx" ON "ConsignorBidderLink"("orgId");
CREATE INDEX "ConsignorBidderLink_bidderId_idx" ON "ConsignorBidderLink"("bidderId");
CREATE UNIQUE INDEX "ConsignorBidderLink_consignorId_bidderId_key" ON "ConsignorBidderLink"("consignorId", "bidderId");
ALTER TABLE "ConsignorBidderLink" ADD CONSTRAINT "ConsignorBidderLink_consignorId_fkey" FOREIGN KEY ("consignorId") REFERENCES "Consignor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsignorBidderLink" ADD CONSTRAINT "ConsignorBidderLink_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "Bidder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written.
ALTER TABLE "ConsignorBidderLink" ADD CONSTRAINT "ConsignorBidderLink_reason_not_blank" CHECK (btrim("reason") <> '');

-- Insert-only: a link that could be deleted could hide the rows the report exists to show.
CREATE TRIGGER "ConsignorBidderLink_append_only"
  BEFORE UPDATE OR DELETE ON "ConsignorBidderLink"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();

-- The consignor, the bidder and the row are one house (INV-02); the action checks it first, this is the guard.
CREATE FUNCTION consignor_bidder_link_same_house() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Consignor" c JOIN "Bidder" b ON b."orgId" = c."orgId"
                  WHERE c."id" = NEW."consignorId" AND b."id" = NEW."bidderId" AND c."orgId" = NEW."orgId") THEN
    RAISE EXCEPTION 'A link must name a consignor and a bidder of its own house'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ConsignorBidderLink_same_house';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ConsignorBidderLink_same_house"
  BEFORE INSERT ON "ConsignorBidderLink"
  FOR EACH ROW EXECUTE FUNCTION consignor_bidder_link_same_house();
