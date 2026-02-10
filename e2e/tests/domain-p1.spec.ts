import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe('Domain Management P1', () => {
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
    await page.goto('/domainedit');
    await page.waitForSelector('table', { timeout: 10000 });

    // Find the row with our domain name — each domain is a table row with a TextField
    const nameField = page.locator(`input[name="domain-name"]`).filter({ has: page.locator(`[value="${domainName}"]`) });

    // Fall back: find all domain-name inputs and locate the one with our value
    const allNameFields = page.locator('input[name="domain-name"]');
    const count = await allNameFields.count();
    let targetField = null;
    for (let i = 0; i < count; i++) {
      const val = await allNameFields.nth(i).inputValue();
      if (val === domainName) {
        targetField = allNameFields.nth(i);
        break;
      }
    }
    expect(targetField).not.toBeNull();

    // Clear and type new name
    await targetField!.fill(updatedName);
    await targetField!.blur();

    // Wait for PUT to complete
    await page.waitForTimeout(1000);

    // Verify persists on reload
    await page.reload();
    await page.waitForSelector('table', { timeout: 10000 });

    // Find the field with the updated name
    const allFieldsAfter = page.locator('input[name="domain-name"]');
    const countAfter = await allFieldsAfter.count();
    let foundUpdated = false;
    for (let i = 0; i < countAfter; i++) {
      const val = await allFieldsAfter.nth(i).inputValue();
      if (val === updatedName) {
        foundUpdated = true;
        break;
      }
    }
    expect(foundUpdated).toBe(true);
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
    await page.goto('/domainedit');
    await page.waitForSelector('table', { timeout: 10000 });

    // Find the row with our domain name
    const allNameFields = page.locator('input[name="domain-name"]');
    const count = await allNameFields.count();
    let targetRow = null;
    for (let i = 0; i < count; i++) {
      const val = await allNameFields.nth(i).inputValue();
      if (val === domainName) {
        // The row is the closest <tr> ancestor
        targetRow = allNameFields.nth(i).locator('xpath=ancestor::tr');
        break;
      }
    }
    expect(targetRow).not.toBeNull();

    // Click the delete icon (DeleteIcon button) in the row
    await targetRow!.locator('button:has(svg[data-testid="DeleteIcon"])').click();

    // DomainDeleteDialog should appear
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog).toBeVisible({ timeout: 5000 });
    await expect(deleteDialog).toContainText('Delete Domain?');

    // Click Delete to confirm
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    // Verify domain row is removed from the table
    await page.waitForTimeout(1000);
    const allFieldsAfter = page.locator('input[name="domain-name"]');
    const countAfter = await allFieldsAfter.count();
    let foundDeleted = false;
    for (let i = 0; i < countAfter; i++) {
      const val = await allFieldsAfter.nth(i).inputValue();
      if (val === domainName) {
        foundDeleted = true;
        break;
      }
    }
    expect(foundDeleted).toBe(false);
  });
});
