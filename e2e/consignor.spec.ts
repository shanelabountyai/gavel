import { expect, type Page, test } from '@playwright/test';
import { registerBidder } from '../src/auction/bidder';
import { closeLots } from '../src/auction/close';
import { placeBid, prismaTx } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';
import { seedDemo } from '../scripts/seed-demo';

// D-74 (AX-07): staff add a consignor, set the pair's contract on the sale page, and read the statement after the
// close; a lot page names the consignor; the numbers are GB-25's (10,020 × 1250 bps → 1,253; fee 500; net 8,267).
const T = Date.now();
let org: { id: string };
const signIn = async (page: Page, email: string) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: email }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/demo'));
};

test.beforeAll(async () => {
  await seedDemo();
  org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
});

test('consignor, contract, statement', async ({ page }) => {
  const code = `E2E-${T}`;
  await signIn(page, 'owner@acme.demo.test');
  await page.getByRole('link', { name: 'Consignors' }).click();
  await page.getByLabel('Code').fill(code);
  await page.getByLabel('Name').fill(`Estate ${T}`);
  await page.getByRole('button', { name: 'Add consignor' }).click();
  await expect(page.getByTestId('consignors').getByRole('row', { name: new RegExp(code) })).toBeVisible();
  const consignor = await db.consignor.findUniqueOrThrow({ where: { orgId_code: { orgId: org.id, code } } });

  const auction = await db.auction.create({ data: { orgId: org.id, name: `E2E consignor sale ${T}`, softCloseWindowSeconds: 120, maxExtensionSeconds: 1800, buyerPremiumBps: 1000, opensAt: new Date('2020-01-01T00:00:00Z') } });
  const end = new Date(T - 60_000);
  const mk = (number: number, startCents: number) => db.lot.create({
    data: { orgId: org.id, auctionId: auction.id, number, title: `Consigned lot ${number} ${T}`, consignorId: consignor.id, startCents, scheduledEnd: end,
      state: { create: { orgId: org.id, priceCents: 0, leaderMaxCents: 0, bidCount: 0, acceptedCount: 0, closesAt: end, extensionCount: 0 } } },
  });
  const [sold, unsold] = [await mk(1, 10020), await mk(2, 10000)];

  await page.goto(`/o/acme/auctions/${auction.id}`);
  const contractForm = page.locator('form', { has: page.getByRole('button', { name: 'Set contract' }) });
  await contractForm.locator('select[name="consignorId"]').selectOption({ value: consignor.id });
  await page.getByLabel('Commission (bps)').fill('1250');
  await page.getByLabel('Fee per sold lot (cents)').fill('500');
  await page.getByLabel('Fee per unsold lot (cents)').fill('1500');
  await page.getByRole('button', { name: 'Set contract' }).click();
  await expect(page.getByTestId('contracts').getByRole('row', { name: new RegExp(code) })).toContainText(/12\.50%\$5\.00\$15\.00/);

  const u = await db.user.upsert({ where: { email: `cons-${T}@acme.demo.test` }, create: { email: `cons-${T}@acme.demo.test`, isDemo: true }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: u.id } }, create: { orgId: org.id, userId: u.id, role: 'member' }, update: {} });
  const b = await registerBidder(org.id, u.id, 'member');
  await placeBid({ orgId: org.id, lotId: sold.id, bidderId: b.id, maxCents: 10020, idempotencyKey: `cons-${sold.id}` }, { now: () => new Date(T - 600_000) });
  await closeLots(new Date(T), prismaTx(db as unknown as Prisma.TransactionClient));

  await page.getByRole('link', { name: 'Consignor statements' }).click();
  const s = page.getByTestId(`statement-${code}`);
  await expect(s.getByRole('row', { name: /Consigned lot 1/ })).toContainText(/Sold\$100\.20\$12\.53\$5\.00\$82\.67/);
  await expect(s.getByRole('row', { name: /Consigned lot 2/ })).toContainText(/—\$0\.00\$15\.00-\$15\.00/);
  await expect(s.getByRole('row', { name: /Net to consignor/ })).toContainText(/\$100\.20\$12\.53\$20\.00\$67\.67/);

  await page.goto(`/o/acme/lots/${unsold.id}`);
  await expect(page.getByText(`Consigned by Estate ${T}`)).toBeVisible();
});
