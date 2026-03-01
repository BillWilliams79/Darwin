import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe('Swarm View', () => {
  let idToken: string;
  let testProjectId: string;
  let testCategoryId: string;
  let testPriorityId: string;
  let testSessionId: string;
  let testIssueSessionId: string;

  const testProjectName = uniqueName('SwarmProj');
  const testCategoryName = uniqueName('SwarmCat');
  const testPriorityTitle = uniqueName('SwarmPri');

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
      worker_count: 1,
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
      worker_count: 1,
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
    // The DataGrid renders a Chip with color="primary" for 'active' status
    const statusChip = page.getByTestId('linked-sessions-grid').locator('.MuiChip-colorPrimary');
    await expect(statusChip).toBeVisible({ timeout: 5000 });
  });

  test('SWM-16: /swarm/session/:id renders SwarmSessionDetail', async ({ page }) => {
    await page.goto(`/swarm/session/${testSessionId}`);
    await expect(page.getByTestId('swarm-session-detail')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('chip-swarm-status')).toContainText('active');
  });

  test('SWM-17: Session detail shows status chip with correct color', async ({ page }) => {
    await page.goto(`/swarm/session/${testSessionId}`);
    await expect(page.getByTestId('chip-swarm-status')).toBeVisible({ timeout: 10000 });
    // 'active' maps to color="primary" → MuiChip-colorPrimary class
    const chip = page.getByTestId('chip-swarm-status');
    await expect(chip).toHaveClass(/MuiChip-colorPrimary/);
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

});
