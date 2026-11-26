import { expect, type Page, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { placeBid } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import { seedDemo } from '../scripts/seed-demo';

// D-96 (AX-19): staff void one paddle's bids on an open lot from the lot history. The ledger gains a VOIDED row with the
// reason, the voided rows are marked, the public history drops them and names the void, and the voided bidder no longer
// reads as holding a bid. Bid times sit a minute or two before the real now, so the lot is open while the page judges.
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

test('staff void a paddle’s bids; the history, the public list and the bidder all say so', async ({ page }) => {
  const [ada, ben] = [await user('ada-v@acme.demo.test'), await user('ben-v@acme.demo.test')];
  const [a, b] = [await registerBidder(org.id, ada.id, 'member'), await registerBidder(org.id, ben.id, 'member')];
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E void ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const end = new Date(T + 86_400_000);
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: 'Voided lot', startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: a.id, maxCents: 15000, idempotencyKey: `v-${lot.id}-a` }, { now: () => new Date(T - 120_000) });
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: b.id, maxCents: 500000, idempotencyKey: `v-${lot.id}-b` }, { now: () => new Date(T - 60_000) }); // Ben's typo leads at 15,500

  await signIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/lots/${lot.id}/history`);
  await page.getByLabel('Paddle', { exact: true }).fill(String(b.paddle));
  await page.getByLabel('Reason', { exact: true }).fill('Bidder called: typed 5,000 meaning 500');
  await page.getByRole('button', { name: "Void this paddle's bids" }).click();
  await expect(page.getByText(`Paddle ${b.paddle}'s bids voided (seq 3).`)).toBeVisible();
  await page.reload();
  await expect(page.locator('tr[data-seq="3"]')).toContainText('Voided by staff');
  await expect(page.getByTestId('void-reason')).toContainText('typed 5,000 meaning 500');
  await expect(page.locator('tr[data-seq="2"]')).toContainText('Voided later');
  const st = await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } });
  expect([st.priceCents, st.leaderBidderId, st.bidCount]).toEqual([10000, a.id, 3]);

  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('public-history')).toContainText("Staff voided Bidder 2's bids");
  await expect(page.getByTestId('public-history').locator('tbody tr')).toHaveCount(2); // Ada's bid and the void line

  await signIn(page, ben.email);
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('you')).toHaveCount(0);
  await expect(page.getByTestId('public-history')).toContainText('Staff voided your bids');
});
