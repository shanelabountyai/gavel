import { db } from '@/core/db';
import { now } from '@/core/clock';
import { lotStatus, minNextBid, reserveMet } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';
import { toLot, toState } from '@/auction/place-bid';

// Task 3.3 (brief §4, O-5). What a poller may see of a lot: public numbers, a boolean for the reserve, and for the
// caller alone whether they lead or were outbid. No max, no reserve amount, no other bidder's id or paddle.
export type LotView = {
  readonly status: 'SCHEDULED' | 'OPEN' | 'CLOSED';
  readonly priceCents: number;
  readonly minNextCents: number;
  readonly closesAt: string;
  readonly bidCount: number;
  readonly reserveMet: boolean; // true when there is no reserve, so "no reserve" and "met" look the same
  readonly you: 'LEADING' | 'OUTBID' | null;
  /** From bidCount, plus status because a lot closes with no bid to change the count. */
  readonly etag: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let rules: ReturnType<typeof loadRules>['rules'] | undefined;

/** null = not found or not yours (a lot in another house is a 404, INV-02). */
export async function lotView(userId: string, lotId: string): Promise<LotView | null> {
  if (!UUID.test(lotId)) return null;
  const row = await db.lot.findUnique({ where: { id: lotId }, include: { auction: true, state: true } });
  if (!row?.state || !(await db.membership.findUnique({ where: { orgId_userId: { orgId: row.orgId, userId } }, select: { userId: true } }))) return null;
  const lot = toLot(row);
  const state = toState(row.state);
  const status = lotStatus(lot, state, now().getTime());
  const bidder = await db.bidder.findUnique({ where: { orgId_userId: { orgId: row.orgId, userId } }, select: { id: true } });
  let you: LotView['you'] = null;
  if (bidder && state.leader === bidder.id) you = 'LEADING';
  else if (bidder && (await db.bid.count({ where: { lotId, bidderId: bidder.id, accepted: true } })) > 0) you = 'OUTBID';
  return {
    status,
    priceCents: state.priceCents,
    minNextCents: minNextBid(lot, state, (rules ??= loadRules().rules)),
    closesAt: new Date(state.closesAtMs).toISOString(),
    bidCount: state.bidCount,
    reserveMet: reserveMet(lot, state),
    you,
    etag: `"${state.bidCount}-${status}"`,
  };
}
