import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

test.describe.serial('Area Management', () => {
  let idToken: string;
  let testDomainId: string;
  const testDomainName = uniqueName('AreaDomain');
  const createdAreaIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    // Create a test domain for area tests
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('domains', 'POST', {
      creator_fk: sub, domain_name: testDomainName, closed: 0,
    }, idToken) as Array<{ id: string }>;

    if (Array.isArray(result) && result.length) {
      testDomainId = result[0].id;
    } else {
      throw new Error(`Failed to create test domain. API returned: ${JSON.stringify(result)}`);
    }
  });

  test.afterAll(async () => {
    // Hard-delete the domain (ON DELETE CASCADE handles child areas/tasks)
    try { await apiDelete('domains', testDomainId, idToken); } catch { /* best-effort */ }
  });

  /** Navigate to TaskPlanView, select the test domain tab, return the visible panel. */
  async function goToTestDomain(page: import('@playwright/test').Page) {
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    // Wait for areas to load
    await page.waitForTimeout(1000);
    // All tab panels exist in the DOM but only the active one has hidden="false".
    // React renders hidden as a string, so non-hidden panels have no hidden attr.
    // Use :visible to find the active panel.
    return page.locator('[role="tabpanel"]:visible').first();
  }

  test('AREA-01: create area via template pattern', async ({ page }) => {
    const areaName = uniqueName('Area');
    const panel = await goToTestDomain(page);

    // Find the template area card within the active tab panel
    const templateCard = panel.getByTestId('area-card-template');
    await expect(templateCard).toBeVisible({ timeout: 5000 });

    // Type the area name in the template card's text field and press Enter.
    // The area name field uses multiline TextField which renders as <textarea>.
    const areaNameField = templateCard.locator('[name="area-name"]');
    await areaNameField.fill(areaName);
    await areaNameField.press('Enter');

    // Wait for the area to be created
    await page.waitForTimeout(1500);

    // Verify the area card exists with the name
    const areaCard = panel.locator('[data-testid^="area-card-"]').filter({ hasText: areaName });
    await expect(areaCard).toBeVisible({ timeout: 5000 });

    // A new blank template should appear
    await expect(panel.getByTestId('area-card-template')).toBeVisible();

    // Get area ID for cleanup
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const areas = await apiCall(
      `areas?creator_fk=${sub}&domain_fk=${testDomainId}&closed=0`,
      'GET', '', idToken,
    ) as Array<{ id: string; area_name: string }>;
    const created = areas?.find(a => a.area_name === areaName);
    if (created) createdAreaIds.push(created.id);
  });

  test('AREA-02: close area via card menu', async ({ page }) => {
    const areaName = uniqueName('CloseArea');

    // Create area via API
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const result = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: areaName, domain_fk: testDomainId, closed: 0, sort_order: 99,
    }, idToken) as Array<{ id: string }>;
    let areaId: string | undefined;
    if (Array.isArray(result) && result.length) {
      areaId = result[0].id;
      createdAreaIds.push(areaId);
    }

    const panel = await goToTestDomain(page);

    // Find the area card with our test area name
    const areaCard = panel.locator('[data-testid^="area-card-"]').filter({ hasText: areaName });
    await expect(areaCard).toBeVisible({ timeout: 5000 });

    // Open the triple-dot card menu
    await areaCard.locator(`[data-testid^="card-menu-"]`).click();

    // Click "Close Area" menu item
    const closeMenuItem = page.locator(`[data-testid^="menu-close-area-"]`);
    await expect(closeMenuItem).toBeVisible();
    await closeMenuItem.click();

    // Confirm in CardCloseDialog
    const closeDialog = page.getByTestId('card-close-dialog');
    await expect(closeDialog).toBeVisible();
    await closeDialog.getByRole('button', { name: 'Close Card' }).click();

    // Verify area card is removed
    await expect(areaCard).not.toBeVisible({ timeout: 5000 });
  });

  // @hello-pangea/dnd keyboard DnD requires active browser focus, which fails
  // when Playwright runs multiple headless browsers in parallel.
  // Passes in isolation (single worker) but not in full parallel suite.
  test.skip('AREA-03: DnD reorder areas in AreaEdit (@hello-pangea/dnd keyboard)', async ({ page }) => {
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const areaName1 = uniqueName('First');
    const areaName2 = uniqueName('Second');

    const r1 = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: areaName1, domain_fk: testDomainId, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    const r2 = await apiCall('areas', 'POST', {
      creator_fk: sub, area_name: areaName2, domain_fk: testDomainId, closed: 0, sort_order: 1,
    }, idToken) as Array<{ id: string }>;

    if (r1?.length) createdAreaIds.push(r1[0].id);
    if (r2?.length) createdAreaIds.push(r2[0].id);

    // Navigate to AreaEdit
    await page.goto('/areaedit');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Select test domain tab
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1000);

    // Find both rows and verify initial order (First before Second)
    const firstRow = page.getByTestId(`area-row-${r1[0].id}`);
    const secondRow = page.getByTestId(`area-row-${r2[0].id}`);
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    await expect(secondRow).toBeVisible({ timeout: 5000 });

    // Verify initial order: First is above Second in the DOM
    const initialFirstY = (await firstRow.boundingBox())!.y;
    const initialSecondY = (await secondRow.boundingBox())!.y;
    expect(initialFirstY).toBeLessThan(initialSecondY);

    // @hello-pangea/dnd keyboard DnD: focus → Space (lift) → ArrowUp (move) → Space (drop)
    // Generous waits needed — under parallel worker load, @hello-pangea/dnd
    // animations and keyboard listener setup require more time.
    await secondRow.focus();
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1000);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);

    // Verify order changed: Second should now be above First
    const afterFirstY = (await firstRow.boundingBox())!.y;
    const afterSecondY = (await secondRow.boundingBox())!.y;
    expect(afterSecondY).toBeLessThan(afterFirstY);

    // Verify persists on reload
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    await page.getByRole('tab', { name: testDomainName }).click();
    await page.waitForTimeout(1000);

    const reloadFirstY = (await page.getByTestId(`area-row-${r1[0].id}`).boundingBox())!.y;
    const reloadSecondY = (await page.getByTestId(`area-row-${r2[0].id}`).boundingBox())!.y;
    expect(reloadSecondY).toBeLessThan(reloadFirstY);
  });
});
