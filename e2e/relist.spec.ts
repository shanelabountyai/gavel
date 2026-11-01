import { expect, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { closeLots } from '../src/auction/close';
import { createConsignor } from '../src/auction/consignor';
import { prismaTx } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';
import { seedDemo } from '../scripts/seed-demo';

// D-89 (AX-17): staff relist an unsold lot from its page into a sale still to open; the new lot links back, and the
// old lot's page, history and consignor statement link forward.
const T = Date.now();
let org: { id: string };

test.beforeAll(async () => {
  await seedDemo();
  org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
});

test('staff relist an unsold lot into the next sale; both lots, the history and the statement link the pair', async ({ page }) => {
  const owner = await db.user.findUniqueOrThrow({ where: { email: 'owner@acme.demo.test' } });
  const c = await createConsignor({ orgId: org.id, userId: owner.id }, { name: `Relist estate ${T}`, code: `RL-${T}` });
  const past = await db.auction.create({ data: { orgId: org.id, name: `E2E relist from ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 600, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const next = await db.auction.create({ data: { orgId: org.id, name: `E2E relist into ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 600, buyerPremiumBps: 1000, opensAt: new Date(T + 86_400_000), firstCloseAt: new Date(T + 2 * 86_400_000), staggerSeconds: 60 } });
  await db.consignmentContract.create({ data: { orgId: org.id, consignorId: c.id, auctionId: past.id, commissionBps: 1000, lotFeeCents: 0, unsoldFeeCents: 500, byUserId: owner.id, createdAt: new Date(T) } });
  const end = new Date('2020-01-02T00:00:00Z');
  const lot = await db.lot.create({
    data: { orgId: org.id, auctionId: past.id, number: 1, title: 'Relisted oak desk', consignorId: c.id, startCents: 10000, reserveCents: 40000, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  await closeLots(new Date(T), prismaTx(db as unknown as Prisma.TransactionClient));

  await demoSignIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/lots/${lot.id}`);
  await page.getByLabel('Into sale').selectOption({ label: next.name });
  await page.getByLabel('Reserve ($, optional)').fill('250');
  await page.getByRole('button', { name: 'Relist lot' }).click();
  await expect(page).toHaveURL(new RegExp(`/auctions/${next.id}`));
  const relist = await db.lot.findFirstOrThrow({ where: { relistOfLotId: lot.id } });
  expect(relist).toMatchObject({ auctionId: next.id, number: 1, title: 'Relisted oak desk', consignorId: c.id, startCents: 10000, reserveCents: 25000 });

  await page.goto(`/o/acme/lots/${relist.id}`);
  await expect(page.getByTestId('relist-of')).toContainText(`lot 1 of ${past.name}`);
  await page.goto(`/o/acme/lots/${lot.id}`);
  await expect(page.getByTestId('relisted-as')).toContainText(`lot 1 in ${next.name}`);
  await expect(page.getByRole('button', { name: 'Relist lot' })).toHaveCount(0);
  await page.goto(`/o/acme/lots/${lot.id}/history`);
  await expect(page.getByTestId('history-relisted-as')).toBeVisible();
  await page.goto(`/o/acme/auctions/${past.id}/statements`);
  await expect(page.getByTestId(`statement-RL-${T}`).getByTestId('statement-relisted')).toHaveText(`relisted as lot 1 in ${next.name}`);
});
