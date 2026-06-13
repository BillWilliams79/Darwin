import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

// Seed the visualizer Zustand store AND the /swarm view choice so the visualizer
// toggle button is pre-selected when the page renders. Matches visualizer store
// schema v2 (adds `elevatorOn` req #2383 + `dataKey` req #2382) and the
// `darwin-swarm-view` localStorage key used by SwarmView.
async function seedVisualizerState(
    page: Page,
    currentDate: string,
    viewType: 'day' | 'week' = 'day'
): Promise<void> {
    await page.evaluate(({ d, v }) => {
        localStorage.setItem('darwin_swarm_visualizer', JSON.stringify({
            state: {
                viewType: v,
                currentDate: d,
                beadWindow: '24h',
                sidewalkOn: false,
                elevatorOn: false,
                dataKey: 'category',
            },
            version: 2,
        }));
        localStorage.setItem('darwin-swarm-view', 'visualizer');
    }, { d: currentDate, v: viewType });
}

// Pin the browser timezone to UTC for this spec. Beads are placed by
// toLocaleDateString(completed_at, timezone) where completed_at is stored UTC and
// the test user's profile timezone is empty (→ host timezone). On a PDT host a
// 03:15 UTC completion renders on the PREVIOUS day, so a chip seeded "today" (UTC)
// falls outside the day-view window and never appears. testDate is computed via
// toISOString() (UTC), so pinning the browser to UTC makes seed and render agree
// deterministically on any host. (The app's prev-day placement is correct behavior;
// this only removes host-timezone nondeterminism from the test.)
test.use({ timezoneId: 'UTC' });

