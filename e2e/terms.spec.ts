import { expect, type Page, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// D-72 (AX-03): staff publish terms of sale; a bidder sees them in place of the bid form, accepts once, and bids; the
// auction page lists who accepted which version.
const T = Date.now();
let org: { id: string };
const signIn = async (page: Page, email: string) => {
  await demoSignIn(page, email);
};

test.beforeAll(async () => {
  await seedDemo();
  org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
});

test('terms published by staff gate the bid form until the bidder accepts them', async ({ page }) => {
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E terms sale ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const end = new Date(T + 86_400_000);
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: `Terms lot ${T}`, startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const email = `terms-${T}@acme.demo.test`;
  const u = await db.user.create({ data: { email, isDemo: true, memberships: { create: { orgId: org.id, role: 'member' } } } });
  const bidder = await registerBidder(org.id, u.id, 'member');

  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/auctions/${auction.id}`);
  await expect(page.getByText('No terms of sale yet')).toBeVisible();
  await page.getByLabel('Terms of sale').fill('As is, where is. Payment within 7 days.');
  await page.getByRole('button', { name: 'Publish terms' }).click();
  await expect(page.getByTestId('terms-current')).toContainText('Version 1');
  await expect(page.getByTestId('terms-current')).toContainText('As is, where is.');

  await signIn(page, email);
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('terms-panel')).toContainText('As is, where is. Payment within 7 days.');
  await expect(page.getByRole('form', { name: 'Place a bid' })).toHaveCount(0);
  await page.getByRole('button', { name: 'I accept the terms of sale' }).click();
  await expect(page.getByRole('form', { name: 'Place a bid' })).toBeVisible();
  await expect(page.getByTestId('terms-panel')).toHaveCount(0);
  await page.getByLabel('Your maximum ($)').fill('150');
  await page.getByRole('button', { name: 'Bid', exact: true }).click();
  await expect(page.getByTestId('bid-msg')).toContainText('You lead at $100.00');

  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/auctions/${auction.id}`);
  await expect(page.getByTestId('terms-acceptances')).toContainText(`#${bidder.paddle}`);
  await expect(page.getByText('Fixed since bidding started')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish a new version' })).toHaveCount(0);
  await page.goto(`/o/acme/lots/${lot.id}/history`);
  await expect(page.getByTestId('terms-acceptances')).toContainText(`#${bidder.paddle}`);
});
