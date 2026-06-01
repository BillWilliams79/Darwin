import { test, expect, Page } from '@playwright/test';

// /build-visualizer is gated on import.meta.env.DEV (Darwin/src/index.jsx).
// Skip entirely when targeting a non-localhost build (production runs of the
// E2E suite via BASE_URL=https://darwin.one don't have the route).
const isDevHost = (process.env.BASE_URL || 'https://localhost:3000').includes('localhost');

test.describe('Build Visualizer — D3 React implementation (req #2720)', () => {
    test.skip(!isDevHost, 'Build Visualizer is DEV-only — skipped against non-localhost target');

    test.beforeEach(async ({ page }) => {
        await page.goto('/build-visualizer');
    });

    test('renders the D3 canvas', async ({ page }) => {
        await expect(page.getByTestId('build-visualizer-canvas')).toBeVisible();
    });

    test('pattern picker is visible', async ({ page }) => {
        const trigger = page.getByTestId('pattern-picker');
        await expect(trigger).toBeVisible();
    });

    // ─── Delete build visibility gate (req #2742) ─────────────────────────
    // Data setup for a full delete-build round-trip requires creating a
    // project, branch, and multiple builds via the API — impractical in the
    // current E2E harness (no project setup fixture). The gate test below
    // verifies that the "Delete build..." item does NOT appear in the
    // default dot-menu (the seed project's main branch has child branches
    // off most builds, and deleting main's last build is blocked when a
    // child branch exists).

    test('delete-build menu item is hidden when conditions are not met', async ({ page }) => {
        // Wait for canvas to render with at least one build dot.
        const canvas = page.getByTestId('build-visualizer-canvas');
        await expect(canvas).toBeVisible();

        // Hover the first visible build dot to open the popover.
        const dot = canvas.locator('.build-dot').first();
        if (await dot.count() > 0) {
            await dot.hover();
            // Short wait for the hover popover to appear.
            await page.waitForTimeout(300);
            // The delete-build item should NOT appear on a typical first dot
            // (either not the last build, only build, or has child branches).
            const deleteItem = page.getByTestId('bv-menu-delete-build');
            // Use count check — the item may not exist at all in the DOM.
            expect(await deleteItem.count()).toBe(0);
        }
    });

    // ─── Delete branch visibility gate (req #2742) ───────────────────────
    // Similar limitation: opening the branch editor requires clicking a
    // branch label, which needs a rendered non-main branch. The gate test
    // below verifies the Delete button is NOT shown for the main branch.

    test('delete-branch button is hidden for main branch', async ({ page }) => {
        const canvas = page.getByTestId('build-visualizer-canvas');
        await expect(canvas).toBeVisible();

        // Click main's label to open the branch editor. Main's label carries
        // data-branch-id="main" on its <text> or <g> wrapper.
        const mainLabel = canvas.locator('[data-branch-id="main"]').first();
        if (await mainLabel.count() > 0) {
            await mainLabel.click();
            // Wait for the branch editor dialog to appear.
            const dialog = page.getByTestId('bv-branch-editor');
            await expect(dialog).toBeVisible({ timeout: 3000 });
            // The Delete button must NOT appear for main.
            const deleteBtn = page.getByTestId('bv-branch-delete');
            expect(await deleteBtn.count()).toBe(0);
            // Close the dialog.
            await page.keyboard.press('Escape');
        }
    });

    // Future: add tests for build-dot click menu, branch creation, etc.
    // Earlier E2E tests (pattern CRUD, branch editor, natural spacing) were
    // retired in req #2720. New E2E coverage for the D3 architecture should
    // be added in a follow-up requirement.
});
