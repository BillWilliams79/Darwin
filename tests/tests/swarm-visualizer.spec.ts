import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

// req #2844 — the Classic SVG/DOM TimeSeriesView was retired; the Konva canvas is
// now the only visualizer substrate. The canvas renders to <canvas>, so its
// chips/beads/datacards are NOT DOM-queryable — this spec covers the
// DOM-queryable surface that remains: the canvas mounts, the toolbar controls
// that survived (36h zoom + the data overlays), the view switch, date
// navigation, and the persisted-state contracts (req #2799 / req #2844).

// Seed the visualizer Zustand store AND the /swarm view choice so the visualizer
// toggle is pre-selected when the page renders. Matches the v10 store schema
// (req #2844 — konvaOn/viewType/beadWindow/sidewalkOn/elevatorOn removed).
async function seedVisualizerState(page: Page, currentDate: string): Promise<void> {
    await page.evaluate((d) => {
        localStorage.setItem('darwin_swarm_visualizer', JSON.stringify({
            state: {
                currentDate: d,
                dataKey: 'category',
                titlesOn: false,
                completesOn: false,
                phasesOn: false,
                konvaWide: true,
            },
            version: 10,
        }));
        localStorage.setItem('darwin-swarm-view', 'visualizer');
    }, currentDate);
}

// Pin the browser timezone to UTC for this spec so seed and render agree
// deterministically on any host (completed_at is stored UTC; the test user's
// profile timezone is empty → host timezone).
test.use({ timezoneId: 'UTC' });

test.describe('Swarm Visualizer — Konva canvas on /swarm', () => {
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

    test('TS-01: visualizer renders the Konva canvas by default', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();

        await expect(page.getByTestId('view-toggle-visualizer')).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
        await expect(page.getByTestId('konva-swarm-canvas')).toBeVisible({ timeout: 5000 });
        // The zoom-level chip is part of the canvas overlay and always renders.
        await expect(page.getByTestId('konva-zoom-level')).toBeVisible();
    });

    test('TS-02: toolbar exposes the surviving controls only', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('timeseries-group')).toBeVisible({ timeout: 10000 });

        // Surviving controls.
        await expect(page.getByTestId('timeseries-window-36h')).toBeVisible();
        await expect(page.getByTestId('timeseries-data-coordination')).toBeVisible();
        await expect(page.getByTestId('timeseries-titles')).toBeVisible();
        await expect(page.getByTestId('timeseries-completes')).toBeVisible();
        await expect(page.getByTestId('timeseries-phases')).toBeVisible();

        // Retired Classic controls are gone.
        await expect(page.getByTestId('timeseries-sidewalk')).toHaveCount(0);
        await expect(page.getByTestId('timeseries-elevator')).toHaveCount(0);
        await expect(page.getByTestId('timeseries-window-24h')).toHaveCount(0);
        await expect(page.getByTestId('visualizer-canvas-toggle')).toHaveCount(0);
        await expect(page.getByTestId('visualizer-view-toggle')).toHaveCount(0);
    });

    test('TS-03: 36h button toggles the canvas wide (konvaWide) state', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        const wide = page.getByTestId('timeseries-window-36h');
        // konvaWide defaults true → button selected.
        await expect(wide).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
        await wide.click();
        await expect(wide).toHaveAttribute('aria-pressed', 'false');
        await wide.click();
        await expect(wide).toHaveAttribute('aria-pressed', 'true');
    });

    test('TS-04: data overlays (Autonomy / Title / Done / Phases) toggle on click', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('konva-swarm-canvas')).toBeVisible({ timeout: 10000 });

        for (const id of ['timeseries-data-coordination', 'timeseries-titles',
                          'timeseries-completes', 'timeseries-phases']) {
            const btn = page.getByTestId(id);
            await expect(btn).toHaveAttribute('aria-pressed', 'false');
            await btn.click();
            await expect(btn).toHaveAttribute('aria-pressed', 'true');
        }
        // Phases overlay reveals its legend.
        await expect(page.getByTestId('ts-phase-legend')).toBeVisible();
    });

    test('TS-05: switching to Cards hides the canvas; switching back restores it', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        await expect(page.getByTestId('konva-swarm-canvas')).toBeVisible({ timeout: 10000 });

        await page.getByTestId('view-toggle-cards').click();
        await expect(page.getByTestId('konva-swarm-canvas')).toHaveCount(0);
        await expect(page.getByTestId('timeseries-group')).toHaveCount(0);

        await page.getByTestId('view-toggle-visualizer').click();
        await expect(page.getByTestId('konva-swarm-canvas')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('timeseries-group')).toBeVisible();
    });

    test('TS-06: Prev / Next / Today move the date title by one day', async ({ page }) => {
        await page.goto('/swarm');
        await seedVisualizerState(page, testDate);
        await page.reload();
        const title = page.getByTestId('visualizer-date-title');
        await expect(title).toBeVisible({ timeout: 10000 });

        const start = await title.textContent();
        await page.getByTestId('visualizer-prev').click();
        await expect(title).not.toHaveText(start || '');
        await page.getByTestId('visualizer-next').click();
        await expect(title).toHaveText(start || '');
    });

    // req #2799 / req #2844 — `currentDate` is navigation state, never persisted. A
    // pre-#2799 build persisted it, so a stale date would reload instead of today
    // (the "late-May affinity"). The store drops currentDate from persistence and
    // strips it (plus the retired Classic fields) on migrate, so every fresh load
    // is today.
    test('TS-07: a stale persisted currentDate does not survive a reload — resets to today', async ({ page }) => {
        await page.goto('/swarm');
        // Seed a returning user's localStorage: a stale late-May date under a
        // pre-#2799 schema version carrying the now-retired Classic fields.
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

        // The rewritten blob must no longer carry currentDate (partialize) or the
        // retired Classic fields (migrate), so neither can re-seed on the next load.
        const persisted = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('darwin_swarm_visualizer') || '{}'));
        expect(persisted.state).not.toHaveProperty('currentDate');
        expect(persisted.state).not.toHaveProperty('konvaOn');
        expect(persisted.state).not.toHaveProperty('viewType');
        expect(persisted.state).not.toHaveProperty('sidewalkOn');
    });
});
