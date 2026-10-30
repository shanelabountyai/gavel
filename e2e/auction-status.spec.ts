import { expect, type Page, test } from '@playwright/test';
import { registerBidder } from '../src/auction/bidder';
import { closeLots } from '../src/auction/close';
import { placeBid, prismaTx } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';
import { seedDemo } from '../scripts/seed-demo';

// UX-16 (R16): the auctions list and the sale's lot table carry a derived status; a closed lot reads "awaiting settlement"
// until auction:close, then "Settled: …". UX-17 (R17): before any settlement the invoices page says so; after it, unsold
// lots are listed with their outcome and each lot links to its history.
const T = Date.now();
let org: { id: string };
const signIn = async (page: Page, email: string) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: email }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/demo'));
};

test.beforeAll(async () => {
  await seedDemo();
  org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
});

test('lot and sale status before and after settlement; unsold lots on the invoices page', async ({ page }) => {
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E status sale ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const mk = (number: number, end: Date, reserveCents: number | null = null) => db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number, title: `Status lot ${number} ${T}`, startCents: 10000, reserveCents, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const past = new Date(T - 60_000);
  const [sold, noBids, underReserve, open] = [await mk(1, past), await mk(2, past), await mk(3, past, 90_000), await mk(4, new Date(T + 3_600_000))];
  const u = await db.user.upsert({ where: { email: `status-${T}@acme.demo.test` }, create: { email: `status-${T}@acme.demo.test`, isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: u.id } }, create: { orgId: org.id, userId: u.id, role: 'member' }, update: {} });
  const b = await registerBidder(org.id, u.id, 'member');
  const at = () => new Date(T - 600_000);
  await placeBid({ orgId: org.id, lotId: sold.id, bidderId: b.id, maxCents: 25000, idempotencyKey: `st-${sold.id}` }, { now: at });
  await placeBid({ orgId: org.id, lotId: underReserve.id, bidderId: b.id, maxCents: 25000, idempotencyKey: `st-${underReserve.id}` }, { now: at });

  await signIn(page, 'owner@acme.demo.test');
  await page.goto('/o/acme/auctions');
  await expect(page.locator('li', { hasText: auction.name }).locator('.badge')).toHaveText('Open'); // lot 4 is still open

  await page.goto(`/o/acme/auctions/${auction.id}`);
  const status = (n: number) => page.getByTestId(`lot-row-${n}`).getByTestId('lot-status');
  await expect(status(1)).toHaveText('Closed, awaiting settlement');
  await expect(status(2)).toHaveText('Closed, awaiting settlement');
  await expect(status(4)).toHaveText('Open');
  await expect(page.getByTestId('lot-row-1')).toContainText('$100.00'); // current price and one bid
  await expect(page.getByTestId('lot-row-2')).toContainText('—');

  await page.goto(`/o/acme/auctions/${auction.id}/invoices`);
  await expect(page.getByTestId('no-settlement')).toContainText('No lots settled yet');
  await expect(page.getByTestId('not-sold')).toHaveCount(0);

  await closeLots(new Date(T), prismaTx(db as unknown as Prisma.TransactionClient));

  await page.goto(`/o/acme/auctions/${auction.id}`);
  await expect(status(1)).toHaveText('Settled: Sold');
  await expect(status(2)).toHaveText('Settled: No bids');
  await expect(status(3)).toHaveText('Settled: Reserve not met');
  await expect(status(4)).toHaveText('Open');

  await page.goto(`/o/acme/auctions/${auction.id}/invoices`);
  await expect(page.getByTestId('no-settlement')).toHaveCount(0);
  const notSold = page.getByTestId('not-sold');
  await expect(notSold.locator('tbody tr')).toHaveCount(2);
  await expect(notSold).toContainText('No bids');
  await expect(notSold).toContainText('Reserve not met');
  await notSold.getByRole('link', { name: noBids.title }).click();
  await expect(page).toHaveURL(new RegExp(`/lots/${noBids.id}/history$`));
  await expect(page.getByRole('link', { name: open.title })).toHaveCount(0); // an open lot is not an outcome
});
