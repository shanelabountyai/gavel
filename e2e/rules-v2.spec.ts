import { expect, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { closeLots } from '../src/auction/close';
import { placeBid, prismaTx } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';
import { seedDemo } from '../scripts/seed-demo';

// D-90 (AX-18): staff type tiered premium terms and pick the equipment increments before the first bid; the bid path
// steps by that table, the invoice charges the tiered premium (GB-29e), and the sale page shows both fixed.
const T = Date.now();

test('a tiered premium and the equipment table, typed by staff, reach the invoice', async ({ page }) => {
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E tiered sale ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1500, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const end = new Date(T - 60_000);
  const lot = await db.lot.create({ data: { orgId: org.id, auctionId: auction.id, number: 1, title: `Skid steer ${T}`, startCents: 100_000, scheduledEnd: end,
    state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } } });

  await demoSignIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/auctions/${auction.id}`);
  const premium = page.getByLabel("Buyer's premium", { exact: true });
  await expect(premium).toHaveValue('15%');
  await premium.fill('15% to $5,000'); // no rate above the last amount: refused, nothing saved
  await page.getByRole('button', { name: 'Save payment and pickup' }).click();
  await expect(page.getByText("Buyer's premium: type a rate like 15%")).toBeVisible();
  await premium.fill('15% to $5,000; 10% above');
  await page.getByLabel('Bid increments', { exact: true }).selectOption('equipment');
  await page.getByRole('button', { name: 'Save payment and pickup' }).click();
  await expect(page.getByTestId('premium-terms')).toHaveText('15% to $5,000; 10% above');
  await expect(page.getByLabel('Bid increments', { exact: true })).toHaveValue('equipment');

  const [win, lose] = await Promise.all([`tier-win-${T}@acme.demo.test`, `tier-lose-${T}@acme.demo.test`].map(async (email) => {
    const u = await db.user.upsert({ where: { email }, create: { email, isDemo: true }, update: {} });
    await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: u.id } }, create: { orgId: org.id, userId: u.id, role: 'member' }, update: {} });
    return registerBidder(org.id, u.id, 'member');
  }));
  const at = () => new Date(T - 600_000);
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: win!.id, maxCents: 1_500_000, idempotencyKey: `tier-${lot.id}-a` }, { now: at });
  // equipment: 990,000 is outbid at min(1,500,000, 990,000 + 10,000) = 1,000,000 (standard would step 5,000)
  await expect(placeBid({ orgId: org.id, lotId: lot.id, bidderId: lose!.id, maxCents: 990_000, idempotencyKey: `tier-${lot.id}-b` }, { now: at })).resolves.toMatchObject({ priceCents: 1_000_000 });
  await closeLots(new Date(T), prismaTx(db as unknown as Prisma.TransactionClient));

  await page.goto(`/o/acme/auctions/${auction.id}`);
  await expect(page.getByText('Premium 15% to $5,000; 10% above; equipment increments.')).toBeVisible();
  await page.goto(`/o/acme/auctions/${auction.id}/invoices`);
  await expect(page.getByText("Buyer's premium on the hammer: 15% to $5,000; 10% above.")).toBeVisible();
  // GB-29e: hammer $10,000.00, premium 750.00 + 500.00 = $1,250.00, total $11,250.00
  await expect(page.getByTestId(`invoice-${win!.paddle}`).getByTestId('total-due')).toHaveText('$11,250.00');
});
