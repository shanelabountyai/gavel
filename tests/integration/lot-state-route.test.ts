// Task 3.3: the lot read endpoint. The body is a closed set of keys (no max, reserve, paddle or identity), `you` is the
// caller's alone, a second poll with the ETag is a 304, an outsider's lot is a 404. Clock injected for bids.
import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/lots/[id]/state/route';
import { registerBidder } from '@/auction/bidder';
import { closeLots } from '@/auction/close';
import { placeBid, prismaTx } from '@/auction/place-bid';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { resetAuthTables, signInAs } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const T = () => new Date('2026-06-01T12:00:00Z');
const KEYS = ['bidCount', 'closesAt', 'final', 'minNextCents', 'opensAt', 'priceCents', 'reserveMet', 'result', 'status', 'you'];

// end: the scheduled close. Bids are placed at T, the view reads the real clock, so an end just after T is a closed lot.
async function setup(end = new Date('2099-01-01T00:00:00Z'), reserveCents: number | null = 100000) {
  const org = await makeOrg('house');
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'A', softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'L', startCents: 10000, reserveCents, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const who = async (email: string) => {
    const u = await addMember(org.id, 'member', email);
    return { user: u, bidder: await registerBidder(org.id, u.id, 'member') };
  };
  const bid = (b: { bidder: { id: string } }, maxCents: number) => placeBid({ orgId: org.id, lotId: lot.id, bidderId: b.bidder.id, maxCents, idempotencyKey: `k${maxCents}` }, { now: T });
  const poll = async (userId: string, etag?: string) => {
    await signInAs(userId, { mfa: true });
    return GET(new Request('http://x/', { headers: etag ? { 'if-none-match': etag } : {} }), { params: Promise.resolve({ id: lot.id }) });
  };
  return { org, lot, who, bid, poll };
}

describe('GET /api/lots/[id]/state (task 3.3)', () => {
  it('leaks nothing: a closed key set for both bidders, you is the caller alone', async () => {
    const { who, bid, poll } = await setup();
    const a = await who('a@example.test');
    const b = await who('b@example.test');
    await bid(a, 20000);
    await bid(b, 30000); // A outbid; B leads at 20500
    const forA = await (await poll(a.user.id)).json();
    const forB = await (await poll(b.user.id)).json();
    expect(Object.keys(forA).sort()).toEqual(KEYS);
    expect(Object.keys(forB).sort()).toEqual(KEYS);
    expect({ a: forA.you, b: forB.you }).toEqual({ a: 'OUTBID', b: 'LEADING' });
    expect(forA).toMatchObject({ status: 'OPEN', priceCents: 20500, minNextCents: 21000, bidCount: 2, reserveMet: false, result: null, final: false, opensAt: '2020-01-01T00:00:00.000Z' });
    const text = JSON.stringify(forA) + JSON.stringify(forB);
    for (const secret of [a.bidder.id, b.bidder.id, a.user.id, b.user.id, a.user.email, '100000']) expect(text).not.toContain(secret);
  });

  it('a second poll with the ETag is a 304, a new bid changes it', async () => {
    const { who, bid, poll } = await setup();
    const a = await who('a@example.test');
    const b = await who('b@example.test');
    await bid(a, 20000);
    const first = await poll(a.user.id);
    const etag = first.headers.get('etag')!;
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toContain('private');
    const again = await poll(a.user.id, etag);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    await bid(b, 30000);
    const after = await poll(a.user.id, etag);
    expect(after.status).toBe(200);
    expect(after.headers.get('etag')).not.toBe(etag);
  });

  it('a lot in another house is a 404; a staff member sees no `you`', async () => {
    const { org, who, poll } = await setup();
    const outsider = await db.user.create({ data: { email: 'o@example.test' } });
    expect((await poll(outsider.id)).status).toBe(404);
    const staff = await addMember(org.id, 'scorekeeper', 's@example.test');
    expect((await (await poll(staff.id)).json()).you).toBeNull();
    await who('a@example.test');
  });

  it('Bids counts accepted bids only: a refused attempt leaves 0 (AX-01)', async () => {
    const { who, bid, poll } = await setup();
    const a = await who('a@example.test');
    await bid(a, 5000); // below the 10000 start: REJECTED_BELOW_MINIMUM, a ledger row all the same
    expect(await (await poll(a.user.id)).json()).toMatchObject({ bidCount: 0, you: null, minNextCents: 10000 });
  });

  it('a closed lot says won / not won, never leading; final once settled (D-67)', async () => {
    const end = new Date(T().getTime() + 30_000);
    const { who, bid, poll, org } = await setup(end, 20000);
    const a = await who('a@example.test');
    const b = await who('b@example.test');
    const c = await who('c@example.test');
    await bid(a, 30000);
    await bid(b, 25000); // A leads at 25500, reserve met
    const view = async (u: { user: { id: string } }) => (await poll(u.user.id)).json();
    expect(await view(a)).toMatchObject({ status: 'CLOSED', result: 'WON', you: null, final: false, priceCents: 25500 });
    expect(await view(b)).toMatchObject({ result: 'NOT_WON', you: null, final: false });
    expect(await view(c)).toMatchObject({ result: null, you: null });
    await closeLots(new Date(end.getTime() + 600_000), prismaTx(db as unknown as Prisma.TransactionClient));
    expect(await view(a)).toMatchObject({ result: 'WON', final: true, priceCents: 25500 });
    expect(await view(b)).toMatchObject({ result: 'NOT_WON', final: true });
    expect(org).toBeTruthy();
  });

  it('a leader under the reserve is told the lot closed unsold', async () => {
    const { who, bid, poll } = await setup(new Date(T().getTime() + 30_000));
    const a = await who('a@example.test');
    await bid(a, 20000); // reserve 100000
    expect(await (await poll(a.user.id)).json()).toMatchObject({ status: 'CLOSED', result: 'UNSOLD', reserveMet: false, you: null });
  });
});
