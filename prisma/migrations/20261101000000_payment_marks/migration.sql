-- D-75 (AX-08, R-08): payment marks, buyer defaults, second-chance offers and their answers. Four insert-only tables.
-- The invoice status is derived from the marks against the current total (invoiceBalance), never stored; the offer's
-- acceptance is a D-44 settlement correction written in the same transaction. Nothing here touches the bid path, the
-- ledger, LotState or Settlement.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
CREATE TABLE "PaymentMark" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "byUserId" UUID NOT NULL,
    "markedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PaymentMark_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentMark_auctionId_bidderId_idx" ON "PaymentMark"("auctionId", "bidderId");
CREATE INDEX "PaymentMark_orgId_idx" ON "PaymentMark"("orgId");

ALTER TABLE "PaymentMark" ADD CONSTRAINT "PaymentMark_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentMark" ADD CONSTRAINT "PaymentMark_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "Bidder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BuyerDefault" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "byUserId" UUID NOT NULL,
    "declaredAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BuyerDefault_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuyerDefault_auctionId_bidderId_key" ON "BuyerDefault"("auctionId", "bidderId");
CREATE INDEX "BuyerDefault_orgId_idx" ON "BuyerDefault"("orgId");

ALTER TABLE "BuyerDefault" ADD CONSTRAINT "BuyerDefault_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuyerDefault" ADD CONSTRAINT "BuyerDefault_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "Bidder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SecondChanceOffer" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "defaultId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "premiumBps" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SecondChanceOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecondChanceOffer_defaultId_lotId_key" ON "SecondChanceOffer"("defaultId", "lotId");
CREATE INDEX "SecondChanceOffer_lotId_idx" ON "SecondChanceOffer"("lotId");
CREATE INDEX "SecondChanceOffer_bidderId_idx" ON "SecondChanceOffer"("bidderId");
CREATE INDEX "SecondChanceOffer_orgId_idx" ON "SecondChanceOffer"("orgId");

ALTER TABLE "SecondChanceOffer" ADD CONSTRAINT "SecondChanceOffer_defaultId_fkey" FOREIGN KEY ("defaultId") REFERENCES "BuyerDefault"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecondChanceOffer" ADD CONSTRAINT "SecondChanceOffer_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecondChanceOffer" ADD CONSTRAINT "SecondChanceOffer_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "Bidder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OfferResponse" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "response" TEXT NOT NULL,
    "byUserId" UUID NOT NULL,
    "respondedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OfferResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfferResponse_offerId_key" ON "OfferResponse"("offerId");
CREATE INDEX "OfferResponse_orgId_idx" ON "OfferResponse"("orgId");

ALTER TABLE "OfferResponse" ADD CONSTRAINT "OfferResponse_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SecondChanceOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written.
ALTER TABLE "PaymentMark" ADD CONSTRAINT "PaymentMark_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "PaymentMark" ADD CONSTRAINT "PaymentMark_method_not_blank" CHECK (btrim("method") <> '');
ALTER TABLE "BuyerDefault" ADD CONSTRAINT "BuyerDefault_reason_not_blank" CHECK (btrim("reason") <> '');
ALTER TABLE "SecondChanceOffer" ADD CONSTRAINT "SecondChanceOffer_price_positive" CHECK ("priceCents" > 0);
ALTER TABLE "SecondChanceOffer" ADD CONSTRAINT "SecondChanceOffer_premiumBps_nonneg" CHECK ("premiumBps" >= 0);
ALTER TABLE "OfferResponse" ADD CONSTRAINT "OfferResponse_response_known" CHECK ("response" IN ('ACCEPTED', 'DECLINED'));

-- Every row here is a fact about a moment; none is edited or removed (D-75, as D-44, D-70, D-74).
CREATE TRIGGER "PaymentMark_append_only" BEFORE UPDATE OR DELETE ON "PaymentMark" FOR EACH ROW EXECUTE FUNCTION gavel_append_only();
CREATE TRIGGER "BuyerDefault_append_only" BEFORE UPDATE OR DELETE ON "BuyerDefault" FOR EACH ROW EXECUTE FUNCTION gavel_append_only();
CREATE TRIGGER "SecondChanceOffer_append_only" BEFORE UPDATE OR DELETE ON "SecondChanceOffer" FOR EACH ROW EXECUTE FUNCTION gavel_append_only();
CREATE TRIGGER "OfferResponse_append_only" BEFORE UPDATE OR DELETE ON "OfferResponse" FOR EACH ROW EXECUTE FUNCTION gavel_append_only();
