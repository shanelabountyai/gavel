// Task 3.7: the bid path over HTTP. A bidder-safe closed key set, a resend with the same key writes nothing, the
// boundary refusals map to 400/409 with nothing written, an outsider's lot is a 404, a member with no paddle a 403.
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/lots/[id]/bids/route';
import { registerBidder } from '@/auction/bidder';
import { db } from '@/core/db';
import { resetAuthTables, signInAs } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const KEYS = ['accepted', 'closesAt', 'minNextCents', 'outcome', 'priceCents', 'youLead'];

async function setup() {
  const org = await makeOrg('house');
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'A', softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const end = new Date('2099-01-01T00:00:00Z');
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'L', startCents: 10000, reserveCents: 100000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const post = async (userId: string, body: unknown, lotId = lot.id) => {
    await signInAs(userId, { mfa: true });
    return POST(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: lotId }) });
  };
  const rows = () => db.bid.count({ where: { lotId: lot.id } });
  return { org, lot, post, rows };
}

describe('POST /api/lots/[id]/bids (task 3.7)', () => {
  it('accepts a bid with a closed key set; the same key again writes nothing and answers the same', async () => {
    const { org, post, rows } = await setup();
    const u = await addMember(org.id, 'member', 'a@example.test');
    const bidder = await registerBidder(org.id, u.id, 'member');
    const first = await post(u.id, { maxCents: 20000, idempotencyKey: 'k1' });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(body).toMatchObject({ outcome: 'ACCEPTED_LEAD', accepted: true, priceCents: 10000, minNextCents: 10500, youLead: true });
    for (const secret of [bidder.id, u.id, u.email, '20000', '100000']) expect(JSON.stringify(body)).not.toContain(secret);
    const again = await post(u.id, { maxCents: 20000, idempotencyKey: 'k1' });
    expect(await again.json()).toEqual(body);
    expect(await rows()).toBe(1);
  });

  it('boundary refusals: wrong type 400, same key other amount 409; nothing written', async () => {
    const { org, post, rows } = await setup();
    const u = await addMember(org.id, 'member', 'a@example.test');
    await registerBidder(org.id, u.id, 'member');
    expect((await post(u.id, { maxCents: '20000', idempotencyKey: 'k1' })).status).toBe(400);
    expect((await post(u.id, { maxCents: 20000 })).status).toBe(400);
    expect((await post(u.id, 'not json at all')).status).toBe(400);
    expect(await rows()).toBe(0);
    expect((await post(u.id, { maxCents: 20000, idempotencyKey: 'k1' })).status).toBe(200);
    expect((await post(u.id, { maxCents: 30000, idempotencyKey: 'k1' })).status).toBe(409);
    expect(await rows()).toBe(1);
  });

  it('an outsider gets 404, a member without a paddle 403, an unknown id 404', async () => {
    const { org, post, rows } = await setup();
    const outsider = await db.user.create({ data: { email: 'o@example.test' } });
    expect((await post(outsider.id, { maxCents: 20000, idempotencyKey: 'k1' })).status).toBe(404);
    const member = await addMember(org.id, 'member', 'm@example.test');
    expect((await post(member.id, { maxCents: 20000, idempotencyKey: 'k1' })).status).toBe(403);
    expect((await post(member.id, { maxCents: 20000, idempotencyKey: 'k1' }, 'nope')).status).toBe(404);
    expect(await rows()).toBe(0);
  });
});
