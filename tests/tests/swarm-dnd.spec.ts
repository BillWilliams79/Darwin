import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';
import { dndKitDrag, dndKitTouchDrag, touchSwipe } from '../helpers/dnd-kit-drag';

/**
 * SwarmView cards — requirement rows, category cards, the aggregator and the
 * project tabs on the hold-to-lift press timeline (req #3663, dnd-kit; the
 * rules are req #2417's, memory/architecture.md § SwarmView Requirement-Row DnD):
 *
 *   SDND-01  hand mode, same card: reorder persists sort_order
 *   SDND-02  hand → hand across cards: category_fk AND the target's sort_order
 *   SDND-03  hand → process: category_fk only; the card highlights while hovered
 *   SDND-04  process mode, same card: no reorder, nothing written
 *   SDND-05  process → process across cards
 *   SDND-06  a drop on the aggregator is no drop
 *   SDND-07  FROM the aggregator into a card: it moves, and stays in the aggregator
 *   SDND-08  the template row never lifts (a press there lifts its card)
 *   SDND-09  a drop on itself writes nothing
 *   SDND-10  pressing ON THE TITLE TEXT lifts the row; the preview is the row
 *   SDND-11  a quick click on the title only places the caret
 *   SDND-12  carried onto another project's tab: switches, lands, persists
 *   SDND-13  Esc after a tab hover-switch: back on the first project, nothing written
 *   SDND-14  a category card reorders in its project and the order persists
 *   SDTOUCH  phone: hold lifts and reorders; a quick swipe scrolls
 *
 * Every drag is real input (trusted pointer, CDP touch). Serial: the tests share
 * beforeAll data and modify it.
 */
