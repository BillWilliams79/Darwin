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

  // -------------------------------------------------------------------------
  // REC-DND-01: Drag recurring task between area cards (same domain)
  // -------------------------------------------------------------------------
  // retries: 1 handles inherent timing flakiness of mouse-based react-dnd DnD under full-suite load
  test('REC-DND-01: drag recurring task between area cards (same domain)', { retries: 1 }, async ({ page }) => {
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

    // Ensure both source and target are inside the viewport so mouse coordinates
    // resolve to the intended DOM elements — prior tests can leave the page
    // scrolled such that the source row is off-screen at DnD time.
    await sourceRow.scrollIntoViewIfNeeded();
    await targetCard.scrollIntoViewIfNeeded();

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
    await page.waitForTimeout(1500);

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
  // retries: 1 handles inherent timing flakiness of 500ms hover-to-switch under full-suite load
  test('REC-DND-02: drag recurring task across domain tabs', { retries: 1 }, async ({ page }) => {
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
    // Small initial move to trigger drag recognition (mirroring REC-DND-01 pattern)
    await page.mouse.move(srcBounds.x + 25, srcBounds.y + 12, { steps: 3 });
    await page.waitForTimeout(100);

    // Step 2: hover over domain 2 tab — triggers RecurringDroppableTab's 500ms timer.
    // Poll: keep generating hover events (every 50ms) until the tab switch is detected,
    // or until 6000ms elapses. This is more robust than a fixed-time wiggle under load.
    const tabCx = tabBounds.x + tabBounds.width / 2;
    const tabCy = tabBounds.y + tabBounds.height / 2;
    await page.mouse.move(tabCx, tabCy, { steps: 20 });
    const deadline = Date.now() + 6000;
    let tabSwitched = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(50);
      await page.mouse.move(tabCx + ((Date.now() % 3) - 1), tabCy, { steps: 2 });
      if (await area3Card.isVisible()) { tabSwitched = true; break; }
    }
    // Step 3: tab should have switched; area3Card visible
    if (!tabSwitched) await expect(area3Card).toBeVisible({ timeout: 2000 });

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
  // REC-DND-03: Drag recurring task → tab switch → drop on tab → tab reverts
  // -------------------------------------------------------------------------
  // retries: 1 handles inherent timing flakiness of 500ms hover-to-switch under full-suite load
  test('REC-DND-03: cancelled cross-domain drag reverts tab to original domain', { retries: 1 }, async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a second domain + area so there is a droppable tab to hover over
    const domain4Name = uniqueName('RecDomain4');
    const domResult = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domain4Name, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!domResult?.length) throw new Error('Failed to create second test domain');
    const testDomain4Id = domResult[0].id;

    const area4Name = uniqueName('RecArea4');
    const areaResult = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: area4Name, domain_fk: testDomain4Id, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!areaResult?.length) throw new Error('Failed to create area in second domain');
    const testArea4Id = areaResult[0].id;

    // Create a recurring def in the original test domain's area
    const result = await apiCall('recurring_tasks', 'POST', {
      creator_fk: sub,
      description: 'DnD cancelled cross-domain task',
      area_fk: testAreaId,
      recurrence: 'daily',
      active: 1,
      accumulate: 1,
      priority: 0,
      insert_position: 'bottom',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create recurring task for REC-DND-03');
    const defId = result[0].id;
    createdDefIds.push(String(defId));

    await page.goto('/recurring');
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: testDomainName }).first().click();
    await page.waitForSelector(`[data-testid="recurring-area-card-${testAreaId}"]`, { timeout: 15000 });

    const sourceRow = page.getByTestId(`recurring-${defId}`);
    await expect(sourceRow).toBeVisible();

    const targetTab = page.getByRole('tab', { name: domain4Name }).first();
    await expect(targetTab).toBeVisible();

    // area4Card becomes visible when the tab switch fires
    const area4Card = page.getByTestId(`recurring-area-card-${testArea4Id}`);
    // area1Card is visible only when we're on the original domain
    const area1Card = page.getByTestId(`recurring-area-card-${testAreaId}`);

    const srcBounds = await sourceRow.boundingBox();
    const tabBounds = await targetTab.boundingBox();
    if (!srcBounds || !tabBounds) throw new Error('Could not get bounding boxes');

    // Step 1: start drag
    await page.mouse.move(srcBounds.x + 12, srcBounds.y + 12);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(srcBounds.x + 25, srcBounds.y + 12, { steps: 3 });
    await page.waitForTimeout(100);

    // Step 2: hover over domain 4 tab until tab switch fires (area4Card appears)
    const tabCx = tabBounds.x + tabBounds.width / 2;
    const tabCy = tabBounds.y + tabBounds.height / 2;
    await page.mouse.move(tabCx, tabCy, { steps: 20 });
    const deadline = Date.now() + 6000;
    let tabSwitched = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(50);
      await page.mouse.move(tabCx + ((Date.now() % 3) - 1), tabCy, { steps: 2 });
      if (await area4Card.isVisible()) { tabSwitched = true; break; }
    }
    if (!tabSwitched) await expect(area4Card).toBeVisible({ timeout: 2000 });

    // Step 3: drop ON the tab itself (not a card) — cancelled drop
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Tab should revert to original domain — area1Card visible, area4Card hidden
    await expect(area1Card).toBeVisible({ timeout: 5000 });
    await expect(area4Card).not.toBeVisible();

    // Verify via API that area_fk was NOT changed
    const check = await apiCall(`recurring_tasks?id=${defId}`, 'GET', '', idToken) as Array<{ area_fk: number | string }>;
    expect(String(check?.[0]?.area_fk)).toBe(String(testAreaId));

    // Cleanup domain 4 (cascade handles area)
    try { await apiDelete('domains', testDomain4Id, idToken); } catch {}
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
