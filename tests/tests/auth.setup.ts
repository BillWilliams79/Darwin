import { test as setup, expect } from '@playwright/test';
import { getAuthTokens, buildProfileFromToken } from '../helpers/auth';
import { cleanupStaleData, apiCall } from '../helpers/api';

const STORAGE_STATE = '.auth/user.json';

setup('authenticate', async ({ page }) => {
  const tokens = await getAuthTokens();
  // Fetch the full DB profile so AuthContext gets correct profile.name, profile.id, etc.
  // Without this, profile is built from JWT only (no name, no DB id) and profile tests fail.
  // The Cognito app client has a secret, so refreshToken silent refresh fails (no SECRET_HASH).
  // AuthContext falls back to the profile COOKIE — make that cookie contain the full DB profile.
  const jwtPayload = JSON.parse(Buffer.from(tokens.idToken.split('.')[1], 'base64url').toString());
  const cognitoUsername = jwtPayload['cognito:username'] as string;
  let fullProfile = buildProfileFromToken(tokens.idToken) as Record<string, unknown>;
  let dbProfileJson = JSON.stringify(fullProfile);
  try {
    const profileResult = await apiCall(`profiles?id=${encodeURIComponent(cognitoUsername)}`, 'GET', '', tokens.idToken) as Array<Record<string, unknown>>;
    if (Array.isArray(profileResult) && profileResult.length > 0) {
      // DB profile lacks userName — AuthContext fallback path needs it for AuthenticatedRoute
      fullProfile = { ...profileResult[0], userName: cognitoUsername };
      dbProfileJson = JSON.stringify(fullProfile);
    }
  } catch { /* best-effort */ }

  // Navigate to the app first so we can set cookies on the correct origin
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Set cookies via document.cookie matching how react-cookie (universal-cookie) stores them.
  // universal-cookie serializes objects as "j:" + JSON.stringify(value), then URL-encodes.
  // Use the full DB profile in the cookie so AuthContext's legacy fallback path has correct data.
  const profileCookie = encodeURIComponent(`j:${JSON.stringify(fullProfile)}`);

  await page.evaluate(({ idToken, accessToken, refreshToken, profileCookie, dbProfileJson }) => {
    // Set refresh token cookie — AuthContext's silent refresh uses this on page load
    document.cookie = `refreshToken=${refreshToken}; path=/; max-age=${90 * 86400}; SameSite=Strict`;
    // Also set legacy cookies — the E2E api helper reads idToken from cookies,
    // and AuthContext will populate from silent refresh on reload
    document.cookie = `idToken=${idToken}; path=/; max-age=86100`;
    document.cookie = `accessToken=${accessToken}; path=/; max-age=86100`;
    // Profile cookie contains full DB profile (name, id, timezone, region, etc.)
    document.cookie = `profile=${profileCookie}; path=/; max-age=86100`;
    // Also cache in localStorage for AuthContext's primary refresh path
    localStorage.setItem('darwin-profile', dbProfileJson);
  }, { idToken: tokens.idToken, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, profileCookie, dbProfileJson });

  // Clean up stale E2E data from prior interrupted runs
  const cleanup = await cleanupStaleData(tokens.idToken);
  const total = cleanup.domains + cleanup.projects + cleanup.sessions;
  if (total > 0) {
    console.log(`Pre-test cleanup: ${cleanup.domains} domains, ${cleanup.projects} projects, ${cleanup.sessions} sessions deleted`);
  }

  // Verify authentication works by loading a protected route
  await page.goto('/taskcards');
  await expect(page).toHaveURL(/\/taskcards/, { timeout: 10000 });

  // Save authenticated state for other tests
  await page.context().storageState({ path: STORAGE_STATE });
});