test.describe.serial('SwarmView DnD — cards (dnd-kit)', () => {
  test.setTimeout(90000);

  let idToken: string;
  let projectId: string;
  let otherProjectId: string;
  let cat1Id: string;
  let cat2Id: string;
  let cat3Id: string;
  let farCatId: string;
  const projectName = uniqueName('DnDProj');
  const otherProjectName = uniqueName('DnDProj2');

  // 3 requirements in cat1 for same-card reorder tests
  let req1Id: string;
  let req2Id: string;
  let req3Id: string;
  const req1Title = uniqueName('R1');
  const req2Title = uniqueName('R2');
  const req3Title = uniqueName('R3');
  // 1 requirement in cat2
  let req4Id: string;
  // cross-card requirement (created in cat1, moved around)
  let crossReqId: string;
  // swarm_ready requirement for the aggregator
  let readyReqId: string;

  const sub = () => process.env.E2E_TEST_COGNITO_SUB!;
  const post = async (table: string, body: object) => {
    const r = await apiCall(table, 'POST', { creator_fk: sub(), ...body }, idToken) as Array<{ id: string }>;
    if (!r?.length) throw new Error(`Failed to create ${table}`);
    return r[0].id;
  };

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    projectId = await post('projects', { project_name: projectName, closed: 0, sort_order: 990 });
    otherProjectId = await post('projects', { project_name: otherProjectName, closed: 0, sort_order: 991 });
    cat1Id = await post('categories', { category_name: uniqueName('DnDCat1'), project_fk: projectId, closed: 0, sort_order: 0, sort_mode: 'hand' });
    cat2Id = await post('categories', { category_name: uniqueName('DnDCat2'), project_fk: projectId, closed: 0, sort_order: 1, sort_mode: 'process' });
    cat3Id = await post('categories', { category_name: uniqueName('DnDCat3'), project_fk: projectId, closed: 0, sort_order: 2, sort_mode: 'reverse' });
    farCatId = await post('categories', { category_name: uniqueName('DnDFar'), project_fk: otherProjectId, closed: 0, sort_order: 0, sort_mode: 'hand' });
    req1Id = await post('requirements', { title: req1Title, category_fk: cat1Id, requirement_status: 'authoring', sort_order: 0 });
    req2Id = await post('requirements', { title: req2Title, category_fk: cat1Id, requirement_status: 'authoring', sort_order: 1 });
    req3Id = await post('requirements', { title: req3Title, category_fk: cat1Id, requirement_status: 'authoring', sort_order: 2 });
    req4Id = await post('requirements', { title: uniqueName('R4'), category_fk: cat2Id, requirement_status: 'authoring' });
    crossReqId = await post('requirements', { title: uniqueName('Cross'), category_fk: cat1Id, requirement_status: 'authoring', sort_order: 10 });
    readyReqId = await post('requirements', { title: uniqueName('Ready'), category_fk: cat3Id, requirement_status: 'swarm_ready' });
  });

  test.afterAll(async () => {
    // CASCADE handles categories + requirements when a project is deleted
    try { await apiDelete('projects', projectId, idToken); } catch {}
    try { await apiDelete('projects', otherProjectId, idToken); } catch {}
  });

  async function reset() {
    await apiCall('categories', 'PUT', [
      { id: cat1Id, sort_mode: 'hand', sort_order: 0, project_fk: parseInt(projectId) },
      { id: cat2Id, sort_mode: 'process', sort_order: 1, project_fk: parseInt(projectId) },
      { id: cat3Id, sort_mode: 'reverse', sort_order: 2, project_fk: parseInt(projectId) },
    ], idToken);
    await apiCall('requirements', 'PUT', [
      { id: req1Id, sort_order: 0, category_fk: parseInt(cat1Id) },
      { id: req2Id, sort_order: 1, category_fk: parseInt(cat1Id) },
      { id: req3Id, sort_order: 2, category_fk: parseInt(cat1Id) },
      { id: crossReqId, sort_order: 10, category_fk: parseInt(cat1Id) },
      { id: req4Id, category_fk: parseInt(cat2Id) },
      { id: readyReqId, category_fk: parseInt(cat3Id) },
    ], idToken);
  }

  /** Open the cards view on the test project (`?project=` deep link, req #3663). */
  async function open(page: Page, aggregator = false) {
    await page.goto(`/swarm?view=cards&project=${projectId}${aggregator ? '&aggregator=1' : ''}`);
    await expect(card(page, cat1Id).getByTestId(`requirement-${req1Id}`)).toBeVisible({ timeout: 30000 });
  }

  const card = (page: Page, id: string) => page.getByTestId(`category-card-${id}`);
  // A requirement row in whichever category card holds it (never its aggregator copy).
  const row = (page: Page, id: string) =>
    page.locator(`[data-testid^="category-card-"] [data-testid="requirement-${id}"]`);
  const aggregator = (page: Page) => page.locator('[role="tabpanel"]:not([hidden])').getByTestId('swarm-start-card');
  const projectTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

  /** Requirement titles in a category card in DOM order (excluding the template). */
  async function titles(page: Page, categoryId: string): Promise<string[]> {
    return card(page, categoryId)
      .locator('[data-testid^="requirement-"]:not([data-testid="requirement-template"]) [name="title"]')
      .evaluateAll(els => els.map(e => (e as HTMLTextAreaElement).value));
  }

  const count = (page: Page, categoryId: string) =>
    card(page, categoryId).locator('[data-testid^="requirement-"]:not([data-testid="requirement-template"])').count();

  const countPuts = async (page: Page, table: string) => {
    const counter = { puts: 0 };
    await page.route(`**/${table}*`, r => { if (r.request().method() === 'PUT') counter.puts++; r.continue(); });
    return counter;
  };

  const fetchReq = async (id: string) =>
    ((await apiCall(`requirements?id=${id}`, 'GET', '', idToken)) as Array<Record<string, any>>)[0];

  // ─── Rows ─────────────────────────────────────────────────────────────────

  test('SDND-01: hand mode, same card — reorder persists sort_order', async ({ page }) => {
    await reset();
    await open(page);
    expect(await titles(page, cat1Id)).toEqual(expect.arrayContaining([req1Title, req2Title, req3Title]));
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/requirements'));
    await dndKitDrag(page, row(page, req1Id), row(page, req3Id));
    await put;
    await expect.poll(async () => {
      const t = await titles(page, cat1Id);
      return [t.indexOf(req2Title), t.indexOf(req3Title), t.indexOf(req1Title)];
    }, { timeout: 10000 }).toEqual([0, 1, 2]);
    expect(await count(page, cat1Id)).toBe(4);
    // Persisted.
    expect((await fetchReq(req1Id)).sort_order).toBe(2);
    await expect(page.locator('[data-dragging="true"]')).toHaveCount(0);
  });

  test('SDND-02: hand → hand across cards — category_fk AND the target\'s sort_order', async ({ page }) => {
    await reset();
    await apiCall('categories', 'PUT', [{ id: cat2Id, sort_mode: 'hand' }], idToken);
    await open(page);
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/requirements'));
    await dndKitDrag(page, row(page, crossReqId), card(page, cat2Id).getByTestId(`requirement-${req4Id}`), { drop: 'upper' });
    const body = JSON.parse((await put).request().postData() || '[]');
    await expect(card(page, cat2Id).getByTestId(`requirement-${crossReqId}`)).toBeVisible({ timeout: 10000 });
    await expect(card(page, cat1Id).getByTestId(`requirement-${crossReqId}`)).toHaveCount(0);
    // Both rows of the target are renumbered; the moved one carries its new category.
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: Number(crossReqId), category_fk: Number(cat2Id) }),
      expect.objectContaining({ id: Number(req4Id), sort_order: expect.any(Number) }),
    ]));
    const moved = await fetchReq(crossReqId);
    expect(String(moved.category_fk)).toBe(String(cat2Id));
  });

  test('SDND-03: hand → process — category_fk only; the target card highlights while hovered', async ({ page }) => {
    await reset();
    await open(page);
    const before = await fetchReq(crossReqId);
    const source = row(page, crossReqId);
    const target = card(page, cat2Id);
    const s = (await source.boundingBox())!;
    const t = (await target.boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2 + 8, s.y + s.height / 2 + 8);
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(s.x + (t.x + t.width / 2 - s.x) * i / 12, s.y + (t.y + t.height / 2 - s.y) * i / 12);
      await page.waitForTimeout(16);
    }
    await expect(target).toHaveAttribute('data-drop-highlight', 'true');
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/requirements'));
    await page.mouse.up();
    const body = JSON.parse((await put).request().postData() || '[]');
    expect(body).toEqual([{ id: Number(crossReqId), category_fk: Number(cat2Id) }]);
    await expect(card(page, cat2Id).getByTestId(`requirement-${crossReqId}`)).toBeVisible({ timeout: 10000 });
    await expect.poll(() => count(page, cat1Id)).toBe(3);
    const after = await fetchReq(crossReqId);
    expect(after.sort_order).toBe(before.sort_order);
  });

  test('SDND-04: process mode, same card — no reorder, nothing written', async ({ page }) => {
    await reset();
    await apiCall('categories', 'PUT', [{ id: cat1Id, sort_mode: 'process' }], idToken);
    await open(page);
    const initial = await titles(page, cat1Id);
    const counter = await countPuts(page, 'requirements');
    await dndKitDrag(page, row(page, req1Id), row(page, req3Id));
    await page.waitForTimeout(500);
    expect(counter.puts).toBe(0);
    expect(await titles(page, cat1Id)).toEqual(initial);
  });

  test('SDND-05: process → reverse across cards — category_fk only', async ({ page }) => {
    await reset();
    await open(page);
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/requirements'));
    await dndKitDrag(page, card(page, cat2Id).getByTestId(`requirement-${req4Id}`), card(page, cat3Id));
    const body = JSON.parse((await put).request().postData() || '[]');
    expect(body).toEqual([{ id: Number(req4Id), category_fk: Number(cat3Id) }]);
    await expect(card(page, cat3Id).getByTestId(`requirement-${req4Id}`)).toBeVisible({ timeout: 10000 });
    await expect.poll(() => count(page, cat2Id)).toBe(0);
  });

  test('SDND-06: a drop on the aggregator is no drop', async ({ page }) => {
    await reset();
    await open(page, true);
    await expect(aggregator(page)).toBeVisible({ timeout: 10000 });
    const counter = await countPuts(page, 'requirements');
    await dndKitDrag(page, row(page, req1Id), aggregator(page));
    await page.waitForTimeout(500);
    expect(counter.puts).toBe(0);
    await expect(card(page, cat1Id).getByTestId(`requirement-${req1Id}`)).toBeVisible();
    expect(await count(page, cat1Id)).toBe(4);
  });

  test('SDND-07: FROM the aggregator into a card — it moves, and stays in the aggregator', async ({ page }) => {
    await reset();
    await open(page, true);
    await aggregator(page).getByTestId('swarm-start-chip-swarm_ready').click();
    const aggRow = aggregator(page).getByTestId(`requirement-${readyReqId}`);
    await expect(aggRow).toBeVisible({ timeout: 15000 });
    await expect(card(page, cat3Id).getByTestId(`requirement-${readyReqId}`)).toBeVisible();
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/requirements'));
    await dndKitDrag(page, aggRow, card(page, cat2Id));
    const body = JSON.parse((await put).request().postData() || '[]');
    expect(body).toEqual([{ id: Number(readyReqId), category_fk: Number(cat2Id) }]);
    await expect(card(page, cat2Id).getByTestId(`requirement-${readyReqId}`)).toBeVisible({ timeout: 10000 });
    await expect(card(page, cat3Id).getByTestId(`requirement-${readyReqId}`)).toHaveCount(0);
    // The aggregator lists by status — the moved requirement is still swarm_ready.
    await expect(aggRow).toBeVisible();
    expect(String((await fetchReq(readyReqId)).category_fk)).toBe(String(cat2Id));
  });

  test('SDND-08: the template row never lifts — a press on it is a press on its card', async ({ page }) => {
    await reset();
    await open(page);
    const counter = await countPuts(page, 'requirements');
    const template = card(page, cat1Id).getByTestId('requirement-template');
    const b = (await template.boundingBox())!;
    const target = (await row(page, req2Id).boundingBox())!;
    await page.mouse.move(b.x + 12, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 30, b.y + b.height / 2, { epics: 4 });
    await page.mouse.move(target.x + 20, target.y + 10, { epics: 8 });
    // The template row is never the lifted item (the category card is, as on
    // the Plan view — the card lifts from anywhere that is not a draggable row).
    await expect(template).not.toHaveAttribute('data-dragging', 'true');
    await expect(card(page, cat1Id)).toHaveAttribute('data-dragging', 'true');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(counter.puts).toBe(0);
    await expect(page.locator('[data-dragging="true"]')).toHaveCount(0);
  });

  test('SDND-09: a drop on itself writes nothing', async ({ page }) => {
    await reset();
    await open(page);
    const counter = await countPuts(page, 'requirements');
    await dndKitDrag(page, row(page, req2Id), row(page, req2Id));
    await page.waitForTimeout(500);
    expect(counter.puts).toBe(0);
    expect(await titles(page, cat1Id)).toContain(req2Title);
  });

  test('SDND-10: pressing ON THE TITLE TEXT lifts the row; neighbours slide; the preview is the row', async ({ page }) => {
    await reset();
    await open(page);
    const source = row(page, req1Id);
    const field = source.locator('[name="title"]');
    const fb = (await field.boundingBox())!;
    const target = (await row(page, req3Id).boundingBox())!;
    const sb = (await source.boundingBox())!;
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.mouse.down();
    await page.mouse.move(fb.x + fb.width / 2 + 3, fb.y + fb.height / 2 + 3);
    await page.mouse.move(fb.x + fb.width / 2 + 8, fb.y + fb.height / 2 + 8);
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2 + (target.y - sb.y) * i / 10);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(300);
    const overlay = page.getByTestId('drag-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('textarea').first()).toHaveValue(req1Title);
    // A neighbour has slid up into the space the lifted row left.
    const slid = await row(page, req2Id).evaluate(el => getComputedStyle(el).transform);
    expect(slid).not.toBe('none');
    await page.mouse.up();
    await expect.poll(async () => (await titles(page, cat1Id)).indexOf(req1Title), { timeout: 10000 }).toBe(2);
  });

  test('SDND-11: a quick click on the title only places the caret', async ({ page }) => {
    await reset();
    await open(page);
    const counter = await countPuts(page, 'requirements');
    const field = row(page, req2Id).locator('[name="title"]');
    await field.click();
    await expect(field).toBeFocused();
    await page.waitForTimeout(400);
    expect(counter.puts).toBe(0);
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
  });

  // ─── Across project tabs ──────────────────────────────────────────────────

  test('SDND-12: carried onto another project\'s tab — switches, lands in its card, persists', async ({ page }) => {
    await reset();
    await open(page);
    await projectTab(page, otherProjectName).scrollIntoViewIfNeeded();
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/requirements'));
    await dndKitDrag(page, row(page, crossReqId), projectTab(page, otherProjectName), {
      holdOverTargetMs: 900,
      then: card(page, farCatId),
    });
    await put;
    await expect(projectTab(page, otherProjectName)).toHaveAttribute('aria-selected', 'true');
    await expect(card(page, farCatId).getByTestId(`requirement-${crossReqId}`)).toBeVisible();
    expect(String((await fetchReq(crossReqId)).category_fk)).toBe(String(farCatId));
  });

  test('SDND-13: Esc after a tab hover-switch — back on the first project, nothing written', async ({ page }) => {
    await reset();
    await open(page);
    const counter = await countPuts(page, 'requirements');
    await projectTab(page, otherProjectName).scrollIntoViewIfNeeded();
    await dndKitDrag(page, row(page, req2Id), projectTab(page, otherProjectName), {
      holdOverTargetMs: 900,
      then: card(page, farCatId),
      cancelWithEscape: true,
    });
    await expect(projectTab(page, projectName)).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(500);
    expect(counter.puts).toBe(0);
    await expect(page.locator('[data-dragging="true"]')).toHaveCount(0);
  });

  // ─── Category cards ───────────────────────────────────────────────────────

  test('SDND-14: a category card reorders in its project and the order persists', async ({ page }) => {
    await reset();
    await open(page);
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/categories'));
    // Grab the card by its header, not one of its rows (a row lifts itself).
    await dndKitDrag(page, card(page, cat3Id).locator('.card-header'), card(page, cat1Id), { drop: 'left' });
    await put;
    const cats = (await apiCall(`categories?project_fk=${projectId}`, 'GET', '', idToken)) as Array<{ id: string; sort_order: number }>;
    const order = [...cats].sort((a, b) => a.sort_order - b.sort_order).map(c => String(c.id));
    expect(order.indexOf(String(cat3Id))).toBeLessThan(order.indexOf(String(cat1Id)));
  });
});

