import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { formatCents } from '../src/auction/engine/money';
import { db } from '../src/core/db';
import { runDb } from '../scripts/auction-eval';
import { seedDemo } from '../scripts/seed-demo';

// R-15 (D-86): the staff recap of the first fixture sale against expected_lots.csv, and the two CSV downloads.
const [head, ...lines] = readFileSync('fixtures/expected_lots.csv', 'utf8').trim().split('\n');
const cols = head!.split(',');
const a1 = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i]!, v]))).filter((r) => r.auction_id === 'A1');
const sold = a1.filter((r) => r.outcome === 'SOLD');
const sum = (k: string) => sold.reduce((a, r) => a + Number(r[k]), 0);

test.beforeAll(async () => {
  expect((await runDb()).ok).toBe(true);
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'gavel-fixtures' } });
  const owner = await db.user.findUniqueOrThrow({ where: { email: 'owner@acme.demo.test' } });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: owner.id } }, create: { orgId: org.id, userId: owner.id, role: 'owner' }, update: { role: 'owner' } });
}, 120_000);

test('the Harlan recap matches expected_lots.csv, and the sale and lot ledgers download as CSV', async ({ page }) => {
  const auction = await db.auction.findFirstOrThrow({ where: { name: { startsWith: 'Harlan' } } });
  await demoSignIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/gavel-fixtures/auctions/${auction.id}`);
  await page.getByRole('link', { name: 'Sale recap' }).click();
  await expect(page.getByRole('heading', { name: `Sale recap: ${auction.name}` })).toBeVisible();
  await expect(page.getByTestId('offered')).toHaveText(String(a1.length));
  await expect(page.getByTestId('sold')).toHaveText(String(sold.length));
  await expect(page.getByTestId('hammer')).toHaveText(formatCents(sum('hammer_cents')));
  await expect(page.getByTestId('premium')).toHaveText(formatCents(sum('premium_cents')));
  const extended = a1.filter((r) => Number(r.extension_count) > 0);
  await expect(page.getByTestId('extended')).toHaveText(`${extended.length} lots, ${extended.reduce((a, r) => a + Number(r.extension_count), 0)} extensions`);
  await expect(page.getByTestId('unsold')).toContainText('UNSOLD_WITHDRAWN');
  await expect(page.getByTestId('lots').locator('tbody tr')).toHaveCount(a1.length);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('csv-sale').click()]);
  expect(dl.suggestedFilename()).toMatch(/ledger\.csv$/);
  const text = readFileSync(await dl.path(), 'utf8');
  expect(text.split('\r\n')[0]).toMatch(/^lot_number,lot_title,seq,bidder_paddle/);
  expect(text.trim().split('\r\n').length - 1).toBe(await db.bid.count({ where: { lot: { auctionId: auction.id } } }));

  // one lot's CSV from its history page
  const lot = await db.lot.findFirstOrThrow({ where: { auctionId: auction.id, number: 6 } });
  await page.goto(`/o/gavel-fixtures/lots/${lot.id}/history`);
  const [one] = await Promise.all([page.waitForEvent('download'), page.getByTestId('csv-lot').click()]);
  expect(readFileSync(await one.path(), 'utf8').trim().split('\r\n').length - 1).toBe(7); // L006, SNIPE: 7 rows
});
