import { test, expect, Page } from '@playwright/test';

// /build-visualizer is gated on import.meta.env.DEV (Darwin/src/index.jsx:155).
// Skip entirely when targeting a non-localhost build (production runs of the
// E2E suite via BASE_URL=https://darwin.one don't have the route).
const isDevHost = (process.env.BASE_URL || 'https://localhost:3000').includes('localhost');

const STORAGE_KEY = 'darwin.buildPatterns.v1';

async function clearLibrary(page: Page): Promise<void> {
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
}

async function readLibrary(page: Page): Promise<any> {
    const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
}

test.describe('Build Visualizer — save/load build patterns (req #2592, menu refresh req #2608)', () => {
    test.skip(!isDevHost, 'Build Visualizer is DEV-only — skipped against non-localhost target');

    // Open the unified document menu (single trigger replaces 6 toolbar
    // buttons — req #2608). Menu items live in a MUI Popover and only mount
    // when the menu is open, so every per-action assertion does this first.
    const openMenu = async (page: Page) => {
        await page.getByTestId('pattern-picker').click();
        await expect(page.getByTestId('bv-new')).toBeVisible();
    };

    test.beforeEach(async ({ page }) => {
        await page.goto('/build-visualizer');
        await clearLibrary(page);
        await page.reload();
        await expect(page.getByTestId('build-visualizer-iframe')).toBeVisible();
    });

    test.afterEach(async ({ page }) => {
        await clearLibrary(page);
    });

    test('seeds with Default pattern on first load', async ({ page }) => {
        const trigger = page.getByTestId('pattern-picker');
        await expect(trigger).toBeVisible();
        // The trigger button surfaces the active pattern name (req #2608).
        await expect(trigger).toContainText('Default');
        const lib = await readLibrary(page);
        expect(lib).not.toBeNull();
        expect(Object.values(lib.patterns)).toHaveLength(1);
        expect(Object.values(lib.patterns)[0]).toMatchObject({ name: 'Default' });
    });

    test('Duplicate creates a new pattern and persists across reloads', async ({ page }) => {
        await openMenu(page);
        await page.getByTestId('bv-save-as').click();
        await page.getByTestId('bv-save-as-input').fill('Test Pattern A');
        await page.getByTestId('bv-save-as-confirm').click();

        let lib = await readLibrary(page);
        const names = Object.values<any>(lib.patterns).map(p => p.name).sort();
        expect(names).toEqual(['Default', 'Test Pattern A']);

        // Reload — the new pattern remains selected
        await page.reload();
        await expect(page.getByTestId('build-visualizer-iframe')).toBeVisible();
        lib = await readLibrary(page);
        expect(lib.patterns[lib.activeId].name).toBe('Test Pattern A');
    });

    test('Rename updates the active pattern name', async ({ page }) => {
        await openMenu(page);
        await page.getByTestId('bv-rename').click();
        await page.getByTestId('bv-rename-input').fill('Default Renamed');
        await page.getByTestId('bv-rename-confirm').click();

        const lib = await readLibrary(page);
        expect(lib.patterns[lib.activeId].name).toBe('Default Renamed');
    });

    test('Delete is disabled when only one pattern exists', async ({ page }) => {
        await openMenu(page);
        // MUI disables MenuItems via aria-disabled (not the disabled attribute),
        // so check the aria attribute rather than `.toBeDisabled()`.
        await expect(page.getByTestId('bv-delete')).toHaveAttribute('aria-disabled', 'true');
    });

    test('Delete removes the active pattern when more than one exists', async ({ page }) => {
        await openMenu(page);
        await page.getByTestId('bv-save-as').click();
        await page.getByTestId('bv-save-as-input').fill('Doomed');
        await page.getByTestId('bv-save-as-confirm').click();
        let lib = await readLibrary(page);
        expect(Object.values<any>(lib.patterns)).toHaveLength(2);

        await openMenu(page);
        await page.getByTestId('bv-delete').click();
        await page.getByTestId('bv-delete-confirm').click();

        lib = await readLibrary(page);
        expect(Object.values<any>(lib.patterns)).toHaveLength(1);
        expect(Object.values<any>(lib.patterns)[0].name).toBe('Default');
    });

    test('Export triggers a download with the dated filename', async ({ page }) => {
        await openMenu(page);
        const downloadPromise = page.waitForEvent('download');
        await page.getByTestId('bv-export').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^darwin-build-patterns-\d{4}-\d{2}-\d{2}\.json$/);
    });
});

