// Task 3.2 (D-49): paddles are distinct under a concurrent submit (the unique index decides); staff get none.
import { beforeEach, describe, expect, it } from 'vitest';
import { registerBidder } from '@/auction/bidder';
import { db } from '@/core/db';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const user = (n: number) => db.user.create({ data: { email: `b${n}@example.test` } });

describe('registerBidder (task 3.2)', () => {
  it('20 concurrent registrations get paddles 1..20, each exactly once', async () => {
    const org = await makeOrg();
    const users = await Promise.all(Array.from({ length: 20 }, (_, i) => user(i)));
    const got = await Promise.all(users.map((u) => registerBidder(org.id, u.id, 'member')));
    expect(got.map((b) => b.paddle).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await db.bidder.count({ where: { orgId: org.id } })).toBe(20);
  });

  it('registering twice (even at once) returns the same bidder', async () => {
    const org = await makeOrg();
    const u = await user(1);
    const [a, b] = await Promise.all([registerBidder(org.id, u.id, 'member'), registerBidder(org.id, u.id, 'member')]);
    expect(a.id).toBe(b.id);
    expect(await db.bidder.count({ where: { orgId: org.id } })).toBe(1);
  });

  it.each(['owner', 'admin', 'scorekeeper'])('%s gets no Bidder row', async (role) => {
    const org = await makeOrg();
    const u = await user(1);
    await expect(registerBidder(org.id, u.id, role)).rejects.toThrow(/do not bid/);
    expect(await db.bidder.count({ where: { orgId: org.id } })).toBe(0);
  });
});
