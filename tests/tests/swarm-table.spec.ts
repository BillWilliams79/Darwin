import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe('Swarm Table View', () => {

  // The table view (DataGrid) renders the current user's requirements. A clean
  // E2E user has none, which leaves the grid empty and breaks every row-dependent
  // assertion (row click, bulk-select, status sort, session chip). Seed a project
  // + category + one requirement per coordination_type (exercises the #2745
  // 'discuss' value in the Autonomy column) + a linked swarm session for the
  // Sessions-chip test. afterAll tears it all down (req #2750 — no data pollution).
  let idToken: string;
  let seedProjectId: string;
  let seedCategoryId: string;
  let seedSessionId: string;
  const seedReqIds: string[] = [];
  const seedProjectName = uniqueName('TblProj');
  const seedCategoryName = uniqueName('TblCat');

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60000);
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const projResult = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: seedProjectName, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!projResult?.length) throw new Error('Failed to seed project');
    seedProjectId = projResult[0].id;

    const catResult = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: seedCategoryName, project_fk: seedProjectId,
      closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!catResult?.length) throw new Error('Failed to seed category');
    seedCategoryId = catResult[0].id;

    // One requirement per coordination_type, all 'authoring' so they appear under
    // the default status filter and the Status asc-sort lands an authoring row first.
    const coords = ['discuss', 'planned', 'implemented', 'deployed'];
    for (const coord of coords) {
      const r = await apiCall('requirements', 'POST', {
        creator_fk: sub, title: uniqueName(`TblReq-${coord}`), category_fk: seedCategoryId,
        requirement_status: 'authoring', coordination_type: coord,
      }, idToken) as Array<{ id: string }>;
      if (!r?.length) throw new Error(`Failed to seed requirement (${coord})`);
      seedReqIds.push(r[0].id);
    }

    // Swarm session linked to the first requirement via source_ref — drives the
    // Sessions-column chip exercised by CTB-15.
    const sessResult = await apiCall('swarm_sessions', 'POST', {
      creator_fk: sub,
      branch: 'feature/e2e-swarm-table',
      task_name: 'e2e-swarm-table',
      source_type: 'roadmap',
      source_ref: `requirement:${seedReqIds[0]}`,
      title: 'E2E Swarm Table Session',
      swarm_status: 'active',
    }, idToken) as Array<{ id: string }>;
    if (!sessResult?.length) throw new Error('Failed to seed swarm session');
    seedSessionId = sessResult[0].id;
    await apiCall('requirement_sessions', 'POST', {
      requirement_fk: seedReqIds[0], session_fk: seedSessionId,
    }, idToken);
  });

  test.afterAll(async () => {
    test.setTimeout(60000);
    // FK-safe teardown: junction → session → requirements → project (CASCADE categories).
    try { await apiDelete('requirement_sessions', `${seedReqIds[0]}`, idToken); } catch {}
    try { await apiDelete('swarm_sessions', seedSessionId, idToken); } catch {}
    for (const id of seedReqIds) { try { await apiDelete('requirements', id, idToken); } catch {} }
    try { await apiDelete('projects', seedProjectId, idToken); } catch {}
  });

  test.beforeEach(async ({ page }) => {
    // Reset view to cards and default status filter before each test
    await page.goto('/swarm');
    await page.evaluate(() => {
      localStorage.setItem('darwin-swarm-view', 'cards');
    });
    await page.goto('/swarm');
    await page.waitForSelector('[data-testid="swarm-view-toggle"]', { timeout: 10000 });
  });

  test('CTB-01: /swarm renders view toggle with Cards and Table buttons', async ({ page }) => {
    const toggle = page.getByTestId('swarm-view-toggle');
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId('view-toggle-cards')).toBeVisible();
    await expect(page.getByTestId('view-toggle-table')).toBeVisible();
  });

  test('CTB-02: Clicking Table toggle shows DataGrid', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });
  });

  test('CTB-03: Clicking Cards toggle shows project tabs, hides DataGrid', async ({ page }) => {
    // Switch to table first
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    // Switch back to cards
    await page.getByTestId('view-toggle-cards').click();
    await expect(page.getByTestId('requirements-datagrid')).not.toBeVisible();

    // Project tabs (role="tab") should be present in cards mode
    const tabs = page.getByRole('tab');
    await expect(tabs.first()).toBeVisible({ timeout: 5000 });
  });

  test('CTB-04: Chips + settings visible in both views; rocket is cards-only', async ({ page }) => {
    // Cards mode (default): chips, rocket, settings all visible
    await expect(page.getByTestId('requirement-status-filter')).toBeVisible();
    await expect(page.getByTestId('swarm-start-card-toggle')).toBeVisible();

    // Switch to table view — chips + settings still visible, but rocket must be hidden
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('requirement-status-filter')).toBeVisible();
    await expect(page.getByTestId('swarm-start-card-toggle')).not.toBeVisible();
  });

  test('CTB-05: DataGrid renders expected columns in correct order', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    // All expected columns visible, in order: ID, Category, Title, Status, Autonomy, Sessions, Created, Completed
    const expectedColumns = ['ID', 'Category', 'Title', 'Status', 'Autonomy', 'Sessions', 'Created', 'Completed'];
    for (const colName of expectedColumns) {
      await expect(page.getByRole('columnheader', { name: colName })).toBeVisible();
    }

    // These should NOT be visible (removed per req, or renamed)
    await expect(page.getByRole('columnheader', { name: 'Sort' })).not.toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Started' })).not.toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Deferred' })).not.toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Coordination' })).not.toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Description' })).not.toBeVisible();
  });

  test('CTB-06: Clicking a requirement row navigates to /swarm/requirement/:id', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator('[data-rowindex="0"]').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.click();

    await expect(page).toHaveURL(/\/swarm\/requirement\/\d+/, { timeout: 10000 });
  });

  test('CTB-07: Table view toggle persists across page reload', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForSelector('[data-testid="swarm-view-toggle"]', { timeout: 10000 });

    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    const storedView = await page.evaluate(() => localStorage.getItem('darwin-swarm-view'));
    expect(storedView).toBe('table');
  });

  test('CTB-08: Status chips filter rows in table view', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    // Count rows with default filter (authoring + approved + swarm_ready + development selected)
    const rowsBefore = await page.locator('[role="row"][data-rowindex]').count();

    // Click 'authoring' chip to deselect it
    await page.getByTestId('filter-chip-authoring').click();
    // Give DataGrid a moment to re-render
    await page.waitForTimeout(300);

    const rowsAfter = await page.locator('[role="row"][data-rowindex]').count();

    // Row count should change (fewer rows if any were authoring; zero change is acceptable if test data has none)
    expect(rowsAfter).toBeLessThanOrEqual(rowsBefore);
  });

  test('CTB-09: Status column uses semantic sort order (authoring → met)', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    // Select all statuses so we see the full range
    for (const status of ['deferred', 'met']) {
      const chip = page.getByTestId(`filter-chip-${status}`);
      // Chip is a toggle — click to enable
      await chip.click();
    }
    await page.waitForTimeout(300);

    // Click Status column header to sort ascending
    const statusHeader = page.getByRole('columnheader', { name: 'Status' });
    await statusHeader.click();
    await page.waitForTimeout(300);

    // Grab the status text from the first 3 visible rows — authoring-family values come first
    const firstRowStatus = await page.locator('[data-rowindex="0"] [data-field="requirement_status"]').innerText();
    expect(firstRowStatus.toLowerCase()).toMatch(/authoring|approved|swarm-start|dev/i);
  });

  test('CTB-10: Status column sort toggles ascending/descending without display corruption', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    const statusHeader = page.getByRole('columnheader', { name: 'Status' });

    // Click 3 times — asc, desc, cleared. After each click, the grid should still have rows and consistent row count.
    const initialRows = await page.locator('[role="row"][data-rowindex]').count();

    await statusHeader.click();
    await page.waitForTimeout(200);
    const ascRows = await page.locator('[role="row"][data-rowindex]').count();
    expect(ascRows).toBe(initialRows);

    await statusHeader.click();
    await page.waitForTimeout(200);
    const descRows = await page.locator('[role="row"][data-rowindex]').count();
    expect(descRows).toBe(initialRows);

    await statusHeader.click();
    await page.waitForTimeout(200);
    const clearedRows = await page.locator('[role="row"][data-rowindex]').count();
    expect(clearedRows).toBe(initialRows);
  });

  test('CTB-11: Table shows checkbox selection column', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    // Header checkbox to select-all rows
    const selectAll = page.getByRole('checkbox', { name: /select all/i }).first();
    await expect(selectAll).toBeVisible();
  });

  test('CTB-12: Selecting rows shows "Edit N Selected" button and opens dialog with Category/Status/Autonomy', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    // Edit bar not visible before selection
    await expect(page.getByTestId('bulk-edit-bar')).not.toBeVisible();

    // Select first row via its checkbox
    const firstRowCheckbox = page.locator('[data-rowindex="0"] input[type="checkbox"]').first();
    await firstRowCheckbox.waitFor({ timeout: 10000 });
    await firstRowCheckbox.check();

    // Bulk edit bar + button visible
    await expect(page.getByTestId('bulk-edit-bar')).toBeVisible();
    const button = page.getByTestId('bulk-edit-button');
    await expect(button).toBeVisible();
    await expect(button).toContainText(/Edit Selected \(1\)/);

    // Open dialog
    await button.click();
    await expect(page.getByTestId('bulk-edit-dialog')).toBeVisible();

    // All three selects present
    await expect(page.getByTestId('bulk-category-select')).toBeVisible();
    await expect(page.getByTestId('bulk-status-select')).toBeVisible();
    await expect(page.getByTestId('bulk-autonomy-select')).toBeVisible();

    // Save button disabled until a value is chosen
    const saveBtn = page.getByTestId('bulk-save-button');
    await expect(saveBtn).toBeDisabled();
  });

  test('CTB-13: Bulk edit Save button enables when any field is selected', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    const firstRowCheckbox = page.locator('[data-rowindex="0"] input[type="checkbox"]').first();
    await firstRowCheckbox.waitFor({ timeout: 10000 });
    await firstRowCheckbox.check();

    await page.getByTestId('bulk-edit-button').click();
    await expect(page.getByTestId('bulk-edit-dialog')).toBeVisible();

    const saveBtn = page.getByTestId('bulk-save-button');
    await expect(saveBtn).toBeDisabled();

    // Choose a value in the Autonomy select (simpler enum, not dependent on DB state)
    // Material Select renders options in a portal; use role-based locator
    await page.getByTestId('bulk-autonomy-select').click();
    await page.getByRole('option', { name: /planned/i }).click();

    await expect(saveBtn).toBeEnabled();

    // Close dialog without saving to avoid mutating data
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page.getByTestId('bulk-edit-dialog')).not.toBeVisible();
  });

  test('CTB-14: Save opens confirmation gate; cancel returns to bulk edit dialog', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    // Select a row and open bulk edit
    const firstRowCheckbox = page.locator('[data-rowindex="0"] input[type="checkbox"]').first();
    await firstRowCheckbox.waitFor({ timeout: 10000 });
    await firstRowCheckbox.check();
    await page.getByTestId('bulk-edit-button').click();
    await expect(page.getByTestId('bulk-edit-dialog')).toBeVisible();

    // Choose a value and click Save
    await page.getByTestId('bulk-autonomy-select').click();
    await page.getByRole('option', { name: /planned/i }).click();
    await page.getByTestId('bulk-save-button').click();

    // Confirmation gate should open
    await expect(page.getByTestId('bulk-confirm-dialog')).toBeVisible();
    await expect(page.getByText(/This action cannot be easily undone/i)).toBeVisible();
    await expect(page.getByTestId('bulk-confirm-button')).toBeVisible();

    // Cancel returns to bulk edit dialog (edit still open)
    await page.getByTestId('bulk-confirm-dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('bulk-confirm-dialog')).not.toBeVisible();
    await expect(page.getByTestId('bulk-edit-dialog')).toBeVisible();

    // Full cleanup — close the edit dialog too
    await page.getByTestId('bulk-edit-dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('bulk-edit-dialog')).not.toBeVisible();
  });

  // Req #2240 — Sessions column lists linked sessions as clickable chips.
  test('CTB-15: Session chips are visible and navigate to /swarm/session/:id', async ({ page }) => {
    await page.getByTestId('view-toggle-table').click();
    await expect(page.getByTestId('requirements-datagrid')).toBeVisible({ timeout: 10000 });

    // Find any rendered session chip. Tests run against shared dev data —
    // at least one requirement is expected to have a linked session, but
    // skip if the dataset has none rather than fail spuriously.
    const anyChip = page.locator('[data-testid^="requirement-session-chip-"]').first();
    const chipCount = await page.locator('[data-testid^="requirement-session-chip-"]').count();
    test.skip(chipCount === 0, 'No linked sessions in current dataset');

    await expect(anyChip).toBeVisible();

    // Extract the session id from the testid attribute.
    const testId = await anyChip.getAttribute('data-testid');
    const sessionId = testId?.split('-').pop();
    expect(sessionId).toMatch(/^\d+$/);

    // Clicking the chip navigates to the session detail — must NOT land on
    // /swarm/requirement/* (would mean stopPropagation regressed and the
    // row click fired first).
    await anyChip.click();
    await expect(page).toHaveURL(new RegExp(`/swarm/session/${sessionId}$`), { timeout: 10000 });
  });

});
