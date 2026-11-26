import { expect, type Page, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { placeBid } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// D-66 bundle (D-67): the lot page by state and by viewer. Closed lots say won / not won, a scheduled lot counts to its
// open with the form disabled, a member registers on the lot page, staff get no form, and the phone board fits.
const T = Date.now();
let org: { id: string };
const user = async (email: string) => {
  const u = await db.user.upsert({ where: { email }, create: { email, isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: u.id } }, create: { orgId: org.id, userId: u.id, role: 'member' }, update: {} });
  return u;
};
async function makeLot(o: { opensAt?: Date; end: Date; reserveCents?: number | null }) {
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E states ${Math.random()}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: o.opensAt ?? new Date('2020-01-01T00:00:00Z') } });
  return db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'State lot', startCents: 10000, reserveCents: o.reserveCents ?? null, scheduledEnd: o.end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: o.end, extensionCount: 0 } } },
  });
}
const signIn = async (page: Page, email: string) => {
  await demoSignIn(page, email);
};

test.beforeAll(async () => {
  await seedDemo();
  org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
});

test('a closed lot tells each viewer the result, never "high bidder"', async ({ page }) => {
  const [ada, ben, cy] = await Promise.all(['ada-s@acme.demo.test', 'ben-s@acme.demo.test', 'cy-s@acme.demo.test'].map(user));
  const [a, b] = [await registerBidder(org.id, ada.id, 'member'), await registerBidder(org.id, ben.id, 'member')];
  const sold = await makeLot({ end: new Date(T - 60_000), reserveCents: 20000 });
  const under = await makeLot({ end: new Date(T - 60_000), reserveCents: 90000 });
  const at = () => new Date(T - 600_000); // bids placed while the lots were open
  await placeBid({ orgId: org.id, lotId: sold.id, bidderId: a.id, maxCents: 30000, idempotencyKey: `s-${sold.id}-a` }, { now: at });
  await placeBid({ orgId: org.id, lotId: sold.id, bidderId: b.id, maxCents: 25000, idempotencyKey: `s-${sold.id}-b` }, { now: at });
  await placeBid({ orgId: org.id, lotId: under.id, bidderId: b.id, maxCents: 30000, idempotencyKey: `s-${under.id}-b` }, { now: at });

  await signIn(page, ada.email);
  await page.goto(`/o/acme/lots/${sold.id}`);
  await expect(page.getByTestId('result')).toContainText('You won this lot at $255.00.');
  await expect(page.getByTestId('you')).toHaveCount(0);
  await signIn(page, ben.email);
  await page.goto(`/o/acme/lots/${sold.id}`);
  await expect(page.getByTestId('result')).toContainText('You did not win. This lot sold to another bidder.');
  await page.goto(`/o/acme/lots/${under.id}`);
  await expect(page.getByTestId('result')).toContainText('the reserve was not met');
  await signIn(page, cy.email);
  await page.goto(`/o/acme/lots/${sold.id}`);
  await expect(page.getByTestId('status')).toHaveText('Closed');
  await expect(page.getByTestId('result')).toHaveCount(0);
});

test('a scheduled lot counts to its open and its form is disabled', async ({ page }) => {
  const u = await user('sched-s@acme.demo.test');
  await registerBidder(org.id, u.id, 'member');
  const lot = await makeLot({ opensAt: new Date(T + 3_600_000), end: new Date(T + 7_200_000) });
  await signIn(page, u.email);
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByText('Opens in')).toBeVisible();
  expect(Number(await page.getByTestId('countdown').getAttribute('data-seconds'))).toBeLessThanOrEqual(3600);
  await expect(page.getByRole('button', { name: 'Bid', exact: true })).toBeDisabled();
  await expect(page.getByTestId('bid-disabled')).toContainText('Bidding opens at');
  expect(await db.bid.count({ where: { lotId: lot.id } })).toBe(0);
});

test('a new member registers on the lot page and bids without visiting the catalog', async ({ page }) => {
  const u = await user(`fresh-${T}@acme.demo.test`);
  const lot = await makeLot({ end: new Date(T + 3_600_000) });
  await signIn(page, u.email);
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.locator('form[aria-label="Place a bid"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Register to bid' }).click();
  await expect(page.getByLabel('Your maximum ($)')).toBeVisible();
  await page.getByLabel('Your maximum ($)').fill('150');
  await page.getByRole('button', { name: 'Bid', exact: true }).click();
  await expect(page.getByTestId('bid-msg')).toContainText('Bid accepted. You lead');
  await expect(page.getByTestId('bid-msg')).toHaveAttribute('data-tone', 'lead');
});

test('staff see no bid form and reach the history in one click', async ({ page }) => {
  const lot = await makeLot({ end: new Date(T + 3_600_000) });
  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('staff-view')).toContainText('Staff view: staff accounts do not bid.');
  await expect(page.locator('form[aria-label="Place a bid"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Bid history' }).click();
  await expect(page).toHaveURL(new RegExp(`/lots/${lot.id}/history$`));
});

test.describe('phone, 375×667', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('price, countdown, minimum and Bid are on the first screen, with and without a banner', async ({ page }) => {
    const u = await user('phone-s@acme.demo.test');
    const me = await registerBidder(org.id, u.id, 'member');
    const lot = await makeLot({ end: new Date(T + 3_600_000) });
    await signIn(page, u.email);
    const fits = async () => {
      for (const sel of ['[data-testid=price]', '[data-testid=countdown]', '[data-testid=min-next]', 'button[type=submit]']) {
        expect(await page.locator(sel).first().evaluate((e) => e.getBoundingClientRect().bottom), sel).toBeLessThanOrEqual(667);
      }
    };
    await page.goto(`/o/acme/lots/${lot.id}`);
    await fits();
    await placeBid({ orgId: org.id, lotId: lot.id, bidderId: me.id, maxCents: 20000, idempotencyKey: `p-${lot.id}` });
    await expect(page.getByTestId('you')).toHaveText('You are the high bidder.', { timeout: 5000 });
    await fits();
    const navHeight = await page.locator('nav').evaluate((e) => e.getBoundingClientRect().height);
    expect(navHeight).toBeLessThanOrEqual(56);
  });

  test('the catalog has no sideways scroll and shows each price', async ({ page }) => {
    await signIn(page, 'member@acme.demo.test');
    await page.goto('/o/acme/catalog');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await expect(page.locator('.cat-price').first()).toBeVisible();
  });
});
