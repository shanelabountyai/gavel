// D-89 (AX-17, R-17): an unsold lot relisted into a later sale. The new lot copies the catalogue fields and consignor,
// takes a new price, names the original, and is published with its LotState as any lot; the original is untouched.
// relistLot refuses a sold, unsettled, already-relisted or cross-house lot and an opened or same sale; the trigger
// refuses the same at the insert and refuses changing the link; verify is clean on both lots.
import { beforeEach, describe, expect, it } from 'vitest';
import { closeLots } from '@/auction/close';
import { createConsignor } from '@/auction/consignor';
import { openState } from '@/auction/engine/engine';
import { loadRules } from '@/auction/load-rules';
import { placeBid, prismaTx } from '@/auction/place-bid';
import { relistLot } from '@/auction/relist';
import { verifyLot } from '@/auction/verify-sql';
import { withdrawLot } from '@/auction/withdraw';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const { rules } = loadRules();
const q = prismaTx(db as unknown as Prisma.TransactionClient);
const T0 = Date.UTC(2026, 0, 1, 12);
const END = T0 + 3_600_000;
const NEXT = T0 + 86_400_000; // the next sale opens a day later
const at = (ms: number) => () => new Date(ms);

async function house(slug = 'acme') {
  const org = await makeOrg(slug);
  const actor = { orgId: org.id, userId: crypto.randomUUID() };
  const sale = (name: string, opensMs: number) => db.auction.create({ data: { orgId: org.id, name, softCloseWindowSeconds: 120, maxExtensionSeconds: 600, buyerPremiumBps: 1000, opensAt: new Date(opensMs), firstCloseAt: new Date(opensMs + 3_600_000), staggerSeconds: 60 } });
  const [a, b] = [await sale('Spring', T0), await sale('Summer', NEXT)];
  const lot = async (number: number, consignorId: string | null, reserveCents: number | null = null) => {
    const s = openState({ startCents: 10000, reserveCents, opensAtMs: T0, scheduledEndMs: END, softCloseWindowMs: 120_000, maxExtensionMs: 600_000, buyerPremiumBps: 1000 });
    return db.lot.create({ data: { orgId: org.id, auctionId: a.id, number, title: `L${number}`, description: `about ${number}`, imageUrl: `https://img.test/${number}.jpg`, consignorId, startCents: 10000, reserveCents, scheduledEnd: new Date(END),
      state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: 0, acceptedCount: 0, closesAt: new Date(s.closesAtMs), extensionCount: 0 } } } });
  };
  const bidder = async (paddle: number) => (await db.bidder.create({ data: { orgId: org.id, userId: (await db.user.create({ data: { email: `r${paddle}-${org.id}@example.test` } })).id, paddle } })).id;
  return { org, actor, a, b, lot, bidder };
}

const relist = (actor: { orgId: string; userId: string }, lotId: string, auctionId: string, ms = END + 1000, startCents = 8000, reserveCents: number | null = null) =>
  relistLot(actor, { lotId, auctionId, startCents, reserveCents, scheduledEnd: null }, { now: at(ms) });

