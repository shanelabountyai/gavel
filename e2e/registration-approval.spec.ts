import { expect, type Page, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// D-88 (AX-16): staff mark a sale as needing approval; a bidder asks from a lot page, staff approve with a note, the bid
// form appears; a revoke takes it away again; the lot's dispute view lists every step.
const T = Date.now();
let org: { id: string };
const signIn = (page: Page, email: string) => demoSignIn(page, email);

test.beforeAll(async () => {
  await seedDemo();
  org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
});

test('a sale that requires approval gates the bid form until staff approve, and a revoke gates it again', async ({ page }) => {
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E approval sale ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const end = new Date(T + 86_400_000);
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: `Approval lot ${T}`, startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const email = `approval-${T}@acme.demo.test`;
  const u = await db.user.create({ data: { email, isDemo: true, memberships: { create: { orgId: org.id, role: 'member' } } } });
  const bidder = await registerBidder(org.id, u.id, 'member');
  const bidForm = page.getByRole('form', { name: 'Place a bid' });

  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/auctions/${auction.id}`);
  await page.getByLabel('Bidders need approval for this sale').check();
  await page.getByRole('button', { name: 'Save payment and pickup' }).click();
  await expect(page.getByText('No bidder has asked to bid in this sale yet.')).toBeVisible();

  await signIn(page, email);
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('approval-panel')).toContainText('needs the house');
  await expect(bidForm).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask to bid in this sale' }).click();
  await expect(page.getByTestId('approval-pending')).toBeVisible();

  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/auctions/${auction.id}`);
  const row = page.getByTestId(`registration-${bidder.paddle}`);
  await expect(row).toContainText('Awaiting approval');
  await row.getByLabel('Note').fill('Deposit $500 taken by phone');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(row).toContainText('Approved');
  await expect(row).toContainText('Deposit $500 taken by phone');

  await signIn(page, email);
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('approval-panel')).toHaveCount(0);
  await page.getByLabel('Your maximum ($)').fill('150');
  await page.getByRole('button', { name: 'Bid', exact: true }).click();
  await expect(page.getByTestId('bid-msg')).toContainText('You lead at $100.00');

  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/auctions/${auction.id}`);
  await row.getByLabel('Note').fill('Card check failed');
  await row.getByRole('button', { name: 'Revoke' }).click();
  await expect(row).toContainText('Declined');
  await expect(page.getByText('Bidders need approval for this sale.')).toBeVisible(); // fixed now: the sale has a bid

  await signIn(page, email);
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('approval-panel')).toContainText('has not approved you');
  await expect(bidForm).toHaveCount(0);

  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/lots/${lot.id}/history`);
  const hist = page.getByTestId('registration-history');
  await expect(hist).toContainText('PENDING');
  await expect(hist).toContainText('Deposit $500 taken by phone');
  await expect(hist).toContainText('Card check failed');
});
