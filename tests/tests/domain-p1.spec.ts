import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName, navigateToDomainEdit, waitForDomainTable, findDomainIndex, getAllDomainNames } from '../helpers/api';

test.describe('Domain Management P1', () => {
  // DomainEdit renders 1000+ accumulated test domains with DnD — needs extra time.
  // DOM-03 does navigate + reload (two full page loads at ~45s each), so 180s.
  test.setTimeout(180_000);

  let idToken: string;
  const createdDomainIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
  });

  test.afterAll(async () => {
    for (const id of createdDomainIds) {
      try {
        await apiDelete('domains', id, idToken);
      } catch { /* best-effort cleanup */ }
    }
  });

  test('DOM-03: update domain name', async ({ page }) => {
    const domainName = uniqueName('EditDom');
    const updatedName = uniqueName('Renamed');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create domain via API
    const result = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domainName, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test domain');
    createdDomainIds.push(result[0].id);
    const domainId = result[0].id;

    // Navigate to DomainEdit
    await navigateToDomainEdit(page);

    // Find the row with our domain name using in-browser evaluation (fast with 1000+ domains)
    const idx = await findDomainIndex(page, domainName);
    expect(idx).toBeGreaterThan(-1);
    const targetField = page.locator('input[name="domain-name"]').nth(idx);

    // Clear and type new name
    await targetField.fill(updatedName);
    await targetField.blur();

    // Wait for PUT to complete
    await page.waitForTimeout(1000);

    // Verify persists on reload
    await page.reload();
    await waitForDomainTable(page);

    // Find the field with the updated name using in-browser evaluation
    const updatedIdx = await findDomainIndex(page, updatedName);
    expect(updatedIdx).toBeGreaterThan(-1);
  });

  test('DOM-04: hard delete domain', async ({ page }) => {
    const domainName = uniqueName('DeleteDom');
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create domain via API
    const result = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: domainName, closed: 0,
    }, idToken) as Array<{ id: string }>;
    if (!result?.length) throw new Error('Failed to create test domain');
    // Don't add to cleanup — we're deleting it in the test

    // Navigate to DomainEdit
    await navigateToDomainEdit(page);

    // Find the row with our domain name using in-browser evaluation
    const idx = await findDomainIndex(page, domainName);
    expect(idx).toBeGreaterThan(-1);
    const targetRow = page.locator('input[name="domain-name"]').nth(idx).locator('xpath=ancestor::tr');

    // Click the delete button (last cell's button in the row)
    await targetRow.locator('td:last-child button').click();

    // DomainDeleteDialog should appear
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog).toBeVisible({ timeout: 5000 });
    await expect(deleteDialog).toContainText('Delete Domain?');

    // Click Delete to confirm
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    // Verify domain row is removed from the table
    await page.waitForTimeout(1000);
    const deletedIdx = await findDomainIndex(page, domainName);
    expect(deletedIdx).toBe(-1);
  });
});
