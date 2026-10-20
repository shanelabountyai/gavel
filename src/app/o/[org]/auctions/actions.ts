'use server';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { loadRules } from '@/auction/load-rules';
import { openState } from '@/auction/engine/engine';
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