// req #2601 — clicking a non-main branch (label or connector) opens the
// branch editor; saving with a new name + type writes through to the
// pattern library and survives a reload.
test.describe('Build Visualizer — branch editor (req #2601)', () => {
    test.skip(!isDevHost, 'Build Visualizer is DEV-only — skipped against non-localhost target');

    test.beforeEach(async ({ page }) => {
        await page.goto('/build-visualizer');
        await clearLibrary(page);
        await page.reload();
        await expect(page.getByTestId('build-visualizer-iframe')).toBeVisible();
    });

    test.afterEach(async ({ page }) => {
        await clearLibrary(page);
    });

    test('clicking a non-main branch label opens the editor and saves name + type', async ({ page }) => {
        const iframe = page.frameLocator('[data-testid="build-visualizer-iframe"]');

        // The first non-main branch in the seed pattern is `dev-a` (a
        // `development` branch). Its label is the first `.branch-label` text
        // node in the SVG. Click it to open the editor.
        const label = iframe.locator('text.branch-label[data-branch-id]').first();
        await expect(label).toBeVisible();
        const branchId = await label.getAttribute('data-branch-id');
        expect(branchId).toBeTruthy();
        await label.click();

        const nameInput = iframe.locator('[data-testid="branch-editor-name"]');
        const typeSelect = iframe.locator('[data-testid="branch-editor-type"]');
        await expect(nameInput).toBeVisible();
        await expect(typeSelect).toBeVisible();

        await nameInput.fill('Renamed Branch');
        await typeSelect.selectOption('hotfix');
        await iframe.locator('[data-testid="branch-editor-save"]').click();

        // Editor closes after save.
        await expect(nameInput).toBeHidden();

        // The pattern library should reflect the new name and type for that branch.
        await expect.poll(async () => {
            const lib = await readLibrary(page);
            const data = lib?.patterns?.[lib.activeId]?.data;
            const br = data?.branches?.find((b: any) => b.id === branchId);
            return br ? { name: br.name, type: br.type } : null;
        }).toEqual({ name: 'Renamed Branch', type: 'hotfix' });
    });

    test('main trunk label opens the editor with type locked', async ({ page }) => {
        const iframe = page.frameLocator('[data-testid="build-visualizer-iframe"]');

        // Main's LEFT endpoint label is an `.endpoint-label` (not `.branch-label`)
        // and carries data-branch-id="main".
        const mainLabel = iframe.locator('text.endpoint-label[data-branch-id="main"]');
        await expect(mainLabel).toBeVisible();
        await mainLabel.click();

        const nameInput = iframe.locator('[data-testid="branch-editor-name"]');
        const typeSelect = iframe.locator('[data-testid="branch-editor-type"]');
        await expect(nameInput).toBeVisible();
        // Type select is disabled for main — engine requires exactly one
        // branch with id='main' AND type='main'.
        await expect(typeSelect).toBeDisabled();

        // Rename the trunk and save.
        await nameInput.fill('Trunk');
        await iframe.locator('[data-testid="branch-editor-save"]').click();
        await expect(nameInput).toBeHidden();

        await expect.poll(async () => {
            const lib = await readLibrary(page);
            const data = lib?.patterns?.[lib.activeId]?.data;
            const br = data?.branches?.find((b: any) => b.id === 'main');
            return br ? { name: br.name, type: br.type } : null;
        }).toEqual({ name: 'Trunk', type: 'main' });
    });
});

