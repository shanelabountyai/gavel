import { expect, type Page, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { closeLots } from '../src/auction/close';
import { placeBid, prismaTx } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';
import { seedDemo } from '../scripts/seed-demo';

// D-75 (AX-08): staff record a payment and the status moves; after the due date they declare a default, which offers the
// lot to the underbidder; accepting corrects the sale and the lot moves to the underbidder's invoice.
const T = Date.now();
let org: { id: string };
const user = async (email: string) => {
  const u = await db.user.upsert({ where: { email }, create: { email, isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: u.id } }, create: { orgId: org.id, userId: u.id, role: 'member' }, update: {} });
  return u;
};
const signIn = async (page: Page, email: string) => {
  await demoSignIn(page, email);
};

test.beforeAll(async () => {
  await seedDemo();
  org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
});

test('payment marks, default and the second-chance offer on the staff invoices page', async ({ page }) => {
  // Due yesterday, so the invoice is overdue from the start.
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E payment sale ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z'), paymentDueAt: new Date(T - 86_400_000) } });
  const end = new Date(T - 60_000);
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: `Payment lot ${T}`, startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const [win, under] = await Promise.all([`pay-win-${T}@acme.demo.test`, `pay-under-${T}@acme.demo.test`].map(user));
  const [a, b] = [await registerBidder(org.id, win!.id, 'member'), await registerBidder(org.id, under!.id, 'member')];
  const at = () => new Date(T - 600_000);
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: a.id, maxCents: 30000, idempotencyKey: `pay-${lot.id}-a` }, { now: at });
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: b.id, maxCents: 25000, idempotencyKey: `pay-${lot.id}-b` }, { now: at }); // price 255.00; B's own max 250.00
  await closeLots(new Date(T), prismaTx(db as unknown as Prisma.TransactionClient));

  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/auctions/${auction.id}/invoices`);
  const inv = page.getByTestId(`invoice-${a.paddle}`);
  await expect(inv.locator('.badge')).toHaveText('Overdue');
  await expect(inv.locator('tfoot')).toContainText('$280.50'); // 255.00 + 10%

  await inv.getByLabel('Amount received ($)').fill('80.50');
  await inv.getByLabel('Method').fill('check');
  await inv.getByRole('button', { name: 'Record payment' }).click();
  await expect(inv.locator('.badge')).toHaveText('Part paid');
  await expect(inv.locator('tfoot')).toContainText('$200.00'); // the balance
  await expect(inv.getByText('$80.50 by check')).toBeVisible();

  await inv.getByLabel('Reason').fill('Two reminders, no payment');
  await inv.getByRole('button', { name: 'Declare default' }).click();
  await expect(inv.locator('.badge')).toHaveText('In default');
  await expect(inv.getByText('Declared in default')).toBeVisible();
  const offer = page.getByTestId('offer-1');
  await expect(offer).toContainText('$250.00'); // D-44: B's last row reached 255.00, capped at B's own 250.00
  await expect(offer.locator('.badge')).toHaveText('Awaiting reply');

  await offer.getByRole('button', { name: 'Accept' }).click();
  await expect(offer.locator('.badge')).toHaveText('Accepted');
  await expect(page.getByTestId(`invoice-${b.paddle}`).locator('tfoot')).toContainText('$275.00'); // 250.00 + 10%
  await expect(inv.locator('tfoot')).toContainText('Credit due to buyer'); // 80.50 paid against no lots

  // The underbidder's own page shows the lot; the defaulter is suspended on the bidders page.
  await signIn(page, under!.email);
  await page.goto('/o/acme/invoices');
  await expect(page.locator('section.invoice', { hasText: auction.name })).toContainText('$275.00');
  await signIn(page, 'owner@acme.demo.test');
  await page.goto('/o/acme/bidders');
  await expect(page.getByTestId(`bidder-${a.paddle}`)).toContainText('Suspended');
});
