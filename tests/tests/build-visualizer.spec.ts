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
