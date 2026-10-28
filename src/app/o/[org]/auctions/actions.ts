'use server';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { loadRules } from '@/auction/load-rules';
import { openState } from '@/auction/engine/engine';
import { publishTerms } from '@/auction/terms';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';

// Task 3.1 (D-48). Staff only (owner/admin, results.write). Money is whole cents; times are UTC.
const utc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Give a date and time.').transform((v) => new Date(`${v}:00Z`));
const cents = (label: string) => z.string().regex(/^\d+$/, `${label} must be whole cents.`).transform(Number).pipe(z.number().int().safe());

export const createAuction = orgAction(
  'results.write',
  z.object({ name: z.string().trim().min(1, 'Give the auction a name.').max(120), opensAt: utc }),
  async (ctx, i) => {
    const d = loadRules().rules.defaults; // D-7: copied onto the row at creation
    const a = await db.$transaction(async (tx) => {
      const a = await tx.auction.create({ data: { ...inOrg(ctx), name: i.name, opensAt: i.opensAt, softCloseWindowSeconds: d.softCloseWindowSeconds, maxExtensionSeconds: d.maxExtensionSeconds, buyerPremiumBps: d.buyerPremiumBps } });
      await audit(ctx, 'auction.created', { targetType: 'auction', targetId: a.id }, tx);
      return a;
    });
    redirect(`/o/${ctx.slug}/auctions/${a.id}`);
  },
);

// Creating a lot publishes it: the Lot and its LotState row (D-16) are written together, so it is in the
// catalog at once. Refusals mirror the DB's CHECKs and triggers (D-11) so the form says why; the DB still guards.
// Creating a lot publishes it: the Lot and its LotState row (D-16) are written together, so it is in the
// catalog at once. Refusals mirror the DB's CHECKs and triggers (D-11) so the form says why; the DB still guards.
// The auction is looked up before the fields are read, so another org's id is a 404 whatever else is in the form (INV-02).
const lotFields = z.object({
  title: z.string().trim().min(1, 'Give the lot a title.').max(200),
  consignor: z.string().trim().max(200).default(''),
  startCents: cents('Start price'),
  reserveCents: z.union([z.literal('').transform(() => null), cents('Reserve')]).default(null),
  scheduledEnd: utc,
});

export const createLot = orgAction(
  'results.write',
  z.object({ auctionId: ref('auction'), title: z.string(), consignor: z.string().optional(), startCents: z.string(), reserveCents: z.string().optional(), scheduledEnd: z.string() }),
  async (ctx, raw) => {
    const auction = await db.auction.findFirst({ where: { id: raw.auctionId, ...inOrg(ctx) } });
    if (!auction) notFound();
    const parsed = lotFields.safeParse(raw);
    if (!parsed.success) throw new Refused(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    const i = parsed.data;
    if (i.startCents < 1) throw new Refused('Start price must be above zero.');
    if (i.reserveCents !== null && i.reserveCents < i.startCents) throw new Refused('Reserve must be at least the start price.');
    if (i.scheduledEnd <= auction.opensAt) throw new Refused('The lot must close after the auction opens.');
    const s = openState({ startCents: i.startCents, reserveCents: i.reserveCents, opensAtMs: auction.opensAt.getTime(), scheduledEndMs: i.scheduledEnd.getTime(), softCloseWindowMs: auction.softCloseWindowSeconds * 1000, maxExtensionMs: auction.maxExtensionSeconds * 1000, buyerPremiumBps: auction.buyerPremiumBps });
    await db.$transaction(async (tx) => {
      const top = await tx.lot.aggregate({ where: { auctionId: auction.id }, _max: { number: true } });
      const lot = await tx.lot.create({
        data: {
          ...inOrg(ctx), auctionId: auction.id, number: (top._max.number ?? 0) + 1, title: i.title, consignor: i.consignor, startCents: i.startCents, reserveCents: i.reserveCents, scheduledEnd: i.scheduledEnd,
          state: { create: { ...inOrg(ctx), priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: s.bidCount, acceptedCount: s.acceptedCount, closesAt: new Date(s.closesAtMs), extensionCount: s.extensionCount } },
        },
      });
      await audit(ctx, 'lot.created', { targetType: 'lot', targetId: lot.id }, tx);
    });
    redirect(`/o/${ctx.slug}/auctions/${auction.id}`);
  },
);

// D-71 (AX-06): payment due date and pickup text, editable until the sale's first bid. The refusal here is the
// message; the Auction_terms_fixed_after_bid trigger is the guard (a bid committing between the two is refused there).
const termsFields = z.object({
  paymentDueAt: z.union([z.literal('').transform(() => null), utc]),
  pickupText: z.string().trim().max(500),
  pickupWindowText: z.string().trim().max(200),
});

export const updateSaleTerms = orgAction(
  'results.write',
  z.object({ auctionId: ref('auction'), paymentDueAt: z.string(), pickupText: z.string(), pickupWindowText: z.string() }),
  async (ctx, raw) => {
    const auction = await db.auction.findFirst({ where: { id: raw.auctionId, ...inOrg(ctx) } });
    if (!auction) notFound();
    const parsed = termsFields.safeParse(raw);
    if (!parsed.success) throw new Refused(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    if (await db.bid.count({ where: { lot: { auctionId: auction.id } }, take: 1 })) throw new Refused('This sale has bids; payment and pickup terms are fixed.');
    await db.$transaction(async (tx) => {
      await tx.auction.update({ where: { id: auction.id }, data: parsed.data });
      await audit(ctx, 'auction.terms_updated', { targetType: 'auction', targetId: auction.id }, tx);
    });
    redirect(`/o/${ctx.slug}/auctions/${auction.id}`);
  },
);

// D-72 (AX-03): a new version of the terms of sale, fixed once the sale has a bid. publishTerms refuses with the
// message; the AuctionTerms_fixed_after_bid trigger is the guard.
export const publishTermsAction = orgAction(
  'results.write',
  z.object({ auctionId: ref('auction'), text: z.string().max(20_000, 'Keep the terms under 20,000 characters.') }),
  async (ctx, i) => {
    if (!(await db.auction.findFirst({ where: { id: i.auctionId, ...inOrg(ctx) }, select: { id: true } }))) notFound(); // INV-02
    await publishTerms(ctx, i.auctionId, i.text);
    redirect(`/o/${ctx.slug}/auctions/${i.auctionId}`);
  },
);
