import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe('Swarm View', () => {
  let idToken: string;
  let testProjectId: string;
  let testCategoryId: string;
  let testPriorityId: string;
  let testIdlePriorityId: string;
  let testSessionId: string;
  let testIssueSessionId: string;

  const testProjectName = uniqueName('SwarmProj');
  const testCategoryName = uniqueName('SwarmCat');
  const testPriorityTitle = uniqueName('SwarmPri');
  const testIdlePriorityTitle = uniqueName('SwarmIdle');

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

    // Create priority
    const priResult = await apiCall('priorities', 'POST', {
      creator_fk: sub, title: testPriorityTitle, category_fk: testCategoryId,
      in_progress: 1, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!priResult?.length) throw new Error('Failed to create test priority');
    testPriorityId = priResult[0].id;

    // Create idle priority (not in_progress) for scheduled toggle test
    const idlePriResult = await apiCall('priorities', 'POST', {
      creator_fk: sub, title: testIdlePriorityTitle, category_fk: testCategoryId,
      in_progress: 0, closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!idlePriResult?.length) throw new Error('Failed to create idle test priority');
    testIdlePriorityId = idlePriResult[0].id;

    // Create swarm session linked to priority via source_ref
    const sessResult = await apiCall('swarm_sessions', 'POST', {
      creator_fk: sub,
      branch: 'feature/e2e-test',
      task_name: 'e2e-test-task',
      source_type: 'roadmap',
      source_ref: `priority:${testPriorityId}`,
      title: 'E2E Test Session',
      pr_url: 'https://github.com/BillWilliams79/Darwin/pull/99',
      swarm_status: 'active',
    }, idToken) as Array<{ id: string }>;
    if (!sessResult?.length) throw new Error('Failed to create test swarm session');
    testSessionId = sessResult[0].id;

    // Link priority to session via junction table
    await apiCall('priority_sessions', 'POST', {
      priority_fk: testPriorityId, session_fk: testSessionId,
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

  test.afterAll(async () => {
    // Delete in FK-safe order
    try { await apiDelete('priority_sessions', `${testPriorityId}`, idToken); } catch {}
    try { await apiDelete('swarm_sessions', testSessionId, idToken); } catch {}
    try { await apiDelete('swarm_sessions', testIssueSessionId, idToken); } catch {}
    try { await apiDelete('priorities', testPriorityId, idToken); } catch {}
    try { await apiDelete('priorities', testIdlePriorityId, idToken); } catch {}
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

  test('SWM-12: Priority row visible within category card', async ({ page }) => {
    await page.goto('/swarm');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testProjectName }).click();
    await expect(page.getByTestId(`priority-${testPriorityId}`)).toBeVisible({ timeout: 10000 });
  });

  test('SWM-12a: Priority row shows row number', async ({ page }) => {
    await page.goto('/swarm');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testProjectName }).click();
    await expect(page.getByTestId(`priority-${testPriorityId}`)).toBeVisible({ timeout: 10000 });
    // Row number "1" should be visible in the priority row
    const row = page.getByTestId(`priority-${testPriorityId}`);
    await expect(row.locator('p').first()).toContainText('1');
  });

  test('SWM-12b: Scheduled toggle works on idle priority row', async ({ page }) => {
    await page.goto('/swarm');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testProjectName }).click();
    await expect(page.getByTestId(`priority-${testIdlePriorityId}`)).toBeVisible({ timeout: 10000 });

    const toggleBtn = page.getByTestId(`scheduled-toggle-${testIdlePriorityId}`);
    await expect(toggleBtn).toBeVisible({ timeout: 5000 });

    // Click to schedule
    await toggleBtn.click();
    // Verify the toggle persists by reloading
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testProjectName }).click();
    await expect(page.getByTestId(`scheduled-toggle-${testIdlePriorityId}`)).toBeVisible({ timeout: 10000 });

    // Click again to unschedule (cleanup)
    await page.getByTestId(`scheduled-toggle-${testIdlePriorityId}`).click();
  });

  test('SWM-12c: Scheduled toggle hidden on in-progress priority', async ({ page }) => {
    await page.goto('/swarm');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testProjectName }).click();
    await expect(page.getByTestId(`priority-${testPriorityId}`)).toBeVisible({ timeout: 10000 });
    // The in-progress priority should NOT have a scheduled toggle
    await expect(page.getByTestId(`scheduled-toggle-${testPriorityId}`)).not.toBeVisible();
  });

  test('SWM-13: /swarm/priority/:id renders PriorityDetail with correct title', async ({ page }) => {
    await page.goto(`/swarm/priority/${testPriorityId}`);
    await expect(page.getByTestId('priority-detail')).toBeVisible({ timeout: 10000 });
    const titleInput = page.getByTestId('priority-title').locator('input');
    await expect(titleInput).toHaveValue(testPriorityTitle, { timeout: 10000 });
  });

  test('SWM-14: PriorityDetail shows linked sessions grid', async ({ page }) => {
    await page.goto(`/swarm/priority/${testPriorityId}`);
    await expect(page.getByTestId('linked-sessions-grid')).toBeVisible({ timeout: 10000 });
  });

  test('SWM-15: PriorityDetail session chip shows correct status color', async ({ page }) => {
    await page.goto(`/swarm/priority/${testPriorityId}`);
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

  test('SWM-18: Session detail shows priority link — click navigates', async ({ page }) => {
    await page.goto(`/swarm/session/${testSessionId}`);
    await expect(page.getByTestId('source-priority-link')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('source-priority-link').click();
    await expect(page).toHaveURL(new RegExp(`/swarm/priority/${testPriorityId}`));
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
    await expect(page.getByTestId('btn-back-to-swarm')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('btn-back-to-swarm').click();
    await expect(page).toHaveURL(/\/swarm$/);
  });

  test('SWM-23: PriorityDetail delete button removes priority and navigates to /swarm', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const deleteTitle = uniqueName('DeleteMe');
    const result = await apiCall('priorities', 'POST', {
      creator_fk: sub, title: deleteTitle, category_fk: testCategoryId,
      in_progress: 0, closed: 0, sort_order: 99,
    }, idToken) as Array<{ id: string }>;
    const deleteId = result[0].id;

    await page.goto(`/swarm/priority/${deleteId}`);
    await expect(page.getByTestId('priority-detail')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('btn-delete-priority').click();
    await expect(page.getByTestId('priority-delete-dialog')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page).toHaveURL('/swarm', { timeout: 10000 });
  });

});
