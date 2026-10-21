import { expect, test } from '@playwright/test';
import { registerBidder } from '../src/auction/bidder';
import { placeBid } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// Task 3.4: the bidder lot page polls. A second bidder's bid shows on the first bidder's page, and a bid inside the soft
// close pushes the countdown out. Bids come from this process through placeBid; the page is the system under test.
test('a rival bid and a soft-close extension reach the open lot page by polling', async ({ page }) => {
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
  const me = await db.user.findUniqueOrThrow({ where: { email: 'member@acme.demo.test' } });
  const mine = await registerBidder(org.id, me.id, 'member');
  const rival = await db.user.upsert({ where: { email: 'rival@acme.demo.test' }, create: { email: 'rival@acme.demo.test', isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: rival.id } }, create: { orgId: org.id, userId: rival.id, role: 'member' }, update: {} });
  const other = await registerBidder(org.id, rival.id, 'member');

  const end = new Date(Date.now() + 40_000);
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E lot page ${Date.now()}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'Polled lot', startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const bid = (b: { id: string }, maxCents: number) => placeBid({ orgId: org.id, lotId: lot.id, bidderId: b.id, maxCents, idempotencyKey: `e2e-${lot.id}-${maxCents}` });

  await page.goto('/demo');
  await page.getByRole('button', { name: 'member@acme.demo.test' }).click();
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('price')).toHaveText('No bids');
  const countdown = async () => Number(await page.getByTestId('countdown').textContent());
  expect(await countdown()).toBeLessThanOrEqual(40);

  await bid(mine, 20000);
  await expect(page.getByTestId('you')).toHaveText('You are the high bidder.', { timeout: 5000 });
  await bid(other, 30000); // outbids me inside the soft-close window: the close moves out
  await expect(page.getByTestId('you')).toHaveText('You have been outbid.', { timeout: 5000 });
  await expect(page.getByTestId('bid-count')).toHaveText('2');
  await expect.poll(countdown, { timeout: 5000 }).toBeGreaterThan(60); // 120 s window from "now", not the 40 s that were left
  const state = await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } });
  expect(state.extensionCount).toBeGreaterThan(0);
});
