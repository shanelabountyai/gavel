// Task 2.1 (D-42 Q1): invoices derived on read from each lot's current settlement.
// Nothing is stored, so auction:verify has no invoice check; V8 already proves every settlement it sums.
import { type Invoice, type SettledLot, invoice } from '@/auction/engine/engine';
import type { Tx } from '@/auction/place-bid';
import { db } from '@/core/db';

/** UX-16/17: the current settlement (the row no other supersedes, D-44) of every settled lot in a sale, by lotId. */
export async function currentSettlements(orgId: string, auctionId: string) {
  const rows = await db.settlement.findMany({ where: { orgId, lot: { auctionId } }, select: { id: true, lotId: true, supersedesId: true, outcome: true, hammerCents: true } });
  const superseded = new Set(rows.map((r) => r.supersedesId));
  return new Map(rows.filter((r) => !superseded.has(r.id)).map((r) => [r.lotId, r]));
}

// A lot's current settlement is the row no other row supersedes (D-44); `by` filters that tip, never a superseded row.
async function current(q: Tx, orgId: string, by: string, id: string): Promise<Invoice[]> {
  const rows = await q.query<SettledLot>(
    `SELECT l."auctionId"::text AS "auctionId", l."id"::text AS "lotId", l."number" AS "lotNumber", s."outcome",
            s."winnerBidderId"::text AS "winner", s."hammerCents", s."premiumCents", s."totalCents"
       FROM "Settlement" s JOIN "Lot" l ON l."id" = s."lotId"
      WHERE ${by} = $1::uuid AND l."orgId" = $2::uuid
        AND NOT EXISTS (SELECT 1 FROM "Settlement" n WHERE n."supersedesId" = s."id")`,
    [id, orgId],
  );
  return invoice(rows);
}

/** Staff: every buyer's invoice for one sale. */
export const invoicesForAuction = (q: Tx, orgId: string, auctionId: string) => current(q, orgId, 'l."auctionId"', auctionId);

/** D-71 (AX-06): one bidder's own invoices across the house's sales; a correction that moves a win moves the line. */
export const invoicesForBidder = (q: Tx, orgId: string, bidderId: string) => current(q, orgId, 's."winnerBidderId"', bidderId);
