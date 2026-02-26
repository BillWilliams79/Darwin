import { test, expect } from '@playwright/test';

test.describe('Swarm P1 — Navigation', () => {

  test('SWM-01: Swarm nav link navigates to /swarm', async ({ page }) => {
    await page.goto('/taskcards');
    await page.getByRole('link', { name: /swarm/i }).click();
    await expect(page).toHaveURL(/\/swarm/);
  });

  test('SWM-02: /swarm renders domain tabs', async ({ page }) => {
    await page.goto('/swarm');
    // Domain tabs should appear (role="tab" elements)
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    const tabs = page.getByRole('tab');
    await expect(tabs.first()).toBeVisible();
  });

  test('SWM-03: /swarm renders content area (projects or empty state)', async ({ page }) => {
    await page.goto('/swarm');
    // Either a tabpanel (projects exist) or the empty-state message should appear
    const tabpanel = page.locator('[role="tabpanel"]:not([hidden])');
    const emptyState = page.getByText('No projects yet');
    await expect(tabpanel.or(emptyState)).toBeVisible({ timeout: 10000 });
  });

});
