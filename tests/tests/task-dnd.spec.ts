import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName, clickSortMode } from '../helpers/api';
import { dragAndDrop } from '../helpers/react-dnd-drag';

test.describe.serial('Task DnD — Hand Sort & Cross Card', () => {
  let idToken: string;
  let testDomainId: string;
  const testDomainName = uniqueName('TaskDnD');
  const area1Name = uniqueName('Area1');
  const area2Name = uniqueName('Area2');
  let area1Id: string;
  let area2Id: string;

  // 3 tasks in Area1 for same-card reorder tests
  let task0Id: string;
  let task1Id: string;
  let task2Id: string;
  const task0Desc = uniqueName('T0');
  const task1Desc = uniqueName('T1');
  const task2Desc = uniqueName('T2');

  // 1 task in Area2
  let a2TaskId: string;
  const a2TaskDesc = uniqueName('A2T');

  // Cross-card tasks (created in beforeAll to avoid mid-test Lambda timeouts)
  let crossTask1Id: string;
  const crossTask1Desc = uniqueName('Cross1');
  let crossTask2Id: string;
  const crossTask2Desc = uniqueName('Cross2');

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

    const a1 = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: area1Name, domain_fk: testDomainId,
      closed: 0, sort_order: 0, sort_mode: 'hand',
    }, idToken) as Array<{ id: string }>;
    if (!a1?.length) throw new Error('Failed to create Area1');
    area1Id = a1[0].id;

    const a2 = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: area2Name, domain_fk: testDomainId,
      closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!a2?.length) throw new Error('Failed to create Area2');
    area2Id = a2[0].id;

    const t0 = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: task0Desc, area_fk: area1Id,
      priority: 0, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!t0?.length) throw new Error('Failed to create T0');
    task0Id = t0[0].id;

    const t1 = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: task1Desc, area_fk: area1Id,
      priority: 0, done: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!t1?.length) throw new Error('Failed to create T1');
    task1Id = t1[0].id;

    const t2 = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: task2Desc, area_fk: area1Id,
      priority: 0, done: 0, sort_order: 2,
    }, idToken) as Array<{ id: string }>;
    if (!t2?.length) throw new Error('Failed to create T2');
    task2Id = t2[0].id;

    const a2t = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: a2TaskDesc, area_fk: area2Id,
      priority: 0, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!a2t?.length) throw new Error('Failed to create A2Task');
    a2TaskId = a2t[0].id;

    // Cross-card tasks for DND-05 and DND-06 (created here to avoid mid-test Lambda timeouts)
    const ct1 = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: crossTask1Desc, area_fk: area1Id,
      priority: 0, done: 0, sort_order: 10,
    }, idToken) as Array<{ id: string }>;
    if (!ct1?.length) throw new Error('Failed to create CrossTask1');
    crossTask1Id = ct1[0].id;

    const ct2 = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: crossTask2Desc, area_fk: area1Id,
      priority: 0, done: 0, sort_order: 11,
    }, idToken) as Array<{ id: string }>;
    if (!ct2?.length) throw new Error('Failed to create CrossTask2');
    crossTask2Id = ct2[0].id;
  });

  test.afterAll(async () => {
    // Hard-delete the domain (ON DELETE CASCADE handles child areas/tasks)
    try { await apiDelete('domains', testDomainId, idToken); } catch {}
  });

  async function goToTestDomain(page: any) {
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1500);
  }

  async function getTaskDescriptions(page: any, areaId: string): Promise<string[]> {
    const card = page.getByTestId(`area-card-${areaId}`);
    const rows = card.locator('[data-testid^="task-"]:not([data-testid="task-template"])');
    const count = await rows.count();
    const descs: string[] = [];
    for (let i = 0; i < count; i++) {
      const desc = await rows.nth(i).locator('[name="description"]').inputValue();
      descs.push(desc);
    }
    return descs;
  }

  async function getTaskCount(page: any, areaId: string): Promise<number> {
    const card = page.getByTestId(`area-card-${areaId}`);
    return await card.locator('[data-testid^="task-"]:not([data-testid="task-template"])').count();
  }

  async function resetSortOrder() {
    await apiCall('tasks', 'PUT', [
      { id: task0Id, sort_order: 0 },
      { id: task1Id, sort_order: 1 },
      { id: task2Id, sort_order: 2 },
    ], idToken);
  }

  async function assertNoHiddenTasks(page: any, areaId: string) {
    const card = page.getByTestId(`area-card-${areaId}`);
    const rows = card.locator('[data-testid^="task-"]:not([data-testid="task-template"])');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const vis = await rows.nth(i).evaluate((el: HTMLElement) => getComputedStyle(el).visibility);
      expect(vis).not.toBe('hidden');
      const opacity = await rows.nth(i).evaluate((el: HTMLElement) => getComputedStyle(el).opacity);
      expect(Number(opacity)).toBeGreaterThan(0.5);
    }
  }

  // ─── DND-07: Cancel drag ──────────────────────────────────────────────

  test('DND-07: Cancel task drag in hand-sort mode — no PUT, task stays', async ({ page }) => {
    await goToTestDomain(page);
    // Area1 created with sort_mode: 'hand' — no button click needed

    let putCount = 0;
    await page.route('**/tasks*', (route) => {
      if (route.request().method() === 'PUT') putCount++;
      route.continue();
    });

    const taskRow = page.getByTestId(`task-${task0Id}`);
    await expect(taskRow).toBeVisible({ timeout: 5000 });

    await page.evaluate(({ taskId }) => {
      const taskEl = document.querySelector(`[data-testid="task-${taskId}"]`);
      if (!taskEl) throw new Error('Task element not found');
      const dataTransfer = new DataTransfer();
      const rect = taskEl.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      taskEl.dispatchEvent(new DragEvent('dragstart', {
        bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y,
      }));
      taskEl.dispatchEvent(new DragEvent('dragend', {
        bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y,
      }));
    }, { taskId: task0Id });

    await page.waitForTimeout(1000);
    expect(putCount).toBe(0);

    const card = page.getByTestId(`area-card-${area1Id}`);
    await expect(card.getByTestId(`task-${task0Id}`)).toBeVisible();
    await expect(card.locator('[data-testid^="task-"]:not([data-testid="task-template"])')).toHaveCount(5);
    await assertNoHiddenTasks(page, area1Id);
  });

  // ─── DND-03: Same-card hand-sort reorder ──────────────────────────────

  test('DND-03: Same-card hand-sort reorder moves task', async ({ page }) => {
    await resetSortOrder();
    await goToTestDomain(page);

    await clickSortMode(page, area1Id, 'hand');
    await page.waitForTimeout(500);

    let order = await getTaskDescriptions(page, area1Id);
    expect(order).toEqual([task0Desc, task1Desc, task2Desc, crossTask1Desc, crossTask2Desc]);

    const source = page.getByTestId(`task-${task0Id}`);
    const target = page.getByTestId(`task-${task2Id}`);
    await dragAndDrop(page, source, target);
    await page.waitForTimeout(1500);

    // Verify in-memory reorder
    order = await getTaskDescriptions(page, area1Id);
    expect(order).toEqual([task1Desc, task2Desc, task0Desc, crossTask1Desc, crossTask2Desc]);

    // Task count still 5 (no duplicates — 3 original + 2 cross-card tasks)
    const card = page.getByTestId(`area-card-${area1Id}`);
    await expect(card.locator('[data-testid^="task-"]:not([data-testid="task-template"])')).toHaveCount(5);

    await assertNoHiddenTasks(page, area1Id);
  });

  // ─── DND-04: Same-card no duplicates ──────────────────────────────────

  test('DND-04: Same-card hand-sort — no duplicates, no visibility artifacts', async ({ page }) => {
    await resetSortOrder();
    await goToTestDomain(page);

    await clickSortMode(page, area1Id, 'hand');
    await page.waitForTimeout(500);

    const source = page.getByTestId(`task-${task2Id}`);
    const target = page.getByTestId(`task-${task0Id}`);
    await dragAndDrop(page, source, target);
    await page.waitForTimeout(1500);

    const card = page.getByTestId(`area-card-${area1Id}`);
    await expect(card.locator('[data-testid^="task-"]:not([data-testid="task-template"])')).toHaveCount(5);
    await assertNoHiddenTasks(page, area1Id);
  });

  // ─── DND-05: Cross-card priority sort ─────────────────────────────────

  test('DND-05: Cross-card drag in priority-sort mode still works', async ({ page }) => {
    await goToTestDomain(page);

    await clickSortMode(page, area1Id, 'priority');
    await clickSortMode(page, area2Id, 'priority');
    await page.waitForTimeout(1000);

    const area1Before = await getTaskCount(page, area1Id);
    const area2Before = await getTaskCount(page, area2Id);

    const sourceTask = page.getByTestId(`task-${crossTask1Id}`);
    const targetCard = page.getByTestId(`area-card-${area2Id}`);
    await expect(sourceTask).toBeVisible({ timeout: 5000 });
    await dragAndDrop(page, sourceTask, targetCard);
    await page.waitForTimeout(500);

    const area2Card = page.getByTestId(`area-card-${area2Id}`);
    await expect(area2Card.getByTestId(`task-${crossTask1Id}`)).toBeVisible({ timeout: 5000 });

    const area1Card = page.getByTestId(`area-card-${area1Id}`);
    await expect(area1Card.getByTestId(`task-${crossTask1Id}`)).not.toBeVisible();

    expect(await getTaskCount(page, area1Id)).toBe(area1Before - 1);
    expect(await getTaskCount(page, area2Id)).toBe(area2Before + 1);
  });

  // ─── DND-06: Cross-card to hand-sorted target ────────────────────────

  test('DND-06: Cross-card drag to hand-sorted target inserts correctly', async ({ page }) => {
    await goToTestDomain(page);

    await clickSortMode(page, area1Id, 'priority');
    await clickSortMode(page, area2Id, 'hand');
    await page.waitForTimeout(1000);

    const area2Before = await getTaskCount(page, area2Id);

    const sourceTask = page.getByTestId(`task-${crossTask2Id}`);
    const targetCard = page.getByTestId(`area-card-${area2Id}`);
    await expect(sourceTask).toBeVisible({ timeout: 5000 });
    await dragAndDrop(page, sourceTask, targetCard);
    await page.waitForTimeout(500);

    const area2Card = page.getByTestId(`area-card-${area2Id}`);
    await expect(area2Card.getByTestId(`task-${crossTask2Id}`)).toBeVisible({ timeout: 5000 });

    const area1Card = page.getByTestId(`area-card-${area1Id}`);
    await expect(area1Card.getByTestId(`task-${crossTask2Id}`)).not.toBeVisible();

    expect(await getTaskCount(page, area2Id)).toBe(area2Before + 1);

    const allCrossTask = page.locator(`[data-testid="task-${crossTask2Id}"]`);
    await expect(allCrossTask).toHaveCount(1);
  });
});
