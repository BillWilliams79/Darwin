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

test.describe('Build Visualizer — save/load build patterns (req #2592)', () => {
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

    test('seeds with Default pattern on first load', async ({ page }) => {
        await expect(page.getByTestId('pattern-picker')).toBeVisible();
        const lib = await readLibrary(page);
        expect(lib).not.toBeNull();
        expect(Object.values(lib.patterns)).toHaveLength(1);
        expect(Object.values(lib.patterns)[0]).toMatchObject({ name: 'Default' });
    });

    test('Save As creates a new pattern and persists across reloads', async ({ page }) => {
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
        await page.getByTestId('bv-rename').click();
        await page.getByTestId('bv-rename-input').fill('Default Renamed');
        await page.getByTestId('bv-rename-confirm').click();

        const lib = await readLibrary(page);
        expect(lib.patterns[lib.activeId].name).toBe('Default Renamed');
    });

    test('Delete is disabled when only one pattern exists', async ({ page }) => {
        await expect(page.getByTestId('bv-delete')).toBeDisabled();
    });

    test('Delete removes the active pattern when more than one exists', async ({ page }) => {
        await page.getByTestId('bv-save-as').click();
        await page.getByTestId('bv-save-as-input').fill('Doomed');
        await page.getByTestId('bv-save-as-confirm').click();
        let lib = await readLibrary(page);
        expect(Object.values<any>(lib.patterns)).toHaveLength(2);

        await page.getByTestId('bv-delete').click();
        await page.getByTestId('bv-delete-confirm').click();

        lib = await readLibrary(page);
        expect(Object.values<any>(lib.patterns)).toHaveLength(1);
        expect(Object.values<any>(lib.patterns)[0].name).toBe('Default');
    });

    test('Export triggers a download with the dated filename', async ({ page }) => {
        const downloadPromise = page.waitForEvent('download');
        await page.getByTestId('bv-export').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^darwin-build-patterns-\d{4}-\d{2}-\d{2}\.json$/);
    });
});
