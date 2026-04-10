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
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

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
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

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

    // Task should be gone from calendar after deletion processes
    await expect(event).not.toBeVisible({ timeout: 10000 });
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
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
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
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
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
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Month view (default) — task visible as fc-event
    const event = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(event).toBeVisible({ timeout: 10000 });

    // Switch to week view — still fc-event
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page.locator('.fc-dayGridWeek-button.fc-button-active')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.fc-event').filter({ hasText: taskDesc })).toBeVisible({ timeout: 10000 });

    // Switch to day view — custom DayView renders (no .fc-event); task text in day-view
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await expect(page.locator('.fc-dayGridDay-button.fc-button-active')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('day-view')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('day-view').getByText(taskDesc)).toBeVisible({ timeout: 10000 });

    // Switch back to month view — fc-event visible again
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page.locator('.fc-dayGridMonth-button.fc-button-active')).toBeVisible({ timeout: 5000 });
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
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    const event = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(event).toBeVisible({ timeout: 10000 });

    // Click event to open dialog
    await event.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click done checkbox (index 1) to toggle done=0
    const checkboxes = dialog.getByRole('checkbox');
    await checkboxes.nth(1).click();

    // Close dialog — triggers refetch via taskApiToggle
    await dialog.getByRole('button', { name: 'Close Dialog' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });

    // Task should no longer appear on calendar (refetch excludes done=0 tasks)
    await expect(event).not.toBeVisible({ timeout: 10000 });
  });

  test('CAL-07: empty calendar renders without errors', async ({ page }) => {
    await page.goto('/calview');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Calendar container and title should render
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Completed Tasks$/)).toBeVisible();

    // Navigate 3 months into the future — guaranteed no done tasks
    await page.locator('.fc-next-button').click();
    await page.locator('.fc-next-button').click();
    await page.locator('.fc-next-button').click();

    // Calendar still renders correctly with no events
    await expect(page.locator('.fc')).toBeVisible();
    await expect(page.getByText(/Completed Tasks$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Week', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeVisible();
    await expect(page.locator('.fc-event')).toHaveCount(0);
  });

  test('CAL-17: all tasks render with green background; priority tasks prefixed with !', async ({ page }) => {
    const priTaskDesc = uniqueName('CalPriTask');
    const normalTaskDesc = uniqueName('CalNormTask');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const doneTs = today.toISOString().slice(0, 19);

    // Create a priority task (priority=1) and a normal task (priority=0)
    const [priResult, normResult] = await Promise.all([
      apiCall('tasks', 'POST', {
        creator_fk: sub, description: priTaskDesc, area_fk: testAreaId,
        priority: 1, done: 1, done_ts: doneTs,
      }, idToken) as Promise<Array<{ id: string }>>,
      apiCall('tasks', 'POST', {
        creator_fk: sub, description: normalTaskDesc, area_fk: testAreaId,
        priority: 0, done: 1, done_ts: doneTs,
      }, idToken) as Promise<Array<{ id: string }>>,
    ]);
    if (!priResult?.length) throw new Error('Failed to create priority task');
    if (!normResult?.length) throw new Error('Failed to create normal task');
    createdTaskIds.push(priResult[0].id, normResult[0].id);

    await page.goto('/calview');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Priority task: prefixed with '! ' and green background
    const priEvent = page.locator('.fc-event').filter({ hasText: `! ${priTaskDesc}` });
    await expect(priEvent).toBeVisible({ timeout: 10000 });
    const priBgColor = await priEvent.evaluate(el => (el as HTMLElement).style.backgroundColor);
    expect(priBgColor).toBe('rgb(232, 245, 233)'); // #E8F5E9

    // Normal task: no '! ' prefix and also green background
    const normEvent = page.locator('.fc-event').filter({ hasText: normalTaskDesc });
    await expect(normEvent).toBeVisible({ timeout: 10000 });
    await expect(normEvent).not.toContainText('! ');
    const normBgColor = await normEvent.evaluate(el => (el as HTMLElement).style.backgroundColor);
    expect(normBgColor).toBe('rgb(232, 245, 233)'); // #E8F5E9
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
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Task should NOT be visible in current month
    const event = page.locator('.fc-event').filter({ hasText: taskDesc });
    await expect(event).not.toBeVisible({ timeout: 3000 });

    // Click prev to navigate to previous month
    await page.locator('.fc-prev-button').click();

    // Task should now be visible
    await expect(event).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Calendar Requirements', () => {
  let idToken: string;
  let testProjectId: string;
  let testCategoryId: string;
  let testRequirementId: string;
  const testProjectName = uniqueName('CalReqProj');
  const testCategoryName = uniqueName('CalReqCat');
  const testRequirementTitle = uniqueName('CalReq');

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create project → category → closed requirement with completed_at today
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

    const priResult = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: testRequirementTitle, category_fk: testCategoryId,
      requirement_status: 'completed', sort_order: 0, completed_at: completedAt,
    }, idToken) as Array<{ id: string }>;
    if (!priResult?.length) throw new Error('Failed to create test requirement');
    testRequirementId = priResult[0].id;
  });

  test.afterAll(async () => {
    // Hard-delete the project (ON DELETE CASCADE handles categories/requirements)
    try { await apiDelete('projects', testProjectId, idToken); } catch {}
  });

  test('CAL-09: multi-select toggles update title', async ({ page }) => {
    await page.goto('/calview');
    await page.evaluate(() => localStorage.removeItem('darwin_calendar_view'));
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Default mode is Tasks only — title ends with "Completed Tasks"
    await expect(page.getByText(/Completed Tasks$/)).toBeVisible();

    // Click Requirements to add it — now Tasks+Requirements selected, title becomes "Calendar"
    const toggle = page.getByTestId('calendar-mode-toggle');
    await toggle.getByRole('button', { name: 'Requirements' }).click();
    await expect(page.getByText(/'\d{2} Calendar$/)).toBeVisible({ timeout: 5000 });

    // Deselect Tasks — only Requirements selected, title becomes "Completed Requirements"
    await toggle.getByRole('button', { name: 'Tasks' }).click();
    await expect(page.getByText(/Completed Requirements$/)).toBeVisible({ timeout: 5000 });

    // Re-select Tasks — back to multi-select "Calendar"
    await toggle.getByRole('button', { name: 'Tasks' }).click();
    await expect(page.getByText(/'\d{2} Calendar$/)).toBeVisible({ timeout: 5000 });

    // Deselect Requirements — back to Tasks only, "Completed Tasks"
    await toggle.getByRole('button', { name: 'Requirements' }).click();
    await expect(page.getByText(/Completed Tasks$/)).toBeVisible({ timeout: 5000 });
  });

  test('CAL-10: requirements mode renders completed requirement on calendar', async ({ page }) => {
    await page.goto('/calview');
    await page.evaluate(() => localStorage.removeItem('darwin_calendar_view'));
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Switch to Requirements-only mode (deselect Tasks, select Requirements)
    const toggle = page.getByTestId('calendar-mode-toggle');
    await toggle.getByRole('button', { name: 'Tasks' }).click();
    await toggle.getByRole('button', { name: 'Requirements' }).click();
    await expect(page.getByText(/Completed Requirements$/)).toBeVisible({ timeout: 5000 });

    // Calendar container renders with correct title
    await expect(page.locator('.fc')).toBeVisible();
    await expect(page.getByText(/Completed Requirements$/)).toBeVisible();

    // The test requirement should appear as an event
    const event = page.locator('.fc-event').filter({ hasText: testRequirementTitle });
    await expect(event).toBeVisible({ timeout: 10000 });

    // Navigation buttons still work
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Week', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeVisible();
  });

  test('CAL-11: clicking requirement event navigates to requirement detail', async ({ page }) => {
    await page.goto('/calview');
    await page.evaluate(() => localStorage.removeItem('darwin_calendar_view'));
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Add Requirements to selection (multi-select)
    const toggle = page.getByTestId('calendar-mode-toggle');
    await toggle.getByRole('button', { name: 'Requirements' }).click();
    await page.waitForTimeout(2000);

    // Click the test requirement event
    const event = page.locator('.fc-event').filter({ hasText: testRequirementTitle });
    await expect(event).toBeVisible({ timeout: 10000 });
    await event.click();

    // Should navigate to the requirement detail view
    await page.waitForURL(`**/swarm/requirement/${testRequirementId}`, { timeout: 5000 });
    expect(page.url()).toContain(`/swarm/requirement/${testRequirementId}`);
  });

  test('CAL-20: back button from requirement detail returns to calendar', async ({ page }) => {
    await page.goto('/calview');
    await page.evaluate(() => localStorage.removeItem('darwin_calendar_view'));
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Enable Requirements in toggle
    const toggle = page.getByTestId('calendar-mode-toggle');
    await toggle.getByRole('button', { name: 'Requirements' }).click();
    await page.waitForTimeout(2000);

    // Click the requirement event
    const event = page.locator('.fc-event').filter({ hasText: testRequirementTitle });
    await expect(event).toBeVisible({ timeout: 10000 });
    await event.click();

    // Verify we're on the requirement detail page
    await page.waitForURL(`**/swarm/requirement/${testRequirementId}`, { timeout: 5000 });

    // Click Back — should return to calendar
    await page.getByTestId('btn-back-to-swarm').click();
    await expect(page).toHaveURL(/\/calview$/, { timeout: 5000 });
  });
});

test.describe('Calendar View Persistence', () => {
  test.beforeEach(async ({ page }) => {
    // Clear persisted calendar state before each test
    await page.goto('/calview');
    await page.evaluate(() => localStorage.removeItem('darwin_calendar_view'));
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
  });

  test('CAL-12: view type persists across route navigation', async ({ page }) => {
    // Default is Month view — switch to Week
    await page.getByRole('button', { name: 'Week', exact: true }).click();

    // Verify Week button is active (fc adds fc-button-active class)
    await expect(page.locator('.fc-dayGridWeek-button.fc-button-active')).toBeVisible({ timeout: 5000 });

    // Navigate away to a different route
    await page.goto('/');

    // Return to calendar
    await page.goto('/calview');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Week view should be restored
    await expect(page.locator('.fc-dayGridWeek-button.fc-button-active')).toBeVisible();
  });

  test('CAL-13: date persists across navigation', async ({ page }) => {
    // Get the current title (current month)
    const initialTitle = await page.getByText(/Completed Tasks$/).textContent();

    // Navigate to previous month
    await page.locator('.fc-prev-button').click();

    // Wait for title to change (previous month)
    await expect.poll(async () => {
      return await page.getByText(/Completed Tasks$/).textContent();
    }, { timeout: 5000 }).not.toBe(initialTitle);
    const prevMonthTitle = await page.getByText(/Completed Tasks$/).textContent();

    // Navigate away
    await page.goto('/');

    // Return to calendar
    await page.goto('/calview');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Should still show previous month, not current month
    const restoredTitle = await page.getByText(/Completed Tasks$/).textContent();
    expect(restoredTitle).toBe(prevMonthTitle);
  });

  test('CAL-14: mode persists across navigation', async ({ page }) => {
    // Add Requirements to selection (multi-select: Tasks + Requirements)
    const toggle = page.getByTestId('calendar-mode-toggle');
    await toggle.getByRole('button', { name: 'Requirements' }).click();

    // Verify multi-mode title "Calendar"
    await expect(page.getByText(/'\d{2} Calendar$/)).toBeVisible({ timeout: 5000 });

    // Navigate away
    await page.goto('/');

    // Return to calendar
    await page.goto('/calview');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Multi-mode should be restored — still "Calendar"
    await expect(page.getByText(/'\d{2} Calendar$/)).toBeVisible();
  });

  test('CAL-15: full page reload preserves all settings', async ({ page }) => {
    // Switch to Day view
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await expect(page.locator('.fc-dayGridDay-button.fc-button-active')).toBeVisible({ timeout: 5000 });

    // Navigate to previous day
    await page.locator('.fc-prev-button').click();

    // Add Requirements to selection (multi-select: Tasks + Requirements)
    const toggle = page.getByTestId('calendar-mode-toggle');
    await toggle.getByRole('button', { name: 'Requirements' }).click();
    await expect(page.getByText(/'\d{2} Calendar$/)).toBeVisible({ timeout: 5000 });

    // Capture state before reload
    const titleBeforeReload = await page.getByText(/'\d{2} Calendar$/).textContent();

    // Full page reload
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // All settings should be preserved
    // Day view
    await expect(page.locator('.fc-dayGridDay-button.fc-button-active')).toBeVisible({ timeout: 5000 });
    // Multi-mode preserved
    await expect(page.getByText(/'\d{2} Calendar$/)).toBeVisible();
    // Same date
    const titleAfterReload = await page.getByText(/'\d{2} Calendar$/).textContent();
    expect(titleAfterReload).toBe(titleBeforeReload);
  });

  test('CAL-16: Today button works correctly with persistence', async ({ page }) => {
    // Get current month title
    const currentMonthTitle = await page.getByText(/Completed Tasks$/).textContent();

    // Navigate 3 months back
    await page.locator('.fc-prev-button').click();
    await page.locator('.fc-prev-button').click();
    await page.locator('.fc-prev-button').click();

    // Wait for title to change (3 months back)
    await expect.poll(async () => {
      return await page.getByText(/Completed Tasks$/).textContent();
    }, { timeout: 5000 }).not.toBe(currentMonthTitle);
    const oldMonthTitle = await page.getByText(/Completed Tasks$/).textContent();

    // Navigate away and back — should still be on old month (persisted)
    await page.goto('/');
    await page.goto('/calview');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
    const restoredTitle = await page.getByText(/Completed Tasks$/).textContent();
    expect(restoredTitle).toBe(oldMonthTitle);

    // Click Today button — should return to current month
    await page.locator('.fc-today-button').click();
    await expect.poll(async () => {
      return await page.getByText(/Completed Tasks$/).textContent();
    }, { timeout: 5000 }).toBe(currentMonthTitle);
    const todayTitle = await page.getByText(/Completed Tasks$/).textContent();
    expect(todayTitle).toBe(currentMonthTitle);

    // Navigate away and back — should now persist current month
    await page.goto('/');
    await page.goto('/calview');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
    const finalTitle = await page.getByText(/Completed Tasks$/).textContent();
    expect(finalTitle).toBe(currentMonthTitle);
  });
});

test.describe('DayView', () => {
  let idToken: string;
  let testDomainId: string;
  let testAreaId: string;
  const testDomainName = uniqueName('DVDom');
  const testAreaName = uniqueName('DVArea');
  const createdTaskIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const domResult = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: testDomainName, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!domResult?.length) throw new Error('Failed to create domain');
    testDomainId = domResult[0].id;

    const areaResult = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: testAreaName, domain_fk: testDomainId, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!areaResult?.length) throw new Error('Failed to create area');
    testAreaId = areaResult[0].id;
  });

  test.beforeEach(async ({ page }) => {
    // Always start from month view with fresh state
    await page.goto('/calview');
    await page.evaluate(() => localStorage.removeItem('darwin_calendar_view'));
    await page.reload();
    await expect(page.locator('.fc-view-harness')).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async () => {
    try { await apiDelete('domains', testDomainId, idToken); } catch {}
  });

  test('CAL-17: clicking date cell opens DayView', async ({ page }) => {
    const todayStr = new Date().toISOString().slice(0, 10);

    // Click today's date cell in the month grid
    const dateCell = page.locator(`td[data-date="${todayStr}"]`).first();
    await expect(dateCell).toBeVisible({ timeout: 5000 });
    await dateCell.click();

    // Wait for FullCalendar to switch to day view, then DayView component renders
    await expect(page.locator('.fc-dayGridDay-button.fc-button-active')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('day-view')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.fc-view-harness')).not.toBeVisible();
  });

  test('CAL-18: DayView shows task grouped under domain/area', async ({ page }) => {
    const taskDesc = uniqueName('DVTask');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const doneTs = today.toISOString().slice(0, 19);
    const todayStr = today.toISOString().slice(0, 10);

    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 1, done_ts: doneTs,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create task');
    createdTaskIds.push(result[0].id);

    // Navigate to calendar; Prev → Today ensures FullCalendar anchors on today, then Day
    await page.goto('/calview');
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });
    await page.locator('.fc-prev-button').click();
    await page.locator('.fc-today-button').click();
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await expect(page.locator('.fc-dayGridDay-button.fc-button-active')).toBeVisible({ timeout: 5000 });

    await expect(page.getByTestId('day-view')).toBeVisible({ timeout: 10000 });

    // Task description, domain name, and area name should all appear
    await expect(page.getByTestId('day-view').getByText(taskDesc)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('day-view').getByText(testDomainName)).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('day-view').getByText(testAreaName)).toBeVisible({ timeout: 5000 });
  });

  test('CAL-19: DayView persists day view across navigation', async ({ page }) => {
    const todayStr = new Date().toISOString().slice(0, 10);

    await page.goto('/calview');
    await expect(page.locator('.fc-view-harness')).toBeVisible({ timeout: 10000 });
    const dateCell = page.locator(`td[data-date="${todayStr}"]`).first();
    await dateCell.click();

    // Wait for day view to fully activate
    await expect(page.locator('.fc-dayGridDay-button.fc-button-active')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('day-view')).toBeVisible({ timeout: 10000 });

    // Navigate away and back
    await page.goto('/');
    await page.goto('/calview');

    // Should still be in day view (savedViewType persisted)
    await expect(page.getByTestId('day-view')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.fc-dayGridDay-button.fc-button-active')).toBeVisible({ timeout: 5000 });
  });
});
