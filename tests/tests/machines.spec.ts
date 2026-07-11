import { test, expect } from '@playwright/test';

// Req #2943 — Machines management page (/swarm/machines). Loads the DataGrid of
// registered machines; Name is inline-editable. Data comes from darwin_dev
// (dev/prod split) — seed 2-3 machines rows before running the rename test.

test.describe('Machines View', () => {
  test('MACH-01: /swarm/machines renders DataGrid', async ({ page }) => {
    await page.goto('/swarm/machines');
    await expect(page.getByTestId('machines-datagrid')).toBeVisible({ timeout: 10000 });
  });

  test('MACH-02: Machines navbar link navigates correctly', async ({ page }) => {
    await page.goto('/taskcards');
    await page.getByRole('link', { name: /^machines$/i }).click();
    await expect(page).toHaveURL(/\/swarm\/machines/);
    await expect(page.getByTestId('machines-datagrid')).toBeVisible({ timeout: 10000 });
  });

  test('MACH-03: Machines page shows heading', async ({ page }) => {
    await page.goto('/swarm/machines');
    await expect(page.getByRole('heading', { name: 'Machines' })).toBeVisible({ timeout: 10000 });
  });

  test('MACH-04: inline rename persists across reload (requires ≥1 seeded machine)', async ({ page }) => {
    await page.goto('/swarm/machines');
    await expect(page.getByTestId('machines-datagrid')).toBeVisible({ timeout: 10000 });

    // Find the first Name cell (data-testid machine-name-<id>). Skip if the dev
    // DB has no machines seeded — the load/nav tests above still cover the page.
    const nameCell = page.locator('[data-testid^="machine-name-"]').first();
    const count = await nameCell.count();
    test.skip(count === 0, 'no machines seeded in darwin_dev — seed before running rename test');

    const testid = await nameCell.getAttribute('data-testid');
    const original = (await nameCell.innerText()).trim();
    const renamed = `${original}-e2e`;

    // Enter edit mode on the Name column (single click starts edit via the grid's
    // onCellClick handler / double-click as fallback), type, commit with Enter.
    await nameCell.dblclick();
    const input = page.locator('input[type="text"]').first();
    await input.fill(renamed);
    await input.press('Enter');

    // Reload and confirm the new value stuck.
    await page.reload();
    await expect(page.getByTestId(testid!)).toHaveText(renamed, { timeout: 10000 });

    // Restore the original name to keep the fixture idempotent.
    const restored = page.getByTestId(testid!);
    await restored.dblclick();
    const input2 = page.locator('input[type="text"]').first();
    await input2.fill(original);
    await input2.press('Enter');
  });
});
