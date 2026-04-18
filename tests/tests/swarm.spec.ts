import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe('Swarm View', () => {
  let idToken: string;
  let testProjectId: string;
  let testCategoryId: string;
  let testRequirementId: string;
  let testIdleRequirementId: string;
  let testSessionId: string;
  let testIssueSessionId: string;

  const testProjectName = uniqueName('SwarmProj');
  const testCategoryName = uniqueName('SwarmCat');
  const testRequirementTitle = uniqueName('SwarmReq');
  const testIdleRequirementTitle = uniqueName('SwarmIdle');

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create project
    const projResult = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: testProjectName, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!projResult?.length) throw new Error('Failed to create test project');
    testProjectId = projResult[0].id;

    // Create category
    const catResult = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: testCategoryName, project_fk: testProjectId,
      closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!catResult?.length) throw new Error('Failed to create test category');
    testCategoryId = catResult[0].id;

    // Create requirement
    const priResult = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: testRequirementTitle, category_fk: testCategoryId,
      requirement_status: 'development', sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!priResult?.length) throw new Error('Failed to create test requirement');
    testRequirementId = priResult[0].id;

    // Create an extra authoring requirement (historically used by the removed
    // scheduled-toggle tests; kept as a second row so the card shows more than
    // one item for row-number assertions).
    const idlePriResult = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: testIdleRequirementTitle, category_fk: testCategoryId,
      requirement_status: 'authoring', sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!idlePriResult?.length) throw new Error('Failed to create idle test requirement');
    testIdleRequirementId = idlePriResult[0].id;

    // Create swarm session linked to requirement via source_ref
    const sessResult = await apiCall('swarm_sessions', 'POST', {
      creator_fk: sub,
      branch: 'feature/e2e-test',
      task_name: 'e2e-test-task',
      source_type: 'roadmap',
      source_ref: `requirement:${testRequirementId}`,
      title: 'E2E Test Session',
      pr_url: 'https://github.com/BillWilliams79/Darwin/pull/99',
      swarm_status: 'active',
    }, idToken) as Array<{ id: string }>;
    if (!sessResult?.length) throw new Error('Failed to create test swarm session');
    testSessionId = sessResult[0].id;

    // Link requirement to session via junction table
    await apiCall('requirement_sessions', 'POST', {
      requirement_fk: testRequirementId, session_fk: testSessionId,
    }, idToken);

    // Create a second session with issue source_ref
    const issueResult = await apiCall('swarm_sessions', 'POST', {
      creator_fk: sub,
      branch: 'feature/issue-fix',
      task_name: 'issue-fix',
      source_type: 'issue',
      source_ref: 'darwin#8',
      title: 'Fix issue 8',
      swarm_status: 'active',
    }, idToken) as Array<{ id: string }>;
    if (!issueResult?.length) throw new Error('Failed to create issue session');
    testIssueSessionId = issueResult[0].id;
  });

  // 60s timeout: 6 sequential API deletes on cold Lambda can exceed the 30s default
  test.afterAll(async () => {
    test.setTimeout(60000);
    // Delete in FK-safe order
    try { await apiDelete('requirement_sessions', `${testRequirementId}`, idToken); } catch {}
    try { await apiDelete('swarm_sessions', testSessionId, idToken); } catch {}
    try { await apiDelete('swarm_sessions', testIssueSessionId, idToken); } catch {}
    try { await apiDelete('requirements', testRequirementId, idToken); } catch {}
    try { await apiDelete('requirements', testIdleRequirementId, idToken); } catch {}
    // CASCADE handles categories when project is deleted
    try { await apiDelete('projects', testProjectId, idToken); } catch {}
  });

  test('SWM-10: SwarmView renders project tab with test project name', async ({ page }) => {
    await page.goto('/swarm');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await expect(page.getByRole('tab', { name: testProjectName })).toBeVisible({ timeout: 10000 });
  });

  test('SWM-11: Project tab click shows category card', async ({ page }) => {
    await page.goto('/swarm');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testProjectName }).click();
    await expect(page.getByTestId(`category-card-${testCategoryId}`)).toBeVisible({ timeout: 10000 });
  });

  test('SWM-12: Requirement row visible within category card', async ({ page }) => {
    await page.goto('/swarm');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testProjectName }).click();
    await expect(page.getByTestId(`requirement-${testRequirementId}`)).toBeVisible({ timeout: 10000 });
  });

  test('SWM-12a: Requirement row shows row number', async ({ page }) => {
    await page.goto('/swarm');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testProjectName }).click();
    await expect(page.getByTestId(`requirement-${testRequirementId}`)).toBeVisible({ timeout: 10000 });
    // Row number "1" should be visible in the requirement row
    const row = page.getByTestId(`requirement-${testRequirementId}`);
    await expect(row.locator('p').first()).toContainText('1');
  });

  test('SWM-13: /swarm/requirement/:id renders RequirementDetail with correct title', async ({ page }) => {
    await page.goto(`/swarm/requirement/${testRequirementId}`);
    await expect(page.getByTestId('requirement-detail')).toBeVisible({ timeout: 10000 });
    const titleInput = page.getByTestId('requirement-title').locator('input');
    await expect(titleInput).toHaveValue(testRequirementTitle, { timeout: 10000 });
  });

  test('SWM-14: RequirementDetail shows linked sessions grid', async ({ page }) => {
    await page.goto(`/swarm/requirement/${testRequirementId}`);
    await expect(page.getByTestId('linked-sessions-grid')).toBeVisible({ timeout: 10000 });
  });

  test('SWM-15: RequirementDetail session chip shows correct status color', async ({ page }) => {
    await page.goto(`/swarm/requirement/${testRequirementId}`);
    await expect(page.getByTestId('linked-sessions-grid')).toBeVisible({ timeout: 10000 });
    // 'active' uses custom bgcolor #4caf50
    const statusChip = page.getByTestId('linked-sessions-grid').locator('.MuiChip-root').first();
    await expect(statusChip).toHaveCSS('background-color', 'rgb(76, 175, 80)');
  });

  test('SWM-16: /swarm/session/:id renders SwarmSessionDetail', async ({ page }) => {
    await page.goto(`/swarm/session/${testSessionId}`);
    await expect(page.getByTestId('swarm-session-detail')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('chip-swarm-status')).toContainText('active');
  });

  test('SWM-17: Session detail shows status chip with correct color', async ({ page }) => {
    await page.goto(`/swarm/session/${testSessionId}`);
    await expect(page.getByTestId('chip-swarm-status')).toBeVisible({ timeout: 10000 });
    // 'active' uses custom bgcolor #4caf50
    const chip = page.getByTestId('chip-swarm-status');
    await expect(chip).toHaveCSS('background-color', 'rgb(76, 175, 80)');
  });

  test('SWM-18: Session detail shows requirement link — click navigates', async ({ page }) => {
    await page.goto(`/swarm/session/${testSessionId}`);
    await expect(page.getByTestId('source-requirement-link')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('source-requirement-link').click();
    await expect(page).toHaveURL(new RegExp(`/swarm/requirement/${testRequirementId}`));
  });

  test('SWM-19: Session detail shows GitHub issue link for issue source_ref', async ({ page }) => {
    await page.goto(`/swarm/session/${testIssueSessionId}`);
    await expect(page.getByTestId('source-issue-link')).toBeVisible({ timeout: 10000 });
    const href = await page.getByTestId('source-issue-link').getAttribute('href');
    expect(href).toContain('github.com/BillWilliams79/Darwin/issues/8');
  });

  test('SWM-20: /swarm/sessions DataGrid renders with test session', async ({ page }) => {
    await page.goto('/swarm/sessions');
    await expect(page.getByTestId('sessions-datagrid')).toBeVisible({ timeout: 10000 });
    // The DataGrid should contain our test session's task_name (.first() for prior-run orphans)
    await expect(page.getByText('e2e-test-task').first()).toBeVisible({ timeout: 10000 });
  });

  test('SWM-22: SessionsView Source column shows issue link', async ({ page }) => {
    await page.goto('/swarm/sessions');
    await expect(page.getByTestId('sessions-datagrid')).toBeVisible({ timeout: 10000 });
    // The Source column should render a clickable issue link for the issue-sourced session
    const issueLink = page.getByTestId('sessions-datagrid').getByTestId('source-issue-link').first();
    await expect(issueLink).toBeVisible({ timeout: 10000 });
    const href = await issueLink.getAttribute('href');
    expect(href).toContain('github.com/BillWilliams79/Darwin/issues/8');
  });

  test('SWM-21: Back to Swarm navigation works', async ({ page }) => {
    await page.goto(`/swarm/session/${testSessionId}`);
    await expect(page.getByTestId('btn-back')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('btn-back').click();
    // With no browser history, SwarmSessionDetail falls back to /swarm/sessions
    await expect(page).toHaveURL(/\/swarm\/sessions$/);
  });

  test('SWM-24: requirement detail shows category-order index', async ({ page }) => {
    await page.goto(`/swarm/requirement/${testRequirementId}`);
    await expect(page.getByTestId('requirement-detail')).toBeVisible({ timeout: 10000 });
    // Detail row renders both "ID - N" and "Category Order - N"; check each in its own span
    const idEl = page.getByTestId('requirement-id');
    await expect(idEl).toBeVisible({ timeout: 10000 });
    await expect(idEl).toContainText(`ID - ${testRequirementId}`);
    const indexEl = page.getByTestId('requirement-index');
    await expect(indexEl).toHaveText('1');
    await expect(page.getByText('Category Order - 1')).toBeVisible();
  });

  test('SWM-25: up/down navigation between requirements', async ({ page }) => {
    // Navigate to first requirement — prev disabled, next enabled
    await page.goto(`/swarm/requirement/${testRequirementId}`);
    await expect(page.getByTestId('requirement-detail')).toBeVisible({ timeout: 10000 });

    // Wait for siblings to load (next becomes enabled)
    await expect(page.getByTestId('btn-next-requirement')).not.toBeDisabled({ timeout: 10000 });
    await expect(page.getByTestId('btn-prev-requirement')).toBeDisabled();

    // Navigate to next requirement
    await page.getByTestId('btn-next-requirement').click();
    await expect(page).toHaveURL(new RegExp(`/swarm/requirement/${testIdleRequirementId}`), { timeout: 10000 });

    // Now at last requirement — prev enabled, next disabled
    await expect(page.getByTestId('btn-prev-requirement')).not.toBeDisabled({ timeout: 10000 });
    await expect(page.getByTestId('btn-next-requirement')).toBeDisabled();
  });

  test('SWM-26: navigation does not enter closed requirements when Show Closed is off', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a closed requirement after the two open ones
    const closedResult = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: uniqueName('ClosedNav'), category_fk: testCategoryId,
      requirement_status: 'met', sort_order: 99,
    }, idToken) as Array<{ id: string }>;
    const closedRequirementId = closedResult[0].id;

    try {
      // Ensure closed filter chip is OFF (default) by navigating to /swarm first
      await page.goto('/swarm');
      const metChip = page.getByTestId('filter-chip-met');
      await metChip.waitFor({ timeout: 10000 });
      // If chip is selected (not outlined), click to deselect
      const isOutlined = await metChip.evaluate(el => el.classList.contains('MuiChip-outlined'));
      if (!isOutlined) {
        await metChip.click();
      }

      // Navigate to the idle requirement (sort_order=1, second open item — last open item)
      await page.goto(`/swarm/requirement/${testIdleRequirementId}`);
      await expect(page.getByTestId('requirement-detail')).toBeVisible({ timeout: 10000 });

      // prev should be enabled (first open requirement exists before this one)
      await expect(page.getByTestId('btn-prev-requirement')).not.toBeDisabled({ timeout: 5000 });
      // next should be DISABLED because the only next item is closed and Show Closed is off
      await expect(page.getByTestId('btn-next-requirement')).toBeDisabled({ timeout: 5000 });
    } finally {
      try { await apiDelete('requirements', closedRequirementId, idToken); } catch {}
    }
  });

  test('SWM-27: closed requirements sort by most recently closed first', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create 3 closed requirements with distinct completed_at timestamps
    const now = Date.now();
    const oldClosed = new Date(now - 3 * 86400000).toISOString().slice(0, 19);   // 3 days ago
    const midClosed = new Date(now - 1 * 86400000).toISOString().slice(0, 19);   // 1 day ago
    const newClosed = new Date(now).toISOString().slice(0, 19);                   // now

    const oldTitle = uniqueName('ClosedOld');
    const midTitle = uniqueName('ClosedMid');
    const newTitle = uniqueName('ClosedNew');

    const oldResult = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: oldTitle, category_fk: testCategoryId,
      requirement_status: 'met', sort_order: 90, completed_at: oldClosed,
    }, idToken) as Array<{ id: string }>;
    const midResult = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: midTitle, category_fk: testCategoryId,
      requirement_status: 'met', sort_order: 91, completed_at: midClosed,
    }, idToken) as Array<{ id: string }>;
    const newResult = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: newTitle, category_fk: testCategoryId,
      requirement_status: 'met', sort_order: 92, completed_at: newClosed,
    }, idToken) as Array<{ id: string }>;

    const oldId = oldResult[0].id;
    const midId = midResult[0].id;
    const newId = newResult[0].id;

    try {
      await page.goto('/swarm');
      await page.waitForSelector('[role="tab"]', { timeout: 10000 });
      await page.getByRole('tab', { name: testProjectName }).click();
      await expect(page.getByTestId(`category-card-${testCategoryId}`)).toBeVisible({ timeout: 10000 });

      // Turn on completed filter chip
      const metChip = page.getByTestId('filter-chip-met');
      await metChip.waitFor({ timeout: 10000 });
      // If chip is not selected (outlined), click to select
      const isOutlined = await metChip.evaluate(el => el.classList.contains('MuiChip-outlined'));
      if (isOutlined) {
        await metChip.click();
      }

      // Wait for closed requirements to appear
      await expect(page.getByTestId(`requirement-${newId}`)).toBeVisible({ timeout: 10000 });

      // Extract titles from requirement rows in this category card (excluding template)
      const card = page.getByTestId(`category-card-${testCategoryId}`);
      const requirementRows = card.locator('[data-testid^="requirement-"]:not([data-testid="requirement-template"])');

      const titles: string[] = [];
      const count = await requirementRows.count();
      for (let i = 0; i < count; i++) {
        const titleField = requirementRows.nth(i).locator('textarea[name="title"], input[name="title"]').first();
        titles.push(await titleField.inputValue());
      }

      // Find positions of our closed items
      const newIdx = titles.indexOf(newTitle);
      const midIdx = titles.indexOf(midTitle);
      const oldIdx = titles.indexOf(oldTitle);

      // All three should be found
      expect(newIdx).toBeGreaterThanOrEqual(0);
      expect(midIdx).toBeGreaterThanOrEqual(0);
      expect(oldIdx).toBeGreaterThanOrEqual(0);

      // Most recently closed should come first among closed items
      expect(newIdx).toBeLessThan(midIdx);
      expect(midIdx).toBeLessThan(oldIdx);

      // Turn off completed filter chip (cleanup UI state)
      const isStillSelected = !(await metChip.evaluate(el => el.classList.contains('MuiChip-outlined')));
      if (isStillSelected) {
        await metChip.click();
      }
    } finally {
      try { await apiDelete('requirements', oldId, idToken); } catch {}
      try { await apiDelete('requirements', midId, idToken); } catch {}
      try { await apiDelete('requirements', newId, idToken); } catch {}
    }
  });

  test('SWM-28: selecting completed chip does not show closed categories', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create a closed category in the test project
    const closedCatResult = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: uniqueName('ClosedCat'), project_fk: testProjectId,
      closed: 1, sort_order: 99,
    }, idToken) as Array<{ id: string }>;
    const closedCategoryId = closedCatResult[0].id;

    try {
      await page.goto('/swarm');
      await page.waitForSelector('[role="tab"]', { timeout: 10000 });
      await page.getByRole('tab', { name: testProjectName }).click();

      // Turn on completed chip
      const metChip = page.getByTestId('filter-chip-met');
      await metChip.waitFor({ timeout: 10000 });
      const isOutlined = await metChip.evaluate(el => el.classList.contains('MuiChip-outlined'));
      if (isOutlined) {
        await metChip.click();
      }

      // The closed category card must NOT be visible regardless of requirement status filter
      await expect(page.getByTestId(`category-card-${closedCategoryId}`)).not.toBeVisible({ timeout: 5000 });

      // Turn off completed chip (restore state)
      const isStillSelected = !(await metChip.evaluate(el => el.classList.contains('MuiChip-outlined')));
      if (isStillSelected) {
        await metChip.click();
      }
    } finally {
      try { await apiDelete('categories', closedCategoryId, idToken); } catch {}
    }
  });

  test('SWM-23: RequirementDetail delete button removes requirement and navigates to /swarm', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const deleteTitle = uniqueName('DeleteMe');
    const result = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: deleteTitle, category_fk: testCategoryId,
      requirement_status: 'authoring', sort_order: 99,
    }, idToken) as Array<{ id: string }>;
    const deleteId = result[0].id;

    await page.goto(`/swarm/requirement/${deleteId}`);
    await expect(page.getByTestId('requirement-detail')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('btn-delete-requirement').click();
    await expect(page.getByTestId('requirement-delete-dialog')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page).toHaveURL(/\/swarm$/, { timeout: 10000 });
  });

});
