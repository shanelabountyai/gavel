// D-70 (AX-05): suspend and reinstate. The history is insert-only and Bidder.status is its projection.
import { beforeEach, describe, expect, it } from 'vitest';
import { setBidderStatus } from '@/auction/bidder';
import { db } from '@/core/db';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

async function setup() {
  const org = await makeOrg();
  const u = await db.user.create({ data: { email: 'b1@example.test' } });
  const bidder = await db.bidder.create({ data: { orgId: org.id, userId: u.id, paddle: 1 } });
  return { actor: { orgId: org.id, userId: crypto.randomUUID() }, bidder };
}

// Every bidder's status equals its latest history row's, or ACTIVE with none.
const disagreeing = () => db.$queryRaw<{ id: string }[]>`
  SELECT b."id" FROM "Bidder" b
  LEFT JOIN LATERAL (SELECT c."status" FROM "BidderStatusChange" c WHERE c."bidderId" = b."id" ORDER BY c."changedAt" DESC, c."id" DESC LIMIT 1) l ON true
  WHERE b."status" <> COALESCE(l."status", 'ACTIVE')`;

describe('setBidderStatus (D-70)', () => {
  it('suspend then reinstate: two history rows, two audit events, the projection agrees', async () => {
    const { actor, bidder } = await setup();
    await setBidderStatus(actor, bidder.id, 'SUSPENDED', '  non-payment ');
    expect((await db.bidder.findUniqueOrThrow({ where: { id: bidder.id } })).status).toBe('SUSPENDED');
    expect(await disagreeing()).toEqual([]);
    await setBidderStatus(actor, bidder.id, 'ACTIVE', 'paid');
    const rows = await db.bidderStatusChange.findMany({ where: { bidderId: bidder.id }, orderBy: { changedAt: 'asc' } });
    expect(rows.map((r) => [r.status, r.reason])).toEqual([['SUSPENDED', 'non-payment'], ['ACTIVE', 'paid']]);
    expect((await db.auditEvent.findMany({ where: { targetId: bidder.id }, orderBy: { at: 'asc' } })).map((e) => e.action)).toEqual(['bidder.suspended', 'bidder.reinstated']);
    expect((await db.bidder.findUniqueOrThrow({ where: { id: bidder.id } })).status).toBe('ACTIVE');
    expect(await disagreeing()).toEqual([]);
  });

  it('a blank reason, a repeat, or another house writes nothing', async () => {
    const { actor, bidder } = await setup();
    await expect(setBidderStatus(actor, bidder.id, 'SUSPENDED', '   ')).rejects.toThrow(/reason/);
    await expect(setBidderStatus(actor, bidder.id, 'ACTIVE', 'x')).rejects.toThrow(/already active/);
    const other = await makeOrg('other');
    await expect(setBidderStatus({ ...actor, orgId: other.id }, bidder.id, 'SUSPENDED', 'x')).rejects.toThrow();
    expect(await db.bidderStatusChange.count()).toBe(0);
    expect((await db.bidder.findUniqueOrThrow({ where: { id: bidder.id } })).status).toBe('ACTIVE');
  });

  it('two staff suspending at once: one change, one refusal (the Bidder row lock decides)', async () => {
    const { actor, bidder } = await setup();
    const got = await Promise.allSettled([setBidderStatus(actor, bidder.id, 'SUSPENDED', 'a'), setBidderStatus(actor, bidder.id, 'SUSPENDED', 'b')]);
    expect(got.filter((g) => g.status === 'fulfilled')).toHaveLength(1);
    expect(got.filter((g) => g.status === 'rejected').map((g) => String((g as PromiseRejectedResult).reason))).toEqual([expect.stringMatching(/already suspended/)]);
    expect(await db.bidderStatusChange.count()).toBe(1);
  });

  it('the history refuses UPDATE and DELETE', async () => {
    const { actor, bidder } = await setup();
    const row = await setBidderStatus(actor, bidder.id, 'SUSPENDED', 'abuse');
    await expect(db.$executeRaw`UPDATE "BidderStatusChange" SET "reason" = 'edited' WHERE "id" = ${row.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM "BidderStatusChange" WHERE "id" = ${row.id}::uuid`).rejects.toThrow(/append-only/);
  });
});
