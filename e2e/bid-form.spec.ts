import { expect, test } from '@playwright/test';
import { registerBidder } from '../src/auction/bidder';
import { placeBid } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// Task 3.5: double click writes one ledger row (one key per submission); a max above 10× the price asks first, and a
// cancelled one writes nothing. D-68: the board shows the caller's own maximum, and a refused raise quotes it.
test('double click writes one row; a 50× max confirms, and cancel writes nothing; a refused raise names the max', async ({ page }) => {
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

  await expect(page.getByTestId('your-max')).toContainText('Your maximum: $5,000.00');
  await page.getByLabel('Your maximum ($)').fill('200'); // below the $5,000 already placed
  await page.getByRole('button', { name: 'Bid', exact: true }).click();
  await expect(page.getByTestId('bid-msg')).toContainText('Your maximum is already $5,000.00; enter more to raise it.');
  expect(await rows()).toBe(3); // refused, recorded all the same (D-14)
});

// UX-08 (R8): one tap bids the shown minimum with a fresh key; a double tap writes one row.
// UX-14 (R14): the board shows the judged price and position as soon as the action answers, before the next poll.
test('one tap bids the minimum, a double tap writes one row, and the board takes the judged numbers at once', async ({ page }) => {
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
  const me = await db.user.findUniqueOrThrow({ where: { email: 'member@acme.demo.test' } });
  const rivalUser = await db.user.upsert({ where: { email: 'rival-tap@acme.demo.test' }, create: { email: 'rival-tap@acme.demo.test', isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: rivalUser.id } }, create: { orgId: org.id, userId: rivalUser.id, role: 'member' }, update: {} });
  const [mine, rival] = [await registerBidder(org.id, me.id, 'member'), await registerBidder(org.id, rivalUser.id, 'member')];
  const end = new Date(Date.now() + 3_600_000);
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E one tap ${Date.now()}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'One tap lot', startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const rows = () => db.bid.findMany({ where: { lotId: lot.id, bidderId: mine.id }, orderBy: { seq: 'asc' } });

  await page.goto('/demo');
  await page.getByRole('button', { name: 'member@acme.demo.test' }).click();
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByLabel('Your maximum ($)')).toHaveAttribute('placeholder', '100.00');
  await expect(page.getByText('Enter the most you will pay.')).toBeVisible();

  const shown = (await page.getByTestId('min-next').textContent())!; // $100.00 on an untouched $100 lot
  await page.getByTestId('bid-min').dblclick();
  await expect(page.getByTestId('bid-msg')).toContainText('Bid accepted. You lead at $100.00.');
  const mineRows = await rows();
  expect(mineRows).toHaveLength(1);
  expect(mineRows[0]!.maxCents).toBe(Number(shown.replace(/[$,]/g, '')) * 100);
  // UX-14: read without waiting; the price and the next minimum came from the action's response, not the poll
  expect(await page.getByTestId('price').textContent()).toBe('$100.00');
  expect(await page.getByTestId('min-next').textContent()).toBe('$105.00');
  expect(await page.getByTestId('you').textContent()).toBe('You are the high bidder.');

  // Outbid on entry: the rival's $300 maximum is already on the lot; my $150 is accepted but not leading.
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: rival.id, maxCents: 30000, idempotencyKey: `tap-rival-${lot.id}` });
  await page.getByLabel('Your maximum ($)').fill('150');
  await page.getByRole('button', { name: 'Bid', exact: true }).click();
  await expect(page.getByTestId('bid-msg')).toContainText("another bidder's maximum is higher ($155.00)");
  expect(await page.getByTestId('price').textContent()).toBe('$155.00'); // one price on the screen
  expect(await page.getByTestId('you').textContent()).toBe('You have been outbid.');
  expect(await page.getByTestId('your-max').textContent()).toContain('$150.00');
});
