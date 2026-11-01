'use server';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { dollars } from '@/auction/dollars';
import { fromLocalInput, isTimeZone } from '@/auction/house-time';
import { loadRules } from '@/auction/load-rules';
import { createConsignor, setContract } from '@/auction/consignor';
import { decideRegistration } from '@/auction/registration';
import { checkLotFields, insertLot, relistLot } from '@/auction/relist';
import { parsePremium } from '@/auction/premium-text';
import { publishTerms } from '@/auction/terms';
import { audit } from '@/core/audit';
import { orgAction, ref } from '@/core/authz/action';
import { inOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { Prisma } from '@/generated/prisma/client';

// Task 3.1 (D-48). Staff only (owner/admin, results.write). Money is typed in dollars and parsed as text into whole
// cents (UX-15, D-79); a typed time is read in the sale's zone (R-12, D-84) and stored as the UTC instant it names.
const at = (tz: string, what = 'Give a date and time.') => z.string().transform((v, c) => {
  const d = fromLocalInput(v, tz);
  if (!d) c.addIssue({ code: 'custom', message: what });
  return d as Date;
});
const optionalAt = (tz: string) => z.union([z.literal('').transform(() => null), at(tz)]);
const wholeSeconds = z.string().regex(/^\d+$/, 'Stagger must be whole seconds.').transform(Number).pipe(z.number().int().max(86_400, 'Stagger cannot exceed a day.'));

export const createAuction = orgAction(
  'results.write',
  z.object({ name: z.string().trim().min(1, 'Give the auction a name.').max(120), timeZone: z.string().refine(isTimeZone, 'Pick a time zone the browser knows.'), opensAt: z.string(), firstCloseAt: z.string().default(''), staggerSeconds: z.string().default('0') }),
  async (ctx, raw) => {
    const parsed = z.object({ opensAt: at(raw.timeZone), firstCloseAt: optionalAt(raw.timeZone), staggerSeconds: wholeSeconds }).safeParse(raw);
    if (!parsed.success) throw new Refused(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    const i = { ...parsed.data, name: raw.name, timeZone: raw.timeZone };
    if (i.firstCloseAt && i.firstCloseAt <= i.opensAt) throw new Refused('The first close must be after the auction opens.');
    const { defaults: d, defaultTable } = loadRules().rules; // D-7: copied onto the row at creation (D-90: the table and the schedule too)
    const a = await db.$transaction(async (tx) => {
      const a = await tx.auction.create({ data: { ...inOrg(ctx), name: i.name, opensAt: i.opensAt, timeZone: i.timeZone, firstCloseAt: i.firstCloseAt, staggerSeconds: i.staggerSeconds, softCloseWindowSeconds: d.softCloseWindowSeconds, maxExtensionSeconds: d.maxExtensionSeconds, buyerPremiumBps: d.buyerPremiumBps, incrementTable: defaultTable, premiumBands: d.premiumBands.length > 1 ? d.premiumBands : Prisma.DbNull } });
      await audit(ctx, 'auction.created', { targetType: 'auction', targetId: a.id }, tx);
      return a;
    });
    redirect(`/o/${ctx.slug}/auctions/${a.id}`);
  },
);

// Creating a lot publishes it: the Lot and its LotState row (D-16) are written together, so it is in the
// catalog at once. Refusals mirror the DB's CHECKs and triggers (D-11) so the form says why; the DB still guards.
// The auction is looked up before the fields are read, so another org's id is a 404 whatever else is in the form (INV-02).
const lotFields = (tz: string) => z.object({
  title: z.string().trim().min(1, 'Give the lot a title.').max(200),
  consignorId: z.union([z.literal('').transform(() => null), z.uuid()]).default(null),
  startCents: dollars('Start price'),
  reserveCents: z.union([z.literal('').transform(() => null), dollars('Reserve')]).default(null),
  scheduledEnd: optionalAt(tz), // R-10: blank = the sale's first close + (number - 1) × stagger
});

export const createLot = orgAction(
  'results.write',
  z.object({ auctionId: ref('auction'), title: z.string(), consignorId: z.union([z.literal(''), ref('consignor')]).optional(), startCents: z.string(), reserveCents: z.string().optional(), scheduledEnd: z.string().default('') }),
  async (ctx, raw) => {
    const auction = await db.auction.findFirst({ where: { id: raw.auctionId, ...inOrg(ctx) } });
    if (!auction) notFound();
    const parsed = lotFields(auction.timeZone).safeParse(raw);
    if (!parsed.success) throw new Refused(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    const i = parsed.data;
    checkLotFields(auction, i);
    if (i.consignorId !== null && !(await db.consignor.findFirst({ where: { id: i.consignorId, ...inOrg(ctx) }, select: { id: true } }))) throw new Refused('No such consignor in this house.'); // D-74; INV-02
    const created = await db.$transaction((tx) => insertLot(tx, ctx, auction, i));
    redirect(`/o/${ctx.slug}/auctions/${auction.id}?new=${created.id}`); // UX-15: the page says "Lot N published" and marks the row
  },
);

// D-89 (AX-17): staff relist an unsold lot into a later sale. Both ids are looked up before the fields are read (INV-02);
// the price is retyped (a lower reserve is the usual reason), the close read in the target sale's zone (R-12).
export const relistLotAction = orgAction(
  'results.write',
  z.object({ lotId: ref('lot'), auctionId: ref('auction'), startCents: z.string(), reserveCents: z.string().optional(), scheduledEnd: z.string().default('') }),
  async (ctx, raw) => {
    const [lot, auction] = await Promise.all([
      db.lot.findFirst({ where: { id: raw.lotId, ...inOrg(ctx) }, select: { id: true } }),
      db.auction.findFirst({ where: { id: raw.auctionId, ...inOrg(ctx) }, select: { timeZone: true } }),
    ]);
    if (!lot || !auction) notFound();
    const parsed = lotFields(auction.timeZone).pick({ startCents: true, reserveCents: true, scheduledEnd: true }).safeParse(raw);
    if (!parsed.success) throw new Refused(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    const created = await relistLot(ctx, { lotId: raw.lotId, auctionId: raw.auctionId, ...parsed.data });
    redirect(`/o/${ctx.slug}/auctions/${raw.auctionId}?new=${created.id}`);
  },
);

// D-71 (AX-06): payment due date and pickup text, editable until the sale's first bid. The refusal here is the
// message; the Auction_terms_fixed_after_bid trigger is the guard (a bid committing between the two is refused there).
const termsFields = (tz: string) => z.object({
  paymentDueAt: optionalAt(tz),
  pickupText: z.string().trim().max(500),
  pickupWindowText: z.string().trim().max(200),
  // D-78 (AX-09): configuration, not advice; which base applies where the sale happens is a question for counsel.
  taxBps: z.string().regex(/^\d+$/, 'Sales tax must be whole basis points (825 = 8.25%).').transform(Number).pipe(z.number().int().max(10000, 'Sales tax cannot exceed 10,000 bps.')),
  taxBase: z.enum(['HAMMER', 'HAMMER_PLUS_PREMIUM']),
  requiresApproval: z.string().optional().transform((v) => v === 'on'), // D-88: an unticked checkbox posts nothing
});

export const updateSaleTerms = orgAction(
  'results.write',
  z.object({ auctionId: ref('auction'), paymentDueAt: z.string(), pickupText: z.string(), pickupWindowText: z.string(), taxBps: z.string(), taxBase: z.string(), requiresApproval: z.string().optional(), incrementTable: z.string().optional(), premium: z.string().optional() }),
  async (ctx, raw) => {
    const auction = await db.auction.findFirst({ where: { id: raw.auctionId, ...inOrg(ctx) } });
    if (!auction) notFound();
    const parsed = termsFields(auction.timeZone).safeParse(raw);
    if (!parsed.success) throw new Refused(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    // D-90 (R-18): the increment table and the buyer's premium; a form without the fields leaves them as they are.
    if (raw.incrementTable !== undefined && !(raw.incrementTable in loadRules().rules.tables)) throw new Refused('Pick one of the increment tables.');
    const premium = raw.premium === undefined ? undefined : parsePremium(raw.premium);
    if (premium && 'error' in premium) throw new Refused(premium.error);
    if (await db.bid.count({ where: { lot: { auctionId: auction.id } }, take: 1 })) throw new Refused('This sale has bids; payment, pickup, tax, approval, increment and premium terms are fixed.');
    await db.$transaction(async (tx) => {
      await tx.auction.update({ where: { id: auction.id }, data: {
        ...parsed.data,
        ...(raw.incrementTable !== undefined && { incrementTable: raw.incrementTable }),
        ...(premium && { buyerPremiumBps: premium.buyerPremiumBps, premiumBands: premium.premiumBands ?? Prisma.DbNull }),
      } });
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

// D-88 (AX-16): staff approve or decline a bidder's request for this sale. One form, two buttons; the note is optional
// on an approval (the card or deposit check done outside) and required on a decline, which decideRegistration enforces.
export const decideRegistrationAction = orgAction(
  'results.write',
  z.object({ auctionId: ref('auction'), bidderId: ref('bidder'), status: z.enum(['APPROVED', 'DECLINED']), note: z.string().max(500, 'Keep the note under 500 characters.') }),
  async (ctx, i) => {
    if (!(await db.auction.findFirst({ where: { id: i.auctionId, ...inOrg(ctx) }, select: { id: true } }))) notFound(); // INV-02
    if (!(await db.bidder.findFirst({ where: { id: i.bidderId, ...inOrg(ctx) }, select: { id: true } }))) notFound(); // INV-03
    await decideRegistration(ctx, i.auctionId, i.bidderId, i.status, i.note);
    redirect(`/o/${ctx.slug}/auctions/${i.auctionId}`);
  },
);

// D-74 (AX-07): consignors are reference data; a contract is an insert-only row per (consignor, sale), superseded by
// the next. Money fields are whole units (bps, cents) as every staff form here; the CHECKs are the guard.
export const createConsignorAction = orgAction(
  'results.write',
  z.object({ name: z.string().max(200, 'Keep the name under 200 characters.'), code: z.string().max(40, 'Keep the code under 40 characters.') }),
  async (ctx, i) => {
    await createConsignor(ctx, i);
    redirect(`/o/${ctx.slug}/consignors`);
  },
);

const whole = (label: string) => z.string().regex(/^\d+$/, `${label} must be a whole number.`).transform(Number).pipe(z.number().int().safe());
const contractFields = z.object({ commissionBps: whole('Commission (bps)'), lotFeeCents: whole('Lot fee (cents)'), unsoldFeeCents: whole('Unsold fee (cents)') });

export const setContractAction = orgAction(
  'results.write',
  z.object({ auctionId: ref('auction'), consignorId: ref('consignor'), commissionBps: z.string(), lotFeeCents: z.string(), unsoldFeeCents: z.string() }),
  async (ctx, raw) => {
    // Both ids are looked up before the fields are read, so another org's sale or consignor is a 404 whatever else is in the form (INV-02, INV-03).
    const [auction, consignor] = await Promise.all([
      db.auction.findFirst({ where: { id: raw.auctionId, ...inOrg(ctx) }, select: { id: true } }),
      db.consignor.findFirst({ where: { id: raw.consignorId, ...inOrg(ctx) }, select: { id: true } }),
    ]);
    if (!auction || !consignor) notFound();
    const parsed = contractFields.safeParse(raw);
    if (!parsed.success) throw new Refused(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    await setContract(ctx, { auctionId: raw.auctionId, consignorId: raw.consignorId, ...parsed.data });
    redirect(`/o/${ctx.slug}/auctions/${raw.auctionId}`);
  },
);
