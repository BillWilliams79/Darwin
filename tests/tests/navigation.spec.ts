import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('NAV-01: navigate between all views via NavBar', async ({ page }) => {
    // Start at Plan view
    await page.goto('/taskcards');
    await expect(page).toHaveURL(/\/taskcards/);

    // Navigate to Calendar
    await page.getByRole('link', { name: /calendar/i }).click();
    await expect(page).toHaveURL(/\/calview/);

    // Navigate to Domains (inside bike menu)
    await page.getByTestId('bike-menu-button').click();
    await page.getByRole('menuitem', { name: /domains/i }).click();
    await expect(page).toHaveURL(/\/domainedit/);

    // Navigate to Areas (inside bike menu)
    await page.getByTestId('bike-menu-button').click();
    await page.getByRole('menuitem', { name: /areas/i }).click();
    await expect(page).toHaveURL(/\/areaedit/);

    // Navigate to Roadmap (links to /swarm)
    await page.getByRole('link', { name: /roadmap/i }).click();
    await expect(page).toHaveURL(/\/swarm$/);

    // Navigate to Sessions
    await page.getByRole('link', { name: /sessions/i }).click();
    await expect(page).toHaveURL(/\/swarm\/sessions/);

    // Navigate to Dev Servers
    await page.getByRole('link', { name: /dev servers/i }).click();
    await expect(page).toHaveURL(/\/devservers/);

    // Navigate back to Plan
    await page.getByRole('link', { name: /plan/i }).click();
    await expect(page).toHaveURL(/\/taskcards/);
  });
});
