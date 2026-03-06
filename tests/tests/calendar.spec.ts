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
    // Hard-delete the domain (ON DELETE CASCADE handles child areas/tasks)
    try { await apiDelete('domains', testDomainId, idToken); } catch {}
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

  test('CAL-03: delete task via calendar dialog', async ({ page }) => {
    const taskDesc = uniqueName('CalDel');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const doneTs = today.toISOString().slice(0, 19);

    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 1, done_ts: doneTs,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create task');
    const taskId = result[0].id;
    createdTaskIds.push(taskId);

    await page.goto('/calview');
    await page.waitForTimeout(3000);

    const event = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(event).toBeVisible({ timeout: 10000 });

    // Click event to open TaskEditDialog
    await event.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click delete icon (IconButton inside the task row within dialog)
    const taskRow = dialog.getByTestId(`task-${taskId}`);
    await taskRow.getByRole('button').click();

    // TaskDeleteDialog appears
    const deleteDialog = page.getByTestId('task-delete-dialog');
    await expect(deleteDialog).toBeVisible({ timeout: 3000 });
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    // Wait for deletion to process
    await page.waitForTimeout(2000);

    // Task should be gone from calendar
    await expect(event).not.toBeVisible({ timeout: 5000 });
  });

  test('CAL-04: drag task reschedules to different day (API verification)', async ({ page }) => {
    // FullCalendar DnD is unreliable in Playwright (issue #48).
    // This test verifies the PUT done_ts → calendar update pipeline that eventDrop triggers.
    const taskDesc = uniqueName('CalDrag');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const doneTs = today.toISOString().slice(0, 19);
    const todayStr = today.toISOString().slice(0, 10);

    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 1, done_ts: doneTs,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create task');
    const taskId = result[0].id;
    createdTaskIds.push(taskId);

    // Verify task appears on today's date
    await page.goto('/calview');
    await page.waitForTimeout(3000);
    const event = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(event).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`td[data-date="${todayStr}"] .fc-event`).filter({ hasText: taskDesc })).toBeVisible();

    // Simulate eventDrop: PUT done_ts to tomorrow (same API call eventDrop makes)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    const newDoneTs = tomorrow.toISOString().slice(0, 19);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    await apiCall('tasks', 'PUT', [{ id: taskId, done_ts: newDoneTs }], idToken);

    // Reload to refetch — task should appear on new date
    await page.reload();
    await page.waitForTimeout(3000);
    await expect(page.locator(`td[data-date="${tomorrowStr}"] .fc-event`).filter({ hasText: taskDesc })).toBeVisible({ timeout: 10000 });
  });

  test('CAL-05: month/week/day view switching', async ({ page }) => {
    const taskDesc = uniqueName('CalView');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const doneTs = today.toISOString().slice(0, 19);

    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 1, done_ts: doneTs,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create task');
    createdTaskIds.push(result[0].id);

    await page.goto('/calview');
    await page.waitForTimeout(3000);

    // Month view (default) — task visible
    const event = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(event).toBeVisible({ timeout: 10000 });

    // Switch to week view
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await page.waitForTimeout(2000);
    await expect(page.locator('.fc-event').filter({ hasText: taskDesc })).toBeVisible({ timeout: 10000 });

    // Switch to day view
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await page.waitForTimeout(2000);
    await expect(page.locator('.fc-event').filter({ hasText: taskDesc })).toBeVisible({ timeout: 10000 });

    // Switch back to month view
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await page.waitForTimeout(2000);
    await expect(page.locator('.fc-event').filter({ hasText: taskDesc })).toBeVisible({ timeout: 10000 });
  });

  test('CAL-06: toggle done via dialog removes task from calendar', async ({ page }) => {
    const taskDesc = uniqueName('CalDone');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const doneTs = today.toISOString().slice(0, 19);

    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 1, done_ts: doneTs,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create task');
    createdTaskIds.push(result[0].id);

    await page.goto('/calview');
    await page.waitForTimeout(3000);

    const event = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(event).toBeVisible({ timeout: 10000 });

    // Click event to open dialog
    await event.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click done checkbox (index 1) to toggle done=0
    const checkboxes = dialog.getByRole('checkbox');
    await checkboxes.nth(1).click();
    await page.waitForTimeout(1000);

    // Close dialog — triggers refetch via taskApiToggle
    await dialog.getByRole('button', { name: 'Close Dialog' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });

    // Wait for refetch (done=0 tasks excluded from calendar query)
    await page.waitForTimeout(3000);

    // Task should no longer appear on calendar
    await expect(event).not.toBeVisible({ timeout: 5000 });
  });

  test('CAL-07: empty calendar renders without errors', async ({ page }) => {
    await page.goto('/calview');
    await page.waitForTimeout(3000);

    // Calendar container and title should render
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Completed Tasks$/)).toBeVisible();

    // Navigate 3 months into the future — guaranteed no done tasks
    await page.locator('.fc-next-button').click();
    await page.waitForTimeout(1000);
    await page.locator('.fc-next-button').click();
    await page.waitForTimeout(1000);
    await page.locator('.fc-next-button').click();
    await page.waitForTimeout(2000);

    // Calendar still renders correctly with no events
    await expect(page.locator('.fc')).toBeVisible();
    await expect(page.getByText(/Completed Tasks$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Week', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeVisible();
    await expect(page.locator('.fc-event')).toHaveCount(0);
  });

  test('CAL-08: prev/next navigation fetches new data', async ({ page }) => {
    const taskDesc = uniqueName('CalNav');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a done task for the 15th of the previous month
    const prevMonth = new Date();
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    prevMonth.setDate(15);
    prevMonth.setHours(12, 0, 0, 0);
    const doneTs = prevMonth.toISOString().slice(0, 19);

    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 1, done_ts: doneTs,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create task');
    createdTaskIds.push(result[0].id);

    // Navigate to calendar (current month)
    await page.goto('/calview');
    await page.waitForTimeout(3000);

    // Task should NOT be visible in current month
    const event = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(event).not.toBeVisible({ timeout: 3000 });

    // Click prev to navigate to previous month
    await page.locator('.fc-prev-button').click();
    await page.waitForTimeout(3000);

    // Task should now be visible
    await expect(event).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Calendar Priorities', () => {
  let idToken: string;
  let testProjectId: string;
  let testCategoryId: string;
  let testPriorityId: string;
  const testProjectName = uniqueName('CalPriProj');
  const testCategoryName = uniqueName('CalPriCat');
  const testPriorityTitle = uniqueName('CalPri');

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create project → category → closed priority with completed_at today
    const projResult = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: testProjectName, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!projResult?.length) throw new Error('Failed to create test project');
    testProjectId = projResult[0].id;

    const catResult = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: testCategoryName, project_fk: testProjectId,
      closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!catResult?.length) throw new Error('Failed to create test category');
    testCategoryId = catResult[0].id;

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const completedAt = today.toISOString().slice(0, 19);

    const priResult = await apiCall('priorities', 'POST', {
      creator_fk: sub, title: testPriorityTitle, category_fk: testCategoryId,
      in_progress: 0, closed: 1, sort_order: 0, completed_at: completedAt,
    }, idToken) as Array<{ id: string }>;
    if (!priResult?.length) throw new Error('Failed to create test priority');
    testPriorityId = priResult[0].id;
  });

  test.afterAll(async () => {
    // Hard-delete the project (ON DELETE CASCADE handles categories/priorities)
    try { await apiDelete('projects', testProjectId, idToken); } catch {}
  });

  test('CAL-09: toggle between Tasks and Priorities modes updates title', async ({ page }) => {
    await page.goto('/calview');
    await page.waitForTimeout(3000);

    // Default mode is Tasks — title ends with "Completed Tasks"
    await expect(page.getByText(/Completed Tasks$/)).toBeVisible();

    // Click Priorities toggle
    const toggle = page.getByTestId('calendar-mode-toggle');
    await toggle.getByRole('button', { name: 'Priorities' }).click();
    await page.waitForTimeout(1000);

    // Title should now end with "Completed Priorities"
    await expect(page.getByText(/Completed Priorities$/)).toBeVisible();
    await expect(page.getByText(/Completed Tasks$/)).not.toBeVisible();

    // Click Tasks toggle to switch back
    await toggle.getByRole('button', { name: 'Tasks' }).click();
    await page.waitForTimeout(1000);

    // Title should revert to "Completed Tasks"
    await expect(page.getByText(/Completed Tasks$/)).toBeVisible();
  });

  test('CAL-10: priorities mode renders completed priority on calendar', async ({ page }) => {
    await page.goto('/calview');
    await page.waitForTimeout(3000);

    // Switch to Priorities mode
    const toggle = page.getByTestId('calendar-mode-toggle');
    await toggle.getByRole('button', { name: 'Priorities' }).click();
    await page.waitForTimeout(2000);

    // Calendar container renders with correct title
    await expect(page.locator('.fc')).toBeVisible();
    await expect(page.getByText(/Completed Priorities$/)).toBeVisible();

    // The test priority should appear as an event
    const event = page.locator('.fc-event').filter({ hasText: testPriorityTitle });
    await expect(event).toBeVisible({ timeout: 10000 });

    // Navigation buttons still work
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Week', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeVisible();
  });

  test('CAL-11: clicking priority event navigates to priority detail', async ({ page }) => {
    await page.goto('/calview');
    await page.waitForTimeout(3000);

    // Switch to Priorities mode
    const toggle = page.getByTestId('calendar-mode-toggle');
    await toggle.getByRole('button', { name: 'Priorities' }).click();
    await page.waitForTimeout(2000);

    // Click the test priority event
    const event = page.locator('.fc-event').filter({ hasText: testPriorityTitle });
    await expect(event).toBeVisible({ timeout: 10000 });
    await event.click();

    // Should navigate to the priority detail view
    await page.waitForURL(`**/swarm/priority/${testPriorityId}`, { timeout: 5000 });
    expect(page.url()).toContain(`/swarm/priority/${testPriorityId}`);
  });
});
