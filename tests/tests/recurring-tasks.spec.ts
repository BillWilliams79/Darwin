import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe('Recurring Tasks Management', () => {
  test.describe.configure({ mode: 'serial' }); // single worker — beforeAll creates one shared domain
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
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForSelector(`[data-testid="recurring-area-card-${testAreaId}"]`, { timeout: 15000 });
  }

  // -------------------------------------------------------------------------
  // REC-01: Page renders and test area card is visible
  // -------------------------------------------------------------------------
  test('REC-01: navigate to /recurring and find test area card', async ({ page }) => {
    await goToTestDomain(page);
    const card = page.getByTestId(`recurring-area-card-${testAreaId}`);
    await expect(card).toBeVisible();
    // Area name is shown in card header (multiline TextField renders textarea, not input)
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

    // Poll until PUT completes — avoids race between blur-triggered PUT and immediate GET
    await expect.poll(async () => {
      const u = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as Array<{ description: string }>;
      return u?.[0]?.description;
    }, { timeout: 5000 }).toBe('Updated description');
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

    // Poll until PUT completes
    await expect.poll(async () => {
      const u = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as Array<{ active: number }>;
      return u?.[0]?.active;
    }, { timeout: 5000 }).toBe(0);
  });

  // -------------------------------------------------------------------------
  // REC-05a: Keyboard navigation on recurrence select
  // -------------------------------------------------------------------------
  test('REC-05a: keyboard shortcut changes recurrence select', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub,
      description: 'Keyboard recurrence test',
      area_fk: testAreaId,
      recurrence: 'daily',
      active: 1, accumulate: 1, priority: 0, insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    await expect(row).toBeVisible();

    // Focus the recurrence select via click→Escape (reliable MUI focus pattern), then press shortcut
    const recurrenceSelect = row.locator('[role="combobox"]').first();
    await recurrenceSelect.click();          // opens dropdown
    await page.keyboard.press('Escape');     // closes dropdown, focus stays on select button
    await page.keyboard.press('m');          // our onKeyDown handler fires → monthly

    // Poll until PUT completes
    await expect.poll(async () => {
      const u = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as Array<{ recurrence: string }>;
      return u?.[0]?.recurrence;
    }, { timeout: 5000 }).toBe('monthly');
  });

  // -------------------------------------------------------------------------
  // REC-05b: Keyboard cycling on weekday select (S = Sat, S again = Sun)
  // -------------------------------------------------------------------------
  test('REC-05b: keyboard cycling on weekday anchor select', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub,
      description: 'Weekday cycle test',
      area_fk: testAreaId,
      recurrence: 'weekly',
      anchor_date: '2025-01-06',
      active: 1, accumulate: 1, priority: 0, insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    await expect(row).toBeVisible();

    // Second combobox is the weekday anchor select
    const weekdaySelect = row.locator('[role="combobox"]').nth(1);

    // First S → Saturday: click→Escape to focus the select button, then press key
    await weekdaySelect.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    await expect.poll(async () => {
      const u = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as Array<{ anchor_date: string }>;
      return u?.[0]?.anchor_date?.slice(0, 10);
    }, { timeout: 5000 }).toBe('2025-01-11');

    // Second S → Sunday: refocus and press S again — cycle ref advances to index 1
    await weekdaySelect.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    await expect.poll(async () => {
      const u = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as Array<{ anchor_date: string }>;
      return u?.[0]?.anchor_date?.slice(0, 10);
    }, { timeout: 5000 }).toBe('2025-01-12');
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
