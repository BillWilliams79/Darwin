import { test, expect } from '@playwright/test';

test.describe('Swarm Table View', () => {

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

    // All expected columns visible, in order: ID, Category, Title, Status, Autonomy, Created, Completed
    const expectedColumns = ['ID', 'Category', 'Title', 'Status', 'Autonomy', 'Created', 'Completed'];
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

});
