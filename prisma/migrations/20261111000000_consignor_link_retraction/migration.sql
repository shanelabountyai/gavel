-- D-94 (amends D-93 b): a consignor–bidder link entered by mistake is retracted by an insert-only row, never deleted.
-- The report leaves retracted links out; the link and its retraction both stay on the page.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
CREATE TABLE "ConsignorBidderLinkRetraction" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "linkId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "byUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ConsignorBidderLinkRetraction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConsignorBidderLinkRetraction_linkId_key" ON "ConsignorBidderLinkRetraction"("linkId");
CREATE INDEX "ConsignorBidderLinkRetraction_orgId_idx" ON "ConsignorBidderLinkRetraction"("orgId");
ALTER TABLE "ConsignorBidderLinkRetraction" ADD CONSTRAINT "ConsignorBidderLinkRetraction_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ConsignorBidderLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written.
ALTER TABLE "ConsignorBidderLinkRetraction" ADD CONSTRAINT "ConsignorBidderLinkRetraction_reason_not_blank" CHECK (btrim("reason") <> '');

CREATE TRIGGER "ConsignorBidderLinkRetraction_append_only"
  BEFORE UPDATE OR DELETE ON "ConsignorBidderLinkRetraction"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();

-- The retraction and its link are one house (INV-02); the action checks it first, this is the guard.
CREATE FUNCTION consignor_link_retraction_same_house() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ConsignorBidderLink" k WHERE k."id" = NEW."linkId" AND k."orgId" = NEW."orgId") THEN
    RAISE EXCEPTION 'A retraction must name a link of its own house'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ConsignorBidderLinkRetraction_same_house';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ConsignorBidderLinkRetraction_same_house"
  BEFORE INSERT ON "ConsignorBidderLinkRetraction"
  FOR EACH ROW EXECUTE FUNCTION consignor_link_retraction_same_house();
