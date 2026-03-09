import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe.serial('Priority Card', () => {
  test.setTimeout(60000);
  let idToken: string;
  let testDomainId: string;
  let testAreaId: string;
  let testArea2Id: string;
  const testDomainName = uniqueName('PCardDom');
  const testAreaName = uniqueName('PCardArea');
  const testArea2Name = uniqueName('PCardArea2');

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const domResult = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: testDomainName, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!domResult?.length) throw new Error('Failed to create test domain');
    testDomainId = domResult[0].id;

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
    // Hard-delete domain (CASCADE handles areas → tasks)
    try { await apiDelete('domains', testDomainId, idToken); } catch { /* best-effort */ }
    // Clean up orphaned priority_card_order records (no FK cascade)
    try { await apiCall('priority_card_order', 'DELETE', { domain_id: testDomainId }, idToken); } catch { /* best-effort */ }
  });

  /** Navigate to test domain, clearing persisted priority card state so each test starts fresh. */
  async function goToTestDomain(page: import('@playwright/test').Page) {
    await page.goto('/taskcards');
    await page.evaluate(() => localStorage.removeItem('darwin_priority_card'));
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForSelector(`[data-testid="area-card-${testAreaId}"]`, { timeout: 15000 });
  }

  /** Click the flag toggle to show the priority card. */
  async function showPriorityCard(page: import('@playwright/test').Page) {
    const toggle = page.getByTestId(`priority-card-toggle-${testDomainId}`);
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();
    await expect(page.getByTestId('priority-card')).toBeVisible({ timeout: 5000 });
  }

  test('PCARD-01: toggle shows and hides the priority card', async ({ page }) => {
    await goToTestDomain(page);

    const toggle = page.getByTestId(`priority-card-toggle-${testDomainId}`);
    await expect(toggle).toBeVisible({ timeout: 5000 });

    // Initially hidden (default state)
    await expect(page.getByTestId('priority-card')).not.toBeVisible();

    // Click toggle → card appears
    await toggle.click();
    await expect(page.getByTestId('priority-card')).toBeVisible({ timeout: 5000 });

    // Click toggle again → card hidden
    await toggle.click();
    await expect(page.getByTestId('priority-card')).not.toBeVisible({ timeout: 3000 });
  });

  test('PCARD-02: priority card aggregates tasks from multiple areas', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const task1Desc = uniqueName('PCardTask1');
    const task2Desc = uniqueName('PCardTask2');

    const r1 = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: task1Desc, area_fk: testAreaId, priority: 1, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r1?.length) throw new Error('Failed to create task 1');

    const r2 = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: task2Desc, area_fk: testArea2Id, priority: 1, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r2?.length) throw new Error('Failed to create task 2');

    await goToTestDomain(page);
    await showPriorityCard(page);

    // Both tasks from different areas should appear in the priority card
    const card = page.getByTestId('priority-card');
    await expect(card.getByTestId(`task-${r1[0].id}`)).toBeVisible({ timeout: 5000 });
    await expect(card.getByTestId(`task-${r2[0].id}`)).toBeVisible({ timeout: 5000 });
  });

  test('PCARD-03: un-prioritizing in priority card removes task; area card reflects change', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const taskDesc = uniqueName('PCardUnprio');

    const r = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 1, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r?.length) throw new Error('Failed to create task');
    const taskId = r[0].id;

    await goToTestDomain(page);
    await showPriorityCard(page);

    const card = page.getByTestId('priority-card');
    const taskInCard = card.getByTestId(`task-${taskId}`);
    await expect(taskInCard).toBeVisible({ timeout: 5000 });

    // Click priority checkbox (first checkbox) — turns priority off
    await taskInCard.getByRole('checkbox').nth(0).click();
    await page.waitForTimeout(2000);

    // Task removed from priority card
    await expect(taskInCard).not.toBeVisible({ timeout: 5000 });

    // Task still in area card, priority checkbox now unchecked
    const areaCard = page.getByTestId(`area-card-${testAreaId}`);
    const taskInArea = areaCard.getByTestId(`task-${taskId}`);
    await expect(taskInArea).toBeVisible({ timeout: 5000 });
    await expect(taskInArea.getByRole('checkbox').nth(0)).not.toBeChecked();
  });

  test('PCARD-04: done in priority card removes task from both cards', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const taskDesc = uniqueName('PCardDone');

    const r = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 1, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r?.length) throw new Error('Failed to create task');
    const taskId = r[0].id;

    await goToTestDomain(page);
    await showPriorityCard(page);

    const card = page.getByTestId('priority-card');
    const taskInCard = card.getByTestId(`task-${taskId}`);
    await expect(taskInCard).toBeVisible({ timeout: 5000 });

    // Click done (second checkbox) in the priority card
    await taskInCard.getByRole('checkbox').nth(1).click();

    // Wait for PUT + invalidation + refetch
    await page.waitForTimeout(2000);

    // Task gone from priority card (done=0 query filter)
    await expect(taskInCard).not.toBeVisible({ timeout: 5000 });

    // Task also gone from area card (done=0 query filter)
    const areaCard = page.getByTestId(`area-card-${testAreaId}`);
    await expect(areaCard.getByTestId(`task-${taskId}`)).not.toBeVisible({ timeout: 5000 });
  });

  test('PCARD-05: done in area card removes task from priority card', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const taskDesc = uniqueName('PCardAreaDone');

    const r = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 1, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r?.length) throw new Error('Failed to create task');
    const taskId = r[0].id;

    await goToTestDomain(page);
    await showPriorityCard(page);

    // Verify task visible in priority card
    const card = page.getByTestId('priority-card');
    await expect(card.getByTestId(`task-${taskId}`)).toBeVisible({ timeout: 5000 });

    // Click done in the area card
    const areaCard = page.getByTestId(`area-card-${testAreaId}`);
    const taskInArea = areaCard.getByTestId(`task-${taskId}`);
    await expect(taskInArea).toBeVisible({ timeout: 5000 });
    await taskInArea.getByRole('checkbox').nth(1).click();

    // Wait for PUT + invalidation + refetch
    await page.waitForTimeout(2000);

    // Task disappears from priority card
    await expect(card.getByTestId(`task-${taskId}`)).not.toBeVisible({ timeout: 5000 });
  });

  test('PCARD-06: prioritizing task in area card makes it appear in priority card', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const taskDesc = uniqueName('PCardAppear');

    // Create task with priority=0
    const r = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 0, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r?.length) throw new Error('Failed to create task');
    const taskId = r[0].id;

    await goToTestDomain(page);
    await showPriorityCard(page);

    // Task not in priority card yet
    const card = page.getByTestId('priority-card');
    await expect(card.getByTestId(`task-${taskId}`)).not.toBeVisible();

    // Click priority in area card
    const areaCard = page.getByTestId(`area-card-${testAreaId}`);
    const taskInArea = areaCard.getByTestId(`task-${taskId}`);
    await expect(taskInArea).toBeVisible({ timeout: 5000 });
    await taskInArea.getByRole('checkbox').nth(0).click();

    // Wait for PUT + invalidation + refetch
    await page.waitForTimeout(2000);

    // Task now appears in priority card
    await expect(card.getByTestId(`task-${taskId}`)).toBeVisible({ timeout: 5000 });
  });

  test('PCARD-07: priority card 3-dot menu has only sort options (no Close or Delete)', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const taskDesc = uniqueName('PCardMenu');

    await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 1, done: 0, sort_order: 0,
    }, idToken);

    await goToTestDomain(page);
    await showPriorityCard(page);

    // Open the priority card 3-dot menu
    await page.getByTestId(`priority-card-menu-${testDomainId}`).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 3000 });

    // Sort options present
    await expect(page.getByTestId('priority-card-sort-created')).toBeVisible();
    await expect(page.getByTestId('priority-card-sort-hand')).toBeVisible();

    // Close and Delete must NOT be present
    await expect(menu.getByText('Close')).not.toBeVisible();
    await expect(menu.getByText('Delete')).not.toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('PCARD-08: sort mode persists across page reload', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const taskDesc = uniqueName('PCardHandSort');

    const r = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: taskDesc, area_fk: testAreaId, priority: 1, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r?.length) throw new Error('Failed to create task');

    await goToTestDomain(page);
    await showPriorityCard(page);

    // Default is hand sort — verify check indicator visible
    await page.getByTestId(`priority-card-menu-${testDomainId}`).click();
    await expect(page.getByTestId('priority-card-sort-hand-check')).toBeVisible();

    // Switch to chronological sort
    await page.getByTestId('priority-card-sort-created').click();
    await page.waitForTimeout(500);

    // Priority card still visible, no crash
    await expect(page.getByTestId('priority-card')).toBeVisible();

    // Reload — localStorage is NOT cleared here so persisted state survives
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1500);

    // Priority card still shown (toggle state persisted)
    await expect(page.getByTestId('priority-card')).toBeVisible({ timeout: 5000 });

    // Open menu — Chronological check indicator should be visible (sortMode='created' persisted)
    await page.getByTestId(`priority-card-menu-${testDomainId}`).click();
    await expect(page.getByTestId('priority-card-sort-created')).toBeVisible();
    await expect(page.getByTestId('priority-card-sort-created-check')).toBeVisible();

    await page.keyboard.press('Escape');
  });
});
