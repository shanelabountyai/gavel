-- D-92 (AX-23, R-23): a bidder's watchlist and the closing-soon notice. notifiedClosesAt dedupes the notice per
-- (lot, bidder, closesAt): the cron writes one only where it differs from the lot's current close.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
CREATE TABLE "Watch" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "notifiedClosesAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Watch_lotId_idx" ON "Watch"("lotId");
CREATE INDEX "Watch_orgId_idx" ON "Watch"("orgId");
CREATE UNIQUE INDEX "Watch_bidderId_lotId_key" ON "Watch"("bidderId", "lotId");
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "Bidder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written. The bidder, the lot and the row are one house (INV-02); the action checks it first, this is the guard.
CREATE FUNCTION watch_same_house() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Bidder" b JOIN "Lot" l ON l."orgId" = b."orgId"
                  WHERE b."id" = NEW."bidderId" AND l."id" = NEW."lotId" AND b."orgId" = NEW."orgId") THEN
    RAISE EXCEPTION 'A watch must name a bidder and a lot of its own house'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'Watch_same_house';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Watch_same_house"
  BEFORE INSERT OR UPDATE OF "orgId", "bidderId", "lotId" ON "Watch"
  FOR EACH ROW EXECUTE FUNCTION watch_same_house();
