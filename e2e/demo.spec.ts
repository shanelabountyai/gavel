import { expect, test } from '@playwright/test';
import { seedDemo } from '../scripts/seed-demo';

// INV-27, flag-on half (the flag-off half is tests/invariants/inv-27-demo.test.ts). playwright.config.ts starts the
// server with DEMO_MODE=1; this spec seeds the same database itself.
test.beforeAll(async () => { await seedDemo(); });

test('demo sign-in lands a one-org bidder on their catalog', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'member@acme.demo.test' }).click();
  await expect(page).toHaveURL(/\/o\/acme\/catalog$/); // one org: straight in, a bidder to the catalog (staff go to the auctions)
  await expect(page.getByRole('navigation')).toContainText('Acme Studio');
});
