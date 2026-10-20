// Task 2.1 (D-42 Q1): the invoices of one auction, derived on read from each lot's current settlement.
// Nothing is stored, so auction:verify has no invoice check; V8 already proves every settlement it sums.
import { type Invoice, type SettledLot, invoice } from '@/auction/engine/engine';
import type { Tx } from '@/auction/place-bid';

export async function invoicesForAuction(q: Tx, orgId: string, auctionId: string): Promise<Invoice[]> {
  // One Settlement per lot until task 2.2; then "current" becomes the row no other row supersedes.
  const rows = await q.query<SettledLot>(
    `SELECT l."auctionId"::text AS "auctionId", l."id"::text AS "lotId", l."number" AS "lotNumber", s."outcome",
            s."winnerBidderId"::text AS "winner", s."hammerCents", s."premiumCents", s."totalCents"
       FROM "Settlement" s JOIN "Lot" l ON l."id" = s."lotId"
      WHERE l."auctionId" = $1::uuid AND l."orgId" = $2::uuid`,
    [auctionId, orgId],
  );
  return invoice(rows);
}
