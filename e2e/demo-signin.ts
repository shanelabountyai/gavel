import type { Page } from '@playwright/test';

/** Sign in through /demo (D-81). The account may sit behind the collapsed "Other seeded accounts". */
export async function demoSignIn(page: Page, email: string) {
  await page.goto('/demo');
  const button = page.locator(`form[data-email="${email}"] button`);
  if (!(await button.isVisible())) await page.getByText('Other seeded accounts').click();
  await button.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/demo'));
}
