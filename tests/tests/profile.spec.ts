import { test, expect } from '@playwright/test';

test.describe('Profile', () => {
  test('PROF-01: navigate to profile page via bike icon link', async ({ page }) => {
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Click the bike icon link in the NavBar (Link to="/profile" wrapping PedalBikeIcon)
    await page.locator('a[href="/profile"]').click();

    // Verify navigation to /profile
    await expect(page).toHaveURL(/\/profile/);

    // Profile.jsx renders 5 TextFields: Name, E-mail, Region, User Pool ID, Cognito Identifier
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });
    const textFields = page.locator('.MuiTextField-root');
    await expect(textFields).toHaveCount(5);

    // Verify profile labels are present
    await expect(page.locator('body')).toContainText('Name');
    await expect(page.locator('body')).toContainText('mail');
  });

  test('PROF-02: profile page via direct navigation', async ({ page }) => {
    // Navigate directly to /profile route
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Profile.jsx renders 5 TextFields: Name, E-mail, Region, User Pool ID, Cognito Identifier
    const textFields = page.locator('.MuiTextField-root');
    await expect(textFields).toHaveCount(5);

    // Verify profile labels are present
    await expect(page.locator('body')).toContainText('Name');
    await expect(page.locator('body')).toContainText('mail');
  });
});
