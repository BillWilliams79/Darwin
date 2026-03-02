import { test, expect } from '@playwright/test';

test.describe('Dev Servers View', () => {
  test('DEV-01: /devservers renders DataGrid', async ({ page }) => {
    await page.goto('/devservers');
    await expect(page.getByTestId('dev-servers-datagrid')).toBeVisible({ timeout: 10000 });
  });

  test('DEV-02: Dev Servers navbar link navigates correctly', async ({ page }) => {
    await page.goto('/taskcards');
    await page.getByRole('link', { name: /dev servers/i }).click();
    await expect(page).toHaveURL(/\/devservers/);
    await expect(page.getByTestId('dev-servers-datagrid')).toBeVisible({ timeout: 10000 });
  });

  test('DEV-03: Dev Servers page shows heading', async ({ page }) => {
    await page.goto('/devservers');
    await expect(page.getByRole('heading', { name: 'Dev Servers' })).toBeVisible({ timeout: 10000 });
  });
});
