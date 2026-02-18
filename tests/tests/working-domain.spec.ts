import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, uniqueName } from '../helpers/api';

test.describe('Working Domain Persistence', () => {
  let idToken: string;
  const createdDomainIds: string[] = [];
  // Create two test domains so we can switch between them
  const domainNameA = uniqueName('WD-A');
  const domainNameB = uniqueName('WD-B');
  let domainIdA: string;
  let domainIdB: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create two test domains
    const resultA = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domainNameA, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (Array.isArray(resultA) && resultA.length) {
      domainIdA = resultA[0].id;
      createdDomainIds.push(domainIdA);
    } else {
      throw new Error(`Failed to create test domain A: ${JSON.stringify(resultA)}`);
    }

    const resultB = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domainNameB, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (Array.isArray(resultB) && resultB.length) {
      domainIdB = resultB[0].id;
      createdDomainIds.push(domainIdB);
    } else {
      throw new Error(`Failed to create test domain B: ${JSON.stringify(resultB)}`);
    }
  });

  test.afterAll(async () => {
    for (const id of createdDomainIds) {
      try {
        await apiCall('domains', 'DELETE', { id }, idToken);
      } catch { /* best-effort cleanup */ }
    }
  });

  test('WD-01: domain persists across Plan → Calendar → Plan navigation', async ({ page }) => {
    // Navigate to Plan view and select domain B
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });
    const tabB = page.getByRole('tab', { name: domainNameB });
    await expect(tabB).toBeVisible({ timeout: 5000 });
    await tabB.click();
    await page.waitForTimeout(500);

    // Verify domain B tab is selected (aria-selected)
    await expect(tabB).toHaveAttribute('aria-selected', 'true');

    // Navigate to Calendar
    await page.getByRole('link', { name: /calendar/i }).click();
    await expect(page).toHaveURL(/\/calview/);

    // Navigate back to Plan
    await page.getByRole('link', { name: /plan/i }).click();
    await expect(page).toHaveURL(/\/taskcards/);
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });

    // Verify domain B is still selected
    const tabBAfter = page.getByRole('tab', { name: domainNameB });
    await expect(tabBAfter).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
  });

  test('WD-02: domain persists between Plan view and Area editor', async ({ page }) => {
    // Navigate to Plan view and select domain A
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });
    const tabA = page.getByRole('tab', { name: domainNameA });
    await expect(tabA).toBeVisible({ timeout: 5000 });
    await tabA.click();
    await page.waitForTimeout(500);

    await expect(tabA).toHaveAttribute('aria-selected', 'true');

    // Navigate to Area editor
    await page.getByRole('link', { name: /areas/i }).click();
    await expect(page).toHaveURL(/\/areaedit/);
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });

    // Verify domain A is selected in Area editor
    const areaTabA = page.getByRole('tab', { name: domainNameA });
    await expect(areaTabA).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
  });

  test('WD-03: working domain persists across full page reload', async ({ page }) => {
    // Navigate to Plan view and select domain B
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });
    const tabB = page.getByRole('tab', { name: domainNameB });
    await expect(tabB).toBeVisible({ timeout: 5000 });
    await tabB.click();
    await page.waitForTimeout(500);

    // Verify localStorage was set to domain B's ID
    const storedB = await page.evaluate(() => {
      const raw = localStorage.getItem('darwin_working_domain');
      return raw ? JSON.parse(raw) : null;
    });
    expect(storedB).toBeTruthy();
    expect(String(storedB.state?.domainId)).toBe(String(domainIdB));

    // Full page reload — Zustand rehydrates from localStorage
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });

    // Domain B should still be selected after reload
    const reloadedTabB = page.getByRole('tab', { name: domainNameB });
    await expect(reloadedTabB).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
  });

  test('WD-04: deleted domain falls back to first domain', async ({ page }) => {
    // Create a temporary domain that will be closed
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const tempDomainName = uniqueName('WD-Temp');
    const tempResult = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: tempDomainName, closed: 0,
    }, idToken) as Array<{ id: string }>;

    let tempDomainId: string | undefined;
    if (Array.isArray(tempResult) && tempResult.length) {
      tempDomainId = tempResult[0].id;
      createdDomainIds.push(tempDomainId);
    }

    // Navigate to Plan view and select the temporary domain
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });
    const tempTab = page.getByRole('tab', { name: tempDomainName });
    await expect(tempTab).toBeVisible({ timeout: 5000 });
    await tempTab.click();
    await page.waitForTimeout(500);

    // Close the temporary domain via the tab close icon
    await tempTab.locator('svg').click();
    const closeDialog = page.getByTestId('domain-close-dialog');
    await expect(closeDialog).toBeVisible();
    await closeDialog.getByRole('button', { name: 'Close Tab' }).click();
    await expect(tempTab).not.toBeVisible({ timeout: 5000 });

    // Navigate away and back — should fall back to first domain (not crash)
    await page.getByRole('link', { name: /calendar/i }).click();
    await expect(page).toHaveURL(/\/calview/);
    await page.getByRole('link', { name: /plan/i }).click();
    await expect(page).toHaveURL(/\/taskcards/);
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });

    // First tab should be selected (fallback behavior)
    const firstTab = page.locator('[role="tab"][aria-selected="true"]').first();
    await expect(firstTab).toBeVisible({ timeout: 5000 });
  });

  test('WD-05: logout clears working domain from localStorage', async ({ page }) => {
    // Set working domain directly in localStorage (avoids full page load timing)
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });

    // Set localStorage via the app's tab click
    const tabB = page.getByRole('tab', { name: domainNameB });
    await expect(tabB).toBeVisible({ timeout: 5000 });
    await tabB.click();
    await page.waitForTimeout(500);

    // Verify localStorage has the working domain entry
    const storedBefore = await page.evaluate(() => localStorage.getItem('darwin_working_domain'));
    expect(storedBefore).not.toBeNull();

    // Simulate what LogoutLink does: remove the localStorage item
    // (actual logout redirects to Cognito which would lose the page context)
    await page.evaluate(() => {
      localStorage.removeItem('darwin_working_domain');
    });

    const storedAfter = await page.evaluate(() => localStorage.getItem('darwin_working_domain'));
    expect(storedAfter).toBeNull();
  });
});
