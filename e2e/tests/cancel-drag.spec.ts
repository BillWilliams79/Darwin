import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe.serial('Cancel Drag', () => {
  let idToken: string;
  let testDomainId: string;
  const testDomainName = uniqueName('CancelDnD');
  const createdAreaIds: string[] = [];
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
  });

  test.afterAll(async () => {
    for (const id of createdTaskIds) {
      try { await apiDelete('tasks', id, idToken); } catch { /* best-effort */ }
    }
    for (const id of createdAreaIds) {
      try { await apiDelete('areas', id, idToken); } catch { /* best-effort */ }
    }
    try { await apiCall('domains', 'PUT', [{ id: testDomainId, closed: 1 }], idToken); } catch {}
  });

  test('DND-01: cancel area reorder in AreaEdit fires no PUT', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const area1Name = uniqueName('Stay1');
    const area2Name = uniqueName('Stay2');

    // Create 2 areas with known sort order
    const r1 = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: area1Name, domain_fk: testDomainId,
      closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    const r2 = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: area2Name, domain_fk: testDomainId,
      closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (r1?.length) createdAreaIds.push(r1[0].id);
    if (r2?.length) createdAreaIds.push(r2[0].id);

    // Intercept PUT requests to areas — count them
    let putCount = 0;
    await page.route('**/areas*', (route) => {
      if (route.request().method() === 'PUT') {
        putCount++;
      }
      route.continue();
    });

    // Navigate to AreaEdit and select domain
    await page.goto('/areaedit');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1000);

    // Find the second area row
    const secondRow = page.getByTestId(`area-row-${r2[0].id}`);
    await expect(secondRow).toBeVisible({ timeout: 5000 });

    // Start DnD with keyboard: Space to lift
    await secondRow.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);

    // Move up
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);

    // CANCEL with Escape (instead of Space to drop)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Verify: no PUT was fired
    expect(putCount).toBe(0);

    // Verify: area order unchanged — first row should still be area1
    const panel = page.locator('[role="tabpanel"]:visible').first();
    const rows = panel.locator('[data-testid^="area-row-"]:not([data-testid="area-row-template"])');
    const firstRowName = await rows.first().locator('input[name="area-name"]').inputValue();
    expect(firstRowName).toBe(area1Name);
  });

  test('DND-02: cancel task drag in TaskPlanView fires no PUT', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const areaName = uniqueName('DragArea');
    const taskDesc = uniqueName('DragTask');

    // Create area and task
    const areaResult = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: areaName, domain_fk: testDomainId,
      closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!areaResult?.length) throw new Error('Failed to create area');
    const areaId = areaResult[0].id;
    createdAreaIds.push(areaId);

    const taskResult = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: areaId,
      priority: 0, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!taskResult?.length) throw new Error('Failed to create task');
    const taskId = taskResult[0].id;
    createdTaskIds.push(taskId);

    // Intercept PUT requests to tasks
    let putCount = 0;
    await page.route('**/tasks*', (route) => {
      if (route.request().method() === 'PUT') {
        putCount++;
      }
      route.continue();
    });

    // Navigate to TaskPlanView and select domain
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1500);

    // Find the task row
    const taskRow = page.getByTestId(`task-${taskId}`);
    await expect(taskRow).toBeVisible({ timeout: 5000 });

    // Start a synthetic drag and immediately cancel via dragend (no drop)
    await page.evaluate(
      ({ taskId }) => {
        const taskEl = document.querySelector(`[data-testid="task-${taskId}"]`);
        if (!taskEl) throw new Error('Task element not found');
        const dataTransfer = new DataTransfer();
        const rect = taskEl.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;

        taskEl.dispatchEvent(new DragEvent('dragstart', {
          bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y,
        }));
        // Cancel immediately — no drop event
        taskEl.dispatchEvent(new DragEvent('dragend', {
          bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y,
        }));
      },
      { taskId },
    );

    await page.waitForTimeout(1000);

    // Verify: no PUT was fired for tasks
    expect(putCount).toBe(0);

    // Verify: task still in original area
    const areaCard = page.getByTestId(`area-card-${areaId}`);
    await expect(areaCard.getByTestId(`task-${taskId}`)).toBeVisible();
  });
});
