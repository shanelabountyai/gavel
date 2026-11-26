import { test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { placeBid } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import { runDb } from '../scripts/auction-eval';
import { seedDemo } from '../scripts/seed-demo';

// Capture spec for the exec brief's two screenshots (closure 2). Skipped unless BRIEF_SHOTS names the output folder:
// BRIEF_SHOTS=/some/dir npx dotenv -e .env.test -e .env.local -- playwright test e2e/brief-shots.spec.ts
const out = process.env.BRIEF_SHOTS;
test.skip(!out, 'set BRIEF_SHOTS to an output folder to capture the brief screenshots');

test.beforeAll(async () => {
  await runDb();
  await seedDemo();
}, 120_000);

test('bidder lot page: proxy lead inside the soft close', async ({ page }) => {
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
  const me = await db.user.findUniqueOrThrow({ where: { email: 'member@acme.demo.test' } });
  const mine = await registerBidder(org.id, me.id, 'member');
  const rival = await db.user.upsert({ where: { email: 'rival@acme.demo.test' }, create: { email: 'rival@acme.demo.test', isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: rival.id } }, create: { orgId: org.id, userId: rival.id, role: 'member' }, update: {} });
  const other = await registerBidder(org.id, rival.id, 'member');
  const end = new Date(Date.now() + 90_000);
  const auction = await db.auction.create({ data: { orgId: org.id, name: 'Harlan farm estate, part two', softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1500, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 14, title: 'Walnut drop-leaf table', startCents: 10000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: other.id, maxCents: 30000, idempotencyKey: `shot-${lot.id}-1` });
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: mine.id, maxCents: 50000, idempotencyKey: `shot-${lot.id}-2` });

  await demoSignIn(page, 'member@acme.demo.test');
  await page.goto(`/o/acme/lots/${lot.id}`);
  await page.getByTestId('you').waitFor();
  await page.setViewportSize({ width: 800, height: 900 }); // the board is 46rem; no empty half-page beside it
  await page.locator('main').screenshot({ path: `${out}/lot-shot.png` });
});

test('staff history: two late bids refused and kept', async ({ page }) => {
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'gavel-fixtures' } });
  const owner = await db.user.findUniqueOrThrow({ where: { email: 'owner@acme.demo.test' } });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: owner.id } }, create: { orgId: org.id, userId: owner.id, role: 'owner' }, update: { role: 'owner' } });
  const lot = await db.lot.findFirstOrThrow({ where: { orgId: org.id, title: 'Stoneware crock, 5 gal', number: 9 } }); // L009, LATE
  await demoSignIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/gavel-fixtures/lots/${lot.id}/history`);
  await page.locator('tbody tr[data-seq]').first().waitFor();
  await page.locator('main').screenshot({ path: `${out}/history-shot.png` });
});
