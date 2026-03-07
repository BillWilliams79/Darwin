import { test, expect } from '@playwright/test';

test.describe('Error Handling P1', () => {

  test('ERR-01: API error degrades gracefully (no crash)', async ({ page }) => {
    // Mock API calls: Domains → 1 domain, Areas → 1 area, Tasks → 500 error.
    // Route patterns target the API path specifically — **/tasks** would also
    // match the page URL /taskcards (since "taskcards" contains "tasks").
    await page.route('**/eng/darwin/domains*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 99999, domain_name: 'Test Domain', sort_order: 0 }]),
      });
    });

    await page.route('**/eng/darwin/areas*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 99999, area_name: 'Test Area', domain_fk: 99999, sort_order: 0, sort_mode: 'priority', creator_fk: 'test' }]),
      });
    });

    await page.route('**/eng/darwin/tasks*', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
    });

    // Navigate to TaskPlanView — mocked API calls fire quickly
    await page.goto('/taskcards');

    // The domain tab should render with mock data
    await expect(page.getByRole('tab', { name: 'Test Domain' })).toBeVisible({ timeout: 10000 });

    // The area card should render (TanStack Query handles the 500 via retries,
    // then enters error state — component shows the area but no tasks)
    await expect(page.getByText('Test Area')).toBeVisible({ timeout: 10000 });

    // No crash — page remains functional
    await expect(page.getByRole('link', { name: /plan/i })).toBeVisible();
  });
});
