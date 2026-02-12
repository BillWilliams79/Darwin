import { test as setup, expect } from '@playwright/test';
import { getAuthTokens, buildProfileFromToken } from '../helpers/auth';

const STORAGE_STATE = '.auth/user.json';

setup('authenticate', async ({ page }) => {
  const tokens = await getAuthTokens();
  const profile = buildProfileFromToken(tokens.idToken);

  // Navigate to the app first so we can set cookies on the correct origin
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Set cookies via document.cookie matching how react-cookie (universal-cookie) stores them.
  // universal-cookie serializes objects as "j:" + JSON.stringify(value), then URL-encodes.
  const profileCookie = encodeURIComponent(`j:${JSON.stringify(profile)}`);

  await page.evaluate(({ idToken, accessToken, refreshToken, profileCookie }) => {
    // Set refresh token cookie — AuthContext's silent refresh uses this on page load
    document.cookie = `refreshToken=${refreshToken}; path=/; max-age=${90 * 86400}; SameSite=Strict`;
    // Also set legacy cookies — the E2E api helper reads idToken from cookies,
    // and AuthContext will populate from silent refresh on reload
    document.cookie = `idToken=${idToken}; path=/; max-age=86100`;
    document.cookie = `accessToken=${accessToken}; path=/; max-age=86100`;
    document.cookie = `profile=${profileCookie}; path=/; max-age=86100`;
  }, { idToken: tokens.idToken, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, profileCookie });

  // Verify authentication works by loading a protected route
  await page.goto('/taskcards');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

  // Save authenticated state for other tests
  await page.context().storageState({ path: STORAGE_STATE });
});
