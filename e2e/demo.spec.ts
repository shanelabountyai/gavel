import { expect, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// INV-27, flag-on half (the flag-off half is tests/invariants/inv-27-demo.test.ts). playwright.config.ts starts the
// server with DEMO_MODE=1; this spec seeds the same database itself. R10 (D-81): the page routes by journey.
const T = Date.now();
test.beforeAll(async () => {
  await seedDemo();
  const acme = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
  // Ada holds a paddle in Acme, and Acme has the most recently opened sale with a lot still open: the live house.
  const ada = await db.user.upsert({ where: { email: 'bidder-ada@acme.demo.test' }, create: { email: 'bidder-ada@acme.demo.test', isDemo: true }, update: { isDemo: true } });
  await db.membership.upsert({ where: { orgId_userId: { orgId: acme.id, userId: ada.id } }, create: { orgId: acme.id, userId: ada.id, role: 'member' }, update: {} });
  await registerBidder(acme.id, ada.id, 'member');
  const auction = await db.auction.create({ data: { orgId: acme.id, name: `E2E demo sale ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date(T - 60_000) } });
  const end = new Date(T + 3_600_000);
  await db.lot.create({ data: { orgId: acme.id, auctionId: auction.id, number: 1, title: 'Demo lot', startCents: 10000, scheduledEnd: end, state: { create: { orgId: acme.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } } });
  // The owner belongs to two houses, as on the demo database (DEMO.md step 3).
  const fixtures = await db.org.upsert({ where: { slug: 'gavel-fixtures' }, update: {}, create: { slug: 'gavel-fixtures', name: 'Gavel fixtures (synthetic)' } });
  const owner = await db.user.findUniqueOrThrow({ where: { email: 'owner@acme.demo.test' } });
  await db.membership.upsert({ where: { orgId_userId: { orgId: fixtures.id, userId: owner.id } }, create: { orgId: fixtures.id, userId: owner.id, role: 'owner' }, update: { role: 'owner' } });
});

test('demo sign-in lands a one-org bidder on their catalog', async ({ page }) => {
  await demoSignIn(page, 'member@acme.demo.test');
  await expect(page).toHaveURL(/\/o\/acme\/catalog$/); // one org: straight in, a bidder to the catalog (staff go to the auctions)
  await expect(page.getByRole('navigation')).toContainText('Acme Studio');
});

test('the page routes by journey: Bid as Ada to the catalog, Run the sale to the live house even with two orgs', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByText('another visitor may be bidding as Ada right now')).toBeVisible();
  const other = page.locator('details');
  await expect(other.locator('form[data-email="member@globex.demo.test"] button')).toBeAttached();
  await expect(other.locator('form[data-email="member@globex.demo.test"] button')).toBeHidden(); // collapsed
  await page.getByRole('button', { name: 'Bid as Ada' }).click();
  await expect(page).toHaveURL(/\/o\/acme\/catalog$/);
  await expect(page.getByText('paddle')).toBeVisible();

  await page.goto('/demo');
  await page.getByRole('button', { name: 'Run the sale as owner' }).click();
  await expect(page).toHaveURL(/\/o\/acme\/auctions$/);
});
