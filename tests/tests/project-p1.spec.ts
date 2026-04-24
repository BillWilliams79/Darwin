import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName, navigateToProjectEdit, waitForProjectTable, findProjectIndex, getAllProjectNames } from '../helpers/api';
import { pangeaDragAndDrop } from '../helpers/pangea-dnd-drag';

test.describe.serial('Project Management P1', () => {
  test.setTimeout(90_000);

  let idToken: string;
  const sub = process.env.E2E_TEST_COGNITO_SUB!;
  const createdProjectIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdRequirementIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
  });

  test.afterAll(async () => {
    // Cleanup in reverse dependency order: requirements → categories → projects
    for (const id of createdRequirementIds) {
      try { await apiDelete('requirements', id, idToken); } catch { /* best-effort */ }
    }
    for (const id of createdCategoryIds) {
      try { await apiDelete('categories', id, idToken); } catch { /* best-effort */ }
    }
    for (const id of createdProjectIds) {
      try { await apiDelete('projects', id, idToken); } catch { /* best-effort */ }
    }
  });

  test('PROJ-02: update project name inline', async ({ page }) => {
    const projectName = uniqueName('EditProj');
    const updatedName = uniqueName('RenamedProj');

    // Create project via API
    const result = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: projectName, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test project');
    createdProjectIds.push(result[0].id);

    await navigateToProjectEdit(page);

    const idx = await findProjectIndex(page, projectName);
    expect(idx).toBeGreaterThan(-1);
    const targetField = page.locator('input[name="project-name"]').nth(idx);

    // Clear and type new name
    await targetField.fill(updatedName);
    await targetField.blur();

    // Wait for PUT to complete
    await page.waitForTimeout(1000);

    // Verify persists on reload
    await page.reload();
    await waitForProjectTable(page);

    const updatedIdx = await findProjectIndex(page, updatedName);
    expect(updatedIdx).toBeGreaterThan(-1);
  });

  test('PROJ-03: close project via checkbox', async ({ page }) => {
    const projectName = uniqueName('CloseProj');

    // Create open project via API
    const result = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: projectName, closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test project');
    const projectId = result[0].id;
    createdProjectIds.push(projectId);

    await navigateToProjectEdit(page);

    // Find the project row
    const projectRow = page.getByTestId(`project-row-${projectId}`);
    await expect(projectRow).toBeVisible({ timeout: 5000 });

    // Click the closed checkbox
    await projectRow.locator('input[type="checkbox"]').click();

    // Wait for PUT and re-sort
    await page.waitForTimeout(1500);

    // Verify via API that the project is closed
    const projects = await apiCall(
      `projects?creator_fk=${sub}&id=${projectId}&fields=id,closed`,
      'GET', '', idToken,
    ) as Array<{ id: number; closed: number }>;
    expect(projects?.length).toBe(1);
    expect(projects[0].closed).toBe(1);
  });

  test('PROJ-04: reopen closed project via checkbox', async ({ page }) => {
    const projectName = uniqueName('ReopenProj');

    // Create a closed project via API
    const result = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: projectName, closed: 1, sort_order: null,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test project');
    const projectId = result[0].id;
    createdProjectIds.push(projectId);

    await navigateToProjectEdit(page);

    // Closed projects are rendered below open projects in ProjectEdit
    const projectRow = page.getByTestId(`project-row-${projectId}`);
    await expect(projectRow).toBeVisible({ timeout: 5000 });

    // The checkbox should be checked (closed=1)
    const checkbox = projectRow.locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();

    // Click to reopen
    await checkbox.click();

    // Wait for PUT and re-sort
    await page.waitForTimeout(1500);

    // Verify via API that the project is reopened
    const projects = await apiCall(
      `projects?creator_fk=${sub}&id=${projectId}&fields=id,closed`,
      'GET', '', idToken,
    ) as Array<{ id: number; closed: number }>;
    expect(projects?.length).toBe(1);
    expect(projects[0].closed).toBe(0);
  });

  test('PROJ-05: hard delete project via delete button', async ({ page }) => {
    const projectName = uniqueName('DeleteProj');

    // Create project via API
    const result = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: projectName, closed: 0, sort_order: 2,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test project');
    // Don't add to cleanup — we're deleting it in the test

    await navigateToProjectEdit(page);

    const idx = await findProjectIndex(page, projectName);
    expect(idx).toBeGreaterThan(-1);
    const targetRow = page.locator('input[name="project-name"]').nth(idx).locator('xpath=ancestor::*[starts-with(@data-testid, "project-row-")]');

    // Click the delete button (last child div's button in the row)
    await targetRow.locator('> div:last-child button').click();

    // ProjectDeleteDialog should appear
    const deleteDialog = page.getByTestId('project-delete-dialog');
    await expect(deleteDialog).toBeVisible({ timeout: 5000 });
    await expect(deleteDialog).toContainText('Delete Project?');

    // Click Delete to confirm
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    // Verify project row is removed
    await page.waitForTimeout(1000);
    const deletedIdx = await findProjectIndex(page, projectName);
    expect(deletedIdx).toBe(-1);
  });

  test('PROJ-06: DnD reorder projects', async ({ page }) => {
    const name1 = uniqueName('SortProjA');
    const name2 = uniqueName('SortProjB');

    // Create 2 projects with explicit sort_order
    const r1 = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: name1, closed: 0, sort_order: 900,
    }, idToken) as Array<{ id: string }>;
    const r2 = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: name2, closed: 0, sort_order: 901,
    }, idToken) as Array<{ id: string }>;

    if (!r1?.length || !r2?.length) throw new Error('Failed to create test projects');
    createdProjectIds.push(r1[0].id, r2[0].id);

    await navigateToProjectEdit(page);

    // Find both rows and verify initial order (A before B)
    const firstRow = page.getByTestId(`project-row-${r1[0].id}`);
    const secondRow = page.getByTestId(`project-row-${r2[0].id}`);
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
    await waitForProjectTable(page);

    const reloadFirstY = (await page.getByTestId(`project-row-${r1[0].id}`).boundingBox())!.y;
    const reloadSecondY = (await page.getByTestId(`project-row-${r2[0].id}`).boundingBox())!.y;
    expect(reloadSecondY).toBeLessThan(reloadFirstY);
  });

  test('PROJ-07: verify Categories and Requirements count columns', async ({ page }) => {
    const projectName = uniqueName('CountsProj');

    // Create project
    const projResult = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: projectName, closed: 0, sort_order: 3,
    }, idToken) as Array<{ id: string }>;
    if (!projResult?.length) throw new Error('Failed to create test project');
    const projectId = projResult[0].id;
    createdProjectIds.push(projectId);

    // Navigate and verify 0/0 counts
    await navigateToProjectEdit(page);

    const catCount = page.getByTestId(`category-count-${projectId}`);
    const priCount = page.getByTestId(`requirement-count-${projectId}`);

    await expect(catCount).toHaveText('0');
    await expect(priCount).toHaveText('0');

    // Create 2 categories under this project
    const cat1Result = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: uniqueName('Cat1'), project_fk: projectId, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    const cat2Result = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: uniqueName('Cat2'), project_fk: projectId, closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;

    if (!cat1Result?.length || !cat2Result?.length) throw new Error('Failed to create categories');
    createdCategoryIds.push(cat1Result[0].id, cat2Result[0].id);

    // Create 3 requirements under cat1 and 1 under cat2 (4 total)
    for (let i = 0; i < 3; i++) {
      const result = await apiCall('requirements', 'POST', {
        creator_fk: sub, title: uniqueName(`Req1-${i}`), category_fk: cat1Result[0].id,
        requirement_status: 'authoring',
      }, idToken) as Array<{ id: string }>;
      if (result?.length) createdRequirementIds.push(result[0].id);
    }
    const priResult = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: uniqueName('Req2-0'), category_fk: cat2Result[0].id,
      requirement_status: 'authoring',
    }, idToken) as Array<{ id: string }>;
    if (priResult?.length) createdRequirementIds.push(priResult[0].id);

    // Reload and verify updated counts
    await page.reload();
    await waitForProjectTable(page);

    await expect(catCount).toHaveText('2');
    await expect(priCount).toHaveText('4');
  });
});
