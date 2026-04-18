import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

// Seed the calendar Zustand store with a known currentDate so chip positions are predictable.
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
        timeSeriesGranularity: '24h',
        timeSeriesChipMode: 'title',
        timeSeriesLaneMode: 'none',
        timeSeriesView: 'rail',
        timeSeriesShowAll: false,
      },
      version: 4,
    }));
  }, { d: currentDate, m: mode });
}

test.describe('Calendar Time Series View', () => {
  let idToken: string;
  let testProjectId: string;
  let testCategoryId: string;
  const testProjectName = uniqueName('TSProj');
  const testCategoryName = uniqueName('TSCat');
  const testDate = new Date().toISOString().slice(0, 10); // today in local-ish tz
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

    // Seed three requirements closed at distinct hours of today (UTC).
    // UTC is fine — the view computes the time fraction in user's browser tz and chip
    // positions are tz-dependent, but the *chip existence* is what the spec verifies.
    const dayStr = testDate;
    const stamps = ['03:15:00', '11:30:00', '19:45:00'];
    for (let i = 0; i < stamps.length; i++) {
      const completedAt = `${dayStr} ${stamps[i]}`;
      const title = uniqueName(`TSReq${i}`);
      const res = await apiCall('requirements', 'POST', {
        creator_fk: sub,
        title,
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

  test('TS-01: Time Series toggle reveals the rail', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Toggle on
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('time-series-view')).toBeVisible({ timeout: 5000 });
    // FullCalendar should be hidden
    await expect(page.locator('.fc-view-harness')).not.toBeVisible();
    // Rail is present
    await expect(page.getByTestId('ts-rail')).toBeVisible();
  });

  test('TS-02: chip count matches seeded requirements', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('ts-rail')).toBeVisible({ timeout: 10000 });

    for (const id of createdRequirementIds) {
      await expect(page.getByTestId(`ts-chip-${id}`)).toBeVisible({ timeout: 10000 });
    }
  });

  test('TS-03: granularity toggle changes tick count', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('ts-rail')).toBeVisible({ timeout: 10000 });

    // 24h default → 9 tick marks (0,3,6,9,12,15,18,21,24)
    await expect(page.getByTestId('ts-ticks').locator('.ts-tick')).toHaveCount(9);

    // 6×4h → 7 ticks (0,4,8,12,16,20,24)
    await page.getByTestId('ts-granularity-4h').click();
    await expect(page.getByTestId('ts-ticks').locator('.ts-tick')).toHaveCount(7);

    // 3×8h → 4 ticks (0,8,16,24)
    await page.getByTestId('ts-granularity-8h').click();
    await expect(page.getByTestId('ts-ticks').locator('.ts-tick')).toHaveCount(4);

    // AM/PM → 3 ticks (AM, |, PM)
    await page.getByTestId('ts-granularity-ampm').click();
    await expect(page.getByTestId('ts-ticks').locator('.ts-tick')).toHaveCount(3);
  });

  test('TS-04: chip-mode toggle flips between #id and trimmed title', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('ts-rail')).toBeVisible({ timeout: 10000 });

    const id = createdRequirementIds[0];
    const chip = page.getByTestId(`ts-chip-${id}`);

    // Switch to #id mode
    await page.getByTestId('ts-chipmode-id').click();
    await expect(chip).toHaveText(`#${id}`);

    // Switch to title mode → should contain test prefix
    await page.getByTestId('ts-chipmode-title').click();
    await expect(chip).toContainText('TSReq0');
  });

  test('TS-05: lane mode creates category lanes', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('ts-rail')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('ts-lanemode-category').click();
    // Lane container appears
    await expect(page.getByTestId('ts-lanes')).toBeVisible();
    // A lane keyed by our test category name exists
    await expect(page.getByTestId(`ts-lane-${testCategoryName}`)).toBeVisible();
  });

  test('TS-06: chip click navigates to requirement detail', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('ts-rail')).toBeVisible({ timeout: 10000 });

    const id = createdRequirementIds[0];
    await page.getByTestId(`ts-chip-${id}`).click();
    await page.waitForURL(`**/swarm/requirement/${id}`, { timeout: 5000 });
    expect(page.url()).toContain(`/swarm/requirement/${id}`);
  });

  test('TS-07: Summary ↔ Time Series mutual exclusion', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await expect(page.locator('.fc')).toBeVisible({ timeout: 10000 });

    // Turn on Summary
    await page.getByTestId('summary-toggle').click();
    await expect(page.getByTestId('summary-toggle')).toHaveAttribute('aria-pressed', 'true');

    // Turn on Time Series — Summary should flip off
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('timeseries-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('summary-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('time-series-view')).toBeVisible();

    // Flip Summary back on — Time Series should flip off
    await page.getByTestId('summary-toggle').click();
    await expect(page.getByTestId('summary-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('timeseries-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('time-series-view')).not.toBeVisible();
  });

  test('TS-08: now marker visible when viewing today', async ({ page }) => {
    await page.goto('/calview');
    await seedCalendarState(page, testDate);
    await page.reload();
    await page.getByTestId('timeseries-toggle').click();
    await expect(page.getByTestId('ts-rail')).toBeVisible({ timeout: 10000 });
    // Now-marker only exists when selectedDate === today
    await expect(page.getByTestId('ts-now-marker')).toBeVisible();
  });
});
