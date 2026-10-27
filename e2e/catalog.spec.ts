import { expect, test } from '@playwright/test';
import { db } from '../src/core/db';
import { runDb } from '../scripts/auction-eval';
import { seedDemo } from '../scripts/seed-demo';

// Task 3.1: staff create an auction and a lot, and it appears in the catalog; a bad reserve is refused and writes nothing.
test.beforeAll(async () => {
  expect((await runDb()).ok).toBe(true);
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'gavel-fixtures' } });
  const owner = await db.user.findUniqueOrThrow({ where: { email: 'owner@acme.demo.test' } });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: owner.id } }, create: { orgId: org.id, userId: owner.id, role: 'owner' }, update: { role: 'owner' } });
}, 120_000);

test('create auction and lot, see it in the catalog; reserve below start is refused', async ({ page }) => {
  const name = `E2E auction ${Date.now()}`;
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await page.goto('/o/gavel-fixtures/auctions');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Opens (UTC)').fill('2031-01-01T10:00');
  await page.getByRole('button', { name: 'Create auction' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  const fill = async (title: string, start: string, reserve: string) => {
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Start price (cents)').fill(start);
    await page.getByLabel('Reserve (cents, optional)').fill(reserve);
    await page.getByLabel('Closes (UTC)').fill('2031-01-01T12:00');
    await page.getByRole('button', { name: 'Create and publish lot' }).click();
  };
  await fill('Bad reserve lot', '10000', '5000');
  await expect(page.locator('form [role=alert]')).toHaveText('Reserve must be at least the start price.');
  expect(await db.lot.count({ where: { title: 'Bad reserve lot' } })).toBe(0);

  await fill('Walnut desk', '10000', '15000');
  await expect(page.getByRole('cell', { name: 'Walnut desk' })).toBeVisible();
  const lot = await db.lot.findFirstOrThrow({ where: { title: 'Walnut desk' }, include: { state: true } });
  expect(lot.state?.closesAt).toEqual(lot.scheduledEnd);

  await page.goto('/o/gavel-fixtures/catalog');
  await expect(page.getByRole('row', { name: new RegExp(`Walnut desk.*${name}`) })).toBeVisible();
  // The $150.00 reserve is never shown. Scoped to this lot's row: the catalog now shows current prices, and other lots may stand at $150.00.
  await expect(page.getByRole('row', { name: /Walnut desk/ })).not.toContainText('150.00');
});
