import { expect, test } from '@playwright/test';
import { registerBidder } from '../src/auction/bidder';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// Task 3.5: double click writes one ledger row (one key per submission); a max above 10× the price asks first, and a
// cancelled one writes nothing.
test('double click writes one row; a 50× max confirms, and cancel writes nothing', async ({ page }) => {
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
  const me = await db.user.findUniqueOrThrow({ where: { email: 'member@acme.demo.test' } });
  await registerBidder(org.id, me.id, 'member');
  const end = new Date(Date.now() + 3_600_000);
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E bid form ${Date.now()}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'Bid form lot', startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const rows = () => db.bid.count({ where: { lotId: lot.id } });

  await page.goto('/demo');
  await page.getByRole('button', { name: 'member@acme.demo.test' }).click();
  await page.goto(`/o/acme/lots/${lot.id}`);

  await page.getByLabel('Your maximum ($)').fill('150');
  await page.getByRole('button', { name: 'Bid', exact: true }).dblclick();
  await expect(page.getByTestId('bid-msg')).toContainText('Bid accepted');
  expect(await rows()).toBe(1);

  await page.getByLabel('Your maximum ($)').fill('5000'); // 50× the $100 start
  await page.getByRole('button', { name: 'Bid', exact: true }).click();
  await expect(page.getByTestId('confirm')).toContainText('more than 10×');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('confirm')).toHaveCount(0);
  expect(await rows()).toBe(1);

  await page.getByRole('button', { name: 'Bid', exact: true }).click();
  await page.getByRole('button', { name: /Yes, bid/ }).click();
  await expect(page.getByTestId('bid-msg')).toContainText('Bid accepted');
  expect(await rows()).toBe(2);
});
