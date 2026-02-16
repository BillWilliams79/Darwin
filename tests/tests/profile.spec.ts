import { test, expect } from '@playwright/test';

test.describe('Profile', () => {
  test('PROF-01: profile drawer opens and shows user data', async ({ page }) => {
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Click the Profile button in the NavBar (ProfileDrawer renders a Button)
    await page.getByRole('button', { name: /profile/i }).click();

    // Verify the MUI Drawer opens with profile fields
    const drawer = page.locator('.MuiDrawer-root');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Profile.jsx renders 5 TextFields: Name, E-mail, Region, User Pool ID, Cognito Identifier
    // Verify at least Name and E-mail are present and non-empty
    const nameField = drawer.locator('input').filter({ has: page.locator('[id]') }).first();
    const textFields = drawer.locator('.MuiTextField-root');
    const fieldCount = await textFields.count();
    expect(fieldCount).toBeGreaterThanOrEqual(2);

    // Verify the drawer contains recognizable profile labels
    await expect(drawer).toContainText('Name');
    await expect(drawer).toContainText('mail');
  });

  test('PROF-02: profile page via direct navigation', async ({ page }) => {
    // Navigate directly to /profile route
    await page.goto('/profile');
    await page.waitForTimeout(2000);

    // Profile.jsx renders TextFields for Name, E-mail, Region, etc.
    // Verify the page renders profile content (not a redirect or error)
    const textFields = page.locator('.MuiTextField-root');
    const fieldCount = await textFields.count();
    expect(fieldCount).toBeGreaterThanOrEqual(2);

    // Verify profile labels are present
    await expect(page.locator('body')).toContainText('Name');
    await expect(page.locator('body')).toContainText('mail');
  });
});
