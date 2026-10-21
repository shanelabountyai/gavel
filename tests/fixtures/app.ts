import { db } from '@/core/db';

// CLONE-OWNED. The INV-01..04 harness seeds these rows in both fixture orgs, so it can drive
// actions whose inputs use ref('<model>') for the clone's own tables. Return { model: id } for
// one row of each model, owned by `org.orgId`.
export async function seedApp(org: { orgId: string; userId: string }, key: 'a' | 'b'): Promise<Record<string, string>> {
  // A fixed id: the harness re-seeds before every call, and a ref minted once must still resolve.
  const id = `00000000-0000-4000-8000-${key === 'a' ? '000000009001' : '000000009002'}`;
  const auction = await db.auction.create({
    data: { id, orgId: org.orgId, name: `harness ${key}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1500, opensAt: new Date('2031-01-01T00:00:00Z') },
  });
  const end = new Date('2031-01-02T00:00:00Z');
  const lotId = `00000000-0000-4000-8000-${key === 'a' ? '000000009011' : '000000009012'}`;
  const lot = await db.lot.create({
    data: { id: lotId, orgId: org.orgId, auctionId: auction.id, number: 1, title: `harness lot ${key}`, startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.orgId, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  return { auction: auction.id, lot: lot.id };
}
