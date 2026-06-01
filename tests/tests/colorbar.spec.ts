import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

/**
 * req #2752 — Aggregator category color bar visibility.
 *
 * The SwarmStartCard aggregator renders a category color bar to the left of
 * each requirement's #-chip. The bar fill is the requirement's origin-category
 * color. For a PALE category color (the trigger case: DarwinUI #f2e982) the
 * fill is correct but has ~1.25:1 contrast against the white light-mode card,
 * so the stripe reads as invisible.
 *
 * The fix keeps the true category color as the fill and adds a SAME-HUE
 * delineating border (a darkened shade of the fill in light mode, lightened in
 * dark mode) so the bar always shows up as its own category color — not washed
 * to gray. This test pins both halves of that contract:
 *   1. fill === the exact category color (#f2e982)
 *   2. border is solid AND a darker, same-hue (yellow) shade — never gray.
 */
test.describe.serial('req #2752 — aggregator color bar', () => {
  test.setTimeout(60000);

  let idToken: string;
  let projectId: string;
  let catId: string;
  let reqId: string;
  const projectName = uniqueName('ColorBarProj');
  const catName = uniqueName('ColorBarPale');
  const reqTitle = uniqueName('ColorBarReq');
  const PALE = '#f2e982'; // DarwinUI's pale yellow — the requirement's trigger case

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    const proj = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: projectName, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    projectId = proj[0].id;

    const cat = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: catName, project_fk: projectId,
      closed: 0, sort_order: 0, sort_mode: 'process', color: PALE,
    }, idToken) as Array<{ id: string }>;
    catId = cat[0].id;

    const r = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: reqTitle, category_fk: catId,
      requirement_status: 'development',
    }, idToken) as Array<{ id: string }>;
    reqId = r[0].id;
  });

  test.afterAll(async () => {
    if (projectId) await apiDelete('projects', projectId, idToken);
  });

  test('pale category color renders as fill + same-hue (non-gray) border', async ({ page }) => {
    await page.goto('/swarm');
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });
    await page.getByRole('tab', { name: projectName }).click();
    await expect(page.getByTestId(`category-card-${catId}`)).toBeVisible({ timeout: 15000 });

    const visiblePanel = page.locator('[role="tabpanel"]:not([hidden])').first();
    const toggleBtn = page.getByTestId('swarm-start-card-toggle');
    await toggleBtn.click();
    const aggregator = visiblePanel.getByTestId('swarm-start-card');
    await expect(aggregator).toBeVisible({ timeout: 10000 });

    // Our requirement is development status — switch to that chip.
    await aggregator.getByTestId('swarm-start-chip-development').click();
    const aggRow = aggregator.getByTestId(`requirement-${reqId}`);
    await expect(aggRow).toBeVisible({ timeout: 15000 });

    const bar = aggregator.getByTestId(`category-color-bar-${reqId}`).locator('> *').first();
    const style = await bar.evaluate((el: HTMLElement) => {
      const cs = getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        borderTopStyle: cs.borderTopStyle,
        borderTopColor: cs.borderTopColor,
      };
    });

    // 1) Fill is the EXACT category color — the true hue is preserved, not adjusted.
    expect(style.backgroundColor).toBe('rgb(242, 233, 130)');

    // 2) A solid delineating border is present so the pale stripe shows up.
    expect(style.borderTopStyle).toBe('solid');

    // 3) The border is a SAME-HUE shade (yellow), not a flat gray. Parse the rgb
    //    and assert it is (a) yellow-ish — red & green both clearly exceed blue —
    //    and (b) darker than the pale fill, so it reads against the white card.
    const m = style.borderTopColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    expect(m).not.toBeNull();
    const [r, g, b] = [Number(m![1]), Number(m![2]), Number(m![3])];
    // Yellow hue: red and green dominate blue by a wide margin (a gray edge
    // would have r ≈ g ≈ b and fail this).
    expect(r - b).toBeGreaterThan(40);
    expect(g - b).toBeGreaterThan(40);
    // Darker than the #f2e982 fill (242/233/130) so it contrasts on white.
    expect(r).toBeLessThan(242);
    expect(g).toBeLessThan(233);
  });
});
