import { expect, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { db } from '../src/core/db';
import { runDb } from '../scripts/auction-eval';
import { seedDemo } from '../scripts/seed-demo';

// Task 3.1: staff create an auction and a lot, and it appears in the catalog; a bad reserve is refused and writes nothing.
// UX-15 (D-79): prices are typed in dollars and stored as whole cents by string parsing; the page says "Lot N published"
// and marks the row. R-10 + R-12 (D-84): times are typed and printed in the sale's zone, the zone named; a lot with no
// close of its own closes at the first close plus (number − 1) × stagger.
test.beforeAll(async () => {
  expect((await runDb()).ok).toBe(true);
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'gavel-fixtures' } });
  const owner = await db.user.findUniqueOrThrow({ where: { email: 'owner@acme.demo.test' } });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: owner.id } }, create: { orgId: org.id, userId: owner.id, role: 'owner' }, update: { role: 'owner' } });
}, 120_000);

test('create auction and lots in the house zone with staggered closes, see them in the catalog; reserve below start is refused', async ({ page }) => {
  const name = `E2E auction ${Date.now()}`;
  await demoSignIn(page, 'owner@acme.demo.test');
  await page.goto('/o/gavel-fixtures/auctions');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/New_York');
  await page.getByLabel('Opens', { exact: true }).fill('2031-01-01T10:00');
  await expect(page.getByTestId('opensAt-hint')).toContainText('= 2031-01-01 10:00 EST, opens in'); // read in the sale's zone, not UTC
  await page.getByLabel('First lot closes (optional)').fill('2031-01-01T12:00');
  await page.getByLabel('Stagger (seconds between lot closes)').fill('60');
  await page.getByRole('button', { name: 'Create auction' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByTestId('house-time')).toHaveText('Times are shown in America/New_York. Lots close from 2031-01-01 12:00 EST, 60 s apart, unless a lot sets its own close.');
  const auction = await db.auction.findFirstOrThrow({ where: { name } });
  expect([auction.timeZone, auction.opensAt, auction.firstCloseAt, auction.staggerSeconds]).toEqual(['America/New_York', new Date('2031-01-01T15:00:00Z'), new Date('2031-01-01T17:00:00Z'), 60]);

  const fill = async (title: string, start: string, reserve: string, closes = '') => {
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Start price ($)').fill(start);
    await page.getByLabel('Reserve ($, optional)').fill(reserve);
    await page.getByLabel(/^Closes/).fill(closes);
    if (closes) await expect(page.getByTestId('scheduledEnd-hint')).toContainText(`= ${closes.replace('T', ' ')} EST, closes in`);
    await page.getByRole('button', { name: 'Create and publish lot' }).click();
  };
  await fill('Bad reserve lot', '100', '50');
  await expect(page.locator('form [role=alert]')).toHaveText('Reserve must be at least the start price.');
  expect(await db.lot.count({ where: { title: 'Bad reserve lot' } })).toBe(0);

  await fill('Exponent lot', '1e2', '');
  await expect(page.locator('form [role=alert]')).toContainText('Start price: give dollars and cents');
  expect(await db.lot.count({ where: { title: 'Exponent lot' } })).toBe(0);

  await fill('Walnut desk', '100', '150'); // no close given: the first close
  await expect(page.getByTestId('published')).toHaveText('Lot 1 published.');
  await expect(page.locator('tr.row-new')).toContainText('Walnut desk');
  const lot = await db.lot.findFirstOrThrow({ where: { title: 'Walnut desk' }, include: { state: true } });
  expect([lot.startCents, lot.reserveCents, lot.scheduledEnd]).toEqual([10000, 15000, new Date('2031-01-01T17:00:00Z')]);
  expect(lot.state?.closesAt).toEqual(lot.scheduledEnd);

  await fill('Half dollar lot', '100.5', ''); // lot 2: first close + 60 s
  await expect(page.getByTestId('published')).toHaveText('Lot 2 published.');
  const second = await db.lot.findFirstOrThrow({ where: { title: 'Half dollar lot' } });
  expect([second.startCents, second.scheduledEnd]).toEqual([10050, new Date('2031-01-01T17:01:00Z')]);

  await fill('Own close lot', '100', '', '2031-01-02T09:30'); // an explicit close wins over the stagger
  await expect(page.getByTestId('published')).toHaveText('Lot 3 published.');
  expect((await db.lot.findFirstOrThrow({ where: { title: 'Own close lot' } })).scheduledEnd).toEqual(new Date('2031-01-02T14:30:00Z'));

  await page.goto('/o/gavel-fixtures/catalog');
  const desk = page.getByRole('row', { name: new RegExp(`Walnut desk.*${name}`) });
  await expect(desk).toBeVisible();
  // R21: relative on the page, the exact instant in the title, in the house's zone (R-12)
  await expect(desk.locator('time')).toHaveText(/^Closes in \d+ d \d+ h$/);
  await expect(desk.locator('time')).toHaveAttribute('title', '2031-01-01 12:00 EST');
  // The $150.00 reserve is never shown. Scoped to this lot's row: the catalog now shows current prices, and other lots may stand at $150.00.
  await expect(page.getByRole('row', { name: /Walnut desk/ })).not.toContainText('150.00');
});
