import { expect, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { placeBid } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// UX-12 (R12): one polite live region says "Under one minute left", "Extended by a late bid; now closes in m:ss" and
// "Bidding has closed" once each, and does not change on the 250 ms tick. UX-13 (R13): a visibilitychange to visible
// polls at once; with the state route failing the clock says "Reconnecting…" and the bid form stays usable.
let org: { id: string };
let mine: { id: string };
let other: { id: string };
test.beforeAll(async () => {
  await seedDemo();
  org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
  const me = await db.user.findUniqueOrThrow({ where: { email: 'member@acme.demo.test' } });
  mine = await registerBidder(org.id, me.id, 'member');
  const rival = await db.user.upsert({ where: { email: 'rival-live@acme.demo.test' }, create: { email: 'rival-live@acme.demo.test', isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: rival.id } }, create: { orgId: org.id, userId: rival.id, role: 'member' }, update: {} });
  other = await registerBidder(org.id, rival.id, 'member');
});
async function makeLot(end: Date) {
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E live ${Math.random()}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  return db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'Live lot', startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
}

test('the live region announces the final minute, an extension and the close once each, not per tick', async ({ page }) => {
  const lot = await makeLot(new Date(Date.now() + 63_000));
  await demoSignIn(page, 'member@acme.demo.test');
  await page.goto(`/o/acme/lots/${lot.id}`);
  const announce = page.getByTestId('announce');
  await expect(announce).toHaveText('', { timeout: 1000 });
  await expect(announce).toHaveText('Under one minute left', { timeout: 10_000 });
  const before = Number(await page.getByTestId('countdown').getAttribute('data-seconds'));
  await page.waitForTimeout(1500);
  expect(Number(await page.getByTestId('countdown').getAttribute('data-seconds'))).toBeLessThan(before); // the clock ticked
  await expect(announce).toHaveText('Under one minute left'); // the region did not

  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: mine.id, maxCents: 20000, idempotencyKey: `live-${lot.id}-a` });
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: other.id, maxCents: 30000, idempotencyKey: `live-${lot.id}-b` }); // inside the window: extends
  await expect(announce).toHaveText(/^Extended by a late bid; now closes in \d+:\d\d$/, { timeout: 5000 });
  await expect(page.getByTestId('ext-count')).toHaveText('Extended once since you opened this page', { timeout: 10_000 });

  const closing = await makeLot(new Date(Date.now() + 3_000));
  await page.goto(`/o/acme/lots/${closing.id}`);
  await expect(page.getByTestId('announce')).toHaveText('Bidding has closed', { timeout: 10_000 });
  await expect(page.getByTestId('status').first()).toHaveText('Closed');
});

test('coming back to the page polls at once; a failing route says Reconnecting and leaves the form usable', async ({ page }) => {
  const lot = await makeLot(new Date(Date.now() + 3_600_000));
  await demoSignIn(page, 'member@acme.demo.test');
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('countdown')).toBeVisible();

  const asked = page.waitForRequest((r) => r.url().includes(`/api/lots/${lot.id}/state`), { timeout: 200 });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await asked;

  await page.route(`**/api/lots/${lot.id}/state`, (r) => r.abort());
  await expect(page.getByTestId('reconnecting')).toHaveText('Reconnecting…', { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Bid', exact: true })).toBeEnabled();
  await expect(page.getByTestId('countdown')).toBeVisible();
});

test('a closed lot stops polling: at most one state request in the 10 s after the close shows', async ({ page }) => {
  const lot = await makeLot(new Date(Date.now() + 3_000));
  await demoSignIn(page, 'member@acme.demo.test');
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('status').first()).toHaveText('Closed', { timeout: 10_000 });
  let n = 0;
  page.on('request', (r) => { if (r.url().includes(`/api/lots/${lot.id}/state`)) n++; });
  await page.waitForTimeout(10_000);
  expect(n).toBeLessThanOrEqual(1); // R20: unsettled, so one slow poll at most; none once the settlement is final
});
