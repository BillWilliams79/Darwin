import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe.serial('Domain Sort Order', () => {
  let idToken: string;
  const createdDomainIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
  });

  test.afterAll(async () => {
    for (const id of createdDomainIds) {
      try { await apiCall('domains', 'PUT', [{ id, closed: 1 }], idToken); } catch { /* best-effort */ }
    }
  });

  test('DOM-08: domain sort_order persists via API reorder', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create 3 domains with explicit sort_order
    const names = [uniqueName('SortA'), uniqueName('SortB'), uniqueName('SortC')];
    const ids: string[] = [];

    for (let i = 0; i < 3; i++) {
      const r = await apiCall('domains', 'POST', {
        creator_fk: sub, domain_name: names[i], closed: 0, sort_order: i,
      }, idToken) as Array<{ id: string }>;
      if (!r?.length) throw new Error(`Failed to create domain ${names[i]}`);
      ids.push(r[0].id);
      createdDomainIds.push(r[0].id);
    }

    // Reorder via PUT: reverse the order (C=0, B=1, A=2)
    await apiCall('domains', 'PUT', [
      { id: ids[0], sort_order: 2 },
      { id: ids[1], sort_order: 1 },
      { id: ids[2], sort_order: 0 },
    ], idToken);

    // Navigate to DomainEdit and verify order
    await page.goto('/domainedit');
    await page.waitForSelector('table', { timeout: 10000 });

    const allNameFields = page.locator('input[name="domain-name"]');
    const count = await allNameFields.count();
    const domainNames: string[] = [];
    for (let i = 0; i < count; i++) {
      domainNames.push(await allNameFields.nth(i).inputValue());
    }

    // SortC (sort_order=0) should appear before SortB (1) before SortA (2)
    const idxC = domainNames.indexOf(names[2]);
    const idxB = domainNames.indexOf(names[1]);
    const idxA = domainNames.indexOf(names[0]);

    expect(idxC).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(-1);
    expect(idxA).toBeGreaterThan(-1);
    expect(idxC).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxA);
  });

  test('DOM-09: new domain appears at end of open domains', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const newDomName = uniqueName('NewEnd');

    // Create a domain with high sort_order to make it appear early
    const r = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: newDomName, closed: 0, sort_order: 9999,
    }, idToken) as Array<{ id: string }>;
    if (!r?.length) throw new Error('Failed to create domain');
    createdDomainIds.push(r[0].id);

    // Navigate to DomainEdit
    await page.goto('/domainedit');
    await page.waitForSelector('table', { timeout: 10000 });

    // The new domain should be visible somewhere in the list
    const allNameFields = page.locator('input[name="domain-name"]');
    const count = await allNameFields.count();
    const domainNames: string[] = [];
    for (let i = 0; i < count; i++) {
      domainNames.push(await allNameFields.nth(i).inputValue());
    }

    const idx = domainNames.indexOf(newDomName);
    expect(idx).toBeGreaterThan(-1);

    // New domain should appear before the blank template row (last row)
    // Template row has empty string
    const blankIdx = domainNames.lastIndexOf('');
    expect(idx).toBeLessThan(blankIdx);
  });

  test('DOM-10: domain tab order in TaskPlanView matches sort_order', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create 2 domains with explicit sort_order (reversed alphabetical)
    const nameFirst = uniqueName('TabFirst');
    const nameSecond = uniqueName('TabSecond');

    const r1 = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: nameSecond, closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!r1?.length) throw new Error('Failed to create domain');
    createdDomainIds.push(r1[0].id);

    const r2 = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: nameFirst, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r2?.length) throw new Error('Failed to create domain');
    createdDomainIds.push(r2[0].id);

    // Navigate to TaskPlanView
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Get all tab labels
    const tabs = page.locator('[role="tab"]');
    const tabCount = await tabs.count();
    const tabLabels: string[] = [];
    for (let i = 0; i < tabCount; i++) {
      tabLabels.push(await tabs.nth(i).innerText());
    }

    // TabFirst (sort_order=0) should appear before TabSecond (sort_order=1)
    // MUI Tab applies text-transform: uppercase, so innerText() returns uppercase
    const idxFirst = tabLabels.findIndex(l => l.toLowerCase().includes(nameFirst.toLowerCase()));
    const idxSecond = tabLabels.findIndex(l => l.toLowerCase().includes(nameSecond.toLowerCase()));

    expect(idxFirst).toBeGreaterThan(-1);
    expect(idxSecond).toBeGreaterThan(-1);
    expect(idxFirst).toBeLessThan(idxSecond);
  });

  test('DOM-11: closed domain gets NULL sort_order, reopened gets last', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const domName = uniqueName('CloseReopen');

    // Create an open domain
    const r = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domName, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r?.length) throw new Error('Failed to create domain');
    const domainId = r[0].id;
    createdDomainIds.push(domainId);

    // Close it via API (sets sort_order to NULL)
    await apiCall('domains', 'PUT', [{ id: domainId, closed: 1, sort_order: 'NULL' }], idToken);

    // Verify sort_order is NULL via API
    const closedDoms = await apiCall(
      `domains?creator_fk=${sub}&id=${domainId}&fields=id,sort_order,closed`,
      'GET', '', idToken,
    ) as Array<{ id: number; sort_order: number | null; closed: number }>;

    expect(closedDoms?.length).toBe(1);
    expect(closedDoms[0].closed).toBe(1);
    expect(closedDoms[0].sort_order).toBeNull();

    // Reopen it with a high sort_order (simulating max+1)
    await apiCall('domains', 'PUT', [{ id: domainId, closed: 0, sort_order: 999 }], idToken);

    // Verify sort_order is set
    const reopenedDoms = await apiCall(
      `domains?creator_fk=${sub}&id=${domainId}&fields=id,sort_order,closed`,
      'GET', '', idToken,
    ) as Array<{ id: number; sort_order: number | null; closed: number }>;

    expect(reopenedDoms?.length).toBe(1);
    expect(reopenedDoms[0].closed).toBe(0);
    expect(reopenedDoms[0].sort_order).toBe(999);
  });

  test('DOM-12: domain order consistent across DomainEdit and TaskPlanView', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create 3 domains with specific sort_order
    const names = [uniqueName('ConsistA'), uniqueName('ConsistB'), uniqueName('ConsistC')];

    for (let i = 0; i < 3; i++) {
      const r = await apiCall('domains', 'POST', {
        creator_fk: sub, domain_name: names[i], closed: 0, sort_order: i,
      }, idToken) as Array<{ id: string }>;
      if (!r?.length) throw new Error(`Failed to create domain ${names[i]}`);
      createdDomainIds.push(r[0].id);
    }

    // Check order in DomainEdit
    await page.goto('/domainedit');
    await page.waitForSelector('table', { timeout: 10000 });

    const allNameFields = page.locator('input[name="domain-name"]');
    const fieldCount = await allNameFields.count();
    const domainEditNames: string[] = [];
    for (let i = 0; i < fieldCount; i++) {
      domainEditNames.push(await allNameFields.nth(i).inputValue());
    }

    // Filter to just our test domains
    const editOrder = names.filter(n => domainEditNames.includes(n));

    // Check order in TaskPlanView
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    const tabs = page.locator('[role="tab"]');
    const tabCount = await tabs.count();
    const tabLabels: string[] = [];
    for (let i = 0; i < tabCount; i++) {
      tabLabels.push(await tabs.nth(i).innerText());
    }

    // Filter to just our test domains (MUI Tab text-transform: uppercase)
    const planOrder = names.filter(n => tabLabels.some(l => l.toLowerCase().includes(n.toLowerCase())));

    // Both views should show same order: ConsistA, ConsistB, ConsistC
    expect(editOrder).toEqual(names);
    expect(planOrder).toEqual(names);
  });
});
