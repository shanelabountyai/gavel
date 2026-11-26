import { expect, type Page, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { placeBid } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// D-73 (AX-04): staff withdraw an open lot from its page with a reason; the board turns to Withdrawn for everyone, the
// high bidder reads that their bids are void, the catalog shows the badge, and the history carries the row.
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

test('staff withdraw an open lot with bids; the bidder, the catalog and the history all say so', async ({ page }) => {
  const ada = await user('ada-w@acme.demo.test');
  const a = await registerBidder(org.id, ada.id, 'member');
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E withdraw ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const end = new Date(T + 86_400_000);
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'Withdrawn lot', startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: a.id, maxCents: 30000, idempotencyKey: `w-${lot.id}-a` }, { now: () => new Date(T - 60_000) });

  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('withdraw-panel')).toBeVisible();
  await page.getByLabel('Reason').fill('Title problem found after cataloguing');
  await page.getByRole('button', { name: 'Withdraw lot' }).click();
  await expect(page.getByTestId('status')).toHaveText('Withdrawn');
  await expect(page.getByTestId('withdrawn-at')).toBeVisible();
  await expect(page.getByTestId('withdraw-panel')).toHaveCount(0);
  const row = await db.lotWithdrawal.findUniqueOrThrow({ where: { lotId: lot.id } });
  expect(row.reason).toBe('Title problem found after cataloguing');

  await page.goto(`/o/acme/lots/${lot.id}/history`);
  await expect(page.getByTestId('withdrawal')).toContainText('Title problem found after cataloguing');
  await page.goto('/o/acme/catalog');
  await expect(page.getByRole('row', { name: /Withdrawn lot/ }).getByText('Withdrawn', { exact: true })).toBeVisible();

  await signIn(page, ada.email);
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('result')).toContainText('withdrawn from the sale');
  await expect(page.getByTestId('status')).toHaveText('Withdrawn');
  await expect(page.getByTestId('you')).toHaveCount(0);
  expect(await db.outbox.count({ where: { template: 'withdrawn', to: ada.email } })).toBe(1);
});
