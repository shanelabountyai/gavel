-- D-91 (AX-21, R-21): catalogue fields. Estimates, condition, category and the as-is flag are shown to bidders; no rule
-- reads them (the engine, settlement and verify never see these columns).

-- Prisma-shaped part (prisma/schema/gavel.prisma).
ALTER TABLE "Lot" ADD COLUMN "estimateLowCents" INTEGER,
  ADD COLUMN "estimateHighCents" INTEGER,
  ADD COLUMN "conditionText" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "category" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "asIs" BOOLEAN NOT NULL DEFAULT true;

-- Hand-written. An estimate is a pair or nothing, whole cents, low no higher than high. The IS NOT NULLs are needed:
-- with one end null, `low <= high` is NULL, and a CHECK passes on NULL.
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_estimate_range" CHECK (
  ("estimateLowCents" IS NULL AND "estimateHighCents" IS NULL)
  OR ("estimateLowCents" IS NOT NULL AND "estimateHighCents" IS NOT NULL AND "estimateLowCents" > 0 AND "estimateLowCents" <= "estimateHighCents")
);
