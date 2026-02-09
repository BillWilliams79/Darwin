import { test, expect } from '@playwright/test';

// Auth tests use fresh browser context — no pre-existing cookies.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('AUTH-02: unauthenticated users redirected to login', async ({ page }) => {
    await page.goto('/taskcards');
    await expect(page).toHaveURL(/\/login/);
  });

  // AUTH-01 requires HTTPS: Cognito redirects to https://localhost:3000/loggedin/ (from
  // REACT_APP_LOGIN_REDIRECT) but the CRA dev server serves HTTP. The redirect fails with
  // chrome-error://chromewebdata/. To enable: run CRA with HTTPS=true, or test against
  // production (darwin.one). The programmatic auth in auth.setup.ts validates token acquisition.
  test.skip('AUTH-01: full login via Cognito hosted UI', async ({ page }) => {
    await page.goto('/');

    // Click login link on home page ("Login / Create Account")
    await page.getByRole('link', { name: /login/i }).click();

    // Should redirect to Cognito hosted UI
    await expect(page).toHaveURL(/amazoncognito\.com/, { timeout: 10000 });

    // Cognito hosted UI has duplicate form fields (desktop/mobile).
    // The visible ones are the last instances on larger viewports.
    await page.locator('input[name="username"]:visible').fill(process.env.E2E_TEST_USERNAME!);
    await page.locator('input[name="password"]:visible').fill(process.env.E2E_TEST_PASSWORD!);
    await page.locator('input[name="signInSubmitButton"]:visible').click();

    // Cognito redirects to /loggedin with hash params.
    // LoggedIn component validates JWT, fetches profile, sets cookies, then redirects.
    await page.waitForURL('**/loggedin**', { timeout: 15000 });

    // Wait for the redirect away from /loggedin (JWT validation + profile fetch)
    await expect(page).not.toHaveURL(/\/loggedin/, { timeout: 15000 });

    // Verify authenticated state: LoggedIn sets React context (idToken, profile)
    // and redirects to "/". The HomePage shows "Logout" when idToken is set.
    // Note: cookies use secure:true so they won't persist on HTTP localhost,
    // but React context is set for the SPA session.
    await expect(page).toHaveURL(/localhost:3000/, { timeout: 5000 });
    await expect(page.getByRole('link', { name: /logout/i })).toBeVisible({ timeout: 10000 });

    // Verify in-session navigation to protected route works (SPA navigation, no reload)
    await page.getByRole('link', { name: /plan/i }).click();
    await expect(page).toHaveURL(/\/taskcards/);
  });
});
