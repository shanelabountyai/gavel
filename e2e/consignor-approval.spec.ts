import { expect, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { registerBidder } from '../src/auction/bidder';
import { closeLots } from '../src/auction/close';
import { formatCents } from '../src/auction/engine/money';
import { placeBid, prismaTx } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';
import { seedDemo } from '../scripts/seed-demo';

// D-87 (AX-14): a lot closes below its reserve; staff record the consignor's approval on the invoices page; the lot moves
// to the high bidder's invoice at the high bid and the lot history names the approval.
const T = Date.now();

test('a below-reserve lot sold to the high bidder on the consignor\'s approval', async ({ page }) => {
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E approval sale ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const end = new Date(T - 60_000);
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number: 1, title: `Approval lot ${T}`, startCents: 10000, reserveCents: 90000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const users = await Promise.all([`appr-a-${T}@acme.demo.test`, `appr-b-${T}@acme.demo.test`].map(async (email) => {
    const u = await db.user.upsert({ where: { email }, create: { email, isDemo: true }, update: {} });
    await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: u.id } }, create: { orgId: org.id, userId: u.id, role: 'member' }, update: {} });
    return u;
  }));
  const a = await registerBidder(org.id, users[0]!.id, 'member');
  const b = await registerBidder(org.id, users[1]!.id, 'member');
  const at = () => new Date(T - 600_000);
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: a.id, maxCents: 50000, idempotencyKey: `appr-${lot.id}-a` }, { now: at });
  await placeBid({ orgId: org.id, lotId: lot.id, bidderId: b.id, maxCents: 30000, idempotencyKey: `appr-${lot.id}-b` }, { now: at });
  await closeLots(new Date(T), prismaTx(db as unknown as Prisma.TransactionClient));
  const high = (await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } })).priceCents; // the verified projection's price

  await demoSignIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/auctions/${auction.id}/invoices`);
  const row = page.getByTestId('not-sold-1');
  await expect(row).toContainText(`${formatCents(high)} · paddle ${a.paddle}`);
  await row.getByLabel('Approval reference').fill('CA-E2E-1');
  await row.getByLabel('Reason').fill('Consignor accepted by phone');
  await row.getByRole('button', { name: 'Sell at high bid' }).click();

  await expect(page.getByTestId(`invoice-${a.paddle}`)).toContainText(formatCents(high));
  await expect(page.getByTestId('not-sold-1')).toHaveCount(0);
  await page.goto(`/o/acme/lots/${lot.id}/history`);
  await expect(page.getByTestId('approval')).toContainText('Consignor approval CA-E2E-1');
});
