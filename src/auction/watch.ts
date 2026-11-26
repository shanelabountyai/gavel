// D-92 (AX-23, R-23): a bidder's watchlist, and the closing-soon notice the cron writes for it. Nothing here touches the
// bid path or takes the lot's lock: the notice is advisory, and a soft-close extension racing it is caught on the next run.
import { enqueueNotice } from '@/auction/notices';
import { prismaRunner, type Runner } from '@/auction/place-bid';
import { db } from '@/core/db';

/** The notice goes out once a watched lot closes within this long. It equals the production cron's interval (daily,
 * vercel.json), so every watched lot is inside the window on at least one run before it closes. Shorten it with the cron. */
export const CLOSING_SOON_LEAD_MS = 24 * 3_600_000;

/** Idempotent both ways. The caller has checked the lot is in the bidder's house (INV-02); the trigger is the guard. */
export async function setWatch(orgId: string, bidderId: string, lotId: string, on: boolean): Promise<void> {
  if (on) await db.watch.upsert({ where: { bidderId_lotId: { bidderId, lotId } }, create: { orgId, bidderId, lotId }, update: {} });
  else await db.watch.deleteMany({ where: { bidderId, lotId } });
}

/** One notice per (lot, bidder, closesAt) for every watch on an open lot closing in (asOf, asOf + lead]: withdrawn
 * lots, suspended bidders and lots not yet open are skipped. The mark and the outbox rows commit together. */
export async function notifyClosingSoon(asOf: Date, deps: { run?: Runner; leadMs?: number } = {}): Promise<number> {
  const run = deps.run ?? prismaRunner;
  return run(async (tx) => {
    const due = await tx.query<{ orgId: string; lotId: string; bidderId: string; priceCents: number | null; closesAt: Date }>(
      `UPDATE "Watch" w SET "notifiedClosesAt" = s."closesAt"
         FROM "LotState" s, "Lot" l, "Auction" a, "Bidder" b
        WHERE s."lotId" = w."lotId" AND l."id" = w."lotId" AND a."id" = l."auctionId" AND b."id" = w."bidderId"
          AND b."status" = 'ACTIVE' AND a."opensAt" <= $1::timestamptz
          AND s."closesAt" > $1::timestamptz AND s."closesAt" <= $1::timestamptz + $2::interval
          AND w."notifiedClosesAt" IS DISTINCT FROM s."closesAt"
          AND NOT EXISTS (SELECT 1 FROM "LotWithdrawal" x WHERE x."lotId" = w."lotId")
      RETURNING w."orgId", w."lotId", w."bidderId", CASE WHEN s."acceptedCount" > 0 THEN s."priceCents" END AS "priceCents", s."closesAt"`,
      [asOf.toISOString(), `${deps.leadMs ?? CLOSING_SOON_LEAD_MS} milliseconds`],
    );
    for (const d of due) await enqueueNotice(tx, d.orgId, d.lotId, d.bidderId, { template: 'closing_soon', priceCents: d.priceCents, closesAt: new Date(d.closesAt) });
    return due.length;
  });
}
