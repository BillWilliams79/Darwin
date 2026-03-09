import { test, expect } from '@playwright/test';

// Auth tests use fresh browser context — no pre-existing cookies.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('AUTH-02: unauthenticated users redirected to login', async ({ page }) => {
    await page.goto('/taskcards');
    await expect(page).toHaveURL(/\/login/);
  });

  // AUTH-01: Full browser login flow through Cognito hosted UI.
  // Requires HTTPS (Cognito redirect needs SSL). Works on production and localhost with basicSsl.
  test('AUTH-01: full login via Cognito hosted UI', async ({ page }) => {
    // Multi-redirect flow through external service needs generous timeout
    test.setTimeout(60_000);

    // Unauthenticated / → redirects to /profile which shows Log In button
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    // Wait for React app to render before clicking
    const loginBtn = page.getByTestId('login-button');
    await expect(loginBtn).toBeVisible({ timeout: 15000 });
    await loginBtn.click();

    // Should redirect to Cognito hosted UI
    await expect(page).toHaveURL(/amazoncognito\.com/, { timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');

    // Cognito hosted UI has duplicate form fields (desktop/mobile).
    // The visible ones are the last instances on larger viewports.
    await page.locator('input[name="username"]:visible').fill(process.env.E2E_TEST_USERNAME!);
    await page.locator('input[name="password"]:visible').fill(process.env.E2E_TEST_PASSWORD!);
    await page.locator('input[name="signInSubmitButton"]:visible').click();

    // Auth code flow: Cognito redirects to /loggedin?code=xxx → token exchange → /taskcards.
    // Wait for final authenticated state — URL should NOT be /login or /loggedin.
    await expect(page).not.toHaveURL(/\/(login|loggedin)/, { timeout: 30000 });
    // Verify protected route is accessible (Plan view renders domain tabs)
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });

    // Verify in-session navigation to protected route works (SPA navigation, no reload)
    // Sidebar nav uses ListItemButton (role="link") with label "Plan"
    await page.getByRole('link', { name: /plan/i }).click();
    await expect(page).toHaveURL(/\/taskcards/);
  });
});
