import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe.serial('Category Management', () => {
  test.setTimeout(90_000);

  let idToken: string;
  const sub = process.env.E2E_TEST_COGNITO_SUB!;
  let testProjectId: string;
  const testProjectName = uniqueName('CatProject');
  const createdCategoryIds: string[] = [];

  // Second project for tab switching test (CAT-09)
  let testProject2Id: string;
  const testProject2Name = uniqueName('CatProject2');

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

    // Create second test project for tab switching
    const result2 = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: testProject2Name, closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!result2?.length) throw new Error('Failed to create test project 2');
    testProject2Id = result2[0].id;
  });

  test.afterAll(async () => {
    // Hard-delete projects (ON DELETE CASCADE handles categories → priorities)
    try { await apiDelete('projects', testProjectId, idToken); } catch { /* best-effort */ }
    try { await apiDelete('projects', testProject2Id, idToken); } catch { /* best-effort */ }
  });

  /** Navigate to CategoryEdit and select the test project tab. */
  async function goToTestProject(page: import('@playwright/test').Page) {
    await page.goto('/categoryedit');
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: testProjectName, exact: true }).click();
    await page.waitForTimeout(1000);
  }

  test('CAT-01: create category via template row', async ({ page }) => {
    const categoryName = uniqueName('Category');

    await goToTestProject(page);

    // Scope to the visible tab panel
    const panel = page.locator('[role="tabpanel"]:not([hidden])').first();
    const templateRow = panel.getByTestId('category-row-template');
    await expect(templateRow).toBeVisible({ timeout: 5000 });

    const nameField = templateRow.locator('input[name="category-name"]');
    await nameField.fill(categoryName);
    await nameField.press('Enter');

    // Wait for the category to be created
    await page.waitForTimeout(2000);

    // Verify the category row exists in the panel
    const allNames = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[name="category-name"]');
      return Array.from(inputs).map(input => (input as HTMLInputElement).value);
    });
    expect(allNames).toContain(categoryName);

    // A new blank template should still exist
    await expect(panel.getByTestId('category-row-template')).toBeVisible();

    // Get category ID for cleanup
    const categories = await apiCall(
      `categories?creator_fk=${sub}&project_fk=${testProjectId}&closed=0`,
      'GET', '', idToken,
    ) as Array<{ id: string; category_name: string }>;
    const created = categories?.find(c => c.category_name === categoryName);
    if (created) createdCategoryIds.push(created.id);
  });

  test('CAT-08: template row gets focus after creating a new category', async ({ page }) => {
    const categoryName = uniqueName('FocusCat');

    await goToTestProject(page);

    const panel = page.locator('[role="tabpanel"]:not([hidden])').first();
    const templateRow = panel.getByTestId('category-row-template');
    await expect(templateRow).toBeVisible({ timeout: 5000 });

    const nameField = templateRow.locator('input[name="category-name"]');
    await nameField.fill(categoryName);
    await nameField.press('Enter');

    // Wait for the category to be saved and template to re-render
    await page.waitForTimeout(2000);

    // The template input should be focused after creation
    const templateInput = panel.getByTestId('category-row-template').locator('input[name="category-name"]');
    await expect(templateInput).toBeFocused({ timeout: 3000 });

    // Track for cleanup
    const categories = await apiCall(
      `categories?creator_fk=${sub}&project_fk=${testProjectId}&closed=0`,
      'GET', '', idToken,
    ) as Array<{ id: string; category_name: string }>;
    const created = categories?.find(c => c.category_name === categoryName);
    if (created) createdCategoryIds.push(created.id);
  });

  test('CAT-09: project tabs work — switch between projects', async ({ page }) => {
    // Create a category in each project via API
    const catName1 = uniqueName('CatInProj1');
    const catName2 = uniqueName('CatInProj2');

    const cat1Result = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: catName1, project_fk: testProjectId, closed: 0, sort_order: 99,
    }, idToken) as Array<{ id: string }>;
    if (cat1Result?.length) createdCategoryIds.push(cat1Result[0].id);

    const cat2Result = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: catName2, project_fk: testProject2Id, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    // cat2 cleanup handled by project2 CASCADE

    await page.goto('/categoryedit');
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });

    // Select first project tab and verify its category
    await page.getByRole('tab', { name: testProjectName, exact: true }).click();
    await page.waitForTimeout(1000);

    let visibleNames = await page.evaluate(() => {
      // Get names from the visible (non-hidden) tab panel
      const panels = document.querySelectorAll('[role="tabpanel"]');
      for (const panel of panels) {
        if (panel.getAttribute('hidden') === null) {
          const inputs = panel.querySelectorAll('input[name="category-name"]');
          return Array.from(inputs).map(input => (input as HTMLInputElement).value);
        }
      }
      return [];
    });
    expect(visibleNames).toContain(catName1);
    expect(visibleNames).not.toContain(catName2);

    // Switch to second project tab
    await page.getByRole('tab', { name: testProject2Name, exact: true }).click();
    await page.waitForTimeout(1000);

    visibleNames = await page.evaluate(() => {
      const panels = document.querySelectorAll('[role="tabpanel"]');
      for (const panel of panels) {
        if (panel.getAttribute('hidden') === null) {
          const inputs = panel.querySelectorAll('input[name="category-name"]');
          return Array.from(inputs).map(input => (input as HTMLInputElement).value);
        }
      }
      return [];
    });
    expect(visibleNames).toContain(catName2);
    expect(visibleNames).not.toContain(catName1);
  });
});
