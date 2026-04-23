import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

// Seed the visualizer Zustand store AND the /swarm view choice so the visualizer
// toggle button is pre-selected when the page renders. Matches visualizer store
// schema v1 and the `darwin-swarm-view` localStorage key used by SwarmView.
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
                vizKey: 'bead',
                beadWindow: '24h',
                sidewalkOn: false,
            },
            version: 1,
        }));
        localStorage.setItem('darwin-swarm-view', 'visualizer');
    }, { d: currentDate, v: viewType });
}

test.describe('Swarm Visualizer — Bead / Swarm / Sidewalk toolbar on /swarm', () => {
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

    test('TS-04: Bead click → requirement detail', async ({ page }) => {
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
        await expect(page.getByTestId('timeseries-viz-bead')).toHaveCount(0);

        await page.getByTestId('view-toggle-visualizer').click();
        await expect(page.getByTestId('time-series-view')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('timeseries-viz-bead')).toBeVisible();
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
        await page.getByTestId('timeseries-viz-swarm').click();
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
});
