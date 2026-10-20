import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';
import { dndKitDrag, dndKitTouchDrag } from '../helpers/dnd-kit-drag';

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
    await descField.evaluate(el => el.blur()); // explicit blur triggers save reliably

    // New row should appear (not the template)
    await expect(card.locator('[data-testid^="recurring-"]:not([data-testid="recurring-template"])'))
      .toHaveCount(1, { timeout: 10000 });

    // Wait for the server-assigned ID to appear (optimistic IDs may be temporary)
    await expect.poll(async () => {
      const row = card.locator('[data-testid^="recurring-"]:not([data-testid="recurring-template"])').first();
      const tid = await row.getAttribute('data-testid');
      const id = tid?.replace('recurring-', '') ?? '';
      // Server-assigned IDs are numeric; optimistic/temp IDs may not be
      return id && /^\d+$/.test(id) ? id : '';
    }, { timeout: 10000 }).toBeTruthy();

    // Capture the new id for cleanup
    const newRow = card.locator('[data-testid^="recurring-"]:not([data-testid="recurring-template"])').first();
    const testId = await newRow.getAttribute('data-testid');
    const newId = testId?.replace('recurring-', '') ?? '';
    if (newId) createdDefIds.push(newId);

    // Verify the record was created via API
    if (newId) {
      await expect.poll(async () => {
        const u = await apiCall(`recurring_tasks?id=${newId}`, 'GET', '', idToken) as Array<{ description: string }>;
        return u?.[0]?.description;
      }, { timeout: 10000 }).toBe('Water the plants');
    }
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
  // REC-TAB-01: Tab from description → recurrence Select (existing task)
  // -------------------------------------------------------------------------
  test('REC-TAB-01: Tab from description focuses recurrence select', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub, description: 'Tab focus test', area_fk: testAreaId,
      recurrence: 'daily', active: 1, accumulate: 1, priority: 0, insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    const descField = row.locator('textarea, input[name="description"]').first();
    await descField.click();
    await page.keyboard.press('Tab');

    const recurrenceCombobox = row.locator('[data-testid="recurring-' + defId + '-recurrence"]')
      .locator('..').locator('[role="combobox"]');
    // Fallback: find combobox by position (first combobox in row)
    const combobox = row.locator('[role="combobox"]').first();
    await expect(combobox).toBeFocused({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // REC-TAB-02: Tab from template description → saves + focuses recurrence on new row
  // -------------------------------------------------------------------------
  test('REC-TAB-02: Tab from template saves and focuses recurrence on new row', async ({ page }) => {
    await goToTestDomain(page);
    const card = page.getByTestId(`recurring-area-card-${testAreaId}`);
    // Ensure page is settled before interacting with template
    await page.waitForTimeout(500);

    const templateRow = card.getByTestId('recurring-template');
    const descField = templateRow.locator('textarea').first();
    await descField.click();
    await expect(descField).toBeFocused({ timeout: 3000 });
    await page.keyboard.type('Tab save test', { delay: 20 });
    await page.waitForTimeout(300);

    await page.keyboard.press('Tab');

    // New row should appear with our description (wait for server round-trip)
    const newRow = card.locator('[data-testid^="recurring-"]:not([data-testid="recurring-template"])').filter({
      has: page.locator('textarea', { hasText: 'Tab save test' }),
    });
    await expect(newRow).toBeVisible({ timeout: 10000 });

    // The recurrence combobox on the new row should be focused
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.getAttribute('role');
    });
    expect(focused).toBe('combobox');

    // Capture new row ID for cleanup
    const tid = await newRow.getAttribute('data-testid');
    const id = tid?.replace('recurring-', '') ?? '';
    if (id && /^\d+$/.test(id)) createdDefIds.push(id);
  });

  // -------------------------------------------------------------------------
  // REC-TAB-03: Tab from recurrence (weekly) → weekday Select
  // -------------------------------------------------------------------------
  test('REC-TAB-03: Tab from recurrence focuses weekday select', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub, description: 'Tab weekly test', area_fk: testAreaId,
      recurrence: 'weekly', anchor_date: '2025-01-06',
      active: 1, accumulate: 1, priority: 0, insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    // Focus recurrence select via click→Escape
    const recurrence = row.locator('[role="combobox"]').first();
    await recurrence.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');

    // Weekday combobox (second combobox) should be focused
    const weekday = row.locator('[role="combobox"]').nth(1);
    await expect(weekday).toBeFocused({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // REC-TAB-04: Tab from recurrence (monthly) → monthly day Select
  // -------------------------------------------------------------------------
  test('REC-TAB-04: Tab from recurrence focuses monthly day select', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub, description: 'Tab monthly test', area_fk: testAreaId,
      recurrence: 'monthly', anchor_date: '2025-01-15',
      active: 1, accumulate: 1, priority: 0, insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    const recurrence = row.locator('[role="combobox"]').first();
    await recurrence.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');

    // Monthly day combobox (second combobox) should be focused
    const monthlyDay = row.locator('[role="combobox"]').nth(1);
    await expect(monthlyDay).toBeFocused({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // REC-TAB-05: Tab from recurrence (annual) → month Select → Tab → day Select
  // -------------------------------------------------------------------------
  test('REC-TAB-05: Tab through annual month and day selects', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub, description: 'Tab annual test', area_fk: testAreaId,
      recurrence: 'annual', anchor_date: '2025-03-15',
      active: 1, accumulate: 1, priority: 0, insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);

    // Focus recurrence, Tab → annual month
    const recurrence = row.locator('[role="combobox"]').first();
    await recurrence.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');

    const annualMonth = row.locator('[role="combobox"]').nth(1);
    await expect(annualMonth).toBeFocused({ timeout: 3000 });

    // Tab again → annual day
    await page.keyboard.press('Tab');
    const annualDay = row.locator('[role="combobox"]').nth(2);
    await expect(annualDay).toBeFocused({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // REC-TAB-06: Tab from recurrence (daily) — no anchor, default behavior
  // -------------------------------------------------------------------------
  test('REC-TAB-06: Tab from daily recurrence passes through', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub, description: 'Tab daily test', area_fk: testAreaId,
      recurrence: 'daily', active: 1, accumulate: 1, priority: 0, insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    const recurrence = row.locator('[role="combobox"]').first();
    await recurrence.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');

    // Focus should NOT be on the recurrence combobox anymore
    await expect(recurrence).not.toBeFocused({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // REC-TAB-07: Shift+Tab from recurrence → description
  // -------------------------------------------------------------------------
  test('REC-TAB-07: Shift+Tab from recurrence focuses description', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub, description: 'Shift-Tab test', area_fk: testAreaId,
      recurrence: 'weekly', anchor_date: '2025-01-06',
      active: 1, accumulate: 1, priority: 0, insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    const recurrence = row.locator('[role="combobox"]').first();
    await recurrence.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Tab');

    // Description textarea should be focused
    const descField = row.locator('textarea').first();
    await expect(descField).toBeFocused({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // REC-TAB-08: Shift+Tab from weekday anchor → recurrence
  // -------------------------------------------------------------------------
  test('REC-TAB-08: Shift+Tab from weekday focuses recurrence', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub, description: 'Shift-Tab anchor test', area_fk: testAreaId,
      recurrence: 'weekly', anchor_date: '2025-01-06',
      active: 1, accumulate: 1, priority: 0, insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    // Focus weekday select (second combobox)
    const weekday = row.locator('[role="combobox"]').nth(1);
    await weekday.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Tab');

    // Recurrence combobox (first) should be focused
    const recurrence = row.locator('[role="combobox"]').first();
    await expect(recurrence).toBeFocused({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // REC-TAB-09: Shift+Tab from annual day → annual month
  // -------------------------------------------------------------------------
  test('REC-TAB-09: Shift+Tab from annual day focuses annual month', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub, description: 'Shift-Tab annual test', area_fk: testAreaId,
      recurrence: 'annual', anchor_date: '2025-06-15',
      active: 1, accumulate: 1, priority: 0, insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await goToTestDomain(page);
    const row = page.getByTestId(`recurring-${defId}`);
    // Focus annual day select (third combobox: recurrence, month, day)
    const annualDay = row.locator('[role="combobox"]').nth(2);
    await annualDay.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Tab');

    // Annual month combobox (second) should be focused
    const annualMonth = row.locator('[role="combobox"]').nth(1);
    await expect(annualMonth).toBeFocused({ timeout: 3000 });
  });

  // Drag and drop (req #3663, dnd-kit — real pointer / CDP touch input). A
  // recurring task has no stored order, so an area card takes it as a whole:
  // it highlights while the row hovers and the drop writes area_fk alone.

  /** Create a recurring def via the API and remember it for cleanup. */
  async function createDef(areaId: string, description: string, extra: object = {}) {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub, description, area_fk: areaId, recurrence: 'daily', active: 1,
      accumulate: 1, priority: 0, insert_position: 'bottom', ...extra,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task');
    createdDefIds.push(String(result[0].id));
    return String(result[0].id);
  }

  async function createDomainWithArea(prefix: string) {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const name = uniqueName(prefix);
    const dom = await apiCall('domains', 'POST', { creator_fk: sub, domain_name: name, closed: 0 }, idToken) as Array<{ id: string }>;
    const area = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: uniqueName(`${prefix}Area`), domain_fk: dom[0].id, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    return { name, domainId: String(dom[0].id), areaId: String(area[0].id) };
  }

  // Grab a row by its description text — where a person picks it up. The
  // row's centre can fall on its Recurrence select, which (by design) opens on
  // the press and never lifts the row.
  const grip = (page: import('@playwright/test').Page, defId: string) =>
    page.getByTestId(`recurring-${defId}`).locator('[name="description"]').first();

  const areaOf = async (defId: string) =>
    String(((await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken)) as Array<{ area_fk: number | string }>)[0]?.area_fk);

  // -------------------------------------------------------------------------
  // REC-DND-01: Drag recurring task between area cards (same domain)
  // -------------------------------------------------------------------------
  test('REC-DND-01: drag recurring task between area cards (same domain)', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const area2Result = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: uniqueName('RecArea2'), domain_fk: testDomainId, closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!area2Result?.length) throw new Error('Failed to create second test area');
    const testArea2Id = String(area2Result[0].id);
    const defId = await createDef(testAreaId, 'DnD cross-card task');

    await goToTestDomain(page);
    const targetCard = page.getByTestId(`recurring-area-card-${testArea2Id}`);
    await expect(targetCard).toBeVisible({ timeout: 15000 });

    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/recurring_tasks'));
    await dndKitDrag(page, grip(page, defId), targetCard);
    const body = JSON.parse((await put).request().postData() || '[]');
    expect(body).toEqual([{ id: Number(defId), area_fk: Number(testArea2Id) }]);

    await expect(targetCard.getByTestId(`recurring-${defId}`)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId(`recurring-area-card-${testAreaId}`).getByTestId(`recurring-${defId}`)).toHaveCount(0);
    expect(await areaOf(defId)).toBe(testArea2Id);

    try { await apiDelete('areas', testArea2Id, idToken); } catch {}
  });

  // -------------------------------------------------------------------------
  // REC-DND-02: Drag recurring task across domain tabs
  // -------------------------------------------------------------------------
  test('REC-DND-02: drag recurring task across domain tabs', async ({ page }) => {
    const other = await createDomainWithArea('RecDomain2');
    const defId = await createDef(testAreaId, 'DnD cross-domain task', { recurrence: 'weekly', anchor_date: '2025-01-06' });

    // Earlier tests leave rows in this card, so the new row sits low on the
    // page; at the default height, scrolling it into view takes the tab strip
    // off screen and the glide would aim above the viewport. Tall enough that
    // the row and the tab are on screen together, as a person would see them.
    await page.setViewportSize({ width: 1280, height: 2400 });
    await goToTestDomain(page);
    const targetTab = page.getByRole('tab', { name: other.name }).first();
    await targetTab.scrollIntoViewIfNeeded();
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/recurring_tasks'));
    await dndKitDrag(page, grip(page, defId), targetTab, {
      holdOverTargetMs: 900,
      then: page.getByTestId(`recurring-area-card-${other.areaId}`),
    });
    await put;
    await expect(targetTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`recurring-area-card-${other.areaId}`).getByTestId(`recurring-${defId}`)).toBeVisible({ timeout: 10000 });
    expect(await areaOf(defId)).toBe(other.areaId);

    try { await apiDelete('domains', other.domainId, idToken); } catch {}
  });

  // -------------------------------------------------------------------------
  // REC-DND-03: Drag → tab switch → release ON the tab → cancelled, tab reverts
  // -------------------------------------------------------------------------
  test('REC-DND-03: cancelled cross-domain drag reverts tab to original domain', async ({ page }) => {
    const other = await createDomainWithArea('RecDomain4');
    const defId = await createDef(testAreaId, 'DnD cancelled cross-domain task');

    // Row and tab on screen together (see REC-DND-02).
    await page.setViewportSize({ width: 1280, height: 2400 });
    await goToTestDomain(page);
    let puts = 0;
    await page.route('**/recurring_tasks*', r => { if (r.request().method() === 'PUT') puts++; r.continue(); });
    const targetTab = page.getByRole('tab', { name: other.name }).first();
    await targetTab.scrollIntoViewIfNeeded();
    const area4Card = page.getByTestId(`recurring-area-card-${other.areaId}`);

    // Hold over the tab until it switches, then release ON the tab — a cancel.
    // The switch is observed while the drag is still in the air.
    let switched = false;
    const watch = (async () => {
      const until = Date.now() + 6000;
      while (!switched && Date.now() < until) {
        switched = await area4Card.isVisible().catch(() => false);
        await page.waitForTimeout(50);
      }
    })();
    await dndKitDrag(page, grip(page, defId), targetTab, { holdOverTargetMs: 1200 });
    await watch;
    expect(switched).toBe(true);

    await expect(page.getByTestId(`recurring-area-card-${testAreaId}`)).toBeVisible({ timeout: 5000 });
    await expect(area4Card).not.toBeVisible();
    await page.waitForTimeout(300);
    expect(puts).toBe(0);
    expect(await areaOf(defId)).toBe(String(testAreaId));

    try { await apiDelete('domains', other.domainId, idToken); } catch {}
  });

  // -------------------------------------------------------------------------
  // REC-DND-04: the whole row is the grip — pressing ON THE DESCRIPTION lifts it
  // -------------------------------------------------------------------------
  test('REC-DND-04: pressing on the description text lifts the row; a quick click still edits', async ({ page }) => {
    const defId = await createDef(testAreaId, 'DnD grip task');
    await goToTestDomain(page);
    const field = page.getByTestId(`recurring-${defId}`).locator('[name="description"]').first();

    // A quick click places the caret and lifts nothing.
    await field.click();
    await expect(field).toBeFocused();
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
    // Leave the field (a press in a field ALREADY being edited edits, by design).
    await field.evaluate(el => (el as HTMLElement).blur());
    await expect(field).not.toBeFocused();

    // A press that moves lifts the row: the preview is the row itself.
    await field.scrollIntoViewIfNeeded();
    const fb = (await field.boundingBox())!;
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.mouse.down();
    await page.mouse.move(fb.x + fb.width / 2 + 3, fb.y + fb.height / 2 + 3);
    await page.waitForTimeout(60);
    await page.mouse.move(fb.x + fb.width / 2 + 10, fb.y + fb.height / 2 + 30, { steps: 4 });
    const overlay = page.getByTestId('drag-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('textarea').first()).toHaveValue('DnD grip task');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('[data-dragging="true"]')).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // REC-DND-05: a Select stays a control — pressing it opens it, never lifts
  // -------------------------------------------------------------------------
  test('REC-DND-05: a press on the recurrence select opens it and never lifts the row', async ({ page }) => {
    const defId = await createDef(testAreaId, 'DnD select task');
    await goToTestDomain(page);
    const select = page.getByTestId(`recurring-${defId}`).locator('[role="combobox"]').first();
    await select.scrollIntoViewIfNeeded();
    const b = (await select.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 2 + 3);
    await page.waitForTimeout(60);
    await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2 + 12, { steps: 4 });
    await page.waitForTimeout(500);
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
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

    // Click the delete icon → opens the MUI confirmation dialog (replaced the old
    // window.confirm in commit 224f309, 2026-03-11) → click its "Delete" button.
    await row.getByRole('button', { name: /delete/i }).click();
    const deleteDialog = page.getByTestId('recurring-delete-dialog');
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    // Row should disappear
    await expect(row).not.toBeVisible({ timeout: 10000 });

    // Verify deleted via API
    const check = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as unknown;
    // 404 comes back as an error object or empty — just confirm id not in results
    expect(Array.isArray(check) ? check.length : 0).toBe(0);
  });
});

test.describe.serial('Recurring Tasks — touch drag (dnd-kit)', () => {
  test.use({ hasTouch: true, viewport: { width: 412, height: 780 } });
  test.setTimeout(90000);
  let idToken: string;
  let domainId: string, area1Id: string, area2Id: string, defId: string;
  const domainName = uniqueName('RecTouch');

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const post = async (table: string, body: object) =>
      String(((await apiCall(table, 'POST', { creator_fk: sub, ...body }, idToken)) as Array<{ id: string }>)[0].id);
    domainId = await post('domains', { domain_name: domainName, closed: 0 });
    area1Id = await post('areas', { area_name: uniqueName('TouchA'), domain_fk: domainId, closed: 0, sort_order: 0 });
    area2Id = await post('areas', { area_name: uniqueName('TouchB'), domain_fk: domainId, closed: 0, sort_order: 1 });
    defId = await post('recurring_tasks', {
      description: 'Touch-moved task', area_fk: area1Id, recurrence: 'daily', active: 1,
      accumulate: 1, priority: 0, insert_position: 'bottom',
    });
  });

  test.afterAll(async () => {
    try { await apiDelete('domains', domainId, idToken); } catch {}
  });

  test('REC-TOUCH-01: hold still to lift a recurring row, then carry it to another card', async ({ page }) => {
    await page.goto(`/recurring?domain=${domainId}`);
    const source = page.getByTestId(`recurring-${defId}`).locator('[name="description"]').first();
    await expect(source).toBeVisible({ timeout: 30000 });
    const target = page.getByTestId(`recurring-area-card-${area2Id}`);
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/recurring_tasks'));
    await dndKitTouchDrag(page, source, target);
    await put;
    await expect(target.getByTestId(`recurring-${defId}`)).toBeVisible({ timeout: 10000 });
    const after = (await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken)) as Array<{ area_fk: number | string }>;
    expect(String(after[0].area_fk)).toBe(area2Id);
  });
});
