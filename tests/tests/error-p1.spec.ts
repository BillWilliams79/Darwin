import { test, expect } from '@playwright/test';

test.describe('Error Pages', () => {
  test('ERR-02: 404 page for invalid routes', async ({ page }) => {
    // Navigate to a non-existent route
    await page.goto('/nonexistent-route-xyz');
    await page.waitForTimeout(1000);

    // Error404.jsx renders "Error 404: Resource Not Found"
    await expect(page.locator('body')).toContainText('Error 404');
    await expect(page.locator('body')).toContainText('Resource Not Found');
  });
});
