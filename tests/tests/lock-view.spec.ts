import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

/**
 * The plan visualizer's LOCK VIEW (req #3761) — pipeline -> initiatives -> epics,
 * no requirement drawn, with the lock cascade, the pause marks and the engine
 * holders. Each user action is exercised through the real page and judged by two
 * witnesses: what the page then SHOWS, and what the gateway then HOLDS.
 *
 *   LOCK-01  lock / unlock the pipeline   (cascades to every initiative and epic)
 *   LOCK-02  lock / unlock an initiative  (cascades to its epics only)
 *   LOCK-03  lock / unlock an epic
 *   LOCK-04  pause / unpause the pipeline (every initiative reads paused)
 *   LOCK-05  pause / unpause an initiative
 *   LOCK-06  an engine claim outlines the scope it holds, with its holder
 *   LOCK-07  a refused write (the gateway's 423) is echoed in place, in its own words
 *   LOCK-08  an epic click frames the epic in the full plan
 *   LOCK-09  the Lock chip switches the view and the choice survives a reload
 *   LOCK-10  an ancestor's lock refuses the write before it is sent
 *
 * One throwaway plan owned by the E2E user (two initiatives, three epics),
 * created and deleted through the REST gateway. Serial: the tests move its flags.
 */
test.describe.serial('Plan Lock view (req #3761)', () => {
  test.setTimeout(90000);
  test.use({ viewport: { width: 1400, height: 900 } });

  let idToken: string;
  let projectId: string;
  let categoryId: string;
  let pipelineId: string;
  let initAId: string;
  let initBId: string;
  let epicA1: string;
  let epicA2: string;
  let epicB1: string;
  let claimId: string | undefined;

  const sub = () => process.env.E2E_TEST_COGNITO_SUB!;
  const post = async (table: string, body: object) => {
    const r = await apiCall(table, 'POST', { creator_fk: sub(), ...body }, idToken) as Array<{ id: string }>;
    if (!Array.isArray(r) || r[0]?.id == null) throw new Error(`Failed to create ${table}: ${JSON.stringify(r)}`);
    return r[0].id;
  };
  const row = async (table: string, id: string) => {
    const rows = await apiCall(`${table}?id=${id}`, 'GET', '', idToken) as Array<Record<string, unknown>>;
    return rows[0];
  };
  const put = (table: string, id: string, body: object) =>
    apiCall(table, 'PUT', [{ id, ...body }], idToken);

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    projectId = await post('projects', { project_name: uniqueName('LockView'), closed: 0, sort_order: 993 });
    categoryId = await post('categories', { category_name: uniqueName('LockViewCat'), project_fk: projectId, closed: 0, sort_order: 0, sort_mode: 'hand' });
    pipelineId = await post('pipelines', { title: uniqueName('LockView plan'), pipeline_status: 'active' });
    initAId = await post('initiatives', { pipeline_fk: pipelineId, title: 'Build', category_fk: categoryId, sort_order: 1 });
    initBId = await post('initiatives', { pipeline_fk: pipelineId, title: 'Ship', category_fk: categoryId, sort_order: 2 });
    epicA1 = await post('epics', { initiative_fk: initAId, title: 'Design' });
    epicA2 = await post('epics', { initiative_fk: initAId, title: 'Implement' });
    epicB1 = await post('epics', { initiative_fk: initBId, title: 'Release' });
  });

  test.afterAll(async () => {
    // A locked row refuses its delete: lift every lock first (a lock write is
    // never refused), then take the rows out leaf-first.
    const unlock: Array<[string, string | undefined]> = [
      ['epics', epicA1], ['epics', epicA2], ['epics', epicB1],
      ['initiatives', initAId], ['initiatives', initBId], ['pipelines', pipelineId],
    ];
    for (const [table, id] of unlock) if (id) { try { await put(table, id, { locked: 0 }); } catch {} }
    if (claimId) { try { await apiDelete('orchestration_claims', claimId, idToken); } catch {} }
    for (const id of [epicA1, epicA2, epicB1]) if (id) { try { await apiDelete('epics', id, idToken); } catch {} }
    for (const id of [initAId, initBId]) if (id) { try { await apiDelete('initiatives', id, idToken); } catch {} }
    if (pipelineId) { try { await apiDelete('pipelines', pipelineId, idToken); } catch {} }
    if (categoryId) { try { await apiDelete('categories', categoryId, idToken); } catch {} }
    if (projectId) { try { await apiDelete('projects', projectId, idToken); } catch {} }
  });

  async function open(page: Page) {
    await page.goto(`/swarm/pipeline/${pipelineId}?mode=lock`);
    await expect(page.getByTestId('lock-view')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId(`lock-view-epic-${epicB1}`)).toBeVisible({ timeout: 15000 });
  }

  const tier = (page: Page, testid: string) => page.getByTestId(testid);
  const locked = (page: Page, testid: string, want: '0' | '1') =>
    expect(tier(page, testid)).toHaveAttribute('data-locked', want, { timeout: 15000 });
  const paused = (page: Page, testid: string, want: '0' | '1') =>
    expect(tier(page, testid)).toHaveAttribute('data-paused', want, { timeout: 15000 });

  test('LOCK-01 lock and unlock the pipeline cascades to everything under it', async ({ page }) => {
    await open(page);
    await locked(page, 'lock-view-pipeline', '0');
    await page.getByTestId('lock-view-pipeline-lock').click();
    await locked(page, 'lock-view-pipeline', '1');
    await locked(page, `lock-view-initiative-${initAId}`, '1');
    await locked(page, `lock-view-initiative-${initBId}`, '1');
    for (const id of [epicA1, epicA2, epicB1]) await locked(page, `lock-view-epic-${id}`, '1');
    expect(Number((await row('pipelines', pipelineId)).locked)).toBe(1);
    // The cascade is read, never stored: no child row was written.
    expect(Number((await row('initiatives', initAId)).locked)).toBe(0);
    expect(Number((await row('epics', epicA1)).locked)).toBe(0);

    await page.getByTestId('lock-view-pipeline-lock').click();
    await locked(page, 'lock-view-pipeline', '0');
    for (const id of [epicA1, epicA2, epicB1]) await locked(page, `lock-view-epic-${id}`, '0');
    expect(Number((await row('pipelines', pipelineId)).locked)).toBe(0);
  });

  test('LOCK-02 lock and unlock an initiative cascades to its epics only', async ({ page }) => {
    await open(page);
    await page.getByTestId(`lock-view-initiative-lock-${initAId}`).click();
    await locked(page, `lock-view-initiative-${initAId}`, '1');
    await locked(page, `lock-view-epic-${epicA1}`, '1');
    await locked(page, `lock-view-epic-${epicA2}`, '1');
    await locked(page, `lock-view-initiative-${initBId}`, '0');
    await locked(page, `lock-view-epic-${epicB1}`, '0');
    await locked(page, 'lock-view-pipeline', '0');
    expect(Number((await row('initiatives', initAId)).locked)).toBe(1);

    await page.getByTestId(`lock-view-initiative-lock-${initAId}`).click();
    await locked(page, `lock-view-initiative-${initAId}`, '0');
    await locked(page, `lock-view-epic-${epicA1}`, '0');
    expect(Number((await row('initiatives', initAId)).locked)).toBe(0);
  });

  test('LOCK-03 lock and unlock an epic', async ({ page }) => {
    await open(page);
    await page.getByTestId(`lock-view-epic-lock-${epicA1}`).click();
    await locked(page, `lock-view-epic-${epicA1}`, '1');
    await locked(page, `lock-view-epic-${epicA2}`, '0');
    await locked(page, `lock-view-initiative-${initAId}`, '0');
    expect(Number((await row('epics', epicA1)).locked)).toBe(1);

    await page.getByTestId(`lock-view-epic-lock-${epicA1}`).click();
    await locked(page, `lock-view-epic-${epicA1}`, '0');
    expect(Number((await row('epics', epicA1)).locked)).toBe(0);
  });

  test('LOCK-04 pause and unpause the pipeline', async ({ page }) => {
    await open(page);
    await page.getByTestId('lock-view-pipeline-pause').click();
    await paused(page, 'lock-view-pipeline', '1');
    await paused(page, `lock-view-initiative-${initAId}`, '1');
    await paused(page, `lock-view-initiative-${initBId}`, '1');
    expect((await row('pipelines', pipelineId)).pipeline_status).toBe('paused');

    await page.getByTestId('lock-view-pipeline-pause').click();
    await paused(page, 'lock-view-pipeline', '0');
    await paused(page, `lock-view-initiative-${initAId}`, '0');
    expect((await row('pipelines', pipelineId)).pipeline_status).toBe('active');
  });

  test('LOCK-05 pause and unpause an initiative', async ({ page }) => {
    await open(page);
    await page.getByTestId(`lock-view-initiative-pause-${initBId}`).click();
    await paused(page, `lock-view-initiative-${initBId}`, '1');
    await paused(page, `lock-view-initiative-${initAId}`, '0');
    await paused(page, 'lock-view-pipeline', '0');
    expect((await row('initiatives', initBId)).initiative_status).toBe('paused');

    await page.getByTestId(`lock-view-initiative-pause-${initBId}`).click();
    await paused(page, `lock-view-initiative-${initBId}`, '0');
    expect((await row('initiatives', initBId)).initiative_status).toBe('active');
  });

  test('LOCK-06 an engine claim outlines the scope it holds, with its holder', async ({ page }) => {
    claimId = await post('orchestration_claims', {
      pipeline_fk: pipelineId, initiative_fk: initAId, terminal_pid: 71999, engine_pid: 72099,
      // A heartbeat that cannot age out while the test reads it.
      update_ts: '2030-01-01 00:00:00',
    });
    await open(page);
    await expect(tier(page, `lock-view-initiative-${initAId}`)).toHaveAttribute('data-held', '1', { timeout: 15000 });
    await expect(tier(page, `lock-view-initiative-${initBId}`)).toHaveAttribute('data-held', '0');
    await expect(tier(page, 'lock-view-pipeline')).toHaveAttribute('data-held', '0');
    const holder = tier(page, `lock-view-initiative-holder-${claimId}`);
    await expect(holder).toHaveAttribute('data-role', 'lead');
    await expect(holder).toContainText('lead');
  });

  test('LOCK-07 a refused write is echoed in place, in the gateway\'s own words', async ({ page }) => {
    await open(page);
    const message = 'epics is locked by its pipeline — unlock it first';
    await page.route(/\/epics$/, (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      return route.fulfill({
        status: 423, contentType: 'application/json',
        body: JSON.stringify({ message, table: 'epics', locked_by: 'pipeline' }),
      });
    });
    await page.getByTestId(`lock-view-epic-lock-${epicB1}`).click();
    const echo = page.getByTestId(`lock-view-refusal-epic-${epicB1}`);
    await expect(echo).toHaveText(`Refused (423): ${message}`, { timeout: 15000 });
    await expect(page.getByTestId(`lock-view-refusal-epic-${epicA1}`)).toHaveCount(0);
    // Nothing changed: the refusal is the truth about the row.
    await locked(page, `lock-view-epic-${epicB1}`, '0');
    expect(Number((await row('epics', epicB1)).locked)).toBe(0);
  });

  test('LOCK-08 an epic click frames the epic in the full plan', async ({ page }) => {
    await open(page);
    await page.getByTestId(`lock-view-epic-open-${epicA2}`).click();
    await expect(page).toHaveURL(new RegExp(`mode=plan.*epic=${epicA2}|epic=${epicA2}.*mode=plan`));
    await expect(page.getByTestId('pipeline-plan-visualizer')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('lock-view')).toHaveCount(0);
  });

  test('LOCK-09 the Lock chip switches the view and the choice survives a reload', async ({ page }) => {
    await page.goto(`/swarm/pipeline/${pipelineId}?mode=plan`);
    await expect(page.getByTestId('pipeline-plan-visualizer')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('pipeline-viz-mode-lock').click();
    await expect(page.getByTestId('lock-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('pipeline-viz-mode-lock')).toHaveAttribute('aria-pressed', 'true');
    // the link's ?mode=plan was cleared by the pick, so a reload keeps the pick
    await page.reload();
    await expect(page.getByTestId('lock-view')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('pipeline-viz-mode-lock').click();
    await expect(page.getByTestId('pipeline-plan-visualizer')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('lock-view')).toHaveCount(0);
  });

  test('LOCK-10 a lock held by an ancestor refuses the write before it is sent', async ({ page }) => {
    await put('pipelines', pipelineId, { locked: 1 });
    await open(page);
    await locked(page, `lock-view-epic-${epicA1}`, '1');
    let writes = 0;
    await page.route(/\/(epics|initiatives)$/, (route) => {
      if (route.request().method() === 'PUT') writes += 1;
      return route.continue();
    });
    await page.getByTestId(`lock-view-epic-lock-${epicA1}`).click();
    await expect(page.getByTestId(`lock-view-refusal-epic-${epicA1}`))
      .toHaveText('This epic is locked by its pipeline — unlock that first');
    await page.getByTestId(`lock-view-initiative-lock-${initAId}`).click();
    await expect(page.getByTestId(`lock-view-refusal-initiative-${initAId}`))
      .toHaveText('This initiative is locked by its pipeline — unlock that first');
    expect(writes).toBe(0);
    await put('pipelines', pipelineId, { locked: 0 });
  });
});
