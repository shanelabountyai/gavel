// Task 3.6 (O-11, D-47 Q3, D-53): outbid, won and (D-73) withdrawn notices, terse, through the foundation outbox; nothing is ever
// sent (the transport captures outside production). Templates are registered into the notifications module at
// import, Callboard's pattern, so the drain can render them wherever this file is loaded (cron-jobs.ts imports it).
// The row is written through the bid path's own Tx, not `enqueue`, so Prisma and raw pg share one implementation
// and a rolled-back bid leaves no outbox row.
import { formatCents } from '@/auction/engine/money';
import type { Tx } from '@/auction/place-bid';
import { templates } from '@/modules/notifications/templates';

const s = (v: unknown) => String(v ?? '');
Object.assign(templates, {
  outbid: (d) => ({ subject: `Outbid on ${s(d.lot)}`, body: `You have been outbid on ${s(d.lot)}. The price is now ${s(d.price)}; the lot closes at ${s(d.closesAt)}.` }),
  won: (d) => {
    const pickup = [s(d.pickup), s(d.pickupWindow)].filter(Boolean).join(', '); // D-71: the sale's terms, when the house set them
    return { subject: `You won ${s(d.lot)}`, body: `You won ${s(d.lot)} at ${s(d.hammer)}, ${s(d.total)} with the buyer's premium; closed at ${s(d.closedAt)}.${d.due ? ` Payment is due by ${s(d.due)}.` : ''}${pickup ? ` Pickup: ${pickup}.` : ''}` };
  },
  // D-73: to the leader at the moment of withdrawal. The reason stays on the house's record (PRD question 9 is open).
  withdrawn: (d) => ({ subject: `${s(d.lot)} withdrawn`, body: `${s(d.lot)} has been withdrawn from the sale by the auction house. Your bids on it are void and nothing is owed.` }),
} satisfies typeof templates);

export type Notice =
  | { template: 'outbid'; priceCents: number; closesAt: Date }
  | { template: 'won'; hammerCents: number; totalCents: number; closedAt: Date }
  | { template: 'withdrawn' };

/** One Outbox row to the bidder's user email, the lot title (and for won, the sale's due date and pickup) read from the rows, inside the caller's transaction. */
export async function enqueueNotice(tx: Tx, orgId: string, lotId: string, bidderId: string, n: Notice): Promise<void> {
  const data =
    n.template === 'outbid'
      ? { price: formatCents(n.priceCents), closesAt: n.closesAt.toISOString() }
      : n.template === 'won'
        ? { hammer: formatCents(n.hammerCents), total: formatCents(n.totalCents), closedAt: n.closedAt.toISOString() }
        : {};
  await tx.query(
    `INSERT INTO "Outbox" ("id", "orgId", "channel", "to", "template", "data")
     SELECT gen_random_uuid(), $1::uuid, 'email', u."email", $4, jsonb_build_object('lot', l."title") || $5::jsonb
            || CASE WHEN $4 = 'won' THEN jsonb_strip_nulls(jsonb_build_object('due', to_char(a."paymentDueAt" AT TIME ZONE a."timeZone", 'YYYY-MM-DD HH24:MI') || ' ' || a."timeZone", 'pickup', NULLIF(a."pickupText", ''), 'pickupWindow', NULLIF(a."pickupWindowText", ''))) ELSE '{}' END
       FROM "Bidder" b JOIN "User" u ON u."id" = b."userId", "Lot" l JOIN "Auction" a ON a."id" = l."auctionId"
      WHERE b."id" = $3::uuid AND l."id" = $2::uuid`,
    [orgId, lotId, bidderId, n.template, JSON.stringify(data)],
  );
}
