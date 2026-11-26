-- D-87 (AX-14, R-14): a subject-to-approval sale. The consignor accepts the high bid below the reserve after the close,
-- and staff record it as a D-44 correction carrying the approval reference. resettle() decides when the reference
-- applies (the high bidder, a lot closed UNSOLD_RESERVE_NOT_MET, the reached price); V8 recomputes every such row.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
ALTER TABLE "Settlement" ADD COLUMN "consignorApprovalRef" TEXT;

-- Hand-written. Only a correction carries an approval, and never a blank one.
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_approval_on_correction"
  CHECK ("consignorApprovalRef" IS NULL OR ("supersedesId" IS NOT NULL AND length(trim("consignorApprovalRef")) > 0));
