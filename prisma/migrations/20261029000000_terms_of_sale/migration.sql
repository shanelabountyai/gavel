-- D-72 (AX-03): terms of sale, versioned and insert-only, and each bidder's acceptance of a version. placeBid refuses
-- at the boundary (TERMS_NOT_ACCEPTED, nothing written, no lock) when the sale's latest terms have no acceptance row
-- for the bidder. A sale with no terms rows asks nothing.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
CREATE TABLE "AuctionTerms" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byUserId" UUID NOT NULL,
    "publishedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AuctionTerms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuctionTerms_auctionId_version_key" ON "AuctionTerms"("auctionId", "version");
CREATE INDEX "AuctionTerms_orgId_idx" ON "AuctionTerms"("orgId");

ALTER TABLE "AuctionTerms" ADD CONSTRAINT "AuctionTerms_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TermsAcceptance" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "termsSha256" TEXT NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TermsAcceptance_auctionId_bidderId_termsSha256_key" ON "TermsAcceptance"("auctionId", "bidderId", "termsSha256");
CREATE INDEX "TermsAcceptance_orgId_idx" ON "TermsAcceptance"("orgId");

ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "Bidder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written.
ALTER TABLE "AuctionTerms" ADD CONSTRAINT "AuctionTerms_text_not_blank" CHECK (btrim("text") <> '');
ALTER TABLE "AuctionTerms" ADD CONSTRAINT "AuctionTerms_version_positive" CHECK ("version" >= 1);
ALTER TABLE "AuctionTerms" ADD CONSTRAINT "AuctionTerms_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

CREATE TRIGGER "AuctionTerms_append_only"
  BEFORE UPDATE OR DELETE ON "AuctionTerms"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();

CREATE TRIGGER "TermsAcceptance_append_only"
  BEFORE UPDATE OR DELETE ON "TermsAcceptance"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();

-- Terms are fixed once any lot of the sale has a Bid row (R-03, mirroring D-21 and D-71): a bidder bid on what they
-- accepted. The action refuses first with a message; this is the guard.
CREATE FUNCTION auction_terms_fixed_after_bid_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Bid" b JOIN "Lot" l ON l."id" = b."lotId" WHERE l."auctionId" = NEW."auctionId") THEN
    RAISE EXCEPTION 'Auction % has bids: the terms of sale are fixed', NEW."auctionId";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "AuctionTerms_fixed_after_bid"
  BEFORE INSERT ON "AuctionTerms"
  FOR EACH ROW EXECUTE FUNCTION auction_terms_fixed_after_bid_insert();
