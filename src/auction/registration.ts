import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';

// D-88 (AX-16). A sale with `requiresApproval` takes bids only from bidders whose latest AuctionRegistration row is
// APPROVED. The bidder requests (version 1, PENDING); staff append APPROVED or DECLINED with a note. A revoke is a
// DECLINED row after APPROVED and works like a suspension (D-70 c): an attempt already past the boundary is judged
// normally and a standing maximum stays live. None of this is the bid path (non-negotiable 2).

export type RegistrationStatus = 'PENDING' | 'APPROVED' | 'DECLINED';

const latest = (auctionId: string, bidderId: string, orgId?: string) =>
  db.auctionRegistration.findFirst({ where: { auctionId, bidderId, ...(orgId ? { orgId } : {}) }, orderBy: { version: 'desc' } });

/** For placeBid's boundary and the lot page: the latest status, or null when the bidder never asked. One indexed query. */
export const registrationStatus = async (auctionId: string, bidderId: string) => ((await latest(auctionId, bidderId))?.status ?? null) as RegistrationStatus | null;

const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';

/** The bidder asks to bid in the sale. Idempotent while PENDING or APPROVED; a declined bidder cannot re-queue. */
export async function requestApproval(actor: { orgId: string; userId: string }, bidderId: string, auctionId: string) {
  const auction = await db.auction.findFirst({ where: { id: auctionId, orgId: actor.orgId }, select: { requiresApproval: true } });
  if (!auction) throw new Refused('No such sale in this house.');
  if (!auction.requiresApproval) throw new Refused('This sale needs no approval to bid.');
  const prior = await latest(auctionId, bidderId);
  if (prior?.status === 'DECLINED') throw new Refused('The house declined your registration for this sale.');
  if (prior) return prior;
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.auctionRegistration.create({ data: { orgId: actor.orgId, auctionId, bidderId, version: 1, status: 'PENDING', byUserId: actor.userId, recordedAt: now() } });
      await audit(actor, 'auction.registration_requested', { targetType: 'auction', targetId: auctionId, data: { bidderId } }, tx);
      return row;
    });
  } catch (e) {
    if (!isUnique(e)) throw e;
    return (await latest(auctionId, bidderId))!; // the same bidder asking twice at once: one row
  }
}

/** Staff approve (note optional: the card or deposit check done outside) or decline (reason required). */
export async function decideRegistration(actor: { orgId: string; userId: string }, auctionId: string, bidderId: string, status: 'APPROVED' | 'DECLINED', note: string) {
  const why = note.trim();
  if (status === 'DECLINED' && !why) throw new Refused('Give a reason for declining.');
  const prior = await latest(auctionId, bidderId, actor.orgId);
  if (!prior) throw new Refused('That bidder has not asked to bid in this sale.');
  if (prior.status === status) throw new Refused(status === 'APPROVED' ? 'That bidder is already approved.' : 'That bidder is already declined.');
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.auctionRegistration.create({ data: { orgId: actor.orgId, auctionId, bidderId, version: prior.version + 1, status, note: why, byUserId: actor.userId, recordedAt: now() } });
      await audit(actor, status === 'APPROVED' ? 'auction.registration_approved' : 'auction.registration_declined', { targetType: 'auction', targetId: auctionId, data: { bidderId, note: why } }, tx);
      return row;
    });
  } catch (e) {
    // two staff at once: the (sale, bidder, version) index lets one through; not the bid path, no retry
    if (isUnique(e)) throw new Refused('Someone else just decided this registration. Reload to see it.');
    throw e;
  }
}

/** Every row of a sale's registrations, oldest first, with the paddle and name: the staff queue and the dispute view. */
export const registrationsFor = (auctionId: string, bidderIds?: readonly string[]) =>
  db.auctionRegistration.findMany({
    where: { auctionId, ...(bidderIds ? { bidderId: { in: [...bidderIds] } } : {}) },
    orderBy: [{ bidderId: 'asc' }, { version: 'asc' }],
    include: { bidder: { select: { paddle: true, user: { select: { name: true, email: true } } } } },
  });
