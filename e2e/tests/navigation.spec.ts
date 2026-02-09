import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('NAV-01: navigate between all views via NavBar', async ({ page }) => {
    // Start at Plan view
    await page.goto('/taskcards');
    await expect(page).toHaveURL(/\/taskcards/);

    // Navigate to Calendar
    await page.getByRole('link', { name: /calendar/i }).click();
    await expect(page).toHaveURL(/\/calview/);

    // Navigate to Domains
    await page.getByRole('link', { name: /domains/i }).click();
    await expect(page).toHaveURL(/\/domainedit/);

    // Navigate to Areas
    await page.getByRole('link', { name: /areas/i }).click();
    await expect(page).toHaveURL(/\/areaedit/);

    // Navigate back to Plan
    await page.getByRole('link', { name: /plan/i }).click();
    await expect(page).toHaveURL(/\/taskcards/);
  });
});
