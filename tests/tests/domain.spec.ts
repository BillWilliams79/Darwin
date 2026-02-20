import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe('Domain Management', () => {
  // Track domains created during tests for cleanup
  const createdDomainIds: string[] = [];
  let idToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
  });

  test.afterAll(async () => {
    // Hard-delete test domains (ON DELETE CASCADE handles child areas/tasks)
    for (const id of createdDomainIds) {
      try {
        await apiDelete('domains', id, idToken);
      } catch { /* best-effort cleanup */ }
    }
  });

  test('DOM-01: create domain via dialog', async ({ page }) => {
    const domainName = uniqueName('Domain');

    await page.goto('/taskcards');
    // Wait for domains to load
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Click the "+" tab to open DomainAddDialog (last tab, has no text — just the add icon)
    await page.locator('[role="tab"]').last().click();

    // Wait for and interact with DomainAddDialog
    const dialog = page.getByTestId('domain-add-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Type domain name and press Enter
    await dialog.locator('input').fill(domainName);
    await dialog.locator('input').press('Enter');

    // Verify dialog closes and domain tab appears
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('tab', { name: domainName })).toBeVisible({ timeout: 5000 });

    // Extract domain id from the new tab's area card for cleanup
    // Navigate to the new domain tab and check for an area-card-template
    await page.getByRole('tab', { name: domainName }).click();
    await page.waitForTimeout(1000);

    // Get the domain ID from the API for cleanup
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const domains = await apiCall(
      `domains?creator_fk=${sub}&closed=0&domain_name=${encodeURIComponent(domainName)}`,
      'GET', '', idToken,
    ) as Array<{ id: string }>;
    if (domains?.length) {
      createdDomainIds.push(domains[0].id);
    }
  });

  test('DOM-02: close domain tab', async ({ page }) => {
    const domainName = uniqueName('CloseMe');

    // Create domain via API for this test
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domainName, closed: 0,
    }, idToken) as Array<{ id: string }>;

    let domainId: string | undefined;
    if (Array.isArray(result) && result.length) {
      domainId = result[0].id;
      createdDomainIds.push(domainId);
    }

    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // The new domain should appear as a tab
    const domainTab = page.getByRole('tab', { name: domainName });
    await expect(domainTab).toBeVisible({ timeout: 5000 });

    // Click the CloseIcon inside the domain tab
    // The CloseIcon is the tab's icon prop (rendered as SVG inside the tab)
    await domainTab.locator('svg').click();

    // Confirm in DomainCloseDialog
    const closeDialog = page.getByTestId('domain-close-dialog');
    await expect(closeDialog).toBeVisible();
    await closeDialog.getByRole('button', { name: 'Close Tab' }).click();

    // Verify domain tab is removed
    await expect(domainTab).not.toBeVisible({ timeout: 5000 });
  });
});
