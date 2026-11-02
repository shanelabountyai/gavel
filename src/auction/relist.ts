// D-89 (AX-17, R-17): relist an unsold lot in a later sale that has not opened. The new lot copies the original's
// catalogue fields and consignor, takes the price staff give it (a lower reserve is the usual reason to relist), and
// names the original in relistOfLotId. The original is untouched: its settlement, history and statement line stand,
// and they link forward. insertLot is createLot's write, shared so a relist is published exactly as a new lot is.
import { audit } from '@/core/audit';
import { now as clockNow } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { openState } from '@/auction/engine/engine';
import type { Auction, Prisma } from '@/generated/prisma/client';

type Actor = { readonly orgId: string; readonly userId: string };
type LotFields = { title: string; description?: string; imageUrl?: string | null; consignor?: string; consignorId: string | null; startCents: number; reserveCents: number | null; scheduledEnd: Date | null; relistOfLotId?: string } & Catalogue;
/** D-91 (AX-21): shown in the catalog and on the lot page; no rule reads them. */
type Catalogue = { estimateLowCents?: number | null; estimateHighCents?: number | null; conditionText?: string; category?: string; asIs?: boolean };

/** The Lot and its LotState row (D-16) together, numbered next in the sale; a blank close is first close + (number − 1) × stagger (R-10). */
export async function insertLot(tx: Prisma.TransactionClient, actor: Actor, auction: Auction, i: LotFields) {
  const top = await tx.lot.aggregate({ where: { auctionId: auction.id }, _max: { number: true } });
  const number = (top._max.number ?? 0) + 1;
  const scheduledEnd = i.scheduledEnd ?? new Date(auction.firstCloseAt!.getTime() + (number - 1) * auction.staggerSeconds * 1000);
  const s = openState({ startCents: i.startCents, reserveCents: i.reserveCents, opensAtMs: auction.opensAt.getTime(), scheduledEndMs: scheduledEnd.getTime(), softCloseWindowMs: auction.softCloseWindowSeconds * 1000, maxExtensionMs: auction.maxExtensionSeconds * 1000, buyerPremiumBps: auction.buyerPremiumBps });
  const lot = await tx.lot.create({
    data: {
      orgId: actor.orgId, auctionId: auction.id, number, title: i.title, description: i.description, imageUrl: i.imageUrl, consignor: i.consignor, consignorId: i.consignorId, startCents: i.startCents, reserveCents: i.reserveCents, scheduledEnd, relistOfLotId: i.relistOfLotId,
      estimateLowCents: i.estimateLowCents, estimateHighCents: i.estimateHighCents, conditionText: i.conditionText, category: i.category, asIs: i.asIs,
      state: { create: { orgId: actor.orgId, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: s.bidCount, acceptedCount: s.acceptedCount, closesAt: new Date(s.closesAtMs), extensionCount: s.extensionCount } },
    },
  });
  await audit(actor, i.relistOfLotId ? 'lot.relisted' : 'lot.created', { targetType: 'lot', targetId: lot.id, data: i.relistOfLotId ? { relistOf: i.relistOfLotId } : undefined }, tx);
  return lot;
}

/** Validates a lot's price and close against its sale; the CHECKs and Lot_ends_after_open are the guard. */
export function checkLotFields(auction: Auction, i: Pick<LotFields, 'startCents' | 'reserveCents' | 'scheduledEnd' | 'estimateLowCents' | 'estimateHighCents'>) {
  if (i.startCents < 1) throw new Refused('Start price must be above zero.');
  if (i.reserveCents !== null && i.reserveCents < i.startCents) throw new Refused('Reserve must be at least the start price.');
  if ((i.estimateLowCents == null) !== (i.estimateHighCents == null)) throw new Refused('Give both ends of the estimate, or neither.');
  if (i.estimateLowCents != null && i.estimateLowCents > i.estimateHighCents!) throw new Refused('The low estimate cannot be above the high.');
  if (i.scheduledEnd === null && auction.firstCloseAt === null) throw new Refused('Give a close time, or set a first close and stagger on the sale.');
  if (i.scheduledEnd !== null && i.scheduledEnd <= auction.opensAt) throw new Refused('The lot must close after the auction opens.');
}

/** Staff relist an unsold lot into a sale of the house that has not opened. Refusals mirror the Lot_relist_of_unsold trigger. */
export async function relistLot(actor: Actor, input: { lotId: string; auctionId: string; startCents: number; reserveCents: number | null; scheduledEnd: Date | null }, deps: { now?: () => Date } = {}) {
  const now = deps.now ?? clockNow;
  const [orig, auction] = await Promise.all([
    db.lot.findFirst({ where: { id: input.lotId, orgId: actor.orgId }, include: { relistedAs: { select: { number: true, auction: { select: { name: true } } } }, settlements: { select: { id: true, supersedesId: true, outcome: true } } } }),
    db.auction.findFirst({ where: { id: input.auctionId, orgId: actor.orgId } }),
  ]);
  if (!orig || !auction) throw new Refused('No such lot or sale in this house.');
  const superseded = new Set(orig.settlements.map((x) => x.supersedesId));
  const current = orig.settlements.find((x) => !superseded.has(x.id)); // the row nothing supersedes (D-44)
  if (!current) throw new Refused('Only a settled lot can be relisted; this one has not settled yet.');
  if (!current.outcome.startsWith('UNSOLD')) throw new Refused('This lot sold. Only an unsold lot can be relisted.');
  if (orig.relistedAs) throw new Refused(`Already relisted as lot ${orig.relistedAs.number} in ${orig.relistedAs.auction.name}.`);
  if (auction.id === orig.auctionId) throw new Refused('Relist into a later sale, not the one the lot was in.');
  if (auction.opensAt <= now()) throw new Refused(`${auction.name} has already opened. Relist into a sale that has not.`);
  checkLotFields(auction, input);
  // ponytail: two staff relisting the same lot at once both pass the check above; the unique index on relistOfLotId refuses the loser with a plain error. Not the bid path, no retry.
  return db.$transaction((tx) => insertLot(tx, actor, auction, { title: orig.title, description: orig.description, imageUrl: orig.imageUrl, consignor: orig.consignor, consignorId: orig.consignorId, estimateLowCents: orig.estimateLowCents, estimateHighCents: orig.estimateHighCents, conditionText: orig.conditionText, category: orig.category, asIs: orig.asIs, startCents: input.startCents, reserveCents: input.reserveCents, scheduledEnd: input.scheduledEnd, relistOfLotId: orig.id }));
}
