import { test, expect } from '@playwright/test';

test.describe('Error Handling P1', () => {

  test('ERR-01: API error shows snackbar', async ({ page }) => {
    // Mock all API calls for fast, isolated test.
    // Domains → 1 domain, Areas → 1 area, Tasks → 500 error.

    await page.route('**/domains**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 99999, domain_name: 'Test Domain', sort_order: 0 }]),
      });
    });

    await page.route('**/areas**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 99999, area_name: 'Test Area', domain_fk: 99999, sort_order: 0, sort_mode: 'priority', creator_fk: 'test' }]),
      });
    });

    await page.route('**/tasks**', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
    });

    // Navigate to TaskPlanView — mocked API calls fire quickly
    await page.goto('/taskcards');

    // Snackbar appears via Zustand store (single shared SnackBar at App root).
    // Use auto-retrying assertion to catch the 2-second visibility window.
    const snackbarMessage = page.locator('.MuiSnackbarContent-message').first();
    await expect(snackbarMessage).toBeVisible({ timeout: 10000 });
    await expect(snackbarMessage).toContainText('Unable to read tasks');
    await expect(snackbarMessage).toContainText('500');

    // Verify snackbar auto-hides (autoHideDuration=2000)
    await expect(snackbarMessage).not.toBeVisible({ timeout: 5000 });
  });
});
