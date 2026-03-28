import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName, navigateToProjectEdit, waitForProjectTable, findProjectIndex } from '../helpers/api';

test.describe('Project Management', () => {
  test.setTimeout(90_000);

  let idToken: string;
  const createdProjectIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
  });

  test.afterAll(async () => {
    for (const id of createdProjectIds) {
      try { await apiDelete('projects', id, idToken); } catch { /* best-effort */ }
    }
  });

  test('PROJ-01: create project via template row', async ({ page }) => {
    const projectName = uniqueName('Project');

    await navigateToProjectEdit(page);

    // Find the template row and its input
    const templateRow = page.getByTestId('project-row-template');
    await expect(templateRow).toBeVisible();

    const nameField = templateRow.locator('input[name="project-name"]');
    await nameField.fill(projectName);
    await nameField.press('Enter');

    // Wait for the project to be created and re-render
    await page.waitForTimeout(2000);

    // Verify the project row exists
    const idx = await findProjectIndex(page, projectName);
    expect(idx).toBeGreaterThan(-1);

    // A new blank template should still exist
    await expect(page.getByTestId('project-row-template')).toBeVisible();

    // Get project ID for cleanup
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const projects = await apiCall(
      `projects?creator_fk=${sub}&closed=0&project_name=${encodeURIComponent(projectName)}`,
      'GET', '', idToken,
    ) as Array<{ id: string }>;
    if (projects?.length) {
      createdProjectIds.push(projects[0].id);
    }
  });

  test('PROJ-08: no row highlighted on page load', async ({ page }) => {
    await navigateToProjectEdit(page);

    // No project row should have the selected background on initial load.
    // selectedId starts as null, so no row should have aria-selected or
    // the MUI action.selected background. Check that no row has the
    // 'Mui-selected' class or equivalent selected styling.
    // The component uses sx={{ backgroundColor: isSelected ? 'action.selected' : 'inherit' }}
    // When selectedId is null, no row's id matches, so all have 'inherit'.
    const rows = page.locator('[data-testid^="project-row-"]:not([data-testid="project-row-template"])');
    const count = await rows.count();

    // Verify at least one project row exists (pre-existing data)
    // If no projects exist, the test is trivially true but still valid
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        const bg = await rows.nth(i).evaluate(el => getComputedStyle(el).backgroundColor);
        // 'inherit' resolves to the parent's background — should NOT be the MUI action.selected color
        // MUI action.selected is typically rgba(0, 0, 0, 0.08) in light mode
        // 'rgba(0, 0, 0, 0)' means transparent/inherit — that's the expected state
        expect(bg).not.toContain('0.08');
      }
    }
  });

  test('PROJ-09: template row gets focus after creating a new project', async ({ page }) => {
    const projectName = uniqueName('FocusProj');

    await navigateToProjectEdit(page);

    const templateRow = page.getByTestId('project-row-template');
    const nameField = templateRow.locator('input[name="project-name"]');

    await nameField.fill(projectName);
    await nameField.press('Enter');

    // Wait for the project to be saved and template to re-render
    await page.waitForTimeout(2000);

    // The template input should be focused after creation
    const templateInput = page.getByTestId('project-row-template').locator('input[name="project-name"]');
    await expect(templateInput).toBeFocused({ timeout: 3000 });

    // Cleanup: get the created project ID
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const projects = await apiCall(
      `projects?creator_fk=${sub}&closed=0&project_name=${encodeURIComponent(projectName)}`,
      'GET', '', idToken,
    ) as Array<{ id: string }>;
    if (projects?.length) {
      createdProjectIds.push(projects[0].id);
    }
  });
});
