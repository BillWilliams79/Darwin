import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

// Seed the calendar Zustand store to a known state. Matches persist schema v6.
async function seedCalendarState(page: Page, currentDate: string, viewType = 'dayGridDay', mode: string[] = ['requirements']): Promise<void> {
  await page.evaluate(({ d, v, m }) => {
    localStorage.setItem('darwin_calendar_view', JSON.stringify({
      state: {
        viewType: v,
        currentDate: d,
        mode: m,
        summaryMode: null,
        summaryDate: null,
        timeSeriesMode: null,
        timeSeriesBeadWindow: '24h',
        timeSeriesVizKey: 'bead',
        timeSeriesSidewalkOn: false,
      },
      version: 6,
    }));
  }, { d: currentDate, v: viewType, m: mode });
}

test.describe('Calendar Time Series — Bead / Swarm / Sidewalk toolbar', () => {
  let idToken: string;
  let testProjectId: string;
  let testCategoryId: string;
  const testProjectName = uniqueName('TSProj');
  const testCategoryName = uniqueName('TSCat');
  const testDate = new Date().toISOString().slice(0, 10);
  const createdRequirementIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const projResult = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: testProjectName, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!projResult?.length) throw new Error('Failed to create project');
    testProjectId = projResult[0].id;

    const catResult = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: testCategoryName, project_fk: testProjectId,
      closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!catResult?.length) throw new Error('Failed to create category');
    testCategoryId = catResult[0].id;

    const stamps = ['03:15:00', '11:30:00', '19:45:00'];
    const coord = ['planned', 'implemented', 'deployed'];
    for (let i = 0; i < stamps.length; i++) {
      const completedAt = `${testDate} ${stamps[i]}`;
      const res = await apiCall('requirements', 'POST', {
        creator_fk: sub,
        title: uniqueName(`TSReq${i}`),
        category_fk: testCategoryId,
        requirement_status: 'met',
        coordination_type: coord[i],
        sort_order: i,
        completed_at: completedAt,
      }, idToken) as Array<{ id: string }>;
      if (!res?.length) throw new Error('Failed to seed requirement');
      createdRequirementIds.push(res[0].id);
    }
  });

  test.afterAll(async () => {
    try { await apiDelete('projects', testProjectId, idToken); } catch {}
  });

  test('TS-01: clicking Bead turns Time Series on and renders the bead necklace', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('timeseries-viz-bead').click();
    await expect(page.getByTestId('time-series-view')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('ts-bead')).toBeVisible();
  });

  test('TS-02: seeded chips render as beads', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-viz-bead').click();
    await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

    for (const id of createdRequirementIds) {
      await expect(page.getByTestId(`ts-chip-${id}`)).toBeVisible({ timeout: 10000 });
    }
  });

  test('TS-03: 24h / 36h window buttons switch tick sets', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-viz-bead').click();
    await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

    const ticks = page.locator('[data-testid="ts-bead"] .ts-bead-tick');
    // 24h default → at least several ticks; 36h → different count
    const countA = await ticks.count();
    await page.getByTestId('timeseries-window-36h').click();
    const countB = await ticks.count();
    expect(countA).not.toBe(countB);
  });

  test('TS-04: Bead click → requirement detail', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-viz-bead').click();
    await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

    const id = createdRequirementIds[0];
    await page.getByTestId(`ts-chip-${id}`).click();
    await page.waitForURL(`**/swarm/requirement/${id}`, { timeout: 5000 });
  });

  test('TS-05: Summary ↔ Time Series mutual exclusion', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate, 'dayGridMonth');
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Month view: all visualizer buttons disabled — they don't apply to a
    // month grid (req #2333). Time Series auto-turns off on Month select,
    // which also keeps the window (24h/36h) and Sidewalk buttons disabled.
    await expect(page.getByTestId('timeseries-viz-bead')).toBeDisabled();
    await expect(page.getByTestId('timeseries-viz-swarm')).toBeDisabled();
    await expect(page.getByTestId('timeseries-window-24h')).toBeDisabled();
    await expect(page.getByTestId('timeseries-window-36h')).toBeDisabled();
    await expect(page.getByTestId('timeseries-sidewalk')).toBeDisabled();

    // Switch to Day view then toggle Bead.
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await page.getByTestId('timeseries-viz-bead').click();
    await expect(page.getByTestId('timeseries-viz-bead')).toHaveAttribute('aria-pressed', 'true');

    // Summary toggle is disabled in day view + timeseries on.
    await expect(page.getByTestId('summary-toggle')).toBeDisabled();
  });

  test('TS-06: Sidewalk button — disabled until TS on, and disabled in Week view', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();

    await expect(page.getByTestId('timeseries-sidewalk')).toBeDisabled();

    await page.getByTestId('timeseries-viz-bead').click();
    await expect(page.getByTestId('timeseries-sidewalk')).toBeEnabled();

    // Switch to Week view → Sidewalk disabled again
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page.getByTestId('timeseries-sidewalk')).toBeDisabled();
  });

  test('TS-07: Swarm viz shows autonomy and cross-day behavior in datacard', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-viz-swarm').click();
    await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

    const id = createdRequirementIds[0];
    await page.getByTestId(`ts-chip-${id}`).hover();
    await expect(page.getByTestId(`ts-datacard-autonomy-${id}`)).toHaveText('Planned', { timeout: 3000 });
  });

  test('TS-08: Sidewalk toggle — clicking activates and selected state reflects', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-viz-bead').click();
    await page.getByTestId('timeseries-sidewalk').click();

    await expect(page.getByTestId('timeseries-sidewalk')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('ts-sidewalk')).toBeVisible({ timeout: 5000 });
    // 36h is disabled when Sidewalk is on.
    await expect(page.getByTestId('timeseries-window-36h')).toBeDisabled();
  });
});
