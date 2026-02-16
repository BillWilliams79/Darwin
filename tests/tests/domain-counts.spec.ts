import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe.serial('Domain Counts', () => {
  let idToken: string;
  const sub = process.env.E2E_TEST_COGNITO_SUB!;

  // Track IDs for cleanup (reverse dependency order)
  const createdTaskIds: string[] = [];
  const createdAreaIds: string[] = [];
  const createdDomainIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
  });

  test.afterAll(async () => {
    // Cleanup in reverse dependency order: tasks → areas → domains
    for (const id of createdTaskIds) {
      try { await apiDelete('tasks', id, idToken); } catch { /* best-effort */ }
    }
    for (const id of createdAreaIds) {
      try { await apiDelete('areas', id, idToken); } catch { /* best-effort */ }
    }
    for (const id of createdDomainIds) {
      try { await apiDelete('domains', id, idToken); } catch { /* best-effort */ }
    }
  });

  test('DOM-06: verify Areas and Tasks column headers', async ({ page }) => {
    await page.goto('/domainedit');
    await page.waitForSelector('table', { timeout: 10000 });

    // "Areas" and "Tasks" headers should exist
    const headers = page.locator('thead th');
    await expect(headers.filter({ hasText: 'Areas' })).toBeVisible();
    await expect(headers.filter({ hasText: 'Tasks' })).toBeVisible();

    // "Area Count" should NOT exist
    await expect(headers.filter({ hasText: 'Area Count' })).toHaveCount(0);
  });

  test('DOM-07: verify area and task counts are accurate', async ({ page }) => {
    // Create a test domain via API
    const domainName = uniqueName('Counts');
    const domainResult = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domainName, closed: 0,
    }, idToken) as Array<{ id: string }>;

    const domainId = domainResult[0].id;
    createdDomainIds.push(domainId);

    // Navigate and verify 0/0 counts
    await page.goto('/domainedit');
    await page.waitForSelector('table', { timeout: 10000 });

    const areaCount = page.getByTestId(`area-count-${domainId}`);
    const taskCount = page.getByTestId(`task-count-${domainId}`);

    await expect(areaCount).toHaveText('0');
    await expect(taskCount).toHaveText('0');

    // Create 2 areas via API
    const area1Result = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: uniqueName('Area1'), domain_fk: domainId, closed: 0,
    }, idToken) as Array<{ id: string }>;
    const area1Id = area1Result[0].id;
    createdAreaIds.push(area1Id);

    const area2Result = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: uniqueName('Area2'), domain_fk: domainId, closed: 0,
    }, idToken) as Array<{ id: string }>;
    const area2Id = area2Result[0].id;
    createdAreaIds.push(area2Id);

    // Create 3 tasks in area1, 2 tasks in area2 (5 total)
    for (let i = 0; i < 3; i++) {
      const result = await apiCall('tasks', 'POST', {
        creator_fk: sub, description: uniqueName(`T1-${i}`), area_fk: area1Id,
        done: 0, priority: 0,
      }, idToken) as Array<{ id: string }>;
      createdTaskIds.push(result[0].id);
    }
    for (let i = 0; i < 2; i++) {
      const result = await apiCall('tasks', 'POST', {
        creator_fk: sub, description: uniqueName(`T2-${i}`), area_fk: area2Id,
        done: 0, priority: 0,
      }, idToken) as Array<{ id: string }>;
      createdTaskIds.push(result[0].id);
    }

    // Reload and verify updated counts
    await page.reload();
    await page.waitForSelector('table', { timeout: 10000 });

    await expect(areaCount).toHaveText('2');
    await expect(taskCount).toHaveText('5');
  });
});
