-- D-73 (AX-04): a lot withdrawn by staff before it closes. One insert-only row per lot; the engine reads "withdrawnAt"
-- beside the ledger (CLOSED from it, later attempts REJECTED_LOT_WITHDRAWN, settlement UNSOLD_WITHDRAWN). Written under
-- FOR UPDATE on the lot's LotState row; LotState is never written by it. The two outcome CHECKs grow by one value each
-- (rules/auction.v1.json, new D-23 hash).

-- Prisma-shaped part (prisma/schema/gavel.prisma).
CREATE TABLE "LotWithdrawal" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "byUserId" UUID NOT NULL,
    "withdrawnAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LotWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LotWithdrawal_lotId_key" ON "LotWithdrawal"("lotId");
CREATE INDEX "LotWithdrawal_orgId_idx" ON "LotWithdrawal"("orgId");

ALTER TABLE "LotWithdrawal" ADD CONSTRAINT "LotWithdrawal_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written.
ALTER TABLE "LotWithdrawal" ADD CONSTRAINT "LotWithdrawal_reason_not_blank" CHECK (btrim("reason") <> '');

CREATE TRIGGER "LotWithdrawal_append_only"
  BEFORE UPDATE OR DELETE ON "LotWithdrawal"
  FOR EACH ROW EXECUTE FUNCTION gavel_append_only();

-- Withdrawal is refused once the lot is closed or settled (R-04); after the close a D-44 correction is the remedy.
-- withdrawLot refuses first with a message, under the lock; this is the guard.
CREATE FUNCTION lot_withdrawal_before_close() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closes timestamptz;
BEGIN
  SELECT "closesAt" INTO closes FROM "LotState" WHERE "lotId" = NEW."lotId";
  IF closes IS NULL THEN
    RAISE EXCEPTION 'Lot % has no LotState row: withdrawal refused', NEW."lotId";
  END IF;
  IF NEW."withdrawnAt" >= closes THEN
    RAISE EXCEPTION 'Lot % closed at %: withdrawal at % refused; a settlement correction is the remedy', NEW."lotId", closes, NEW."withdrawnAt";
  END IF;
  IF EXISTS (SELECT 1 FROM "Settlement" s WHERE s."lotId" = NEW."lotId") THEN
    RAISE EXCEPTION 'Lot % is settled: withdrawal refused; a settlement correction is the remedy', NEW."lotId";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "LotWithdrawal_before_close"
  BEFORE INSERT ON "LotWithdrawal"
  FOR EACH ROW EXECUTE FUNCTION lot_withdrawal_before_close();

-- The closed outcome sets (D-14, D-22, D-44) each gain the withdrawn outcome.
ALTER TABLE "Bid" DROP CONSTRAINT "Bid_outcome_known";
ALTER TABLE "Bid"
  ADD CONSTRAINT "Bid_outcome_known" CHECK ("outcome" IN (
    'ACCEPTED_LEAD', 'ACCEPTED_OUTBID', 'ACCEPTED_RAISE',
    'REJECTED_LOT_NOT_OPEN', 'REJECTED_LOT_CLOSED', 'REJECTED_BELOW_MINIMUM', 'REJECTED_NOT_ABOVE_OWN_MAX', 'REJECTED_LOT_WITHDRAWN'
  ));

ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_outcome_known";
ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_outcome_known"
    CHECK ("outcome" IN ('SOLD', 'UNSOLD_NO_BIDS', 'UNSOLD_RESERVE_NOT_MET', 'UNSOLD_WITHDRAWN', 'UNSOLD_BY_CORRECTION'));