test.describe.serial('SwarmView DnD — touch (dnd-kit)', () => {
  test.use({ hasTouch: true, viewport: { width: 412, height: 780 } });
  test.setTimeout(90000);
  let idToken: string;
  const sub = () => process.env.E2E_TEST_COGNITO_SUB!;
  let projectId: string, catId: string;
  const reqs: { id: string; title: string }[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
    const post = async (table: string, body: object) =>
      ((await apiCall(table, 'POST', { creator_fk: sub(), ...body }, idToken)) as Array<{ id: string }>)[0].id;
    projectId = await post('projects', { project_name: uniqueName('SwarmTouch'), closed: 0, sort_order: 992 });
    catId = await post('categories', { category_name: uniqueName('Hand'), project_fk: projectId, closed: 0, sort_order: 0, sort_mode: 'hand' });
    // Enough rows that the page scrolls at phone height.
    for (let i = 0; i < 16; i++) {
      const title = uniqueName(`T${i}`);
      reqs.push({ id: await post('requirements', { title, category_fk: catId, requirement_status: 'authoring', sort_order: i }), title });
    }
  });

  test.afterAll(async () => {
    try { await apiDelete('projects', projectId, idToken); } catch {}
  });

  async function open(page: Page) {
    await page.goto(`/swarm?view=cards&project=${projectId}`);
    await page.waitForSelector(`[data-testid="requirement-${reqs[0].id}"]`, { timeout: 30000 });
  }
  const titles = (page: Page) => page.getByTestId(`category-card-${catId}`)
    .locator('[data-testid^="requirement-"]:not([data-testid="requirement-template"]) [name="title"]')
    .evaluateAll(els => els.map(e => (e as HTMLTextAreaElement).value));

  test('SDTOUCH-01: hold still to lift, then drag — the row reorders', async ({ page }) => {
    await open(page);
    await dndKitTouchDrag(page, page.getByTestId(`requirement-${reqs[0].id}`), page.getByTestId(`requirement-${reqs[2].id}`));
    await expect.poll(() => titles(page), { timeout: 10000 }).toEqual(
      [reqs[1].title, reqs[2].title, reqs[0].title, ...reqs.slice(3).map(r => r.title)]);
  });

  test('SDTOUCH-02: a quick swipe on a row scrolls the page and never lifts it', async ({ page }) => {
    await open(page);
    let puts = 0;
    await page.route('**/requirements*', r => { if (r.request().method() === 'PUT') puts++; r.continue(); });
    const before = await page.evaluate(() => window.scrollY);
    await touchSwipe(page, page.getByTestId(`requirement-${reqs[6].id}`), -260);
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 50);
    expect(puts).toBe(0);
  });
});
