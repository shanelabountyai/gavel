import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import type { Prisma } from '@/generated/prisma/client';

// Task 3.2 (D-49). The next paddle is max + 1 and the unique (orgId, paddle) index is the guard: two
// concurrent registrations can read the same max, one insert fails with P2002, and that writer reads again.
// Registration is not the bid path, so a bounded retry here is fine (non-negotiable 2 is about bids).
// Only the plain `member` role bids (D-25); staff roles get no Bidder row.
export async function registerBidder(orgId: string, userId: string, role: string) {
  if (role !== 'member') throw new Refused('Staff accounts do not bid. Register with a bidder account.');
  for (let attempt = 0; attempt < 50; attempt++) {
    const mine = await db.bidder.findUnique({ where: { orgId_userId: { orgId, userId } } });
    if (mine) return mine;
    const top = await db.bidder.aggregate({ where: { orgId }, _max: { paddle: true } });
    try {
      return await db.bidder.create({ data: { orgId, userId, paddle: (top._max.paddle ?? 0) + 1 } });
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2002') throw e; // paddle or (org, user) taken: look again
    }
  }
  throw new Refused('Registration is busy. Try again.');
}

// D-70 (AX-05). Suspend or reinstate, with a reason. The conditional UPDATE takes the Bidder row lock and
// re-checks the status under it (READ COMMITTED re-evaluates the WHERE after a wait), so two staff clicking at
// once give one change and one refusal. The history row and the audit event commit with it. placeBid reads
// Bidder.status at its boundary, before the lot lock: an attempt that passed the boundary first is judged normally.
export async function setBidderStatus(
  actor: { orgId: string; userId: string },
  bidderId: string,
  status: 'ACTIVE' | 'SUSPENDED',
  reason: string,
) {
  return db.$transaction((tx) => setBidderStatusInTx(tx, actor, bidderId, status, reason));
}

/** D-78 (AX-09): the exemption certificate on file, or none. Reference data on the Bidder row, audited; the invoice reads it. */
export async function setTaxExemption(actor: { orgId: string; userId: string }, bidderId: string, certificateRef: string | null) {
  const ref = certificateRef?.trim() || null;
  await db.$transaction(async (tx) => {
    const { count } = await tx.bidder.updateMany({ where: { id: bidderId, orgId: actor.orgId }, data: { taxExemptRef: ref } });
    if (count === 0) throw new Refused('No such bidder in this house.');
    await audit(actor, ref ? 'bidder.tax_exempt' : 'bidder.tax_exempt_cleared', { targetType: 'bidder', targetId: bidderId, data: { certificateRef: ref } }, tx);
  });
  return ref;
}

/** The transaction body (D-75: a default suspends inside its own transaction). The caller owns BEGIN/COMMIT. */
export async function setBidderStatusInTx(tx: Prisma.TransactionClient, actor: { orgId: string; userId: string }, bidderId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string) {
  const why = reason.trim();
  if (!why) throw new Refused('Give a reason.');
  const from = status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
  const { count } = await tx.bidder.updateMany({ where: { id: bidderId, orgId: actor.orgId, status: from }, data: { status } });
  if (count === 0) throw new Refused(status === 'SUSPENDED' ? 'That bidder is already suspended.' : 'That bidder is already active.');
  const row = await tx.bidderStatusChange.create({ data: { orgId: actor.orgId, bidderId, status, reason: why, byUserId: actor.userId, changedAt: now() } });
  await audit(actor, status === 'SUSPENDED' ? 'bidder.suspended' : 'bidder.reinstated', { targetType: 'bidder', targetId: bidderId, data: { reason: why } }, tx);
  return row;
}
