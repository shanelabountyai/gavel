// R-18 (D-90): a sale's increment table and tiered premium through the database. The bid path steps by the sale's
// table; auction:close writes the tiered premium and the bands on the row; a correction keeps them or goes flat;
// verify recomputes every row; the CHECKs hold the shape; the trigger fixes all three once the sale has a bid.
import { beforeEach, describe, expect, it } from 'vitest';
import { openState } from '@/auction/engine/engine';
import { closeLots } from '@/auction/close';
import { correctSettlement } from '@/auction/correct';
import { prismaTx, placeBid } from '@/auction/place-bid';
import { verifyLot } from '@/auction/verify-sql';
import { loadRules } from '@/auction/load-rules';
import { db } from '@/core/db';
import { Prisma } from '@/generated/prisma/client';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const T0 = Date.UTC(2026, 0, 1);
const END = T0 + 3_600_000;
const TWO = [{ loCents: 0, hiCents: 500_000, bps: 1500 }, { loCents: 500_000, hiCents: null, bps: 1000 }];
const { rules } = loadRules();
const q = prismaTx(db as unknown as Parameters<typeof prismaTx>[0]);

async function setup(terms: { incrementTable?: string; buyerPremiumBps?: number; premiumBands?: typeof TWO } = {}) {
  const org = await makeOrg();
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'Yard', softCloseWindowSeconds: 0, maxExtensionSeconds: 0, buyerPremiumBps: terms.buyerPremiumBps ?? 1500, opensAt: new Date(T0), incrementTable: terms.incrementTable ?? 'standard', premiumBands: terms.premiumBands ?? Prisma.DbNull } });
  const s = openState({ startCents: 100_000, reserveCents: null, opensAtMs: T0, scheduledEndMs: END, softCloseWindowMs: 0, maxExtensionMs: 0, buyerPremiumBps: 1500 });
  const lot = await db.lot.create({ data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'Skid steer', startCents: 100_000, scheduledEnd: new Date(END),
    state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: null, leaderMaxCents: 0, leaderSeq: null, bidCount: 0, acceptedCount: 0, closesAt: new Date(s.closesAtMs), extensionCount: 0 } } } });
  const bidders = await Promise.all(['a', 'b'].map(async (k, i) => db.bidder.create({ data: { orgId: org.id, userId: (await db.user.create({ data: { email: `${k}@example.test` } })).id, paddle: i + 1 } })));
  const bid = (who: number, maxCents: number, at: number) => placeBid({ orgId: org.id, lotId: lot.id, bidderId: bidders[who]!.id, maxCents, idempotencyKey: `k${who}-${maxCents}` }, { now: () => new Date(at) });
  return { org, auction, lot, bidders, bid };
}

describe('rules v2 through the database (D-90)', () => {
  it('GB-30d on the bid path: under equipment 120,000 is outbid at 125,000 and the next minimum is 130,000', async () => {
    const { bid } = await setup({ incrementTable: 'equipment' });
    await bid(0, 1_500_000, T0 + 1000);
    await expect(bid(1, 120_000, T0 + 2000)).resolves.toMatchObject({ outcome: 'ACCEPTED_OUTBID', priceCents: 125_000, minNextCents: 130_000 });
  });

  it('close writes the tiered premium with its bands, verify recomputes it, a correction keeps the bands or goes flat', async () => {
    const { org, lot, bidders, bid } = await setup({ incrementTable: 'equipment', premiumBands: TWO });
    await bid(0, 1_500_000, T0 + 1000);
    await bid(1, 990_000, T0 + 2000); // outbid at min(1,500,000, 990,000 + 10,000) = 1,000,000
    await closeLots(new Date(END), q);
    const first = await db.settlement.findFirstOrThrow({ where: { lotId: lot.id } });
    // GB-29e: 1,000,000 → 75,000 + 50,000 = 125,000
    expect([first.hammerCents, first.premiumCents, first.totalCents, first.premiumBps, first.premiumBands]).toEqual([1_000_000, 125_000, 1_125_000, 1500, TWO]);
    expect(await verifyLot(q, lot.id, rules)).toBeNull();

    const actor = { orgId: org.id, lotId: lot.id, userId: crypto.randomUUID() };
    // To the underbidder: their reached 1,000,000 capped at their own max 990,000 → 75,000 + 49,000 = 124,000, still tiered.
    const b = await correctSettlement({ ...actor, winner: bidders[1]!.id, reason: 'winner withdrew' });
    expect([b.settlement.hammerCents, b.settlement.premiumCents, b.settlement.premiumBands]).toEqual([990_000, 124_000, TWO]);
    // A typed rate alone is a flat premium: 990,000 × 1200 / 10,000 = 118,800, no bands.
    const flat = await correctSettlement({ ...actor, premiumBps: 1200, reason: 'house discount' });
    expect([flat.settlement.premiumCents, flat.settlement.premiumBps, flat.settlement.premiumBands]).toEqual([118_800, 1200, null]);
    // Back to tiers by giving them: same as before, a new row.
    const back = await correctSettlement({ ...actor, premiumBands: TWO, reason: 'discount reversed' });
    expect([back.settlement.premiumCents, back.settlement.premiumBps]).toEqual([124_000, 1500]);
    await expect(correctSettlement({ ...actor, premiumBands: TWO, reason: 'again' })).rejects.toMatchObject({ code: 'NO_CHANGE' });
    await expect(correctSettlement({ ...actor, premiumBands: [{ loCents: 0, hiCents: null, bps: 1500 }], reason: 'one band' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(correctSettlement({ ...actor, premiumBands: [{ loCents: 0, hiCents: 10, bps: 1500 }, { loCents: 20, hiCents: null, bps: 1 }], reason: 'gap' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await verifyLot(q, lot.id, rules)).toBeNull();
  });

  it('the CHECKs: a known table; bands null or two or more whose first rate is the row\'s', async () => {
    const { auction } = await setup();
    const upd = (data: Prisma.AuctionUpdateInput) => db.auction.update({ where: { id: auction.id }, data });
    await expect(upd({ incrementTable: 'farm' })).rejects.toThrow(/Auction_incrementTable_known/);
    await expect(upd({ premiumBands: [{ loCents: 0, hiCents: null, bps: 1500 }] })).rejects.toThrow(/Auction_premiumBands_shape/);
    await expect(upd({ premiumBands: [{ loCents: 0, hiCents: 500_000, bps: 2000 }, { loCents: 500_000, hiCents: null, bps: 1000 }] })).rejects.toThrow(/Auction_premiumBands_shape/);
    await expect(upd({ premiumBands: TWO, incrementTable: 'estate' })).resolves.toMatchObject({ incrementTable: 'estate' });
  });

  it('the table and the premium are fixed once the sale has a bid', async () => {
    const { auction, bid } = await setup();
    await db.auction.update({ where: { id: auction.id }, data: { incrementTable: 'estate', premiumBands: TWO } }); // before any bid: allowed
    await bid(0, 200_000, T0 + 1000);
    for (const data of [{ incrementTable: 'equipment' }, { buyerPremiumBps: 1200 }, { premiumBands: Prisma.DbNull }] as Prisma.AuctionUpdateInput[]) {
      await expect(db.auction.update({ where: { id: auction.id }, data })).rejects.toThrow(/increment and premium terms are fixed/);
    }
  });
});
