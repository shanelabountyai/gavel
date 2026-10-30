-- D-84 (AX-10 R-10, AX-12 R-12): the house's time zone for display and form input, and generated staggered closes.
-- Storage stays UTC (timestamptz), the engine epoch ms, the countdown server-clock arithmetic: the zone changes what
-- is printed and how a typed wall-clock time is read, nothing the ledger or the verifier sees.

-- Prisma-shaped part (prisma/schema/gavel.prisma).
ALTER TABLE "Auction" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN "firstCloseAt" TIMESTAMPTZ(6),
ADD COLUMN "staggerSeconds" INTEGER NOT NULL DEFAULT 0;

-- Hand-written. A zone name is never blank (validity is Intl's call, in the action); a stagger never runs backwards.
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_timeZone_not_blank" CHECK (length(trim("timeZone")) > 0);
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_staggerSeconds_nonneg" CHECK ("staggerSeconds" >= 0);
