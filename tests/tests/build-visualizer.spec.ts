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

    test('renders the D3 canvas (not an iframe)', async ({ page }) => {
        // The D3 canvas should be visible — no iframe.
        await expect(page.getByTestId('build-visualizer-canvas')).toBeVisible();
        // The old iframe testid must NOT exist.
        await expect(page.locator('[data-testid="build-visualizer-iframe"]')).toHaveCount(0);
    });

    test('pattern picker is visible', async ({ page }) => {
        const trigger = page.getByTestId('pattern-picker');
        await expect(trigger).toBeVisible();
    });

    // Future: add tests for build-dot click menu, branch creation, etc.
    // The old iframe-based E2E tests (pattern CRUD, branch editor, natural
    // spacing) were retired with the iframe in req #2720. New E2E coverage
    // for the D3 architecture should be added in a follow-up requirement.
});
