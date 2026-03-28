import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';
import { pangeaDragAndDrop } from '../helpers/pangea-dnd-drag';

test.describe.serial('Category Management P1', () => {
  test.setTimeout(90_000);

  let idToken: string;
  const sub = process.env.E2E_TEST_COGNITO_SUB!;
  let testProjectId: string;
  const testProjectName = uniqueName('CatP1Project');
  const createdCategoryIds: string[] = [];
  const createdPriorityIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    // Create test project
    const result = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: testProjectName, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test project');
    testProjectId = result[0].id;
  });

  test.afterAll(async () => {
    // Hard-delete project (ON DELETE CASCADE handles categories → priorities)
    try { await apiDelete('projects', testProjectId, idToken); } catch { /* best-effort */ }
  });

  /** Navigate to CategoryEdit and select the test project tab, return the visible panel. */
  async function goToTestProject(page: import('@playwright/test').Page) {
    await page.goto('/categoryedit');
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: testProjectName, exact: true }).click();
    await page.waitForTimeout(1000);
    return page.locator('[role="tabpanel"]:not([hidden])').first();
  }

  test('CAT-02: update category name inline', async ({ page }) => {
    const categoryName = uniqueName('EditCat');
    const updatedName = uniqueName('RenamedCat');

    // Create category via API
    const result = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: categoryName, project_fk: testProjectId, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test category');
    createdCategoryIds.push(result[0].id);

    const panel = await goToTestProject(page);

    const catRow = panel.getByTestId(`category-row-${result[0].id}`);
    await expect(catRow).toBeVisible({ timeout: 5000 });

    const nameField = catRow.locator('input[name="category-name"]');
    await expect(nameField).toBeVisible();

    // Clear and type updated name
    await nameField.fill(updatedName);
    await nameField.blur();

    // Wait for PUT
    await page.waitForTimeout(1000);

    // Verify persists on reload
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: testProjectName, exact: true }).click();
    await page.waitForTimeout(1000);

    const panelAfter = page.locator('[role="tabpanel"]:not([hidden])').first();
    const rowAfter = panelAfter.getByTestId(`category-row-${result[0].id}`);
    const nameAfter = await rowAfter.locator('input[name="category-name"]').inputValue();
    expect(nameAfter).toBe(updatedName);
  });

  test('CAT-03: close category via checkbox', async ({ page }) => {
    const categoryName = uniqueName('CloseCat');

    // Create open category via API
    const result = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: categoryName, project_fk: testProjectId, closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test category');
    const categoryId = result[0].id;
    createdCategoryIds.push(categoryId);

    const panel = await goToTestProject(page);

    const catRow = panel.getByTestId(`category-row-${categoryId}`);
    await expect(catRow).toBeVisible({ timeout: 5000 });

    // Click the closed checkbox
    await catRow.locator('input[type="checkbox"]').click();

    // Wait for PUT and re-sort
    await page.waitForTimeout(1500);

    // Verify via API that the category is closed
    const categories = await apiCall(
      `categories?creator_fk=${sub}&id=${categoryId}&fields=id,closed`,
      'GET', '', idToken,
    ) as Array<{ id: number; closed: number }>;
    expect(categories?.length).toBe(1);
    expect(categories[0].closed).toBe(1);
  });

  test('CAT-04: reopen closed category', async ({ page }) => {
    const categoryName = uniqueName('ReopenCat');

    // Create a closed category via API
    const result = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: categoryName, project_fk: testProjectId, closed: 1, sort_order: null,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test category');
    const categoryId = result[0].id;
    createdCategoryIds.push(categoryId);

    const panel = await goToTestProject(page);

    // Closed categories are rendered below open ones
    const catRow = panel.getByTestId(`category-row-${categoryId}`);
    await expect(catRow).toBeVisible({ timeout: 5000 });

    // The checkbox should be checked (closed=1)
    const checkbox = catRow.locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();

    // Click to reopen
    await checkbox.click();

    // Wait for PUT and re-sort
    await page.waitForTimeout(1500);

    // Verify via API that the category is reopened
    const categories = await apiCall(
      `categories?creator_fk=${sub}&id=${categoryId}&fields=id,closed`,
      'GET', '', idToken,
    ) as Array<{ id: number; closed: number }>;
    expect(categories?.length).toBe(1);
    expect(categories[0].closed).toBe(0);
  });

  test('CAT-05: hard delete category + confirmation dialog', async ({ page }) => {
    const categoryName = uniqueName('DeleteCat');

    // Create category via API
    const result = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: categoryName, project_fk: testProjectId, closed: 0, sort_order: 2,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test category');
    // Don't add to cleanup — we're deleting in the test

    const panel = await goToTestProject(page);

    const catRow = panel.getByTestId(`category-row-${result[0].id}`);
    await expect(catRow).toBeVisible({ timeout: 5000 });

    // Click the delete button (last child div's button in the row)
    await catRow.locator('> div:last-child button').click();

    // CategoryDeleteDialog should appear
    const deleteDialog = page.getByTestId('category-edit-delete-dialog');
    await expect(deleteDialog).toBeVisible({ timeout: 5000 });
    await expect(deleteDialog).toContainText('Delete Category?');

    // Click Delete to confirm
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    // Verify category row is removed
    await expect(catRow).not.toBeVisible({ timeout: 5000 });
  });

  test('CAT-06: DnD reorder categories within a project tab', async ({ page }) => {
    const name1 = uniqueName('SortCatA');
    const name2 = uniqueName('SortCatB');

    // Create 2 categories with explicit sort_order
    const r1 = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: name1, project_fk: testProjectId, closed: 0, sort_order: 900,
    }, idToken) as Array<{ id: string }>;
    const r2 = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: name2, project_fk: testProjectId, closed: 0, sort_order: 901,
    }, idToken) as Array<{ id: string }>;

    if (!r1?.length || !r2?.length) throw new Error('Failed to create test categories');
    createdCategoryIds.push(r1[0].id, r2[0].id);

    const panel = await goToTestProject(page);

    // Find both rows and verify initial order (A before B)
    const firstRow = panel.getByTestId(`category-row-${r1[0].id}`);
    const secondRow = panel.getByTestId(`category-row-${r2[0].id}`);
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    await expect(secondRow).toBeVisible({ timeout: 5000 });

    const initialFirstY = (await firstRow.boundingBox())!.y;
    const initialSecondY = (await secondRow.boundingBox())!.y;
    expect(initialFirstY).toBeLessThan(initialSecondY);

    // DnD: drag second row above first row
    await pangeaDragAndDrop(page, secondRow, firstRow);

    // Verify order changed
    const afterFirstY = (await firstRow.boundingBox())!.y;
    const afterSecondY = (await secondRow.boundingBox())!.y;
    expect(afterSecondY).toBeLessThan(afterFirstY);

    // Verify persists on reload
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: testProjectName, exact: true }).click();
    await page.waitForTimeout(1000);

    const reloadPanel = page.locator('[role="tabpanel"]:not([hidden])').first();
    const reloadFirstY = (await reloadPanel.getByTestId(`category-row-${r1[0].id}`).boundingBox())!.y;
    const reloadSecondY = (await reloadPanel.getByTestId(`category-row-${r2[0].id}`).boundingBox())!.y;
    expect(reloadSecondY).toBeLessThan(reloadFirstY);
  });

  test('CAT-07: verify Priorities count column is accurate', async ({ page }) => {
    const categoryName = uniqueName('CountsCat');

    // Create category
    const catResult = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: categoryName, project_fk: testProjectId, closed: 0, sort_order: 3,
    }, idToken) as Array<{ id: string }>;
    if (!catResult?.length) throw new Error('Failed to create test category');
    const categoryId = catResult[0].id;
    createdCategoryIds.push(categoryId);

    // Navigate and verify 0 count initially
    const panel = await goToTestProject(page);

    // The priority count is displayed as text in the row.
    // CategoryTableRow doesn't have a specific data-testid for the count,
    // so we check the text content of the row.
    const catRow = panel.getByTestId(`category-row-${categoryId}`);
    await expect(catRow).toBeVisible({ timeout: 5000 });

    // The third column (index 2) contains the priority count — should show 0
    const countCell = catRow.locator('> div').nth(2);
    await expect(countCell).toHaveText('0');

    // Create 3 priorities under this category
    for (let i = 0; i < 3; i++) {
      const result = await apiCall('priorities', 'POST', {
        creator_fk: sub, title: uniqueName(`CatPri-${i}`), category_fk: categoryId,
        priority_status: 'open', sort_order: i,
      }, idToken) as Array<{ id: string }>;
      if (result?.length) createdPriorityIds.push(result[0].id);
    }

    // Reload and verify updated count
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: testProjectName, exact: true }).click();
    await page.waitForTimeout(1000);

    const reloadPanel = page.locator('[role="tabpanel"]:not([hidden])').first();
    const reloadRow = reloadPanel.getByTestId(`category-row-${categoryId}`);
    const reloadCountCell = reloadRow.locator('> div').nth(2);
    await expect(reloadCountCell).toHaveText('3');
  });
});
