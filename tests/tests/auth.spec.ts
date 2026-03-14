import { test, expect } from '@playwright/test';

// Auth tests use fresh browser context — no pre-existing cookies.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('AUTH-02: unauthenticated users redirected to login', async ({ page }) => {
    await page.goto('/taskcards');
    await expect(page).toHaveURL(/\/login/);
  });

  // AUTH-01: Full browser login flow through Darwin custom login page.
  // Uses USER_SRP_AUTH via amazon-cognito-identity-js (no Cognito hosted UI redirect).
  // Requires ALLOW_USER_SRP_AUTH enabled on Cognito app client 8s82usrcfe58mllbceiavfcd2.
  test('AUTH-01: full login via custom Darwin login page', async ({ page }) => {
    test.setTimeout(60_000);

    // Navigate to profile — shows Log In button when unauthenticated
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');

    // Click Log In → navigates to /login (custom Darwin form, stays on-domain)
    const loginBtn = page.getByTestId('login-button');
    await expect(loginBtn).toBeVisible({ timeout: 15000 });
    await loginBtn.click();

    // Should be on the custom login page (not Cognito hosted UI)
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });

    // Fill Darwin custom login form
    await page.getByTestId('login-email').fill(process.env.E2E_TEST_USERNAME!);
    await page.getByTestId('login-password').fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByTestId('login-submit').click();

    // SRP auth → loginWithTokens → JWT validate → profile fetch → navigate to /taskcards
    await expect(page).toHaveURL(/\/taskcards/, { timeout: 30000 });

    // Verify protected route is accessible (Plan view renders domain tabs)
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });

    // Verify in-session navigation to protected route works
    await page.getByRole('link', { name: /plan/i }).click();
    await expect(page).toHaveURL(/\/taskcards/);
  });
});
