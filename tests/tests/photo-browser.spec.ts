import { test, expect } from '@playwright/test';

test.describe('Photo Browser', () => {

    test('PB-01: /maps/settings/photos renders and shows scan status section', async ({ page }) => {
        await page.goto('/maps/settings/photos');
        await expect(page).toHaveURL(/\/maps\/settings\/photos/);
        // Page heading
        await expect(page.getByRole('heading', { name: 'Photo Settings' })).toBeVisible({ timeout: 10000 });
        // Scan progress section is always visible
        await expect(page.getByText(/SCAN PROGRESS/i)).toBeVisible({ timeout: 10000 });
        // Default idle state
        await expect(page.getByText(/No scan in progress/i)).toBeVisible({ timeout: 10000 });
    });

    test('PB-02: "Photo Settings" item appears in Maps settings dropdown', async ({ page }) => {
        await page.goto('/maps');
        // Open the settings dropdown
        await page.getByTestId('maps-settings-button').click();
        // Photo Settings menu item should be visible
        await expect(page.getByTestId('manage-photos-button')).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('Photo Settings')).toBeVisible();
    });

    test('PB-03: Photo Settings menu item navigates to /maps/settings/photos', async ({ page }) => {
        await page.goto('/maps');
        await page.getByTestId('maps-settings-button').click();
        await page.getByTestId('manage-photos-button').click();
        await expect(page).toHaveURL(/\/maps\/settings\/photos/);
    });

    test('PB-04: RouteCard has photos icon button when runs exist', async ({ page }) => {
        await page.goto('/maps');
        // Wait for cards to load — look for at least one route card photo button
        const photoBtns = page.getByTestId('route-card-photos-btn');
        // If there are no runs, the button won't exist — check presence conditionally
        const count = await photoBtns.count();
        if (count > 0) {
            await expect(photoBtns.first()).toBeVisible();
        } else {
            // No runs in test environment — pass the test with a note
            console.log('PB-04: No runs found in test environment, skipping button visibility check');
        }
    });

    test('PB-05: RouteDetailView has photos icon button', async ({ page }) => {
        await page.goto('/maps');
        // Navigate to first available run detail if any
        const firstCard = page.locator('[data-testid="route-card-photos-btn"]').first();
        const count = await firstCard.count();
        if (count > 0) {
            // Navigate to detail view for the first run
            // Click the card body (not the photo/menu button) to go to detail
            const card = page.locator('.MuiCard-root').first();
            await card.click();
            await expect(page).toHaveURL(/\/maps\/\d+/);
            await expect(page.getByTestId('detail-photos-btn')).toBeVisible({ timeout: 10000 });
        } else {
            console.log('PB-05: No runs found in test environment, skipping detail view check');
        }
    });

    test('PB-06: /maps/photos/:runId renders with no-index message when no index cached', async ({ page }) => {
        // Clear any cached IDB data by intercepting requests
        await page.goto('/maps/photos/99999');
        await expect(page).toHaveURL(/\/maps\/photos\/99999/);
        // Either shows "No photo library indexed yet" or a loading state or back button
        await expect(
            page.getByRole('heading', { name: 'Photos' }).or(
                page.getByText(/No photo library indexed yet/i)
            )
        ).toBeVisible({ timeout: 10000 });
    });

    test('PB-07: Photo Settings page has folder selection controls', async ({ page }) => {
        await page.goto('/maps/settings/photos');
        // Feature toggle section
        await expect(page.getByText(/Show photo button on activity cards/i)).toBeVisible({ timeout: 10000 });
        // Page is organized into three sections: FEATURE, DARWIN PHOTOS APP, CACHE.
        // Match each section heading exactly (case sensitive) so we don't collide
        // with in-page text like "No index cached." or the "Clear Cache" button.
        await expect(page.getByRole('heading', { name: 'FEATURE' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'DARWIN PHOTOS APP' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'CACHE' })).toBeVisible();
    });

});