// req #2615 — natural spacing. Two dev branches whose horizontal x-extents would
// overlap on the same row must land on DIFFERENT Y rows. The collision-aware row
// assignment in BuildLayoutEngine bumps the second branch to the next dev row
// instead of letting two lines run atop each other.
test.describe('Build Visualizer — natural spacing (req #2615)', () => {
    test.skip(!isDevHost, 'Build Visualizer is DEV-only — skipped against non-localhost target');

    // Inject a synthetic pattern BEFORE the iframe boots so the engine renders our
    // hand-rolled dev-overlap scenario. Two dev branches off different main builds:
    //   - long-dev: parent m2, 25 builds → horizontal extends from m2.x past m27.
    //   - short-dev: parent m15, 3 builds → horizontal at m15.x, would naturally
    //     land on row 0 (mainY + 110 = 610) but row 0 is already occupied by
    //     long-dev's horizontal at that x. Algorithm bumps short-dev to row 1
    //     (mainY + 180 = 680).
    test('two dev branches whose extents collide land on different Y rows', async ({ page }) => {
        await page.goto('/build-visualizer');
        await page.waitForLoadState('domcontentloaded');

        const mainBuildIds = Array.from({ length: 30 }, (_, i) => `m${i + 1}`);
        const longDevBuildIds = Array.from({ length: 25 }, (_, i) => `ld${i + 1}`);
        const shortDevBuildIds = ['sd1', 'sd2', 'sd3'];
        const builds: Record<string, any> = {};
        mainBuildIds.forEach((id, i) => { builds[id] = { id, number: i + 1, branchId: 'main', dotColor: null }; });
        longDevBuildIds.forEach((id) => { builds[id] = { id, number: 1, branchId: 'long-dev', dotColor: null }; });
        shortDevBuildIds.forEach((id) => { builds[id] = { id, number: 1, branchId: 'short-dev', dotColor: null }; });

        const data = {
            version: 1,
            currentMajor: 1,
            currentMinor: 0,
            nextBuildNumber: 100,
            nextBranchNumber: 50,
            initialBuildNumber: 1,
            trunkSegments: [{ startIdx: 0, major: 1, minor: 0, initialBuildNumber: 1 }],
            branches: [
                { id: 'main', type: 'main', name: 'Main', parentBranchId: null, parentBuildId: null, side: 'center', buildIds: mainBuildIds },
                { id: 'long-dev', type: 'development', name: 'long-dev', parentBranchId: 'main', parentBuildId: 'm2', side: 'below', buildIds: longDevBuildIds },
                { id: 'short-dev', type: 'development', name: 'short-dev', parentBranchId: 'main', parentBuildId: 'm15', side: 'below', buildIds: shortDevBuildIds },
            ],
            builds,
        };
        const library = {
            version: 1,
            activeId: 'natural-spacing-test',
            patterns: {
                'natural-spacing-test': {
                    id: 'natural-spacing-test',
                    name: 'Natural Spacing Test',
                    createdAt: '2026-05-24T00:00:00.000Z',
                    updatedAt: '2026-05-24T00:00:00.000Z',
                    data,
                },
            },
        };
        await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(library)]);
        await page.reload();
        await expect(page.getByTestId('build-visualizer-iframe')).toBeVisible();

        const iframe = page.frameLocator('[data-testid="build-visualizer-iframe"]');
        // Both dev labels render with data-branch-id; their y attribute is
        // branchY - 16 (see _branchLabel). Read it and recover branchY.
        const longLabel = iframe.locator('text.branch-label[data-branch-id="long-dev"]').first();
        const shortLabel = iframe.locator('text.branch-label[data-branch-id="short-dev"]').first();
        await expect(longLabel).toBeVisible();
        await expect(shortLabel).toBeVisible();
        const longY = Number(await longLabel.getAttribute('y')) + 16;
        const shortY = Number(await shortLabel.getAttribute('y')) + 16;

        // Both dev branches must NOT share a Y. Their extents overlap horizontally
        // — m15.x ≈ 240 + 14·52 = 968, well within long-dev's extent which runs
        // from 240+1·52=292 past 27·52 ≈ column-27 = 240+26·52 = 1592.
        expect(longY).not.toBe(shortY);
        // long-dev was created first → claims row 0 (mainY + 110 = 610).
        expect(longY).toBe(610);
        // short-dev gets bumped one row down (mainY + 110 + 70 = 680).
        expect(shortY).toBe(680);

        await clearLibrary(page);
    });
});
