import { expect, type Page, test } from '@playwright/test';
import { registerBidder } from '../src/auction/bidder';
import { closeLots } from '../src/auction/close';
import { placeBid, prismaTx } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';
import { seedDemo } from '../scripts/seed-demo';

// D-71 (AX-06): staff set payment due and pickup before the first bid; the winner sees their own invoice with them,
// another bidder sees none of it; once the sale has a bid the terms are shown fixed.
const T = Date.now();
let org: { id: string };
const user = async (email: string) => {
  const u = await db.user.upsert({ where: { email }, create: { email, isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: u.id } }, create: { orgId: org.id, userId: u.id, role: 'member' }, update: {} });
  return u;
};
const signIn = async (page: Page, email: string) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: email }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/demo'));
};

test.beforeAll(async () => {
  await seedDemo();
  org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
});

test('terms set by staff reach the winner\'s invoice, and only the winner\'s', async ({ page }) => {
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E invoice sale ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const end = new Date(T - 60_000);
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: `Invoice lot ${T}`, startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });

  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/auctions/${auction.id}`);
  await page.getByLabel('Payment due').fill('2030-03-15T17:00');
  await page.getByLabel('Pickup instructions').fill('Barn 2, 14 Mill Road');
  await page.getByLabel('Pickup window').fill('Sat 9:00–12:00');
  await page.getByRole('button', { name: 'Save payment and pickup' }).click();
  await expect(page.getByLabel('Pickup instructions')).toHaveValue('Barn 2, 14 Mill Road');

  const [win, lose] = await Promise.all([`inv-win-${T}@acme.demo.test`, `inv-lose-${T}@acme.demo.test`].map(user));
  const [a, b] = [await registerBidder(org.id, win!.id, 'member'), await registerBidder(org.id, lose!.id, 'member')];
  const at = () => new Date(T - 600_000);
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: a.id, maxCents: 30000, idempotencyKey: `inv-${lot.id}-a` }, { now: at });
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: b.id, maxCents: 25000, idempotencyKey: `inv-${lot.id}-b` }, { now: at });
  await closeLots(new Date(T), prismaTx(db as unknown as Prisma.TransactionClient));

  await page.goto(`/o/acme/auctions/${auction.id}`);
  await expect(page.getByText('Fixed: the sale has bids.')).toBeVisible();
  await expect(page.getByLabel('Pickup instructions')).toHaveCount(0);

  await signIn(page, win!.email);
  await page.getByRole('link', { name: 'Your invoices' }).first().click();
  const inv = page.locator('section.invoice', { hasText: auction.name });
  await expect(inv).toContainText('Payment due 2030-03-15 17:00 UTC');
  await expect(inv).toContainText('Pickup: Barn 2, 14 Mill Road, Sat 9:00–12:00');
  await expect(inv).toContainText(lot.title);
  await expect(inv.locator('tfoot')).toContainText('$280.50'); // hammer 255.00 + 10% premium

  await signIn(page, lose!.email);
  await page.goto('/o/acme/invoices');
  await expect(page.getByText('no lots won yet')).toBeVisible();
  await expect(page.getByText(lot.title)).toHaveCount(0);
});