describe('relist an unsold lot (D-89)', () => {
  it('relists no-bids, reserve-not-met and withdrawn lots into the next sale; refuses sold, unsettled, twice, same or opened sale', async () => {
    const h = await house();
    const c = await createConsignor(h.actor, { name: 'Estate of X', code: 'EST-1' });
    const [l1, l2, l3, l4, l5] = [await h.lot(1, c.id), await h.lot(2, c.id, 50000), await h.lot(3, null), await h.lot(4, c.id), await h.lot(5, c.id)];
    const x = await h.bidder(1);
    await placeBid({ orgId: h.org.id, lotId: l2.id, bidderId: x, maxCents: 20000, idempotencyKey: 'k1' }, { now: at(T0 + 1000) }); // under the reserve
    await placeBid({ orgId: h.org.id, lotId: l3.id, bidderId: x, maxCents: 20000, idempotencyKey: 'k2' }, { now: at(T0 + 2000) }); // sells
    await withdrawLot({ orgId: h.org.id, lotId: l4.id, reason: 'title', userId: h.actor.userId }, { now: at(T0 + 3000) });
    await expect(relist(h.actor, l1.id, h.b.id)).rejects.toThrow('has not settled yet');
    await closeLots(new Date(END), q, {});
    const r1 = await relist(h.actor, l1.id, h.b.id, END + 1000, 8000, 9000);
    expect(r1).toMatchObject({ auctionId: h.b.id, number: 1, title: 'L1', description: 'about 1', imageUrl: 'https://img.test/1.jpg', consignorId: c.id, startCents: 8000, reserveCents: 9000, relistOfLotId: l1.id, scheduledEnd: new Date(NEXT + 3_600_000) });
    expect(await db.lotState.findUnique({ where: { lotId: r1.id } })).toMatchObject({ priceCents: 0, bidCount: 0, closesAt: new Date(NEXT + 3_600_000) });
    const r2 = await relist(h.actor, l2.id, h.b.id);
    expect(r2).toMatchObject({ number: 2, relistOfLotId: l2.id, scheduledEnd: new Date(NEXT + 3_660_000) }); // stagger
    expect((await relist(h.actor, l4.id, h.b.id)).relistOfLotId).toBe(l4.id); // a withdrawn lot can come back (D-73 j)
    await expect(relist(h.actor, l3.id, h.b.id)).rejects.toThrow('This lot sold');
    await expect(relist(h.actor, l1.id, h.b.id)).rejects.toThrow('Already relisted as lot 1 in Summer');
    await expect(relist(h.actor, l5.id, h.a.id)).rejects.toThrow('later sale');
    await expect(relist(h.actor, l5.id, h.b.id, NEXT)).rejects.toThrow('Summer has already opened');
    await expect(relist(h.actor, l5.id, h.b.id, END + 1000, 8000, 7000)).rejects.toThrow('Reserve must be at least');
    expect((await db.auditEvent.findMany({ where: { orgId: h.org.id, action: 'lot.relisted' } })).map((e) => e.targetId).sort()).toEqual([r1.id, r2.id, (await db.lot.findFirst({ where: { relistOfLotId: l4.id } }))!.id].sort());
    expect(await db.lot.findUnique({ where: { id: l1.id }, select: { relistedAs: { select: { id: true } } } })).toEqual({ relistedAs: { id: r1.id } });
    for (const id of [l1.id, l2.id, l4.id, r1.id, r2.id]) expect(await verifyLot(q, id, rules)).toBeNull();
  });

  it('the trigger refuses a relist of a sold lot, of another consignor, of another house, and any change to the link', async () => {
    const h = await house();
    const o = await house('other');
    const c = await createConsignor(h.actor, { name: 'C', code: 'C-1' });
    const [l1, l2] = [await h.lot(1, c.id), await h.lot(2, c.id)];
    const x = await h.bidder(1);
    await placeBid({ orgId: h.org.id, lotId: l2.id, bidderId: x, maxCents: 20000, idempotencyKey: 'k' }, { now: at(T0 + 1000) });
    await closeLots(new Date(END), q, {});
    const raw = (orgId: string, auctionId: string, relistOfLotId: string, consignorId: string | null = c.id, number = 9) =>
      db.lot.create({ data: { orgId, auctionId, number, title: 't', consignorId, startCents: 100, scheduledEnd: new Date(NEXT + 3_600_000), relistOfLotId } });
    await expect(raw(h.org.id, h.b.id, l2.id)).rejects.toThrow(/Lot_relist_of_unsold|not an unsold lot/); // sold
    await expect(raw(h.org.id, h.b.id, l1.id, null)).rejects.toThrow(/not an unsold lot/); // consignor dropped
    await expect(raw(o.org.id, o.b.id, l1.id, null)).rejects.toThrow(/not an unsold lot/); // another house
    await expect(raw(h.org.id, h.a.id, l1.id)).rejects.toThrow(/not an unsold lot/); // same sale
    await expect(relist(o.actor, l1.id, o.b.id)).rejects.toThrow('No such lot or sale in this house.');
    const ok = await raw(h.org.id, h.b.id, l1.id);
    await expect(db.lot.update({ where: { id: ok.id }, data: { relistOfLotId: null } })).rejects.toThrow(/never changed/);
    await expect(db.lot.update({ where: { id: l2.id }, data: { relistOfLotId: l1.id } })).rejects.toThrow(/never changed/);
  });
});
