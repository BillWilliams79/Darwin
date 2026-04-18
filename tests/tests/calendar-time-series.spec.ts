import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

// Seed the calendar Zustand store to a known currentDate + requirements mode.
async function seedCalendarState(page: Page, currentDate: string, mode: string[] = ['requirements']): Promise<void> {
  await page.evaluate(({ d, m }) => {
    localStorage.setItem('darwin_calendar_view', JSON.stringify({
      state: {
        viewType: 'dayGridMonth',
        currentDate: d,
        mode: m,
        summaryMode: null,
        summaryDate: null,
        timeSeriesMode: null,
        timeSeriesBeadWindow: '24h',
      },
      version: 5,
    }));
  }, { d: currentDate, m: mode });
}

test.describe('Calendar Time Series — Bead Necklace', () => {
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
    for (let i = 0; i < stamps.length; i++) {
      const completedAt = `${testDate} ${stamps[i]}`;
      const res = await apiCall('requirements', 'POST', {
        creator_fk: sub,
        title: uniqueName(`TSReq${i}`),
        category_fk: testCategoryId,
        requirement_status: 'met',
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

  test('TS-01: Time Series toggle reveals the bead necklace', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('time-series-view')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.fc-view-harness')).not.toBeVisible();
    await expect(page.getByTestId('ts-bead')).toBeVisible();
  });

  test('TS-02: seeded chips render as beads', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

    for (const id of createdRequirementIds) {
      await expect(page.getByTestId(`ts-chip-${id}`)).toBeVisible({ timeout: 10000 });
    }
  });

  test('TS-03: 24h / 36h window toggle switches tick sets', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

    // 24h default → 9 ticks (12a/3a/6a/9a/12p/3p/6p/9p/12a)
    await expect(page.getByTestId('ts-bead-timeline').locator('.ts-bead-tick')).toHaveCount(9);

    // Switch to 36h → 7 ticks (6p/12a/6a/12p/6p/12a/6a)
    await page.getByTestId('timeseries-window-36h').click();
    await expect(page.getByTestId('ts-bead-timeline').locator('.ts-bead-tick')).toHaveCount(7);

    // Flip back
    await page.getByTestId('timeseries-window-24h').click();
    await expect(page.getByTestId('ts-bead-timeline').locator('.ts-bead-tick')).toHaveCount(9);
  });

  test('TS-04: bead click navigates to requirement detail', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

    const id = createdRequirementIds[0];
    await page.getByTestId(`ts-chip-${id}`).click();
    await page.waitForURL(`**/swarm/requirement/${id}`, { timeout: 5000 });
    expect(page.url()).toContain(`/swarm/requirement/${id}`);
  });

  test('TS-05: day-nav arrows shift the anchor date by ±1 day', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

    // Chip for today should be visible
    await expect(page.getByTestId(`ts-chip-${createdRequirementIds[0]}`)).toBeVisible();

    // Previous day — today's chip should disappear (different day, 24h window)
    await page.getByTestId('ts-bead-prev-day').click();
    await expect(page.getByTestId(`ts-chip-${createdRequirementIds[0]}`)).not.toBeVisible();

    // Back to today
    await page.getByTestId('ts-bead-next-day').click();
    await expect(page.getByTestId(`ts-chip-${createdRequirementIds[0]}`)).toBeVisible();
  });

  test('TS-06: Summary ↔ Time Series mutual exclusion', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('summary-toggle').click();
    await expect(page.getByTestId('summary-toggle')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('timeseries-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('summary-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('time-series-view')).toBeVisible();

    await page.getByTestId('summary-toggle').click();
    await expect(page.getByTestId('summary-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('timeseries-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('time-series-view')).not.toBeVisible();
  });

  test('TS-07: window buttons are disabled when Time Series is off', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();

    await expect(page.getByTestId('timeseries-window-24h')).toBeDisabled();
    await expect(page.getByTestId('timeseries-window-36h')).toBeDisabled();

    await page.getByTestId('timeseries-toggle').click();

    await expect(page.getByTestId('timeseries-window-24h')).toBeEnabled();
    await expect(page.getByTestId('timeseries-window-36h')).toBeEnabled();
  });
});
