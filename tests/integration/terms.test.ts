// D-72 (AX-03): terms of sale are versioned and insert-only; a bidder accepts a version by hash; placeBid refuses at
// the boundary until the sale's latest version is accepted. The engine, the ledger and the fixtures are untouched.
import { beforeEach, describe, expect, it } from 'vitest';
import { openState } from '@/auction/engine/engine';
import { placeBid } from '@/auction/place-bid';
import { acceptTerms, acceptancesFor, publishTerms, sha256, unacceptedTermsSha } from '@/auction/terms';
import { db } from '@/core/db';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

beforeEach(resetAuthTables);

const T0 = Date.UTC(2026, 0, 1);
async function setup() {
  const org = await makeOrg();
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'A', softCloseWindowSeconds: 0, maxExtensionSeconds: 0, buyerPremiumBps: 1000, opensAt: new Date(T0) } });
  const s = openState({ startCents: 10000, reserveCents: null, opensAtMs: T0, scheduledEndMs: T0 + 3_600_000, softCloseWindowMs: 0, maxExtensionMs: 0, buyerPremiumBps: 1000 });
  const lot = await db.lot.create({ data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'L', startCents: 10000, scheduledEnd: new Date(T0 + 3_600_000),
    state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: 0, acceptedCount: 0, closesAt: new Date(s.closesAtMs), extensionCount: 0 } } } });
  const u = await db.user.create({ data: { email: 'b1@example.test' } });
  const bidder = await db.bidder.create({ data: { orgId: org.id, userId: u.id, paddle: 1 } });
  const actor = { orgId: org.id, userId: crypto.randomUUID() };
  const bid = (key: string) => placeBid({ orgId: org.id, lotId: lot.id, bidderId: bidder.id, maxCents: 12000, idempotencyKey: key }, { now: () => new Date(T0 + 60_000) });
  return { org, auction, lot, bidder, actor, bid };
}

describe('terms of sale (D-72)', () => {
  it('versions count up, the hash is of the trimmed text, and a repeat acceptance is the same row', async () => {
    const { auction, bidder, actor, org } = await setup();
    const v1 = await publishTerms(actor, auction.id, '  As is, where is. \n');
    expect([v1.version, v1.text, v1.sha256]).toEqual([1, 'As is, where is.', sha256('As is, where is.')]);
    const v2 = await publishTerms(actor, auction.id, 'As is, where is. Payment in 7 days.');
    expect(v2.version).toBe(2);
    const a = await acceptTerms(org.id, bidder.id, auction.id);
    const b = await acceptTerms(org.id, bidder.id, auction.id);
    expect(b.id).toBe(a.id);
    expect(a.termsSha256).toBe(v2.sha256);
    expect(await db.termsAcceptance.count()).toBe(1);
    expect((await acceptancesFor(auction.id)).map((r) => [r.paddle, r.version])).toEqual([[1, 2]]);
    expect((await db.auditEvent.findMany({ where: { targetId: auction.id } })).map((e) => e.action)).toEqual(['auction.terms_published', 'auction.terms_published']);
  });

  it('placeBid: no terms asks nothing; unaccepted terms are TERMS_NOT_ACCEPTED with nothing written; a new version re-asks', async () => {
    const { auction, bidder, actor, org, bid, lot } = await setup();
    const other = await makeOrg('other');
    await expect(unacceptedTermsSha(auction.id, bidder.id)).resolves.toBeNull();
    const v1 = await publishTerms(actor, auction.id, 'v1');
    await expect(unacceptedTermsSha(auction.id, bidder.id)).resolves.toBe(v1.sha256);
    await expect(bid('k1')).rejects.toMatchObject({ name: 'BidError', code: 'TERMS_NOT_ACCEPTED', retryable: false });
    expect(await db.bid.count()).toBe(0);
    await expect(acceptTerms(other.id, bidder.id, auction.id)).rejects.toThrow(/no terms/); // another house cannot accept for its bidder
    await acceptTerms(org.id, bidder.id, auction.id);
    const v2 = await publishTerms(actor, auction.id, 'v2');
    await expect(unacceptedTermsSha(auction.id, bidder.id)).resolves.toBe(v2.sha256); // accepted v1 does not cover v2
    await expect(bid('k2')).rejects.toMatchObject({ code: 'TERMS_NOT_ACCEPTED' });
    await acceptTerms(org.id, bidder.id, auction.id);
    await expect(bid('k3')).resolves.toMatchObject({ outcome: 'ACCEPTED_LEAD', accepted: true });
    expect(await db.bid.count({ where: { lotId: lot.id } })).toBe(1);
  });

  it('terms are fixed once the sale has a bid: the action refuses, and so does the trigger under it', async () => {
    const { auction, actor, org, bid } = await setup();
    await bid('k1');
    await expect(publishTerms(actor, auction.id, 'late')).rejects.toThrow(/has bids/);
    await expect(db.auctionTerms.create({ data: { orgId: org.id, auctionId: auction.id, version: 1, text: 'late', sha256: sha256('late'), byUserId: actor.userId, publishedAt: new Date(T0) } })).rejects.toThrow(/terms of sale are fixed/);
    expect(await db.auctionTerms.count()).toBe(0);
  });

  it('blank text and another house are refused; both tables refuse UPDATE and DELETE', async () => {
    const { auction, bidder, actor, org } = await setup();
    await expect(publishTerms(actor, auction.id, '   ')).rejects.toThrow(/text/);
    const other = await makeOrg('other');
    await expect(publishTerms({ ...actor, orgId: other.id }, auction.id, 'x')).rejects.toThrow(/No such sale/);
    const t = await publishTerms(actor, auction.id, 'x');
    const a = await acceptTerms(org.id, bidder.id, auction.id);
    await expect(db.$executeRaw`UPDATE "AuctionTerms" SET "text" = 'edited' WHERE "id" = ${t.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM "AuctionTerms" WHERE "id" = ${t.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`UPDATE "TermsAcceptance" SET "termsSha256" = 'x' WHERE "id" = ${a.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM "TermsAcceptance" WHERE "id" = ${a.id}::uuid`).rejects.toThrow(/append-only/);
  });
});
