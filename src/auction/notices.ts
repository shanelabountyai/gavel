// Task 3.6 (O-11, D-47 Q3, D-53): outbid and won notices, terse, through the foundation outbox; nothing is ever
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
  won: (d) => ({ subject: `You won ${s(d.lot)}`, body: `You won ${s(d.lot)} at ${s(d.hammer)}, ${s(d.total)} with the buyer's premium; closed at ${s(d.closedAt)}.` }),
} satisfies typeof templates);

export type Notice =
  | { template: 'outbid'; priceCents: number; closesAt: Date }
  | { template: 'won'; hammerCents: number; totalCents: number; closedAt: Date };

/** One Outbox row to the bidder's user email, the lot title read from the row, inside the caller's transaction. */
export async function enqueueNotice(tx: Tx, orgId: string, lotId: string, bidderId: string, n: Notice): Promise<void> {
  const data =
    n.template === 'outbid'
      ? { price: formatCents(n.priceCents), closesAt: n.closesAt.toISOString() }
      : { hammer: formatCents(n.hammerCents), total: formatCents(n.totalCents), closedAt: n.closedAt.toISOString() };
  await tx.query(
    `INSERT INTO "Outbox" ("id", "orgId", "channel", "to", "template", "data")
     SELECT gen_random_uuid(), $1::uuid, 'email', u."email", $4, jsonb_build_object('lot', l."title") || $5::jsonb
       FROM "Bidder" b JOIN "User" u ON u."id" = b."userId", "Lot" l
      WHERE b."id" = $3::uuid AND l."id" = $2::uuid`,
    [orgId, lotId, bidderId, n.template, JSON.stringify(data)],
  );
}
