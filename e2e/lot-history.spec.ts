import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { demoSignIn } from './demo-signin';
import { formatCents } from '../src/auction/engine/money';
import { db } from '../src/core/db';
import { runDb } from '../scripts/auction-eval';
import { seedDemo } from '../scripts/seed-demo';

// Task 2.3: the staff history view of one seeded SNIPE lot (L006), checked against the frozen expected_bids.csv.
// The fixtures org gets the demo owner as a member so the demo sign-in reaches it; nothing else is touched.
const read = (f: string) => readFileSync(`fixtures/${f}`, 'utf8').trim().split('\n');
const [head, ...lines] = read('expected_bids.csv');
const cols = head!.split(',');
const want = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i]!, v]))).filter((r) => r.lot_id === 'L006');
const data = JSON.parse(readFileSync('fixtures/auctions.json', 'utf8'));
const fixtureLot = data.auctions.flatMap((a: { lots: { lot_id: string; title: string }[] }) => a.lots).find((l: { lot_id: string }) => l.lot_id === 'L006');
const paddle = (fid: string) => `#${data.bidders.find((b: { bidder_id: string }) => b.bidder_id === fid).paddle}`;
const cents = (v: string) => formatCents(Number(v));
const iso = (ms: string) => new Date(Number(ms)).toISOString();

test.beforeAll(async () => {
  expect((await runDb()).ok).toBe(true);
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'gavel-fixtures' } });
  const owner = await db.user.findUniqueOrThrow({ where: { email: 'owner@acme.demo.test' } });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: owner.id } }, create: { orgId: org.id, userId: owner.id, role: 'owner' }, update: { role: 'owner' } });
}, 120_000);

test('history lists every ledger row of a SNIPE lot, first and last as in expected_bids.csv', async ({ page }) => {
  const lot = await db.lot.findFirstOrThrow({ where: { title: fixtureLot.title, number: fixtureLot.lot_number } });
  await demoSignIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/gavel-fixtures/lots/${lot.id}/history`);

  const state = await db.lotState.findUniqueOrThrow({ where: { lotId: lot.id } });
  const rows = page.locator('tbody tr[data-seq]');
  await expect(rows).toHaveCount(state.bidCount);
  expect(state.bidCount).toBe(want.length);

  for (const [i, w] of [[0, want[0]!], [want.length - 1, want.at(-1)!]] as const) {
    await expect(rows.nth(i).locator('td')).toHaveText([
      w.seq!, paddle(w.bidder_id!), cents(w.max_cents!), new RegExp(`${w.outcome!}$`), cents(w.price_before_cents!), cents(w.price_after_cents!),
      w.leader_before ? paddle(w.leader_before) : '—', w.leader_after ? paddle(w.leader_after) : '—',
      iso(w.closes_before_ms!), Number(w.closes_after_ms) > Number(w.closes_before_ms) ? new RegExp(`^${iso(w.closes_after_ms!)} Extended \\+\\d+:\\d\\d$`) : iso(w.closes_after_ms!), iso(w.placed_at_ms!),
    ]);
  }
  // R18: an extension is marked in words, not only by tint
  await expect(rows.locator('.badge', { hasText: 'Extended' })).toHaveCount(want.filter((w) => Number(w.closes_after_ms) > Number(w.closes_before_ms)).length);
  expect(want.filter((w) => Number(w.closes_after_ms) > Number(w.closes_before_ms)).length).toBe(3);
  await expect(page.getByRole('heading', { name: 'Settlement' })).toBeVisible();
  await expect(page.locator('form, button, input')).toHaveCount(0); // read-only: no edit control
  // R19: one click back to the sale, one to the page a bidder sees
  await page.getByRole('link', { name: 'Bidder view' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/gavel-fixtures/lots/${lot.id}$`));
  await page.goBack();
  await page.getByRole('link', { name: /^← / }).click();
  await expect(page).toHaveURL(new RegExp(`/o/gavel-fixtures/auctions/${lot.auctionId}$`));
});
