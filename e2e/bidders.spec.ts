import { expect, test } from '@playwright/test';
import { db } from '../src/core/db';
import { runDb } from '../scripts/auction-eval';
import { seedDemo } from '../scripts/seed-demo';

// D-70 (AX-05): staff suspend and reinstate a bidder with a reason; the screen says standing maximums stay live.
test.beforeAll(async () => {
  expect((await runDb()).ok).toBe(true);
  await seedDemo();
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'gavel-fixtures' } });
  const owner = await db.user.findUniqueOrThrow({ where: { email: 'owner@acme.demo.test' } });
  await db.membership.upsert({ where: { orgId_userId: { orgId: org.id, userId: owner.id } }, create: { orgId: org.id, userId: owner.id, role: 'owner' }, update: { role: 'owner' } });
}, 120_000);

test('suspend then reinstate paddle 100', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await page.goto('/o/gavel-fixtures/bidders');
  await expect(page.getByText('standing maximums stay live')).toBeVisible();
  const row = page.getByTestId('bidder-100');
  await row.getByLabel('Reason').fill('non-payment');
  await row.getByRole('button', { name: 'Suspend' }).click();
  await expect(row).toContainText('Suspended');
  await expect(row).toContainText('non-payment');
  await row.getByLabel('Reason').fill('paid in full');
  await row.getByRole('button', { name: 'Reinstate' }).click();
  await expect(row).toContainText('Active');
  const org = await db.org.findUniqueOrThrow({ where: { slug: 'gavel-fixtures' } });
  const b = await db.bidder.findUniqueOrThrow({ where: { orgId_paddle: { orgId: org.id, paddle: 100 } } });
  expect(b.status).toBe('ACTIVE');
  expect((await db.bidderStatusChange.findMany({ where: { bidderId: b.id }, orderBy: { changedAt: 'asc' } })).map((c) => c.status)).toEqual(['SUSPENDED', 'ACTIVE']);
});
