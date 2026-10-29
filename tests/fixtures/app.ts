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
  const bidder = await db.bidder.create({
    data: { id: `00000000-0000-4000-8000-${key === 'a' ? '000000009021' : '000000009022'}`, orgId: org.orgId, userId: org.userId, paddle: 1 },
  });
  // D-74: a consignor and its contract with the harness auction, for setContractAction's ref('consignor').
  const consignor = await db.consignor.create({ data: { id: `00000000-0000-4000-8000-${key === 'a' ? '000000009031' : '000000009032'}`, orgId: org.orgId, name: `harness consignor ${key}`, code: `H-${key}` } });
  // D-75: a default and an open offer on the harness lot, for answerOfferAction's ref('offer').
  const dflt = await db.buyerDefault.create({ data: { id: `00000000-0000-4000-8000-${key === 'a' ? '000000009041' : '000000009042'}`, orgId: org.orgId, auctionId: auction.id, bidderId: bidder.id, reason: 'harness', byUserId: org.userId, declaredAt: new Date('2031-01-03T00:00:00Z') } });
  const offer = await db.secondChanceOffer.create({ data: { id: `00000000-0000-4000-8000-${key === 'a' ? '000000009051' : '000000009052'}`, orgId: org.orgId, defaultId: dflt.id, lotId: lot.id, bidderId: bidder.id, priceCents: 10000, premiumBps: 1500, expiresAt: new Date('2031-02-01T00:00:00Z'), createdAt: new Date('2031-01-03T00:00:00Z') } });
  return { auction: auction.id, lot: lot.id, bidder: bidder.id, consignor: consignor.id, offer: offer.id };
}
