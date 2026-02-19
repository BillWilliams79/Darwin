import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe('Calendar View P1', () => {
  let idToken: string;
  let testDomainId: string;
  let testAreaId: string;
  const testDomainName = uniqueName('CalDom');
  const testAreaName = uniqueName('CalArea');
  const createdTaskIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create test domain
    const domResult = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: testDomainName, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!domResult?.length) throw new Error('Failed to create test domain');
    testDomainId = domResult[0].id;

    // Create test area
    const areaResult = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: testAreaName, domain_fk: testDomainId, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!areaResult?.length) throw new Error('Failed to create test area');
    testAreaId = areaResult[0].id;
  });

  test.afterAll(async () => {
    for (const id of createdTaskIds) {
      try { await apiDelete('tasks', id, idToken); } catch { /* best-effort */ }
    }
    try { await apiDelete('areas', testAreaId, idToken); } catch {}
    try { await apiCall('domains', 'PUT', [{ id: testDomainId, closed: 1 }], idToken); } catch {}
  });

  test('CAL-01: done tasks appear in CalendarView', async ({ page }) => {
    const taskDesc = uniqueName('CalTask');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a done task with done_ts set to today at noon
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const doneTs = today.toISOString().slice(0, 19);

    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 1, done_ts: doneTs,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create done task');
    createdTaskIds.push(result[0].id);

    // Navigate to CalendarView (FullCalendar-based, single API call per visible range)
    await page.goto('/calview');
    await page.waitForTimeout(3000);

    // FullCalendar renders events as .fc-event elements
    const taskText = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(taskText).toBeVisible({ timeout: 10000 });
  });

  test('CAL-02: clicking task in CalendarView opens edit dialog', async ({ page }) => {
    const taskDesc = uniqueName('DayViewTask');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a done task for today
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const doneTs = today.toISOString().slice(0, 19);

    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 1, done_ts: doneTs,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create done task');
    createdTaskIds.push(result[0].id);

    // Navigate to CalendarView
    await page.goto('/calview');
    await page.waitForTimeout(3000);

    // Find the task event in FullCalendar
    const taskText = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(taskText).toBeVisible({ timeout: 10000 });

    // Click the task — opens TaskEditDialog
    await taskText.click();

    // The TaskEditDialog should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText('Edit Task');

    // The dialog should contain the task description
    const descField = dialog.locator('textarea[name="description"], input[name="description"]').first();
    await expect(descField).toHaveValue(taskDesc);

    // Close the dialog
    await dialog.getByRole('button', { name: 'Close Dialog' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test('CAL-09: day view navigation shows no phantom tasks', async ({ page }) => {
    const taskDesc = uniqueName('PhantomTest');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a done task 3 days ago
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setHours(12, 0, 0, 0);
    const doneTs = threeDaysAgo.toISOString().slice(0, 19);

    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 1, done_ts: doneTs,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create done task');
    createdTaskIds.push(result[0].id);

    // Navigate to CalendarView and switch to Day view on the task's date
    await page.goto('/calview');
    await page.waitForTimeout(2000);

    // Switch to Day view
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await page.waitForTimeout(1000);

    // Navigate to the task's date — go back 3 days via prev button
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: /prev/i }).click();
      await page.waitForTimeout(500);
    }

    // Verify task is visible on its day
    const taskEvent = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(taskEvent).toBeVisible({ timeout: 10000 });

    // Click next to advance to a day with no test tasks
    await page.getByRole('button', { name: /next/i }).click();
    await page.waitForTimeout(2000);

    // The phantom-task bug would show events briefly then clear them.
    // After settling, this day should have no events matching our test task.
    const phantomEvent = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(phantomEvent).toHaveCount(0, { timeout: 5000 });
  });
});
