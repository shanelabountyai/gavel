// D-93 (AX-22, R-22): staff link a bidder to a consignor; the report lists that bidder's accepted bids on that
// consignor's lots and nothing else. Links are insert-only and one house by trigger. Clock injected.
import { beforeEach, describe, expect, it } from 'vitest';
import { createConsignor, linkBidder, linkedBids, retractLink } from '@/auction/consignor';
import { openState } from '@/auction/engine/engine';
import { placeBid } from '@/auction/place-bid';
import { db } from '@/core/db';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const T0 = Date.UTC(2026, 0, 1, 12);
const END = T0 + 3_600_000;
const at = (ms: number) => ({ now: () => new Date(ms) });

async function house(slug = 'acme') {
  const org = await makeOrg(slug);
  const actor = { orgId: org.id, userId: crypto.randomUUID() };
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'Spring estate', softCloseWindowSeconds: 120, maxExtensionSeconds: 600, buyerPremiumBps: 1000, opensAt: new Date(T0) } });
  const lot = async (number: number, consignorId: string | null) => {
    const s = openState({ startCents: 1000, reserveCents: null, opensAtMs: T0, scheduledEndMs: END, softCloseWindowMs: 120_000, maxExtensionMs: 600_000, buyerPremiumBps: 1000 });
    return db.lot.create({ data: { orgId: org.id, auctionId: auction.id, number, title: `L${number}`, consignorId, startCents: 1000, scheduledEnd: new Date(END),
      state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: 0, acceptedCount: 0, closesAt: new Date(s.closesAtMs), extensionCount: 0 } } } });
  };
  const bidder = async (paddle: number) => {
    const u = await db.user.create({ data: { email: `${slug}${paddle}@example.test` } });
    return (await db.bidder.create({ data: { orgId: org.id, userId: u.id, paddle } })).id;
  };
  const bid = (lotId: string, bidderId: string, maxCents: number, ms: number) => placeBid({ orgId: org.id, lotId, bidderId, maxCents, idempotencyKey: `${lotId}${bidderId}${maxCents}` }, at(ms));
  return { org, actor, lot, bidder, bid };
}

