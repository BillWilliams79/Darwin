import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';
import { dragAndDrop } from '../helpers/react-dnd-drag';

test.describe('Task Management', () => {
  let idToken: string;
  let testDomainId: string;
  let testAreaId: string;
  let testArea2Id: string;
  const testDomainName = uniqueName('TaskDomain');
  const testAreaName = uniqueName('TaskArea');
  const testArea2Name = uniqueName('TaskArea2');
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

    // Create two test areas
    const area1 = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: testAreaName, domain_fk: testDomainId, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!area1?.length) throw new Error('Failed to create test area 1');
    testAreaId = area1[0].id;

    const area2 = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: testArea2Name, domain_fk: testDomainId, closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!area2?.length) throw new Error('Failed to create test area 2');
    testArea2Id = area2[0].id;
  });

  test.afterAll(async () => {
    // Clean up: delete tasks → areas → close domain
    for (const id of createdTaskIds) {
      try { await apiDelete('tasks', id, idToken); } catch { /* best-effort */ }
    }
    try { await apiDelete('areas', testAreaId, idToken); } catch {}
    try { await apiDelete('areas', testArea2Id, idToken); } catch {}
    try { await apiCall('domains', 'PUT', [{ id: testDomainId, closed: 1 }], idToken); } catch {}
  });

  /** Navigate to TaskPlanView and select the test domain tab. */
  async function goToTestDomain(page: import('@playwright/test').Page) {
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1000);
  }

  test('TASK-01: create task via template pattern', async ({ page }) => {
    const taskDesc = uniqueName('Task');

    await goToTestDomain(page);

    // Find the first area card and its task template
    const areaCard = page.getByTestId(`area-card-${testAreaId}`);
    await expect(areaCard).toBeVisible({ timeout: 5000 });

    // The task template is the last task row with id=''
    const template = areaCard.getByTestId('task-template');
    await expect(template).toBeVisible();

    // Type description in the template's text field and press Enter
    const descField = template.locator('textarea, input[type="text"]').first();
    await descField.fill(taskDesc);
    await descField.press('Enter');

    // Wait for task to be saved and re-rendered
    await page.waitForTimeout(1500);

    // Verify the task appears in the area card (with a real id, not template)
    const taskElement = areaCard.locator('[data-testid^="task-"]:not([data-testid="task-template"])').filter({ hasText: taskDesc });
    await expect(taskElement).toBeVisible({ timeout: 5000 });

    // A new blank template should still exist
    await expect(areaCard.getByTestId('task-template')).toBeVisible();

    // Track for cleanup
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const tasks = await apiCall(
      `tasks?creator_fk=${sub}&area_fk=${testAreaId}&done=0`,
      'GET', '', idToken,
    ) as Array<{ id: string; description: string }>;
    const created = tasks?.find(t => t.description === taskDesc);
    if (created) createdTaskIds.push(created.id);
  });

  test('TASK-02: toggle task done', async ({ page }) => {
    // Create a task via API
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const taskDesc = uniqueName('DoneTask');
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

    // Click the done checkbox (second checkbox in the task row)
    const checkboxes = taskRow.getByRole('checkbox');
    await checkboxes.nth(1).click();

    // Wait for the PUT to complete
    await page.waitForTimeout(1000);

    // The task stays in the local state array with done=1 (shows with strikethrough).
    // It only disappears after a page refresh when the API re-fetches (done=0 filter).
    // Verify the done checkbox is now checked.
    await expect(checkboxes.nth(1)).toBeChecked();

    // Verify the task disappears after reload (API only fetches done=0)
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1500);
    await expect(taskRow).not.toBeVisible({ timeout: 5000 });
  });

  test('TASK-03: toggle task priority', async ({ page }) => {
    // Create a task via API
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const taskDesc = uniqueName('PrioTask');
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

    // Click the priority checkbox (first checkbox in the task row)
    const checkboxes = taskRow.getByRole('checkbox');
    await checkboxes.nth(0).click();

    // Wait for re-sort (priority tasks move to top)
    await page.waitForTimeout(500);

    // Verify task is still visible and priority is toggled
    await expect(taskRow).toBeVisible();

    // The priority checkbox should now be checked
    const priorityCheckbox = checkboxes.nth(0);
    await expect(priorityCheckbox).toBeChecked();
  });

  test('TASK-04: delete task with confirmation', async ({ page }) => {
    // Create a task via API
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const taskDesc = uniqueName('DeleteTask');
    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 0,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test task');
    const taskId = result[0].id;
    // Don't add to createdTaskIds — we're deleting it in the test

    await goToTestDomain(page);

    // Find the task row
    const taskRow = page.getByTestId(`task-${taskId}`);
    await expect(taskRow).toBeVisible({ timeout: 5000 });

    // Click the delete icon (the IconButton in the task row)
    await taskRow.getByRole('button').click();

    // Confirm in TaskDeleteDialog
    const deleteDialog = page.getByTestId('task-delete-dialog');
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    // Verify task is removed
    await expect(taskRow).not.toBeVisible({ timeout: 5000 });
  });

  test('TASK-05: DnD task between areas (react-dnd)', async ({ page }) => {
    // Create a task in area 1
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const taskDesc = uniqueName('DragTask');
    const result = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 0,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test task');
    const taskId = result[0].id;
    createdTaskIds.push(taskId);

    await goToTestDomain(page);

    // Find the source task and target area card
    const sourceTask = page.getByTestId(`task-${taskId}`);
    const targetCard = page.getByTestId(`area-card-${testArea2Id}`);
    await expect(sourceTask).toBeVisible({ timeout: 5000 });
    await expect(targetCard).toBeVisible({ timeout: 5000 });

    // Perform the drag-and-drop
    await dragAndDrop(page, sourceTask, targetCard);

    // Wait for the API call and re-render
    await page.waitForTimeout(1500);

    // Verify task moved to area 2 (should appear in the target card)
    const taskInTarget = targetCard.getByTestId(`task-${taskId}`);
    await expect(taskInTarget).toBeVisible({ timeout: 5000 });

    // Verify task no longer in area 1
    const sourceCard = page.getByTestId(`area-card-${testAreaId}`);
    const taskInSource = sourceCard.getByTestId(`task-${taskId}`);
    await expect(taskInSource).not.toBeVisible();

    // Verify persists after reload
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1500);

    const targetAfterReload = page.getByTestId(`area-card-${testArea2Id}`);
    await expect(targetAfterReload.getByTestId(`task-${taskId}`)).toBeVisible({ timeout: 5000 });
  });
});
