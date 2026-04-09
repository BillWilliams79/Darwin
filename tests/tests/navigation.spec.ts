import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('NAV-01: navigate between all views via NavBar', async ({ page }) => {
    // Start at Plan view
    await page.goto('/taskcards');
    await expect(page).toHaveURL(/\/taskcards/);

    // Navigate to Calendar
    await page.getByRole('link', { name: /calendar/i }).click();
    await expect(page).toHaveURL(/\/calview/);
    // Wait for FullCalendar root to render before interacting with the bike menu.
    // networkidle is unreliable on CalendarFC which makes continuous polling API calls.
    await page.waitForSelector('.fc', { timeout: 10000 });

    // Navigate back to Plan (needed for settings menu)
    await page.getByRole('link', { name: /plan/i }).click();
    await expect(page).toHaveURL(/\/taskcards/);

    // Navigate to Domains (via Plan page settings menu)
    await page.getByTestId('settings-menu-button').click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 5000 });
    await page.getByRole('menuitem', { name: /domains/i }).click();
    await expect(page).toHaveURL(/\/domainedit/);

    // Navigate back to Plan, then to Areas (via settings menu)
    await page.getByRole('link', { name: /plan/i }).click();
    await page.getByTestId('settings-menu-button').click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 5000 });
    await page.getByRole('menuitem', { name: /areas/i }).click();
    await expect(page).toHaveURL(/\/areaedit/);

    // Navigate to Roadmap (links to /swarm)
    await page.getByRole('link', { name: /roadmap/i }).click();
    await expect(page).toHaveURL(/\/swarm$/);

    // Navigate to Projects (via Roadmap page settings menu)
    await page.getByTestId('settings-menu-button').click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 5000 });
    await page.getByRole('menuitem', { name: /projects/i }).click();
    await expect(page).toHaveURL(/\/projectedit/);

    // Navigate back to Roadmap, then to Categories (via settings menu)
    await page.getByRole('link', { name: /roadmap/i }).click();
    await page.getByTestId('settings-menu-button').click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 5000 });
    await page.getByRole('menuitem', { name: /categories/i }).click();
    await expect(page).toHaveURL(/\/categoryedit/);

    // Navigate to Sessions
    await page.getByRole('link', { name: /sessions/i }).click();
    await expect(page).toHaveURL(/\/swarm\/sessions/);

    // Navigate to Dev Servers
    await page.getByRole('link', { name: /dev servers/i }).click();
    await expect(page).toHaveURL(/\/devservers/);
  });
});
