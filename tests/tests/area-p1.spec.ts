import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';
import { dndKitDrag } from '../helpers/dnd-kit-drag';

test.describe.serial('Area Management P1', () => {
  let idToken: string;
  let testDomainId: string;
  const testDomainName = uniqueName('AreaP1Dom');
  const createdAreaIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    // Create a test domain for area tests
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: testDomainName, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test domain');
    testDomainId = result[0].id;
  });

  test.afterAll(async () => {
    // Hard-delete the domain (ON DELETE CASCADE handles child areas/tasks)
    try { await apiDelete('domains', testDomainId, idToken); } catch { /* best-effort */ }
  });

  test('AREA-04: update area name', async ({ page }) => {
    const areaName = uniqueName('EditArea');
    const updatedName = uniqueName('RenamedArea');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create area via API
    const result = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: areaName, domain_fk: testDomainId, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test area');
    createdAreaIds.push(result[0].id);

    // Navigate to AreaEdit
    await page.goto('/areaedit');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Select test domain tab
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1000);

    // Find the area name input in the active tab panel
    const panel = page.locator('[role="tabpanel"]:visible').first();
    const areaRow = panel.getByTestId(`area-row-${result[0].id}`);
    await expect(areaRow).toBeVisible({ timeout: 5000 });

    const nameField = areaRow.locator('input[name="area-name"]');
    await expect(nameField).toBeVisible();

    // Clear and type updated name
    await nameField.fill(updatedName);
    await nameField.blur();

    // Wait for PUT
    await page.waitForTimeout(1000);

    // Verify persists on reload
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1000);

    const panelAfter = page.locator('[role="tabpanel"]:visible').first();
    const rowAfter = panelAfter.getByTestId(`area-row-${result[0].id}`);
    const nameAfter = await rowAfter.locator('input[name="area-name"]').inputValue();
    expect(nameAfter).toBe(updatedName);
  });

  test('AREA-05: hard delete area', async ({ page }) => {
    const areaName = uniqueName('DeleteArea');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create area via API
    const result = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: areaName, domain_fk: testDomainId, closed: 0, sort_order: 10,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test area');
    // Don't add to cleanup — we're deleting in the test

    // Navigate to AreaEdit
    await page.goto('/areaedit');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1000);

    const panel = page.locator('[role="tabpanel"]:visible').first();
    const areaRow = panel.getByTestId(`area-row-${result[0].id}`);
    await expect(areaRow).toBeVisible({ timeout: 5000 });

    // Click the delete button (last child div's button in the row)
    await areaRow.locator('> div:last-child button').click();

    // AreaDeleteDialog should appear
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog).toBeVisible({ timeout: 5000 });
    await expect(deleteDialog).toContainText('Delete Area?');

    // Confirm delete
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    // Verify area row is removed
    await expect(areaRow).not.toBeVisible({ timeout: 5000 });
  });

  test('AREA-07: delete area via card menu', async ({ page }) => {
    const areaName = uniqueName('MenuDelArea');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create area via API
    const result = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: areaName, domain_fk: testDomainId, closed: 0, sort_order: 11, sort_mode: 'priority',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test area');
    const areaId = result[0].id;
    // Don't add to cleanup — we're deleting in the test

    // Create a task in this area so we can verify task count in dialog
    const taskResult = await apiCall('tasks', 'POST', {
      creator_fk: sub, description: 'test task for delete', area_fk: areaId, priority: 0, done: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;

    // Navigate to TaskPlanView and select domain tab
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1000);

    const panel = page.locator('[role="tabpanel"]:visible').first();

    // Find the area card
    const areaCard = panel.getByTestId(`area-card-${areaId}`);
    await expect(areaCard).toBeVisible({ timeout: 5000 });

    // Open the triple-dot card menu
    await areaCard.getByTestId(`card-menu-${areaId}`).click();

    // Click "Delete Area" menu item (red)
    const deleteMenuItem = page.getByTestId(`menu-delete-area-${areaId}`);
    await expect(deleteMenuItem).toBeVisible();
    await deleteMenuItem.click();

    // AreaDeleteDialog should appear with area name and task count
    const deleteDialog = page.getByTestId('area-delete-dialog');
    await expect(deleteDialog).toBeVisible({ timeout: 5000 });
    await expect(deleteDialog).toContainText(areaName.substring(0, 20));
    await expect(deleteDialog).toContainText('1 task');
    await expect(deleteDialog).toContainText('This cannot be undone');

    // Confirm delete
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    // Verify area card is removed
    await expect(areaCard).not.toBeVisible({ timeout: 5000 });
  });

  test('AREA-08: delete empty area via card menu shows no-tasks message', async ({ page }) => {
    const areaName = uniqueName('EmptyDelArea');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create area with no tasks
    const result = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: areaName, domain_fk: testDomainId, closed: 0, sort_order: 12, sort_mode: 'priority',
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test area');
    const areaId = result[0].id;
    // Don't add to cleanup — we're deleting in the test

    // Navigate to TaskPlanView and select domain tab
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1000);

    const panel = page.locator('[role="tabpanel"]:visible').first();

    // Find the area card
    const areaCard = panel.getByTestId(`area-card-${areaId}`);
    await expect(areaCard).toBeVisible({ timeout: 5000 });

    // Open the triple-dot card menu and click Delete Area
    await areaCard.getByTestId(`card-menu-${areaId}`).click();
    const deleteMenuItem = page.getByTestId(`menu-delete-area-${areaId}`);
    await expect(deleteMenuItem).toBeVisible();
    await deleteMenuItem.click();

    // AreaDeleteDialog should show no-tasks message
    const deleteDialog = page.getByTestId('area-delete-dialog');
    await expect(deleteDialog).toBeVisible({ timeout: 5000 });
    await expect(deleteDialog).toContainText('has no tasks');
    await expect(deleteDialog).toContainText('This cannot be undone');

    // Confirm delete
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    // Verify area card is removed
    await expect(areaCard).not.toBeVisible({ timeout: 5000 });
  });

  test('AREA-06: DnD area cross-domain on TaskPlanView (dnd-kit)', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a second domain to drop the area onto
    const domain2Name = uniqueName('DropDom');
    const dom2Result = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domain2Name, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!dom2Result?.length) throw new Error('Failed to create target domain');
    const domain2Id = dom2Result[0].id;

    // Create an area in the first domain
    const areaName = uniqueName('DragArea');
    const areaResult = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: areaName, domain_fk: testDomainId, closed: 0, sort_order: 20,
    }, idToken) as Array<{ id: string }>;
    if (!areaResult?.length) throw new Error('Failed to create test area');
    const areaId = areaResult[0].id;
    createdAreaIds.push(areaId);

    // Create an area in the second domain so its tab panel has content
    const area2Name = uniqueName('TargetArea');
    const area2Result = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: area2Name, domain_fk: domain2Id, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    let area2Id: string | undefined;
    if (area2Result?.length) area2Id = area2Result[0].id;

    try {
      // Navigate to TaskPlanView
      await page.goto('/taskcards');
      await page.waitForSelector('[role="tab"]', { timeout: 10000 });

      // Select the source domain tab
      await page.getByRole('tab', { name: testDomainName }).click();
      await page.waitForTimeout(1000);

      // Verify the area card exists
      const sourceCard = page.getByTestId(`area-card-${areaId}`);
      await expect(sourceCard).toBeVisible({ timeout: 5000 });

      // Get the domain2 tab as the drop target
      const targetTab = page.getByRole('tab', { name: domain2Name });
      await expect(targetTab).toBeVisible({ timeout: 5000 });

      // Lift the card, hold it over the other domain's tab until the page
      // switches to it (TAB_HOVER_SWITCH_MS), then carry it onto that domain's
      // card and release. One drag, no synthetic events, no API fallback.
      await sourceCard.scrollIntoViewIfNeeded();
      await targetTab.scrollIntoViewIfNeeded();
      const areaPut = page.waitForResponse(
        res => res.request().method() === 'PUT' && res.url().includes('/areas'),
        { timeout: 10000 },
      );
      await dndKitDrag(page, sourceCard, targetTab, {
        grab: 'upper',
        holdOverTargetMs: 900,
        then: page.getByTestId(`area-card-${area2Id}`),
      });
      await areaPut;

      // The page stays on the domain the card was carried to.
      const movedCard = page.getByTestId(`area-card-${areaId}`);
      await expect(page.getByRole('tab', { name: domain2Name })).toHaveAttribute('aria-selected', 'true');
      await expect(movedCard).toBeVisible({ timeout: 5000 });

      // Verify persists after reload
      await page.reload();
      await page.waitForSelector('[role="tab"]', { timeout: 10000 });
      await page.getByRole('tab', { name: domain2Name }).click();
      await page.waitForTimeout(1500);
      await expect(page.getByTestId(`area-card-${areaId}`)).toBeVisible({ timeout: 5000 });
    } finally {
      // Cleanup: hard-delete domain2 (CASCADE handles area2)
      try { await apiDelete('domains', domain2Id, idToken); } catch {}
    }
  });
});
