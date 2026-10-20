import { db } from '@/core/db';
import { Refused } from '@/core/errors';

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
