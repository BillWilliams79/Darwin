import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe.serial('Task Management P1', () => {
  let idToken: string;
  let testDomainId: string;
  let testAreaId: string;
  const testDomainName = uniqueName('TaskP1Dom');
  const testAreaName = uniqueName('TaskP1Area');
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

  /** Navigate to TaskPlanView and select the test domain tab. */
  async function goToTestDomain(page: import('@playwright/test').Page) {
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1000);
  }

  test('TASK-06: update task description', async ({ page }) => {
    const taskDesc = uniqueName('EditTask');
    const updatedDesc = uniqueName('Updated');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create task via API
    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 0,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test task');
    const taskId = result[0].id;
    createdTaskIds.push(taskId);

    await goToTestDomain(page);

    // Find the task row
    const taskRow = page.getByTestId(`task-${taskId}`);
    await expect(taskRow).toBeVisible({ timeout: 5000 });

    // Find the description field (textarea or input with name="description")
    const descField = taskRow.locator('textarea[name="description"], input[name="description"]').first();
    await expect(descField).toBeVisible();

    // Clear and type updated description
    await descField.fill(updatedDesc);
    await descField.blur();

    // Wait for PUT
    await page.waitForTimeout(1000);

    // Verify persists after reload
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1500);

    const taskRowAfter = page.getByTestId(`task-${taskId}`);
    await expect(taskRowAfter).toBeVisible({ timeout: 5000 });
    const descAfter = taskRowAfter.locator('textarea[name="description"], input[name="description"]').first();
    await expect(descAfter).toHaveValue(updatedDesc);
  });

  test('TASK-07: task edit dialog in CalendarView', async ({ page }) => {
    const taskDesc = uniqueName('CalDialogTask');
    const updatedDesc = uniqueName('DialogUpdated');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a done task with done_ts set to today (so it appears in CalendarView)
    const now = new Date();
    // Set to noon today for visibility in the calendar
    now.setHours(12, 0, 0, 0);
    const doneTs = now.toISOString().slice(0, 19);

    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 1, done_ts: doneTs,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create done test task');
    const taskId = result[0].id;
    createdTaskIds.push(taskId);

    // Navigate to CalendarView
    await page.goto('/calview');
    await page.waitForTimeout(2000);

    // Find the task description text in the calendar
    // CalendarTask renders a Typography with the description, clicking it opens TaskEditDialog
    const taskText = page.locator('.task-calendar').filter({ hasText: taskDesc });
    await expect(taskText).toBeVisible({ timeout: 10000 });

    // Click the task to open TaskEditDialog
    await taskText.click();

    // TaskEditDialog should be visible
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText('Edit Task');

    // The dialog contains a TaskEdit component with a description field
    const dialogDescField = dialog.locator('textarea[name="description"], input[name="description"]').first();
    await expect(dialogDescField).toBeVisible();
    await expect(dialogDescField).toHaveValue(taskDesc);

    // Edit the description
    await dialogDescField.fill(updatedDesc);
    // Trigger save via blur (the onBlur handler in DayView's descriptionOnBlur)
    await dialogDescField.blur();
    await page.waitForTimeout(500);

    // Close the dialog
    await dialog.getByRole('button', { name: 'Close Dialog' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });

    // Wait for re-render after dialog closes (it toggles taskApiToggle)
    await page.waitForTimeout(1500);

    // Verify the updated description appears in the calendar
    const updatedText = page.locator('.task-calendar').filter({ hasText: updatedDesc });
    await expect(updatedText).toBeVisible({ timeout: 5000 });
  });

  test('TASK-09: priority set during task creation persists', async ({ page }) => {
    const taskDesc = uniqueName('PrioRace');

    await goToTestDomain(page);

    const areaCard = page.getByTestId(`area-card-${testAreaId}`);
    const template = areaCard.getByTestId('task-template');
    const descField = template.locator('textarea, input[type="text"]').first();

    // Type description in template
    await descField.fill(taskDesc);

    // Click priority checkbox — triggers blur (POST) then click (priority toggle)
    const priorityCheckbox = template.getByRole('checkbox').nth(0);
    await priorityCheckbox.click();

    // Wait for POST + follow-up PUT to complete
    await page.waitForTimeout(2000);

    // Verify the task was created with priority checked
    const taskElement = areaCard
      .locator('[data-testid^="task-"]:not([data-testid="task-template"])')
      .filter({ hasText: taskDesc });
    await expect(taskElement).toBeVisible({ timeout: 5000 });
    const taskPrioCheckbox = taskElement.getByRole('checkbox').nth(0);
    await expect(taskPrioCheckbox).toBeChecked();

    // Verify persists after reload (proves server has priority=1)
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1500);

    const taskAfterReload = areaCard
      .locator('[data-testid^="task-"]:not([data-testid="task-template"])')
      .filter({ hasText: taskDesc });
    await expect(taskAfterReload).toBeVisible({ timeout: 5000 });
    await expect(taskAfterReload.getByRole('checkbox').nth(0)).toBeChecked();

    // Track for cleanup
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const tasks = await apiCall(
      `tasks?creator_fk=${sub}&area_fk=${testAreaId}&done=0`,
      'GET', '', idToken,
    ) as Array<{ id: string; description: string }>;
    const created = tasks?.find(t => t.description === taskDesc);
    if (created) createdTaskIds.push(created.id);
  });

  test('TASK-10: no duplicate task when Enter then quick priority click', async ({ page }) => {
    const taskDesc = uniqueName('NoDupe');

    await goToTestDomain(page);

    const areaCard = page.getByTestId(`area-card-${testAreaId}`);
    const template = areaCard.getByTestId('task-template');
    const descField = template.locator('textarea, input[type="text"]').first();

    // Type and press Enter (first save)
    await descField.fill(taskDesc);
    await descField.press('Enter');

    // Immediately click priority (would have caused duplicate POST before fix)
    const priorityCheckbox = template.getByRole('checkbox').nth(0);
    await priorityCheckbox.click();

    // Wait for everything to settle
    await page.waitForTimeout(2500);

    // Reload and verify exactly one task with this description
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1500);

    const matchingTasks = areaCard
      .locator('[data-testid^="task-"]:not([data-testid="task-template"])')
      .filter({ hasText: taskDesc });
    await expect(matchingTasks).toHaveCount(1);

    // Cleanup
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const tasks = await apiCall(
      `tasks?creator_fk=${sub}&area_fk=${testAreaId}&done=0`,
      'GET', '', idToken,
    ) as Array<{ id: string; description: string }>;
    for (const t of (tasks || [])) {
      if (t.description === taskDesc) createdTaskIds.push(t.id);
    }
  });

  test('TASK-08: template row controls disabled until parent area saved', async ({ page }) => {
    await goToTestDomain(page);

    // Scope to the visible tab panel for the test domain
    const panel = page.locator('[role="tabpanel"]:not([hidden])').first();

    // Find the template area card (area with id='') within the visible panel
    const templateCard = panel.getByTestId('area-card-template');
    await expect(templateCard).toBeVisible({ timeout: 5000 });

    // The task template inside the unsaved area card should have disabled controls.
    // TaskEdit checks: disabled = {areaId !== '' ? false : areaName === '' ? true : false}
    // For template area card: areaId='' and areaName='' → disabled=true
    const taskTemplate = templateCard.getByTestId('task-template');
    await expect(taskTemplate).toBeVisible();

    // Check that the priority checkbox is disabled
    const priorityCheckbox = taskTemplate.getByRole('checkbox').nth(0);
    await expect(priorityCheckbox).toBeDisabled();

    // Check that the done checkbox is disabled
    const doneCheckbox = taskTemplate.getByRole('checkbox').nth(1);
    await expect(doneCheckbox).toBeDisabled();

    // Check that the description field is disabled
    const descField = taskTemplate.locator('textarea[name="description"], input[name="description"]').first();
    await expect(descField).toBeDisabled();
  });
});
