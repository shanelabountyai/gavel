import { expect, type Page, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { placeBid } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// R9 (D-80): Ada, outbid on lot 3 by Ben, sees "Outbid" on Your bids and on the catalog row without opening lot 3.
const T = Date.now();
let org: { id: string };
const user = async (email: string) => {
  const u = await db.user.upsert({ where: { email }, create: { email, isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: u.id } }, create: { orgId: org.id, userId: u.id, role: 'member' }, update: {} });
  return u;
};
async function makeLot(number: number, title: string, end: Date) {
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E my-bids ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  return db.lot.create({ data: { orgId: org.id, auctionId: auction.id, number, title, startCents: 10000, scheduledEnd: end, state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } } });
}
const signIn = async (page: Page, email: string) => {
  await demoSignIn(page, email);
};

test.beforeAll(async () => {
  await seedDemo();
  org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
});

test('your bids and the catalog badge show lead, outbid and won without opening the lot', async ({ page }) => {
  const [ada, ben] = await Promise.all(['ada-mb@acme.demo.test', 'ben-mb@acme.demo.test'].map(user));
  const [a, b] = [await registerBidder(org.id, ada.id, 'member'), await registerBidder(org.id, ben.id, 'member')];
  const open = new Date(T + 3_600_000);
  const lead = await makeLot(1, `Lead lot ${T}`, open);
  const outbid = await makeLot(3, `Outbid lot ${T}`, open);
  const won = await makeLot(5, `Won lot ${T}`, new Date(T - 60_000));
  const at = () => new Date(T - 600_000);
  await placeBid({ orgId: org.id, lotId: lead.id, bidderId: a.id, maxCents: 20000, idempotencyKey: `mb-${lead.id}-a` }, { now: at });
  await placeBid({ orgId: org.id, lotId: outbid.id, bidderId: a.id, maxCents: 20000, idempotencyKey: `mb-${outbid.id}-a` }, { now: at });
  await placeBid({ orgId: org.id, lotId: outbid.id, bidderId: b.id, maxCents: 30000, idempotencyKey: `mb-${outbid.id}-b` }, { now: at });
  await placeBid({ orgId: org.id, lotId: won.id, bidderId: a.id, maxCents: 20000, idempotencyKey: `mb-${won.id}-a` }, { now: at });

  await signIn(page, ada.email);
  await page.getByRole('link', { name: 'Your bids' }).first().click();
  await expect(page).toHaveURL(/\/o\/acme\/my-bids$/);
  await expect(page.getByRole('row', { name: new RegExp(`Lead lot ${T}`) })).toContainText('Leading');
  await expect(page.getByRole('row', { name: new RegExp(`Outbid lot ${T}`) })).toContainText('Outbid');
  await expect(page.getByRole('row', { name: new RegExp(`Won lot ${T}`) })).toContainText(/Won.*Closed/);
  expect(await page.getByRole('row').count()).toBe(4); // header + the three lots Ada bid on, none of the seed's

  await page.goto('/o/acme/catalog');
  await expect(page.getByRole('row', { name: new RegExp(`Outbid lot ${T}`) }).locator('.badge')).toHaveText('Outbid');
  await expect(page.getByRole('row', { name: new RegExp(`Lead lot ${T}`) }).locator('.badge')).toHaveText('Leading');

  await signIn(page, ben.email);
  await page.goto('/o/acme/my-bids');
  await expect(page.getByRole('row', { name: new RegExp(`Outbid lot ${T}`) })).toContainText('Leading');
  expect(await page.getByRole('row').count()).toBe(2);
});
