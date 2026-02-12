import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe.serial('Sort Order Verification', () => {
  let idToken: string;
  const createdDomainIds: string[] = [];
  const createdAreaIds: string[] = [];
  const createdTaskIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
  });

  test.afterAll(async () => {
    for (const id of createdTaskIds) {
      try { await apiDelete('tasks', id, idToken); } catch { /* best-effort */ }
    }
    for (const id of createdAreaIds) {
      try { await apiDelete('areas', id, idToken); } catch { /* best-effort */ }
    }
    for (const id of createdDomainIds) {
      try { await apiCall('domains', 'PUT', [{ id, closed: 1 }], idToken); } catch { /* best-effort */ }
    }
  });

  test('DOM-05: closed domains sort after open domains in DomainEdit', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const openDom1 = uniqueName('OpenA');
    const openDom2 = uniqueName('OpenB');
    const closedDom = uniqueName('Closed');

    // Create 2 open domains and 1 closed domain
    const r1 = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: openDom1, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r1?.length) throw new Error('Failed to create open domain 1');
    createdDomainIds.push(r1[0].id);

    const r2 = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: openDom2, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r2?.length) throw new Error('Failed to create open domain 2');
    createdDomainIds.push(r2[0].id);

    const r3 = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: closedDom, closed: 1,
    }, idToken) as Array<{ id: string }>;
    if (!r3?.length) throw new Error('Failed to create closed domain');
    createdDomainIds.push(r3[0].id);

    // Navigate to DomainEdit
    await page.goto('/domainedit');
    await page.waitForSelector('table', { timeout: 10000 });

    // Read all domain names in order from the table
    const allNameFields = page.locator('input[name="domain-name"]');
    const count = await allNameFields.count();
    const domainNames: string[] = [];
    for (let i = 0; i < count; i++) {
      domainNames.push(await allNameFields.nth(i).inputValue());
    }

    // Find the positions of our test domains
    const closedIdx = domainNames.indexOf(closedDom);
    const open1Idx = domainNames.indexOf(openDom1);
    const open2Idx = domainNames.indexOf(openDom2);

    // Closed domain should appear after both open domains
    expect(closedIdx).toBeGreaterThan(-1);
    expect(open1Idx).toBeGreaterThan(-1);
    expect(open2Idx).toBeGreaterThan(-1);
    expect(closedIdx).toBeGreaterThan(open1Idx);
    expect(closedIdx).toBeGreaterThan(open2Idx);
  });

  test('AREA-07: areas render in sort_order sequence in TaskPlanView', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const domainName = uniqueName('SortDom');

    // Create domain
    const domResult = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domainName, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!domResult?.length) throw new Error('Failed to create domain');
    const domainId = domResult[0].id;
    createdDomainIds.push(domainId);

    // Create 3 areas with non-sequential sort_order: 2, 0, 1
    const areaNames = ['SortTwo', 'SortZero', 'SortOne'];
    const sortOrders = [2, 0, 1];
    for (let i = 0; i < 3; i++) {
      const r = await apiCall('areas', 'POST', {
        creator_fk: sub, area_name: areaNames[i], domain_fk: domainId,
        closed: 0, sort_order: sortOrders[i],
      }, idToken) as Array<{ id: string }>;
      if (r?.length) createdAreaIds.push(r[0].id);
    }

    // Navigate to TaskPlanView and select the domain
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: domainName }).click();
    await page.waitForTimeout(1500);

    // Read area card names in order from the visible panel
    const panel = page.locator('[role="tabpanel"]:visible').first();
    const areaCards = panel.locator('[data-testid^="area-card-"]:not([data-testid="area-card-template"])');
    const cardCount = await areaCards.count();

    const renderedNames: string[] = [];
    for (let i = 0; i < cardCount; i++) {
      const nameField = areaCards.nth(i).locator('[name="area-name"]');
      renderedNames.push(await nameField.inputValue());
    }

    // Expected order by sort_order ascending: SortZero(0), SortOne(1), SortTwo(2)
    expect(renderedNames).toEqual(['SortZero', 'SortOne', 'SortTwo']);
  });

  test('TASK-09: priority tasks render first within area card', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const domainName = uniqueName('PriDom');
    const areaName = uniqueName('PriArea');

    // Create domain and area
    const domResult = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domainName, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!domResult?.length) throw new Error('Failed to create domain');
    const domainId = domResult[0].id;
    createdDomainIds.push(domainId);

    const areaResult = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: areaName, domain_fk: domainId,
      closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!areaResult?.length) throw new Error('Failed to create area');
    const areaId = areaResult[0].id;
    createdAreaIds.push(areaId);

    // Create 3 tasks: non-priority, priority, non-priority
    const taskDescs = [uniqueName('NoPri1'), uniqueName('HasPri'), uniqueName('NoPri2')];
    const priorities = [0, 1, 0];
    for (let i = 0; i < 3; i++) {
      const r = await apiCall('tasks', 'POST', {
        creator_fk: sub, description: taskDescs[i], area_fk: areaId,
        priority: priorities[i], done: 0,
      }, idToken) as Array<{ id: string }>;
      if (r?.length) createdTaskIds.push(r[0].id);
    }

    // Navigate to TaskPlanView and select the domain
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: domainName }).click();
    await page.waitForTimeout(1500);

    // Find the area card
    const panel = page.locator('[role="tabpanel"]:visible').first();
    const areaCard = panel.getByTestId(`area-card-${areaId}`);
    await expect(areaCard).toBeVisible({ timeout: 5000 });

    // Read task descriptions in order (excluding the template row)
    const taskRows = areaCard.locator('[data-testid^="task-"]:not([data-testid="task-template"])');
    const taskCount = await taskRows.count();
    const renderedDescs: string[] = [];
    for (let i = 0; i < taskCount; i++) {
      const desc = taskRows.nth(i).locator('textarea[name="description"], input[name="description"]').first();
      renderedDescs.push(await desc.inputValue());
    }

    // The priority task (taskDescs[1]) should be first
    expect(renderedDescs[0]).toBe(taskDescs[1]);
  });
});
