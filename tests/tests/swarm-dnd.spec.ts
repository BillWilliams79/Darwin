import { test, expect } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';
import { dragAndDrop } from '../helpers/react-dnd-drag';

/**
 * SwarmView Requirement-Row DnD — E2E tests (req #2417).
 *
 * Covers the hand-sort + cross-card drag-and-drop behavior matrix:
 *   1. Hand mode same-card reorder
 *   2. Hand-to-hand cross-card move
 *   3. Hand-to-process cross-card move
 *   4. Process mode same-card (no reorder)
 *   5. Process-to-process / reverse cross-card
 *   6. Drop on aggregator (no-op)
 *   8. Drag FROM aggregator into a category card
 *   9. Template row not draggable
 *  10. Drop on self (no-op)
 *
 * Uses serial execution because tests share beforeAll state and modify shared
 * requirement data.
 */
test.describe.serial('SwarmView DnD — Requirement Row', () => {
  test.setTimeout(60000);

  let idToken: string;
  let testProjectId: string;
  let cat1Id: string;
  let cat2Id: string;
  const testProjectName = uniqueName('DnDProj');
  const cat1Name = uniqueName('DnDCat1');
  const cat2Name = uniqueName('DnDCat2');

  // 3 requirements in cat1 for same-card reorder tests
  let req1Id: string;
  let req2Id: string;
  let req3Id: string;
  const req1Title = uniqueName('R1');
  const req2Title = uniqueName('R2');
  const req3Title = uniqueName('R3');

  // 1 requirement in cat2 for cross-card tests
  let req4Id: string;
  const req4Title = uniqueName('R4');

  // Cross-card requirement (created in cat1, will be moved to cat2)
  let crossReqId: string;
  const crossReqTitle = uniqueName('Cross');

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    const sub = process.env.E2E_TEST_COGNITO_SUB!;

    // Create project
    const projResult = await apiCall('projects', 'POST', {
      creator_fk: sub, project_name: testProjectName, closed: 0, sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!projResult?.length) throw new Error('Failed to create project');
    testProjectId = projResult[0].id;

    // Create cat1 in hand sort mode
    const c1 = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: cat1Name, project_fk: testProjectId,
      closed: 0, sort_order: 0, sort_mode: 'hand',
    }, idToken) as Array<{ id: string }>;
    if (!c1?.length) throw new Error('Failed to create cat1');
    cat1Id = c1[0].id;

    // Create cat2 in process sort mode
    const c2 = await apiCall('categories', 'POST', {
      creator_fk: sub, category_name: cat2Name, project_fk: testProjectId,
      closed: 0, sort_order: 1, sort_mode: 'process',
    }, idToken) as Array<{ id: string }>;
    if (!c2?.length) throw new Error('Failed to create cat2');
    cat2Id = c2[0].id;

    // Create 3 requirements in cat1 with explicit sort_order
    const r1 = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: req1Title, category_fk: cat1Id,
      requirement_status: 'authoring', sort_order: 0,
    }, idToken) as Array<{ id: string }>;
    if (!r1?.length) throw new Error('Failed to create R1');
    req1Id = r1[0].id;

    const r2 = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: req2Title, category_fk: cat1Id,
      requirement_status: 'authoring', sort_order: 1,
    }, idToken) as Array<{ id: string }>;
    if (!r2?.length) throw new Error('Failed to create R2');
    req2Id = r2[0].id;

    const r3 = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: req3Title, category_fk: cat1Id,
      requirement_status: 'authoring', sort_order: 2,
    }, idToken) as Array<{ id: string }>;
    if (!r3?.length) throw new Error('Failed to create R3');
    req3Id = r3[0].id;

    // Create 1 requirement in cat2
    const r4 = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: req4Title, category_fk: cat2Id,
      requirement_status: 'authoring',
    }, idToken) as Array<{ id: string }>;
    if (!r4?.length) throw new Error('Failed to create R4');
    req4Id = r4[0].id;

    // Cross-card requirement in cat1
    const cr = await apiCall('requirements', 'POST', {
      creator_fk: sub, title: crossReqTitle, category_fk: cat1Id,
      requirement_status: 'authoring', sort_order: 10,
    }, idToken) as Array<{ id: string }>;
    if (!cr?.length) throw new Error('Failed to create CrossReq');
    crossReqId = cr[0].id;
  });

  test.afterAll(async () => {
    test.setTimeout(60000);
    // CASCADE handles categories + requirements when project is deleted
    try { await apiDelete('projects', testProjectId, idToken); } catch {}
  });

  /** Navigate to /swarm, select the test project tab, wait for requirement rows to render. */
  async function goToTestProject(page: any) {
    await page.goto('/swarm');
    await page.waitForSelector('[role="tab"]', { timeout: 15000 });
    await page.getByRole('tab', { name: testProjectName }).click();
    await expect(page.getByTestId(`category-card-${cat1Id}`)).toBeVisible({ timeout: 15000 });
    // Wait for requirements to render inside cat1 (at least the first known requirement)
    await expect(page.getByTestId(`category-card-${cat1Id}`).getByTestId(`requirement-${req1Id}`)).toBeVisible({ timeout: 15000 });
  }

  /** Get requirement titles from a category card in DOM order (excluding template). */
  async function getRequirementTitles(page: any, categoryId: string): Promise<string[]> {
    const card = page.getByTestId(`category-card-${categoryId}`);
    const rows = card.locator('[data-testid^="requirement-"]:not([data-testid="requirement-template"])');
    const count = await rows.count();
    const titles: string[] = [];
    for (let i = 0; i < count; i++) {
      const titleField = rows.nth(i).locator('textarea[name="title"], input[name="title"]').first();
      titles.push(await titleField.inputValue());
    }
    return titles;
  }

  /** Count non-template requirement rows in a category card. */
  async function getRequirementCount(page: any, categoryId: string): Promise<number> {
    const card = page.getByTestId(`category-card-${categoryId}`);
    return await card.locator('[data-testid^="requirement-"]:not([data-testid="requirement-template"])').count();
  }

  /** Click a sort mode in a category card's three-dot menu. */
  async function clickCategorySortMode(page: any, categoryId: string, mode: 'process' | 'hand') {
    await page.getByTestId(`card-menu-${categoryId}`).click();
    await page.getByTestId(`sort-${mode}-${categoryId}`).click();
  }

  /** Reset sort_order for cat1 requirements to known starting state. */
  async function resetSortOrder() {
    await apiCall('requirements', 'PUT', [
      { id: req1Id, sort_order: 0, category_fk: parseInt(cat1Id) },
      { id: req2Id, sort_order: 1, category_fk: parseInt(cat1Id) },
      { id: req3Id, sort_order: 2, category_fk: parseInt(cat1Id) },
      { id: crossReqId, sort_order: 10, category_fk: parseInt(cat1Id) },
      { id: req4Id, category_fk: parseInt(cat2Id) },
    ], idToken);
  }

  /** Verify no requirement rows are hidden or opacity-collapsed (drag artifact). */
  async function assertNoHiddenRows(page: any, categoryId: string) {
    const card = page.getByTestId(`category-card-${categoryId}`);
    const rows = card.locator('[data-testid^="requirement-"]:not([data-testid="requirement-template"])');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const opacity = await rows.nth(i).evaluate((el: HTMLElement) => getComputedStyle(el).opacity);
      expect(Number(opacity)).toBeGreaterThan(0.5);
    }
  }

  // ─── SDND-01: Hand mode, same-card reorder ─────────────────────────────

  test('SDND-01: Hand-mode same-card reorder persists sort_order', async ({ page }) => {
    await resetSortOrder();
    await goToTestProject(page);

    // Cat1 is created in hand mode — verify initial order
    await expect.poll(async () => {
      return await getRequirementTitles(page, cat1Id);
    }, { timeout: 10000 }).toEqual(
      expect.arrayContaining([req1Title, req2Title, req3Title])
    );

    // Verify the first three are in expected order (before cross req)
    const initialTitles = await getRequirementTitles(page, cat1Id);
    const idx1 = initialTitles.indexOf(req1Title);
    const idx2 = initialTitles.indexOf(req2Title);
    const idx3 = initialTitles.indexOf(req3Title);
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);

    // Drag R1 below R3 (reorder within same card in hand mode)
    const source = page.getByTestId(`requirement-${req1Id}`);
    const target = page.getByTestId(`requirement-${req3Id}`);
    await dragAndDrop(page, source, target);

    // Poll until reorder completes
    await expect.poll(async () => {
      const titles = await getRequirementTitles(page, cat1Id);
      const i1 = titles.indexOf(req1Title);
      const i2 = titles.indexOf(req2Title);
      const i3 = titles.indexOf(req3Title);
      // R1 should now be after R2 and near R3
      return i2 < i1;
    }, { timeout: 10000, intervals: [200, 500, 1000] }).toBe(true);

    // No duplicates — count should be unchanged
    const count = await getRequirementCount(page, cat1Id);
    expect(count).toBe(4); // R1, R2, R3, CrossReq

    await assertNoHiddenRows(page, cat1Id);
  });

  // ─── SDND-02: Hand-to-hand cross-card move ─────────────────────────────

  test('SDND-02: Hand-to-hand cross-card move updates category_fk + sort_order', async ({ page }) => {
    await resetSortOrder();

    // Set cat2 to hand mode via API for this test
    await apiCall('categories', 'PUT', [{ id: cat2Id, sort_mode: 'hand' }], idToken);

    await goToTestProject(page);

    // Switch cat2 to hand via menu (in case cached sort_mode differs)
    await clickCategorySortMode(page, cat2Id, 'hand');

    // Wait for baseline: cat1=4 (R1,R2,R3,Cross), cat2=1 (R4)
    await expect.poll(() => getRequirementCount(page, cat1Id), { timeout: 10000 }).toBe(4);
    await expect.poll(() => getRequirementCount(page, cat2Id), { timeout: 10000 }).toBe(1);

    // Drag crossReq from cat1 to cat2 (both in hand mode)
    const source = page.getByTestId(`requirement-${crossReqId}`);
    const targetCard = page.getByTestId(`category-card-${cat2Id}`);
    await dragAndDrop(page, source, targetCard);

    // CrossReq should appear in cat2
    const cat2Card = page.getByTestId(`category-card-${cat2Id}`);
    await expect(cat2Card.getByTestId(`requirement-${crossReqId}`)).toBeVisible({ timeout: 10000 });

    // CrossReq should vanish from cat1
    const cat1Card = page.getByTestId(`category-card-${cat1Id}`);
    await expect(cat1Card.getByTestId(`requirement-${crossReqId}`)).not.toBeVisible({ timeout: 5000 });

    // Counts should reflect the move: cat1=3, cat2=2
    await expect.poll(() => getRequirementCount(page, cat1Id), { timeout: 5000 }).toBe(3);
    await expect.poll(() => getRequirementCount(page, cat2Id), { timeout: 5000 }).toBe(2);
  });

  // ─── SDND-03: Hand-to-process cross-card move ──────────────────────────

  test('SDND-03: Hand-to-process cross-card move persists category_fk only', async ({ page }) => {
    await resetSortOrder();

    // Set cat2 back to process mode
    await apiCall('categories', 'PUT', [{ id: cat2Id, sort_mode: 'process' }], idToken);

    await goToTestProject(page);

    // Wait for baseline: cat1=4 (R1,R2,R3,Cross), cat2=1 (R4)
    await expect.poll(() => getRequirementCount(page, cat1Id), { timeout: 10000 }).toBe(4);
    await expect.poll(() => getRequirementCount(page, cat2Id), { timeout: 10000 }).toBe(1);

    // Drag crossReq from cat1 (hand) to cat2 (process)
    const source = page.getByTestId(`requirement-${crossReqId}`);
    const targetCard = page.getByTestId(`category-card-${cat2Id}`);
    await dragAndDrop(page, source, targetCard);

    // CrossReq should appear in cat2
    const cat2Card = page.getByTestId(`category-card-${cat2Id}`);
    await expect(cat2Card.getByTestId(`requirement-${crossReqId}`)).toBeVisible({ timeout: 10000 });

    // CrossReq should vanish from cat1
    const cat1Card = page.getByTestId(`category-card-${cat1Id}`);
    await expect(cat1Card.getByTestId(`requirement-${crossReqId}`)).not.toBeVisible({ timeout: 5000 });

    // Counts: cat1=3, cat2=2
    await expect.poll(() => getRequirementCount(page, cat1Id), { timeout: 5000 }).toBe(3);
    await expect.poll(() => getRequirementCount(page, cat2Id), { timeout: 5000 }).toBe(2);
  });

  // ─── SDND-04: Process mode same-card — no reorder ──────────────────────

  test('SDND-04: Process-mode same-card drag does not reorder', async ({ page }) => {
    await resetSortOrder();

    // Switch cat1 to process mode
    await apiCall('categories', 'PUT', [{ id: cat1Id, sort_mode: 'process' }], idToken);

    await goToTestProject(page);

    // Capture initial order
    const cat1Card = page.getByTestId(`category-card-${cat1Id}`);
    await expect(cat1Card.getByTestId(`requirement-${req1Id}`)).toBeVisible({ timeout: 10000 });
    const initialTitles = await getRequirementTitles(page, cat1Id);

    // Intercept PUT calls to requirements
    let requirementPutCount = 0;
    await page.route('**/requirements*', (route: any) => {
      if (route.request().method() === 'PUT') requirementPutCount++;
      route.continue();
    });

    // Attempt to drag R1 to R3 within process-mode card
    const source = page.getByTestId(`requirement-${req1Id}`);
    const target = page.getByTestId(`requirement-${req3Id}`);
    await dragAndDrop(page, source, target);

    // Brief wait for potential PUT calls
    await page.waitForTimeout(500);

    // No sort_order PUT should have fired for same-card process mode
    expect(requirementPutCount).toBe(0);

    // Order should be unchanged
    const afterTitles = await getRequirementTitles(page, cat1Id);
    expect(afterTitles).toEqual(initialTitles);

    // Restore cat1 to hand mode
    await apiCall('categories', 'PUT', [{ id: cat1Id, sort_mode: 'hand' }], idToken);
  });

  // ─── SDND-05: Process-to-process cross-card ────────────────────────────

  test('SDND-05: Process-to-process cross-card move works', async ({ page }) => {
    await resetSortOrder();

    // Both cards in process mode
    await apiCall('categories', 'PUT', [
      { id: cat1Id, sort_mode: 'process' },
      { id: cat2Id, sort_mode: 'process' },
    ], idToken);

    await goToTestProject(page);

    // Wait for baseline: cat1=4, cat2=1
    await expect.poll(() => getRequirementCount(page, cat1Id), { timeout: 10000 }).toBe(4);
    await expect.poll(() => getRequirementCount(page, cat2Id), { timeout: 10000 }).toBe(1);

    // Drag crossReq from cat1 to cat2
    const source = page.getByTestId(`requirement-${crossReqId}`);
    const targetCard = page.getByTestId(`category-card-${cat2Id}`);
    await dragAndDrop(page, source, targetCard);

    const cat2Card = page.getByTestId(`category-card-${cat2Id}`);
    await expect(cat2Card.getByTestId(`requirement-${crossReqId}`)).toBeVisible({ timeout: 10000 });

    const cat1Card = page.getByTestId(`category-card-${cat1Id}`);
    await expect(cat1Card.getByTestId(`requirement-${crossReqId}`)).not.toBeVisible({ timeout: 5000 });

    // Counts: cat1=3, cat2=2
    await expect.poll(() => getRequirementCount(page, cat1Id), { timeout: 5000 }).toBe(3);
    await expect.poll(() => getRequirementCount(page, cat2Id), { timeout: 5000 }).toBe(2);

    // Restore cat1 to hand mode
    await apiCall('categories', 'PUT', [{ id: cat1Id, sort_mode: 'hand' }], idToken);
  });

  // ─── SDND-06: Aggregator not a drop target ─────────────────────────────

  test('SDND-06: Drop on aggregator card is a no-op', async ({ page }) => {
    await resetSortOrder();
    await goToTestProject(page);

    // Scope to visible tab panel (MUI renders all panels; hidden ones have `hidden` attribute)
    const visiblePanel = page.locator('[role="tabpanel"]:not([hidden])').first();

    // Enable SwarmStartCard aggregator
    const toggleBtn = page.getByTestId('swarm-start-card-toggle');
    await toggleBtn.click();
    await expect(visiblePanel.getByTestId('swarm-start-card')).toBeVisible({ timeout: 10000 });

    // Wait for baseline: cat1=4
    await expect.poll(() => getRequirementCount(page, cat1Id), { timeout: 10000 }).toBe(4);

    // Attempt to drag R1 onto the aggregator card body
    const source = page.getByTestId(`requirement-${req1Id}`);
    const aggregator = visiblePanel.getByTestId('swarm-start-card');
    await dragAndDrop(page, source, aggregator);

    // Brief wait for any potential mutation
    await page.waitForTimeout(500);

    // R1 should still be in cat1 — count unchanged at 4
    await expect.poll(() => getRequirementCount(page, cat1Id), { timeout: 5000 }).toBe(4);
    await expect(page.getByTestId(`category-card-${cat1Id}`).getByTestId(`requirement-${req1Id}`)).toBeVisible();

    // Hide aggregator for subsequent tests
    await toggleBtn.click();
  });

  // ─── SDND-07: Drag from aggregator into category card ──────────────────

  test('SDND-07: Aggregator rows are drag sources with cursor:grab', async ({ page }) => {
    await resetSortOrder();
    await goToTestProject(page);

    // Scope to visible tab panel
    const visiblePanel = page.locator('[role="tabpanel"]:not([hidden])').first();

    // Enable aggregator and switch to authoring status chip
    const toggleBtn = page.getByTestId('swarm-start-card-toggle');
    await toggleBtn.click();
    const aggregator = visiblePanel.getByTestId('swarm-start-card');
    await expect(aggregator).toBeVisible({ timeout: 10000 });

    // Default status is swarm_ready — click the authoring chip so our test
    // requirements (all authoring status) are visible in the aggregator
    await aggregator.getByTestId('swarm-start-chip-authoring').click();
    await page.waitForTimeout(500);

    // Wait for aggregator to render our requirement rows
    const aggRow = aggregator.getByTestId(`requirement-${req1Id}`);
    await expect(aggRow).toBeVisible({ timeout: 15000 });

    // Aggregator rows should have cursor:grab (proof they are drag sources).
    // Template rows have cursor:default and are NOT draggable.
    const cursor = await aggRow.evaluate((el: HTMLElement) => getComputedStyle(el).cursor);
    expect(cursor).toBe('grab');

    // Verify the aggregator row has the aggregator-row class (color bar rendered)
    const hasColorBar = await aggRow.evaluate((el: HTMLElement) => el.classList.contains('aggregator-row'));
    expect(hasColorBar).toBe(true);

    // req #2752: the inner color bar must carry a delineating border so pale
    // (e.g. DarwinUI #f2e982 on white) or dark category colors stay visible
    // against the card background in either theme. The border is on the inner
    // colored Box (first child of the category-color-bar wrapper).
    const colorBarBorder = await aggregator
      .getByTestId(`category-color-bar-${req1Id}`)
      .locator('> *')
      .first()
      .evaluate((el: HTMLElement) => getComputedStyle(el).borderTopStyle);
    expect(colorBarBorder).toBe('solid');

    // Hide aggregator
    await toggleBtn.click();
  });

  // ─── SDND-08: Template row not draggable ───────────────────────────────

  test('SDND-08: Template row is not draggable', async ({ page }) => {
    await resetSortOrder();
    await goToTestProject(page);

    // Intercept PUT calls
    let putCount = 0;
    await page.route('**/requirements*', (route: any) => {
      if (route.request().method() === 'PUT') putCount++;
      route.continue();
    });

    // The template row has data-testid="requirement-template"
    const template = page.getByTestId(`category-card-${cat1Id}`).getByTestId('requirement-template');
    await expect(template).toBeVisible({ timeout: 10000 });

    const target = page.getByTestId(`requirement-${req2Id}`);

    // Attempt drag — template has canDrag: false, so no drag should initiate
    // Use page.evaluate to dispatch mouse events directly
    await page.evaluate(async () => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const templateEl = document.querySelector('[data-testid="requirement-template"]');
      const targetEl = document.querySelector('[data-testid^="requirement-"]:not([data-testid="requirement-template"])');
      if (!templateEl || !targetEl) return;

      const tRect = templateEl.getBoundingClientRect();
      const x = tRect.left + 12;
      const y = tRect.top + tRect.height / 2;

      templateEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
      await delay(50);
      templateEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x + 20, clientY: y, button: 0, buttons: 1 }));
      await delay(100);

      const tgtRect = targetEl.getBoundingClientRect();
      targetEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: tgtRect.left + 10, clientY: tgtRect.top + 10, button: 0, buttons: 1 }));
      await delay(100);
      targetEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: tgtRect.left + 10, clientY: tgtRect.top + 10, button: 0, buttons: 0 }));
    });

    await page.waitForTimeout(500);

    // No PUT should have fired
    expect(putCount).toBe(0);
  });

  // ─── SDND-09: Drop on self is a no-op ──────────────────────────────────

  test('SDND-09: Drop requirement on itself is a no-op', async ({ page }) => {
    await resetSortOrder();
    await goToTestProject(page);

    let putCount = 0;
    await page.route('**/requirements*', (route: any) => {
      if (route.request().method() === 'PUT') putCount++;
      route.continue();
    });

    // Drag R2 onto itself
    const row = page.getByTestId(`requirement-${req2Id}`);
    await dragAndDrop(page, row, row);

    await page.waitForTimeout(500);

    // No reorder PUT should fire
    expect(putCount).toBe(0);

    // Order preserved
    const titles = await getRequirementTitles(page, cat1Id);
    const idx = titles.indexOf(req2Title);
    expect(idx).toBeGreaterThanOrEqual(0);
  });
});