describe('consignor-linked bidding report (D-93)', () => {
  it('lists the linked bidder’s accepted bids on that consignor’s lots only', async () => {
    const h = await house();
    const [est, other] = [await createConsignor(h.actor, { name: 'Estate', code: 'E1' }), await createConsignor(h.actor, { name: 'Other', code: 'O1' })];
    const [shill, honest] = [await h.bidder(7), await h.bidder(8)];
    const [mine, theirs] = [await h.lot(1, est.id), await h.lot(2, other.id)];
    await h.bid(mine.id, honest, 5000, T0 + 1000); // accepted, unlinked bidder
    await h.bid(mine.id, shill, 3000, T0 + 2000); // accepted: pushes the price to 3,100
    await h.bid(mine.id, shill, 2000, T0 + 3000); // rejected (below the asking price): not in the report
    await h.bid(theirs.id, shill, 4000, T0 + 4000); // another consignor's lot

    await linkBidder(h.actor, { consignorId: est.id, paddle: 7, reason: 'Consignor’s brother' });
    const rows = await linkedBids(h.org.id);
    expect(rows).toEqual([expect.objectContaining({ code: 'E1', paddle: 7, reason: 'Consignor’s brother', auctionName: 'Spring estate', lotNumber: 1, seq: 2, maxCents: 3000, priceAfterCents: 3100, ledAfter: false })]);
    expect(rows[0]!.placedAt.getTime()).toBe(T0 + 2000);
    expect(await db.auditEvent.count({ where: { action: 'consignor.bidder_linked' } })).toBe(1);
  });

  it('refuses a blank reason, an unknown paddle, a duplicate and another house; the DB refuses edits and cross-house rows', async () => {
    const h = await house();
    const est = await createConsignor(h.actor, { name: 'Estate', code: 'E1' });
    await h.bidder(7);
    await expect(linkBidder(h.actor, { consignorId: est.id, paddle: 7, reason: '  ' })).rejects.toThrow(/reason/i);
    await expect(linkBidder(h.actor, { consignorId: est.id, paddle: 99, reason: 'x' })).rejects.toThrow(/paddle 99/i);
    const link = await linkBidder(h.actor, { consignorId: est.id, paddle: 7, reason: 'Agent' });
    await expect(linkBidder(h.actor, { consignorId: est.id, paddle: 7, reason: 'Again' })).rejects.toThrow(/already linked/i);

    const b = await house('other');
    const foreign = await b.bidder(7);
    await expect(linkBidder(b.actor, { consignorId: est.id, paddle: 7, reason: 'x' })).rejects.toThrow(/no such consignor/i);
    expect(await linkedBids(b.org.id)).toEqual([]);

    await expect(db.$executeRawUnsafe(`UPDATE "ConsignorBidderLink" SET "reason" = 'y' WHERE "id" = $1::uuid`, link.id)).rejects.toThrow(/append-only/i);
    await expect(db.$executeRawUnsafe(`DELETE FROM "ConsignorBidderLink" WHERE "id" = $1::uuid`, link.id)).rejects.toThrow(/append-only/i);
    await expect(db.consignorBidderLink.create({ data: { orgId: h.org.id, consignorId: est.id, bidderId: foreign, reason: 'x', byUserId: h.actor.userId, createdAt: new Date(T0) } })).rejects.toThrow(/same_house|own house/i);
  });

  it('a retracted link leaves the report, stays listed, and cannot be retracted twice or edited (D-94)', async () => {
    const h = await house();
    const est = await createConsignor(h.actor, { name: 'Estate', code: 'E1' });
    const shill = await h.bidder(7);
    const lot = await h.lot(1, est.id);
    await h.bid(lot.id, shill, 3000, T0 + 1000);
    const link = await linkBidder(h.actor, { consignorId: est.id, paddle: 7, reason: 'Typo: meant paddle 17' });
    expect(await linkedBids(h.org.id)).toHaveLength(1);

    await expect(retractLink(h.actor, { linkId: link.id, reason: ' ' })).rejects.toThrow(/reason/i);
    const r = await retractLink(h.actor, { linkId: link.id, reason: 'Wrong paddle' });
    expect(await linkedBids(h.org.id)).toEqual([]);
    expect(await db.consignorBidderLink.count()).toBe(1); // the link stays
    await expect(retractLink(h.actor, { linkId: link.id, reason: 'Again' })).rejects.toThrow(/already retracted/i);
    expect(await db.auditEvent.count({ where: { action: 'consignor.bidder_link_retracted' } })).toBe(1);

    const b = await house('other');
    await expect(retractLink(b.actor, { linkId: link.id, reason: 'x' })).rejects.toThrow(/no such link/i);
    await expect(db.$executeRawUnsafe(`DELETE FROM "ConsignorBidderLinkRetraction" WHERE "id" = $1::uuid`, r.id)).rejects.toThrow(/append-only/i);
    await h.bidder(8);
    const live = await linkBidder(h.actor, { consignorId: est.id, paddle: 8, reason: 'Agent' });
    await expect(db.consignorBidderLinkRetraction.create({ data: { orgId: b.org.id, linkId: live.id, reason: 'x', byUserId: b.actor.userId, createdAt: new Date(T0) } })).rejects.toThrow(/same_house|own house/i);
  });

  it('a retracted pair can be linked again; a second live link for a pair is refused (D-95)', async () => {
    const h = await house();
    const est = await createConsignor(h.actor, { name: 'Estate', code: 'E1' });
    const shill = await h.bidder(7);
    const lot = await h.lot(1, est.id);
    await h.bid(lot.id, shill, 3000, T0 + 1000);
    const first = await linkBidder(h.actor, { consignorId: est.id, paddle: 7, reason: 'Nephew' });
    await expect(linkBidder(h.actor, { consignorId: est.id, paddle: 7, reason: 'Again' })).rejects.toThrow(/already linked/i);
    await retractLink(h.actor, { linkId: first.id, reason: 'Retracted by mistake' });
    expect(await linkedBids(h.org.id)).toEqual([]);

    const second = await linkBidder(h.actor, { consignorId: est.id, paddle: 7, reason: 'Nephew, re-linked' });
    expect(second.id).not.toBe(first.id);
    expect(await linkedBids(h.org.id)).toHaveLength(1); // the bid is back in the report
    expect(await db.consignorBidderLink.count()).toBe(2); // both rows stay
    await expect(linkBidder(h.actor, { consignorId: est.id, paddle: 7, reason: 'Third' })).rejects.toThrow(/already linked/i);
    await expect(db.consignorBidderLink.create({ data: { orgId: h.org.id, consignorId: est.id, bidderId: shill, reason: 'raw', byUserId: h.actor.userId, createdAt: new Date(T0) } })).rejects.toThrow(/already linked|one_live/i);
  });
});
