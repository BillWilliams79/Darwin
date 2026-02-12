import { test, expect } from '@playwright/test';

test.describe('Authentication P1', () => {

  test('AUTH-03: logout clears session', async ({ page }) => {
    // Start authenticated (storageState has cookies)
    await page.goto('/taskcards');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

    // Navigate to home page to find logout link
    await page.goto('/');

    // The HomePage shows "Logout" as a link when idToken is set
    const logoutLink = page.getByRole('link', { name: /logout/i });
    await expect(logoutLink).toBeVisible({ timeout: 5000 });

    // LogoutLink component clears refreshToken cookie and redirects to Cognito logout URL.
    // Cognito logout URL is external (amazoncognito.com) — intercept the
    // external navigation to avoid leaving the test domain.
    await page.route('**/amazoncognito.com/**', route => {
      // Return a simple page instead of following the Cognito redirect
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>Logged out</body></html>',
      });
    });

    await logoutLink.click();

    // After LogoutLink renders, the refreshToken cookie should be cleared
    // and the page redirects to Cognito logout URL.
    await page.waitForTimeout(2000);

    // Verify cookies are cleared by navigating back to the app
    // and checking that auth guard blocks access
    await page.goto('/taskcards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  // Use fresh context — no pre-existing cookies
  test.describe('expired token', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('AUTH-04: expired/invalid token redirects to login', async ({ page }) => {
      // With no cookies at all (no refreshToken), AuthContext's silent refresh
      // will find nothing and set authLoading=false with null tokens.
      // AuthenticatedRoute will then redirect to /login.
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Set an invalid refresh token to simulate an expired session
      await page.evaluate(() => {
        document.cookie = 'refreshToken=invalid-expired-token; path=/; max-age=60; SameSite=Strict';
      });

      // Try to access a protected route
      await page.goto('/taskcards');

      // AuthenticatedRoute should redirect to /login because silent refresh
      // will fail with an invalid refresh token
      await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    });
  });
});
