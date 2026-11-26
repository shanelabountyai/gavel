import { moduleExportTables } from '@/app/modules';
import type { ExportTable } from '@/core/tenancy/export';

// Clone-owned (v1.6.0), like org-hooks.ts: which tables a data export holds beyond the template's core ones
// (addendum §5). Add one entry per org-owned table, selecting only columns that are safe to hand over: never a
// sealed column, token hash or recovery code (INV-34 scans the output). Every query runs inside withOrg.
//   { name: 'Booking', rows: (tx, orgId) => tx.booking.findMany({ where: { orgId }, select: { id: true, startsAt: true } }) },
// Gavel (D-102): every org-owned table, explicit columns. Left out as hash/token-shaped (INV-34's 64-hex scan, and not
// the owner's data): AuctionTerms.sha256, TermsAcceptance.termsSha256, Settlement.rulesHash, Bid.idempotencyKey.
export const exportTables: readonly ExportTable[] = [
  ...moduleExportTables,
  { name: 'Auction', rows: (tx, orgId) => tx.auction.findMany({ where: { orgId }, select: { id: true, name: true, softCloseWindowSeconds: true, maxExtensionSeconds: true, buyerPremiumBps: true, opensAt: true, paymentDueAt: true, pickupText: true, pickupWindowText: true, taxBps: true, taxBase: true, timeZone: true, firstCloseAt: true, staggerSeconds: true, requiresApproval: true, incrementTable: true, premiumBands: true, createdAt: true, updatedAt: true } }) },
  { name: 'AuctionRegistration', rows: (tx, orgId) => tx.auctionRegistration.findMany({ where: { orgId }, select: { id: true, auctionId: true, bidderId: true, version: true, status: true, note: true, byUserId: true, recordedAt: true } }) },
  { name: 'AuctionTerms', rows: (tx, orgId) => tx.auctionTerms.findMany({ where: { orgId }, select: { id: true, auctionId: true, version: true, text: true, byUserId: true, publishedAt: true } }) },
  { name: 'TermsAcceptance', rows: (tx, orgId) => tx.termsAcceptance.findMany({ where: { orgId }, select: { id: true, auctionId: true, bidderId: true, acceptedAt: true } }) },
  { name: 'Lot', rows: (tx, orgId) => tx.lot.findMany({ where: { orgId }, select: { id: true, auctionId: true, number: true, title: true, description: true, imageUrl: true, consignor: true, consignorId: true, relistOfLotId: true, startCents: true, reserveCents: true, estimateLowCents: true, estimateHighCents: true, conditionText: true, category: true, asIs: true, scheduledEnd: true, createdAt: true } }) },
  { name: 'Consignor', rows: (tx, orgId) => tx.consignor.findMany({ where: { orgId }, select: { id: true, name: true, code: true, createdAt: true } }) },
  { name: 'ConsignmentContract', rows: (tx, orgId) => tx.consignmentContract.findMany({ where: { orgId }, select: { id: true, consignorId: true, auctionId: true, supersedesId: true, commissionBps: true, lotFeeCents: true, unsoldFeeCents: true, byUserId: true, createdAt: true } }) },
  { name: 'LotState', rows: (tx, orgId) => tx.lotState.findMany({ where: { orgId }, select: { lotId: true, priceCents: true, leaderBidderId: true, leaderMaxCents: true, leaderSeq: true, bidCount: true, acceptedCount: true, closesAt: true, extensionCount: true } }) },
  { name: 'LotWithdrawal', rows: (tx, orgId) => tx.lotWithdrawal.findMany({ where: { orgId }, select: { id: true, lotId: true, reason: true, byUserId: true, withdrawnAt: true } }) },
  { name: 'Bidder', rows: (tx, orgId) => tx.bidder.findMany({ where: { orgId }, select: { id: true, userId: true, paddle: true, status: true, taxExemptRef: true, createdAt: true } }) },
  { name: 'Watch', rows: (tx, orgId) => tx.watch.findMany({ where: { orgId }, select: { id: true, bidderId: true, lotId: true, notifiedClosesAt: true, createdAt: true } }) },
  { name: 'ConsignorBidderLink', rows: (tx, orgId) => tx.consignorBidderLink.findMany({ where: { orgId }, select: { id: true, consignorId: true, bidderId: true, reason: true, byUserId: true, createdAt: true } }) },
  { name: 'ConsignorBidderLinkRetraction', rows: (tx, orgId) => tx.consignorBidderLinkRetraction.findMany({ where: { orgId }, select: { id: true, linkId: true, reason: true, byUserId: true, createdAt: true } }) },
  { name: 'BidderStatusChange', rows: (tx, orgId) => tx.bidderStatusChange.findMany({ where: { orgId }, select: { id: true, bidderId: true, status: true, reason: true, byUserId: true, changedAt: true } }) },
  { name: 'Bid', rows: (tx, orgId) => tx.bid.findMany({ where: { orgId }, select: { id: true, lotId: true, seq: true, bidderId: true, maxCents: true, placedAt: true, outcome: true, accepted: true, priceBeforeCents: true, priceAfterCents: true, leaderBeforeId: true, leaderAfterId: true, closesAtBefore: true, closesAtAfter: true, extended: true, voidReason: true, voidByUserId: true } }) },
  { name: 'Settlement', rows: (tx, orgId) => tx.settlement.findMany({ where: { orgId }, select: { id: true, lotId: true, supersedesId: true, reason: true, correctedByUserId: true, consignorApprovalRef: true, premiumBps: true, premiumBands: true, outcome: true, winnerBidderId: true, winningSeq: true, hammerCents: true, premiumCents: true, totalCents: true, closedAt: true, createdAt: true } }) },
  { name: 'PaymentMark', rows: (tx, orgId) => tx.paymentMark.findMany({ where: { orgId }, select: { id: true, auctionId: true, bidderId: true, amountCents: true, method: true, byUserId: true, markedAt: true } }) },
  { name: 'BuyerDefault', rows: (tx, orgId) => tx.buyerDefault.findMany({ where: { orgId }, select: { id: true, auctionId: true, bidderId: true, reason: true, byUserId: true, declaredAt: true } }) },
  { name: 'SecondChanceOffer', rows: (tx, orgId) => tx.secondChanceOffer.findMany({ where: { orgId }, select: { id: true, defaultId: true, lotId: true, bidderId: true, priceCents: true, premiumBps: true, expiresAt: true, createdAt: true } }) },
  { name: 'OfferResponse', rows: (tx, orgId) => tx.offerResponse.findMany({ where: { orgId }, select: { id: true, offerId: true, response: true, byUserId: true, respondedAt: true } }) },
];

// An org-owned table left out on purpose, with the reason. INV-34 fails on any model with an orgId column that is in
// neither list, so a new table cannot silently drop out of every export.
export const exportSkipped: Readonly<Record<string, string>> = {};