test.describe('Swarm Visualizer — Sidewalk toolbar on /swarm', () => {
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
                completed_at: completedAt,
            }, idToken) as Array<{ id: string }>;
            if (!res?.length) throw new Error('Failed to seed requirement');
            createdRequirementIds.push(res[0].id);
        }
    });

    test.afterAll(async () => {
        try { await apiDelete('projects', testProjectId, idToken); } catch {}
    });

    test('TS-01: Bead is active by default; visualizer renders a bead necklace', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();

        await expect(page.getByTestId('view-toggle-visualizer')).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
        await expect(page.getByTestId('time-series-view')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('ts-bead')).toBeVisible();
    });

    test('TS-02: seeded chips render as beads', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

        for (const id of createdRequirementIds) {
            await expect(page.getByTestId(`ts-chip-${id}`)).toBeVisible({ timeout: 10000 });
        }
    });

    test('TS-03: 24h / 36h window buttons switch tick sets', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

        const ticks = page.locator('[data-testid="ts-bead"] .ts-bead-tick');
        const countA = await ticks.count();
        await page.getByTestId('timeseries-window-36h').click();
        const countB = await ticks.count();
        expect(countA).not.toBe(countB);
    });

    test('TS-04: chip click → requirement detail', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

        const id = createdRequirementIds[0];
        await page.getByTestId(`ts-chip-${id}`).click();
        await page.waitForURL(`**/swarm/requirement/${id}`, { timeout: 5000 });
    });

    test('TS-05: switching to Cards/Table hides the visualizer; switching back restores it', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('time-series-view')).toBeVisible({ timeout: 10000 });

        await page.getByTestId('view-toggle-cards').click();
        await expect(page.getByTestId('time-series-view')).toHaveCount(0);
        await expect(page.getByTestId('timeseries-group')).toHaveCount(0);

        await page.getByTestId('view-toggle-visualizer').click();
        await expect(page.getByTestId('time-series-view')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('timeseries-group')).toBeVisible();
    });

    test('TS-06: Sidewalk button — disabled in Week view, enabled in Day view', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('timeseries-sidewalk')).toBeEnabled({ timeout: 10000 });

        // Switch to Week view → Sidewalk disabled
        await page.getByRole('button', { name: 'Week', exact: true }).click();
        await expect(page.getByTestId('timeseries-sidewalk')).toBeDisabled();

        // Back to Day view → Sidewalk re-enabled
        await page.getByRole('button', { name: 'Day', exact: true }).click();
        await expect(page.getByTestId('timeseries-sidewalk')).toBeEnabled();
    });

    test('TS-07: Swarm viz shows autonomy in datacard', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

        const id = createdRequirementIds[0];
        await page.getByTestId(`ts-chip-${id}`).hover();
        await expect(page.getByTestId(`ts-datacard-autonomy-${id}`)).toHaveText('Planned', { timeout: 3000 });
    });

    test('TS-08: Sidewalk toggle — clicking activates and 36h becomes disabled', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('timeseries-sidewalk')).toBeEnabled({ timeout: 10000 });

        await page.getByTestId('timeseries-sidewalk').click();
        await expect(page.getByTestId('timeseries-sidewalk')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('ts-sidewalk')).toBeVisible({ timeout: 5000 });
        // 36h is disabled when Sidewalk is on.
        await expect(page.getByTestId('timeseries-window-36h')).toBeDisabled();
    });

    test('TS-09: Elevator toggle — enabled only in Week view, renders vertical strip (req #2383)', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();

        // Day view → Elevator disabled.
        await expect(page.getByTestId('timeseries-elevator')).toBeDisabled({ timeout: 10000 });

        // Switch to Week → Elevator now enabled, Sidewalk disabled.
        await page.getByRole('button', { name: 'Week', exact: true }).click();
        await expect(page.getByTestId('timeseries-elevator')).toBeEnabled();
        await expect(page.getByTestId('timeseries-sidewalk')).toBeDisabled();

        // Click Elevator → ts-elevator mounts, Elevator button aria-pressed, 36h disabled.
        await page.getByTestId('timeseries-elevator').click();
        await expect(page.getByTestId('timeseries-elevator')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('ts-elevator')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('timeseries-window-36h')).toBeDisabled();

        // Switch back to Day → Elevator auto-off, button disabled.
        await page.getByRole('button', { name: 'Day', exact: true }).click();
        await expect(page.getByTestId('ts-elevator')).toHaveCount(0);
        await expect(page.getByTestId('timeseries-elevator')).toBeDisabled();
    });

    test('TS-13: Week stack hand-scrolls by drag and hides its scrollbar (req #2842)', async ({ page }) => {
        // Short viewport so the 7 stacked day rows overflow the fixed-height frame
        // (calc(100vh-220px)) and the frame is genuinely scrollable.
        await page.setViewportSize({ width: 1100, height: 620 });
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate, 'week');
        await page.reload();

        const frame = page.getByTestId('ts-week-scroll');
        await expect(frame).toBeVisible({ timeout: 10000 });

        // Regression guard #1 (req #2842): the native scrollbar is hidden — the
        // frame's scrollbar gutter is 0px wide. (Before the fix it was overflow-y:
        // auto with a visible scrollbar on the right.)
        const gutter = await frame.evaluate((el: HTMLElement) => el.offsetWidth - el.clientWidth);
        expect(gutter).toBe(0);
        await expect(frame).toHaveCSS('cursor', 'grab');

        // Regression guard #2 (req #2842): the frame hand-scrolls by mouse drag.
        const box = await frame.boundingBox();
        if (!box) throw new Error('week frame has no bounding box');
        const readTop = () => frame.evaluate((el: HTMLElement) => el.scrollTop);
        const maxTop = await frame.evaluate((el: HTMLElement) => el.scrollHeight - el.clientHeight);
        expect(maxTop).toBeGreaterThan(0);   // frame must actually overflow to be scrollable
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // Drag toward whichever edge has room (focus-day pin makes the start
        // position weekday-dependent): if near the bottom drag DOWN to decrease
        // scrollTop, otherwise drag UP to increase it.
        const before = await readTop();
        const dir = before > maxTop / 2 ? +1 : -1;   // +1 = pointer down (scrollTop↓)
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        for (let i = 1; i <= 12; i++) { await page.mouse.move(cx, cy + dir * i * 18); await page.waitForTimeout(16); }
        await page.mouse.up();
        await page.waitForTimeout(200);
        const after = await readTop();
        expect(after).not.toBe(before);   // drag moved the frame by hand
    });

    test('TS-10: Autonomy toggle — recolors chips by coordination_type (req #2382)', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

        await page.getByTestId('timeseries-data-coordination').click();
        await expect(page.getByTestId('timeseries-data-coordination')).toHaveAttribute('aria-pressed', 'true');
    });

    // req #2566 — when the toolbar "Title" toggle is on, the title label sits
    // to the right of the bubble. The dashed swarm-duration line passes
    // through the bubble's vertical center, which is the same Y as the label.
    // The label must paint an opaque background so the dashed line is hidden
    // beneath the text (z-index alone isn't enough — the SVG line draws
    // through any element with a transparent background).
    test('TS-11: Title labels paint an opaque background that hides the dashed duration line (req #2566)', async ({ page }) => {
        await page.goto('/swarm');
        await page.evaluate((d) => {
            localStorage.setItem('darwin_swarm_visualizer', JSON.stringify({
                state: {
                    viewType: 'day',
                    currentDate: d,
                    vizKey: 'bead',
                    beadWindow: '24h',
                    sidewalkOn: false,
                    elevatorOn: false,
                    dataKey: 'category',
                    titlesOn: true,
                },
                version: 3,
            }));
            localStorage.setItem('darwin-swarm-view', 'visualizer');
        }, testDate);
        await page.reload();
        await expect(page.getByTestId('ts-bead')).toBeVisible({ timeout: 10000 });

        const id = createdRequirementIds[0];
        const label = page.getByTestId(`ts-bead-label-${id}`);
        await expect(label).toBeVisible({ timeout: 5000 });

        const bg = await label.evaluate((el) => getComputedStyle(el).backgroundColor);
        // Must be a real color (not the default `rgba(0, 0, 0, 0)` / `transparent`)
        // so the dashed line behind the bubble is fully occluded.
        expect(bg).not.toBe('rgba(0, 0, 0, 0)');
        expect(bg).not.toBe('transparent');
    });

    // req #2799 — `currentDate` is navigation state, not a saved preference. A
    // pre-#2799 build persisted it, so a stale date (the elevator scrolled to a
    // dense late-May day, or a chevron jump) would reload instead of today — the
    // "late-May affinity." The store now drops currentDate from persistence and
    // strips any already-persisted date on migrate, so every fresh load is today.
    test('TS-12: a stale persisted currentDate does not survive a reload — resets to today (req #2799)', async ({ page }) => {
        await page.goto('/swarm');
        // Seed a returning user's localStorage: a stale late-May date under a
        // pre-#2799 schema version, exactly the reported reproduction.
        await page.evaluate(() => {
            localStorage.setItem('darwin_swarm_visualizer', JSON.stringify({
                state: {
                    viewType: 'day',
                    currentDate: '2026-05-22',
                    vizKey: 'bead',
                    beadWindow: '24h',
                    sidewalkOn: false,
                    elevatorOn: false,
                    dataKey: 'category',
                },
                version: 4,
            }));
            localStorage.setItem('darwin-swarm-view', 'visualizer');
        });
        await page.reload();

        const title = page.getByTestId('visualizer-date-title');
        await expect(title).toBeVisible({ timeout: 10000 });

        // Compute today's title with the SAME logic the toolbar uses (localDateStr
        // + formatDayTitle, browser locale, pinned UTC) — the view must show today,
        // not the seeded May 22.
        const expectedToday = await page.evaluate(() => {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const d = new Date(`${y}-${m}-${day}T12:00:00`);
            return d.toLocaleDateString(undefined, {
                weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
            });
        });
        await expect(title).toHaveText(expectedToday);

        // And the rewritten blob must no longer carry currentDate (partialize),
        // so it can never re-seed a stale date on the next load.
        const persisted = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('darwin_swarm_visualizer') || '{}'));
        expect(persisted.state).not.toHaveProperty('currentDate');
    });
});
