import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe('Recurring Tasks Management', () => {
  test.setTimeout(60000);

  let idToken: string;
  let testDomainId: string;
  let testAreaId: string;
  const testDomainName = uniqueName('RecDomain');
  const testAreaName = uniqueName('RecArea');
  const createdDefIds: string[] = [];

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

    const areaResult = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: testAreaName, domain_fk: testDomainId, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!areaResult?.length) throw new Error('Failed to create test area');
    testAreaId = areaResult[0].id;
  });

  test.afterAll(async () => {
    // Delete any recurring defs created during tests
    for (const id of createdDefIds) {
      try { await apiDelete('recurring_tasks', id, idToken); } catch {}
    }
    // Deleting domain cascades to areas (tasks.recurring_task_fk nullable so no cascade issue)
    try { await apiDelete('domains', testDomainId, idToken); } catch {}
  });

  /** Navigate to /recurring and select the test domain tab. */
  async function goToTestDomain(page: import('@playwright/test').Page) {
    await page.goto('/recurring');
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    // .first() guards against duplicate names from parallel worker beforeAll runs
    await page.getByRole('tab', { name: testDomainName }).first().click();
    await page.waitForSelector(`[data-testid="recurring-area-card-${testAreaId}"]`, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // REC-01: Page renders and test area card is visible
  // -------------------------------------------------------------------------
  test('REC-01: navigate to /recurring and find test area card', async ({ page }) => {
    await goToTestDomain(page);
    const card = page.getByTestId(`recurring-area-card-${testAreaId}`);
    await expect(card).toBeVisible();
    // Area name is shown in card header
    // multiline TextField renders <textarea>, not <input> — use generic name selector
    await expect(card.locator('[name="area-name"]')).toHaveValue(testAreaName);
  });

  // -------------------------------------------------------------------------
  // REC-02: Add recurring task via template row
  // -------------------------------------------------------------------------
  test('REC-02: add recurring task via template row', async ({ page }) => {
    await goToTestDomain(page);
    const card = page.getByTestId(`recurring-area-card-${testAreaId}`);
    const templateRow = card.getByTestId('recurring-template');

    // Type description in template row and blur to save
    const descField = templateRow.locator('textarea, input[name="description"]').first();
    await descField.click();
    await descField.fill('Water the plants');
    await descField.press('Tab'); // blur triggers save

    // New row should appear (not the template)
    await expect(card.locator('[data-testid^="recurring-"]:not([data-testid="recurring-template"])'))
      .toHaveCount(1, { timeout: 10000 });

    // Capture the new id for cleanup
    const newRow = card.locator('[data-testid^="recurring-"]:not([data-testid="recurring-template"])').first();
    const testId = await newRow.getAttribute('data-testid');
    const newId = testId?.replace('recurring-', '') ?? '';
    if (newId) createdDefIds.push(newId);
  });

  // -------------------------------------------------------------------------
  // REC-03: Edit description of an existing row
  // -------------------------------------------------------------------------
  test('REC-03: edit recurring task description', async ({ page }) => {
    // Create a definition via API for a clean test
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub,
      description: 'Original description',
      area_fk: testAreaId,
      recurrence: 'daily',
      active: 1,
      accumulate: 1,
      priority: 0,
      insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    await expect(row).toBeVisible();

    const descField = row.locator('textarea, input[name="description"]').first();
    await descField.click();
    await descField.fill('Updated description');
    await descField.press('Tab');
    // Allow async PUT to complete before API check
    await page.waitForTimeout(2000);

    // Verify persisted via API
    const updated = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as Array<{ description: string }>;
    expect(updated?.[0]?.description).toBe('Updated description');
  });

  // -------------------------------------------------------------------------
  // REC-04: Toggle active flag
  // -------------------------------------------------------------------------
  test('REC-04: toggle active flag', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub,
      description: 'Active toggle test',
      area_fk: testAreaId,
      recurrence: 'weekly',
      anchor_date: '2025-01-06',
      active: 1,
      accumulate: 1,
      priority: 0,
      insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    await expect(row).toBeVisible();

    // The active checkbox — click to toggle off (currently active=1, so icon is PlayCircle)
    const activeCheckbox = row.locator('input[type="checkbox"]').nth(1); // 0=priority, 1=active
    await activeCheckbox.click({ force: true });
    // Allow async PUT to complete before API check
    await page.waitForTimeout(2000);

    // Verify persisted via API
    const updated = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as Array<{ active: number }>;
    expect(updated?.[0]?.active).toBe(0);
  });

  // -------------------------------------------------------------------------
  // REC-DND-01: Drag recurring task between area cards (same domain)
  // -------------------------------------------------------------------------
  test('REC-DND-01: drag recurring task between area cards (same domain)', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a second area in the same test domain
    const area2Name = uniqueName('RecArea2');
    const area2Result = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: area2Name, domain_fk: testDomainId, closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!area2Result?.length) throw new Error('Failed to create second test area');
    const testArea2Id = area2Result[0].id;

    // Create a recurring def in area 1 via API
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub,
      description: 'DnD cross-card task',
      area_fk: testAreaId,
      recurrence: 'daily',
      active: 1,
      accumulate: 1,
      priority: 0,
      insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task for DnD test');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);

    // Wait for both cards
    await page.waitForSelector(`[data-testid="recurring-area-card-${testArea2Id}"]`, { timeout: 15000 });

    const sourceRow = page.getByTestId(`recurring-${defId}`);
    const targetCard = page.getByTestId(`recurring-area-card-${testArea2Id}`);

    await expect(sourceRow).toBeVisible();

    // Use page.mouse — fires mousedown/mousemove/mouseup that TouchBackend handles.
    // dragTo fires DragEvent which TouchBackend ignores.
    const srcBounds = await sourceRow.boundingBox();
    const tgtBounds = await targetCard.boundingBox();
    if (!srcBounds || !tgtBounds) throw new Error('Could not get bounding boxes');

    // Start drag from left edge (priority checkbox area, x+12) to avoid opening Recurrence Select
    await page.mouse.move(srcBounds.x + 12, srcBounds.y + 12);
    await page.mouse.down();
    await page.waitForTimeout(100);
    // Small initial move to trigger drag recognition, then move to target card center
    await page.mouse.move(srcBounds.x + 25, srcBounds.y + 12, { steps: 3 });
    await page.mouse.move(tgtBounds.x + tgtBounds.width / 2, tgtBounds.y + tgtBounds.height / 2, { steps: 10 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    // Allow optimistic update + TanStack Query refetch to settle
    await page.waitForTimeout(1000);

    // Def should appear in area 2's card
    await expect(targetCard.getByTestId(`recurring-${defId}`)).toBeVisible({ timeout: 10000 });

    // Verify via API that area_fk was updated
    const updated = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as Array<{ area_fk: number | string }>;
    expect(String(updated?.[0]?.area_fk)).toBe(String(testArea2Id));

    // Cleanup second area (cascade deletes its recurring tasks is not needed — def already moved)
    try { await apiDelete('areas', testArea2Id, idToken); } catch {}
  });

  // -------------------------------------------------------------------------
  // REC-DND-02: Drag recurring task across domain tabs
  // -------------------------------------------------------------------------
  test('REC-DND-02: drag recurring task across domain tabs', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a second domain + area for this test
    const domain2Name = uniqueName('RecDomain2');
    const domResult = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domain2Name, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!domResult?.length) throw new Error('Failed to create second test domain');
    const testDomain2Id = domResult[0].id;

    const area3Name = uniqueName('RecArea3');
    const areaResult = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: area3Name, domain_fk: testDomain2Id, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!areaResult?.length) throw new Error('Failed to create area in second domain');
    const testArea3Id = areaResult[0].id;

    // Create a recurring def in the original test domain's area
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub,
      description: 'DnD cross-domain task',
      area_fk: testAreaId,
      recurrence: 'weekly',
      anchor_date: '2025-01-06',
      active: 1,
      accumulate: 1,
      priority: 0,
      insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task for cross-domain DnD test');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await page.goto('/recurring');
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: testDomainName }).first().click();
    await page.waitForSelector(`[data-testid="recurring-area-card-${testAreaId}"]`, { timeout: 15000 });

    const sourceRow = page.getByTestId(`recurring-${defId}`);
    await expect(sourceRow).toBeVisible();

    // .first() guards against duplicate tab names from parallel worker runs
    const targetTab = page.getByRole('tab', { name: domain2Name }).first();
    await expect(targetTab).toBeVisible();

    const area3Card = page.getByTestId(`recurring-area-card-${testArea3Id}`);

    const srcBounds = await sourceRow.boundingBox();
    const tabBounds = await targetTab.boundingBox();
    if (!srcBounds || !tabBounds) throw new Error('Could not get bounding boxes');

    // Use page.mouse — fires mousedown/mousemove/mouseup that TouchBackend handles
    // Step 1: start drag on the source row (left edge = priority checkbox, avoids Selects)
    await page.mouse.move(srcBounds.x + 12, srcBounds.y + 12);
    await page.mouse.down();
    await page.waitForTimeout(100);

    // Step 2: hover over domain 2 tab for >500ms — triggers RecurringDroppableTab timer
    await page.mouse.move(tabBounds.x + tabBounds.width / 2, tabBounds.y + tabBounds.height / 2, { steps: 5 });
    await page.waitForTimeout(1200); // 500ms timer + 700ms margin (generous for CI/load)

    // Step 3: wait for tab switch (domain 2 panel becomes visible)
    await expect(area3Card).toBeVisible({ timeout: 5000 });

    // Step 4: move to area card in domain 2 and drop
    const area3Bounds = await area3Card.boundingBox();
    if (!area3Bounds) throw new Error('Could not get area 3 bounding box');
    await page.mouse.move(area3Bounds.x + area3Bounds.width / 2, area3Bounds.y + area3Bounds.height / 2, { steps: 5 });
    await page.waitForTimeout(200);
    await page.mouse.up();

    // Def should appear in domain 2's area card
    await expect(area3Card.getByTestId(`recurring-${defId}`)).toBeVisible({ timeout: 10000 });

    // Verify via API
    const updated = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as Array<{ area_fk: number | string }>;
    expect(String(updated?.[0]?.area_fk)).toBe(String(testArea3Id));

    // Cleanup domain 2 (cascade handles area + recurring tasks)
    try { await apiDelete('domains', testDomain2Id, idToken); } catch {}
  });

  // -------------------------------------------------------------------------
  // REC-05: Delete recurring task
  // -------------------------------------------------------------------------
  test('REC-05: delete recurring task', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub,
      description: 'To be deleted',
      area_fk: testAreaId,
      recurrence: 'monthly',
      anchor_date: '2025-01-15',
      active: 1,
      accumulate: 1,
      priority: 0,
      insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    await expect(row).toBeVisible();

    // Click delete icon and confirm dialog
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: /delete/i }).click();

    // Row should disappear
    await expect(row).not.toBeVisible({ timeout: 10000 });

    // Verify deleted via API
    const check = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as unknown;
    // 404 comes back as an error object or empty — just confirm id not in results
    expect(Array.isArray(check) ? check.length : 0).toBe(0);
  });
});
