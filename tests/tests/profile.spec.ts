import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Profile', () => {
  test('PROF-01: navigate to profile page via bike icon link', async ({ page }) => {
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Open the bike menu (Profile/Domains/Areas are inside it)
    await page.getByTestId('bike-menu-button').click();
    // Click the Profile menu item
    await page.getByRole('menuitem', { name: /profile/i }).click();

    // Verify navigation to /profile
    await expect(page).toHaveURL(/\/profile/);

    // Profile.jsx renders 6 TextFields: Name, Timezone (Autocomplete), E-mail, Region, User Pool ID, Cognito Identifier
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });
    const textFields = page.locator('.MuiTextField-root');
    await expect(textFields).toHaveCount(6);

    // Verify profile labels are present
    await expect(page.locator('body')).toContainText('Name');
    await expect(page.locator('body')).toContainText('mail');
  });

  test('PROF-02: profile page via direct navigation', async ({ page }) => {
    // Navigate directly to /profile route
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Profile.jsx renders 6 TextFields: Name, Timezone (Autocomplete), E-mail, Region, User Pool ID, Cognito Identifier
    const textFields = page.locator('.MuiTextField-root');
    await expect(textFields).toHaveCount(6);

    // Verify profile labels are present
    await expect(page.locator('body')).toContainText('Name');
    await expect(page.locator('body')).toContainText('mail');
  });

  test('PROF-03: export button visible and enabled on profile page', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    const exportButton = page.getByTestId('export-button');
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toBeEnabled();
    await expect(exportButton).toContainText('Export My Data');
  });

  test('PROF-04: export downloads valid JSON with expected structure', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Listen for download event before clicking
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByTestId('export-button').click();
    const download = await downloadPromise;

    // Verify filename pattern: darwin-export-YYYY-MM-DD.json
    expect(download.suggestedFilename()).toMatch(/^darwin-export-\d{4}-\d{2}-\d{2}\.json$/);

    // Save and read the downloaded file
    const downloadPath = path.join('.tmp', download.suggestedFilename());
    await download.saveAs(downloadPath);
    const content = fs.readFileSync(downloadPath, 'utf-8');
    const data = JSON.parse(content);

    // Verify top-level export structure
    expect(data.exportVersion).toBe('1.0');
    expect(data.exportDate).toBeTruthy();
    expect(data.profile).toBeDefined();
    expect(data.domains).toBeDefined();
    expect(Array.isArray(data.domains)).toBe(true);
    expect(data.priorities).toBeDefined();
    expect(Array.isArray(data.priorities)).toBe(true);
    expect(data.swarmSessions).toBeDefined();
    expect(Array.isArray(data.swarmSessions)).toBe(true);

    // Verify profile has expected keys
    expect(data.profile).toHaveProperty('name');
    expect(data.profile).toHaveProperty('email');
    expect(data.profile).toHaveProperty('userName');

    // Verify at least one domain exists with nested areas
    expect(data.domains.length).toBeGreaterThan(0);
    const firstDomain = data.domains[0];
    expect(firstDomain).toHaveProperty('id');
    expect(firstDomain).toHaveProperty('domain_name');
    expect(firstDomain).toHaveProperty('areas');
    expect(Array.isArray(firstDomain.areas)).toBe(true);

    // Cleanup
    fs.unlinkSync(downloadPath);
  });

  test('PROF-05: export button shows loading state during fetch', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Intercept API calls to delay response and observe loading state
    await page.route('**/domains**', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.continue();
    });

    const exportButton = page.getByTestId('export-button');
    await exportButton.click();

    // Button should be disabled and show loading text while fetching
    await expect(exportButton).toBeDisabled();
    await expect(exportButton).toContainText('Exporting...');

    // Wait for export to complete — button returns to enabled
    // Need to handle the download to avoid test hanging
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    const download = await downloadPromise;
    await expect(exportButton).toBeEnabled({ timeout: 10000 });
    await expect(exportButton).toContainText('Export My Data');

    // Cleanup: consume the download
    const downloadPath = path.join('.tmp', download.suggestedFilename());
    await download.saveAs(downloadPath);
    fs.unlinkSync(downloadPath);
  });
});
