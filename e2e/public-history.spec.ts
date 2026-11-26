import { expect, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { placeBid } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// R-11 / R-13 (D-83): the bidder lot page lists accepted bids with per-lot aliases and "You", never a maximum, a refused
// attempt or a paddle; a lot without a reserve says "No reserve".
test('public bid history: accepted rows, aliases, you; no max, no refused row, no paddle; no-reserve label', async ({ page }) => {
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
  const me = await db.user.findUniqueOrThrow({ where: { email: 'member@acme.demo.test' } });
  const mine = await registerBidder(org.id, me.id, 'member');
  const rival = await db.user.upsert({ where: { email: 'rival@acme.demo.test' }, create: { email: 'rival@acme.demo.test', isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: rival.id } }, create: { orgId: org.id, userId: rival.id, role: 'member' }, update: {} });
  const other = await registerBidder(org.id, rival.id, 'member');

  const end = new Date(Date.now() + 600_000);
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E public history ${Date.now()}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'Aliased lot', startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const bid = (b: { id: string }, maxCents: number, k: string) => placeBid({ orgId: org.id, lotId: lot.id, bidderId: b.id, maxCents, idempotencyKey: `e2e-${lot.id}-${k}` });
  await bid(mine, 20000, 'a'); // price 100.00, I lead
  await bid(other, 30000, 'b'); // price 205.00, rival leads
  expect((await bid(mine, 20500, 'c')).outcome).toBe('REJECTED_BELOW_MINIMUM'); // a refused row: never shown

  await demoSignIn(page, 'member@acme.demo.test');
  await page.goto(`/o/acme/lots/${lot.id}`);
  const rows = page.getByTestId('public-history').locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('You');
  await expect(rows.nth(0)).toContainText('$100.00');
  await expect(rows.nth(1)).toContainText('Bidder 2');
  await expect(rows.nth(1)).toContainText('$205.00');
  // the board shows the caller's own maximum (D-68); the history shows nobody's, and the rival's appears nowhere
  const table = await page.getByTestId('public-history').innerText();
  for (const secret of ['$200.00', '$300.00', `#${mine.paddle}`, `#${other.paddle}`, 'Refused', 'REJECTED']) expect(table).not.toContain(secret);
  expect(await page.locator('main').innerText()).not.toContain('$300.00');
  await expect(page.getByTestId('reserve')).toHaveText('No reserve');
});
