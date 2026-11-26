import { createHash } from 'node:crypto';
import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';

// D-72 (AX-03). Terms of sale are versioned, insert-only rows named by the sha256 of their text; a bidder accepts one
// version, and placeBid refuses at its boundary until the sale's latest version has that bidder's acceptance. None of
// this is the bid path: the acceptance is written here, before the lock, never inside it (non-negotiable 2).

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The latest version of a sale's terms, or null when the sale has none (and asks nothing). */
export const currentTerms = (auctionId: string) => db.auctionTerms.findFirst({ where: { auctionId }, orderBy: { version: 'desc' } });

/** Staff publish a new version: max + 1. Refused once the sale has a bid (the trigger is the guard, this is the message). */
export async function publishTerms(actor: { orgId: string; userId: string }, auctionId: string, text: string) {
  const body = text.trim();
  if (!body) throw new Refused('Give the terms some text.');
  const auction = await db.auction.findFirst({ where: { id: auctionId, orgId: actor.orgId }, select: { id: true } });
  if (!auction) throw new Refused('No such sale in this house.');
  if (await db.bid.count({ where: { lot: { auctionId } }, take: 1 })) throw new Refused('This sale has bids; the terms of sale are fixed.');
  return db.$transaction(async (tx) => {
    const top = await tx.auctionTerms.aggregate({ where: { auctionId }, _max: { version: true } });
    // ponytail: two staff publishing at once hit the (auctionId, version) index and the loser sees a plain error; not the bid path, no retry
    const row = await tx.auctionTerms.create({ data: { orgId: actor.orgId, auctionId, version: (top._max.version ?? 0) + 1, text: body, sha256: sha256(body), byUserId: actor.userId, publishedAt: now() } });
    await audit(actor, 'auction.terms_published', { targetType: 'auction', targetId: auctionId, data: { version: row.version, sha256: row.sha256 } }, tx);
    return row;
  });
}

/** A bidder accepts the sale's current terms. Idempotent: the unique index makes a repeat the same row. */
export async function acceptTerms(orgId: string, bidderId: string, auctionId: string) {
  const terms = await currentTerms(auctionId);
  if (!terms || terms.orgId !== orgId) throw new Refused('This sale has no terms to accept.');
  const key = { auctionId, bidderId, termsSha256: terms.sha256 };
  const prior = await db.termsAcceptance.findUnique({ where: { auctionId_bidderId_termsSha256: key } });
  if (prior) return prior;
  try {
    return await db.termsAcceptance.create({ data: { orgId, ...key, acceptedAt: now() } });
  } catch (e) {
    if ((e as { code?: string })?.code !== 'P2002') throw e;
    return (await db.termsAcceptance.findUnique({ where: { auctionId_bidderId_termsSha256: key } }))!;
  }
}

/** For placeBid's boundary: the sha of the sale's latest terms when this bidder has not accepted it, else null. One query. */
export async function unacceptedTermsSha(auctionId: string, bidderId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ sha256: string; accepted: boolean }[]>`
    SELECT t."sha256", EXISTS (SELECT 1 FROM "TermsAcceptance" a WHERE a."auctionId" = t."auctionId" AND a."bidderId" = ${bidderId}::uuid AND a."termsSha256" = t."sha256") AS "accepted"
    FROM "AuctionTerms" t WHERE t."auctionId" = ${auctionId}::uuid ORDER BY t."version" DESC LIMIT 1`;
  const t = rows[0];
  return t && !t.accepted ? t.sha256 : null;
}

/** Who accepted which version of a sale's terms: the staff view on the auction page and the lot's dispute view. */
export async function acceptancesFor(auctionId: string, bidderIds?: readonly string[]) {
  const [terms, rows] = await Promise.all([
    db.auctionTerms.findMany({ where: { auctionId }, select: { version: true, sha256: true } }),
    db.termsAcceptance.findMany({ where: { auctionId, ...(bidderIds ? { bidderId: { in: [...bidderIds] } } : {}) }, orderBy: { acceptedAt: 'asc' }, include: { bidder: { select: { paddle: true } } } }),
  ]);
  const version = new Map(terms.map((t) => [t.sha256, t.version]));
  return rows.map((r) => ({ bidderId: r.bidderId, paddle: r.bidder.paddle, version: version.get(r.termsSha256) ?? null, sha256: r.termsSha256, acceptedAt: r.acceptedAt }));
}
