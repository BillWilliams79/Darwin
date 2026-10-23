import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName, navigateToDomainEdit } from '../helpers/api';
import {
  dndKitDrag, dndKitTouchDrag, dndKitKeyboardDrag, touchSwipe, LIFT_DELAY_MS,
} from '../helpers/dnd-kit-drag';

// req #3664 — the last @hello-pangea/dnd surfaces on the dnd-kit foundation:
// the Area, Domain, Category and Project editors, the Maps view bar, a test
// plan's cases, and the phone calendar list.
//
// One spec per thing the requirement says the user SEES: hold a row and it
// lifts, its neighbours slide aside, the order persists; closed rows and the
// template are not positions; the keyboard reorders; a drag near the edge of a
// long list scrolls it; on a phone a hold lifts while a quick swipe scrolls.
// Every drag is real input — trusted pointer, touch (CDP) and key events.

const sub = () => process.env.E2E_TEST_COGNITO_SUB!;

async function post(table: string, body: object, idToken: string) {
  const r = await apiCall(table, 'POST', { creator_fk: sub(), ...body }, idToken) as Array<{ id: string }>;
  if (!r?.length) throw new Error(`Failed to create ${table}`);
  return String(r[0].id);
}

async function tokenFor(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext({ storageState: '.auth/user.json' });
  const page = await context.newPage();
  const idToken = await getIdToken(page);
  await context.close();
  return idToken;
}

/** The names of a panel's area rows, top to bottom (template excluded). */
const areaNames = (page: Page) => page.locator('[role="tabpanel"]:not([hidden]) [data-testid^="area-row-"]:not([data-testid="area-row-template"]) input[name="area-name"]')
  .evaluateAll(els => els.map(e => (e as HTMLInputElement).value));

// ── The editors ─────────────────────────────────────────────────────────────

test.describe.serial('Editors drag and drop (dnd-kit)', () => {
  test.setTimeout(120000);
  let idToken: string;
  const domName = uniqueName('EdDnD');
  const longDomName = uniqueName('EdDnDLong');
  const projName = uniqueName('EdDnDProj');
  let domId: string, longDomId: string, projId: string;
  const open: { id: string; name: string }[] = [];
  const closed: { id: string; name: string }[] = [];
  const cats: { id: string; name: string }[] = [];
  const longAreas: { id: string; name: string }[] = [];

  test.beforeAll(async ({ browser }) => {
    idToken = await tokenFor(browser);
    domId = await post('domains', { domain_name: domName, closed: 0, sort_order: 99990 }, idToken);
    longDomId = await post('domains', { domain_name: longDomName, closed: 0, sort_order: 99991 }, idToken);
    projId = await post('projects', { project_name: projName, closed: 0, sort_order: 99990 }, idToken);
    for (let i = 0; i < 4; i++) {
      const name = uniqueName(`Open${i}`);
      open.push({ id: await post('areas', { area_name: name, domain_fk: domId, closed: 0, sort_order: i }, idToken), name });
    }
    for (let i = 0; i < 2; i++) {
      const name = uniqueName(`Closed${i}`);
      closed.push({ id: await post('areas', { area_name: name, domain_fk: domId, closed: 1, sort_order: null }, idToken), name });
    }
    for (let i = 0; i < 3; i++) {
      const name = uniqueName(`Cat${i}`);
      cats.push({ id: await post('categories', { category_name: name, project_fk: projId, closed: 0, sort_order: i }, idToken), name });
    }
    // Enough rows that the list runs well past the viewport.
    for (let i = 0; i < 30; i++) {
      const name = uniqueName(`Long${i}`);
      longAreas.push({ id: await post('areas', { area_name: name, domain_fk: longDomId, closed: 0, sort_order: i }, idToken), name });
    }
  });

  test.afterAll(async () => {
    try { await apiDelete('domains', domId, idToken); } catch {}
    try { await apiDelete('domains', longDomId, idToken); } catch {}
    try { await apiDelete('projects', projId, idToken); } catch {}
  });

  const resetAreas = () => apiCall('areas', 'PUT', open.map((a, i) => ({ id: a.id, sort_order: i })), idToken);

  async function openAreas(page: Page, name = domName) {
    await page.goto('/areaedit');
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name, exact: true }).click();
    await page.waitForSelector(`[role="tabpanel"]:not([hidden]) [data-testid="area-row-template"]`, { timeout: 15000 });
  }
  const areaRow = (page: Page, id: string) => page.getByTestId(`area-row-${id}`);

  test('EDND-01: pressing on the name lifts the area row; neighbours slide aside; the order persists', async ({ page }) => {
    await resetAreas();
    await openAreas(page);
    const source = areaRow(page, open[0].id);
    const field = source.locator('input[name="area-name"]');
    const fb = (await field.boundingBox())!;
    const target = (await areaRow(page, open[2].id).boundingBox())!;
    const srcBox = (await source.boundingBox())!;

    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.mouse.down();
    await page.mouse.move(fb.x + fb.width / 2 + 3, fb.y + fb.height / 2 + 3);
    await page.mouse.move(fb.x + fb.width / 2 + 8, fb.y + fb.height / 2 + 8);
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2 + (target.y - srcBox.y) * i / 10);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(300);

    // The lifted clone is the row itself; a passed sibling has slid up.
    const overlay = page.getByTestId('drag-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('input').first()).toHaveValue(open[0].name);
    const slid = await areaRow(page, open[1].id).evaluate(el => (el as HTMLElement).style.transform);
    expect(slid).toMatch(/translate3d\(0px, -\d/);

    const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/areas'));
    await page.mouse.up();
    await saved;
    const expected = [open[1].name, open[2].name, open[0].name, open[3].name, closed[0].name, closed[1].name];
    await expect.poll(() => areaNames(page), { timeout: 10000 }).toEqual(expected);
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: domName, exact: true }).click();
    await expect.poll(() => areaNames(page), { timeout: 10000 }).toEqual(expected);
  });

  test('EDND-02: closed rows and the template neither lift nor take a drop', async ({ page }) => {
    await resetAreas();
    await openAreas(page);
    let puts = 0;
    await page.route('**/areas*', r => { if (r.request().method() === 'PUT') puts++; r.continue(); });

    // A drag started on a closed row lifts nothing and writes nothing.
    await dndKitDrag(page, areaRow(page, closed[0].id), areaRow(page, open[0].id));
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
    // ...and from the template.
    await dndKitDrag(page, page.locator('[role="tabpanel"]:not([hidden])').getByTestId('area-row-template'), areaRow(page, open[0].id));
    expect(puts).toBe(0);

    // An open row carried down over the closed rows lands as the LAST open
    // row — never among them.
    await dndKitDrag(page, areaRow(page, open[0].id), areaRow(page, closed[1].id));
    await expect.poll(() => areaNames(page), { timeout: 10000 })
      .toEqual([open[1].name, open[2].name, open[3].name, open[0].name, closed[0].name, closed[1].name]);
    const rows = await apiCall(`areas?domain_fk=${domId}&fields=id,sort_order,closed`, 'GET', '', idToken) as Array<{ id: string; sort_order: number | null; closed: number }>;
    for (const c of closed) expect(rows.find(r => String(r.id) === c.id)?.sort_order).toBeNull();
  });

  test('EDND-03: a quick click on an area name edits it and moves nothing', async ({ page }) => {
    await resetAreas();
    await openAreas(page);
    let puts = 0;
    await page.route('**/areas*', r => { if (r.request().method() === 'PUT') puts++; r.continue(); });
    const field = areaRow(page, open[1].id).locator('input[name="area-name"]');
    await field.click();
    await expect(field).toBeFocused();
    await page.waitForTimeout(400);
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
    expect(puts).toBe(0);
  });

  test('EDND-04: keyboard — Space lifts a category, ArrowDown moves it, Space drops; the order persists', async ({ page }) => {
    await page.goto('/categoryedit');
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    await page.getByRole('tab', { name: projName, exact: true }).click();
    const panel = page.locator('[role="tabpanel"]:not([hidden])').first();
    await expect(panel.getByTestId(`category-row-${cats[0].id}`)).toBeVisible({ timeout: 15000 });
    const names = () => panel.locator('[data-testid^="category-row-"]:not([data-testid="category-row-template"]) input[name="category-name"]')
      .evaluateAll(els => els.map(e => (e as HTMLInputElement).value));

    await dndKitKeyboardDrag(page, panel.getByTestId(`category-row-${cats[0].id}`), 'ArrowDown', 1);
    await expect.poll(names, { timeout: 10000 }).toEqual([cats[1].name, cats[0].name, cats[2].name]);
    await expect.poll(async () => {
      const rows = await apiCall(`categories?project_fk=${projId}&fields=id,sort_order`, 'GET', '', idToken) as Array<{ id: string; sort_order: number }>;
      return [...rows].sort((a, b) => a.sort_order - b.sort_order).map(r => String(r.id));
    }, { timeout: 10000 }).toEqual([cats[1].id, cats[0].id, cats[2].id]);
  });

  test('EDND-05: dragging an area toward the bottom edge scrolls the long list', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await openAreas(page, longDomName);
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => window.scrollY);
    const b = (await areaRow(page, longAreas[1].id).boundingBox())!;
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 3, y + 3);
    await page.mouse.move(x + 8, y + 8);
    const edge = 700 - 15;
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x, y + (edge - y) * i / 10);
      await page.waitForTimeout(16);
    }
    for (let i = 0; i < 15; i++) {
      await page.mouse.move(x + (i % 2), edge);
      await page.waitForTimeout(80);
    }
    const during = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(during).toBeGreaterThan(before + 40);
  });

  test('EDND-06: a project row reorders by mouse and the order persists', async ({ page }) => {
    const a = await post('projects', { project_name: uniqueName('EdProjA'), closed: 0, sort_order: 99991 }, idToken);
    const b = await post('projects', { project_name: uniqueName('EdProjB'), closed: 0, sort_order: 99992 }, idToken);
    try {
      await page.goto('/projectedit');
      await page.waitForSelector('[data-testid="project-row-template"]', { timeout: 60000 });
      const rowA = page.getByTestId(`project-row-${a}`);
      const rowB = page.getByTestId(`project-row-${b}`);
      await dndKitDrag(page, rowB, rowA, { drop: 'upper' });
      await expect.poll(async () => (await rowB.boundingBox())!.y < (await rowA.boundingBox())!.y, { timeout: 10000 }).toBe(true);
      await expect.poll(async () => {
        const rows = await apiCall(`projects?id=(${a},${b})&fields=id,sort_order`, 'GET', '', idToken) as Array<{ id: string; sort_order: number }>;
        const so = (id: string) => rows.find(r => String(r.id) === id)!.sort_order;
        return so(b) < so(a);
      }, { timeout: 10000 }).toBe(true);
    } finally {
      try { await apiDelete('projects', a, idToken); } catch {}
      try { await apiDelete('projects', b, idToken); } catch {}
    }
  });

  test('EDND-07: a domain row reorders by mouse and the order persists', async ({ page }) => {
    const a = await post('domains', { domain_name: uniqueName('EdDomA'), closed: 0, sort_order: 99993 }, idToken);
    const b = await post('domains', { domain_name: uniqueName('EdDomB'), closed: 0, sort_order: 99994 }, idToken);
    try {
      await navigateToDomainEdit(page);
      const rowA = page.getByTestId(`domain-row-${a}`);
      const rowB = page.getByTestId(`domain-row-${b}`);
      await dndKitDrag(page, rowB, rowA, { drop: 'upper' });
      await expect.poll(async () => (await rowB.boundingBox())!.y < (await rowA.boundingBox())!.y, { timeout: 10000 }).toBe(true);
      await expect.poll(async () => {
        const rows = await apiCall(`domains?id=(${a},${b})&fields=id,sort_order`, 'GET', '', idToken) as Array<{ id: string; sort_order: number }>;
        const so = (id: string) => rows.find(r => String(r.id) === id)!.sort_order;
        return so(b) < so(a);
      }, { timeout: 20000 }).toBe(true);
    } finally {
      try { await apiDelete('domains', a, idToken); } catch {}
      try { await apiDelete('domains', b, idToken); } catch {}
    }
  });
});

// ── The editors on a phone ──────────────────────────────────────────────────

test.describe.serial('Editors drag and drop — touch (dnd-kit)', () => {
  test.use({ hasTouch: true, viewport: { width: 412, height: 780 } });
  test.setTimeout(90000);
  let idToken: string;
  const domName = uniqueName('EdTouch');
  let domId: string;
  const areas: { id: string; name: string }[] = [];

  test.beforeAll(async ({ browser }) => {
    idToken = await tokenFor(browser);
    domId = await post('domains', { domain_name: domName, closed: 0, sort_order: 99995 }, idToken);
    for (let i = 0; i < 18; i++) {
      const name = uniqueName(`T${i}`);
      areas.push({ id: await post('areas', { area_name: name, domain_fk: domId, closed: 0, sort_order: i }, idToken), name });
    }
  });

  test.afterAll(async () => {
    try { await apiDelete('domains', domId, idToken); } catch {}
  });

  async function openAreas(page: Page) {
    await page.goto('/areaedit');
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    const tab = page.getByRole('tab', { name: domName, exact: true });
    await tab.scrollIntoViewIfNeeded();
    await tab.click();
    await page.waitForSelector(`[data-testid="area-row-${areas[0].id}"]`, { timeout: 15000 });
  }

  test('EDTOUCH-01: hold still to lift an area, then drag — it reorders', async ({ page }) => {
    await openAreas(page);
    await dndKitTouchDrag(page, page.getByTestId(`area-row-${areas[0].id}`), page.getByTestId(`area-row-${areas[2].id}`));
    await expect.poll(() => areaNames(page), { timeout: 10000 })
      .toEqual([areas[1].name, areas[2].name, areas[0].name, ...areas.slice(3).map(a => a.name)]);
  });

  test('EDTOUCH-02: a quick swipe on a row scrolls the page and never lifts it', async ({ page }) => {
    await openAreas(page);
    let puts = 0;
    await page.route('**/areas*', r => { if (r.request().method() === 'PUT') puts++; r.continue(); });
    const before = await page.evaluate(() => window.scrollY);
    await touchSwipe(page, page.getByTestId(`area-row-${areas[6].id}`), -260);
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 50);
    expect(puts).toBe(0);
  });
});

// ── The Maps view bar ───────────────────────────────────────────────────────

test.describe.serial('Maps view bar drag and drop (dnd-kit)', () => {
  test.setTimeout(90000);
  let idToken: string;
  const views: { id: string; name: string }[] = [];

  test.beforeAll(async ({ browser }) => {
    idToken = await tokenFor(browser);
    for (let i = 0; i < 3; i++) {
      const name = uniqueName(`View${i}`).slice(-24);
      views.push({ id: await post('map_views', { name, criteria: '{}', sort_order: 9990 + i }, idToken), name });
    }
  });

  test.afterAll(async () => {
    for (const v of views) { try { await apiDelete('map_views', v.id, idToken); } catch {} }
  });

  const chip = (page: Page, id: string) => page.getByTestId(`view-chip-${id}`);
  const order = (page: Page) => page.getByTestId('view-chip-list').locator('[data-testid^="view-chip-"]')
    .evaluateAll(els => els.map(e => e.getAttribute('data-testid')!.replace('view-chip-', '')));
  const mine = (ids: string[]) => ids.filter(id => views.some(v => v.id === id));

  async function openMaps(page: Page) {
    await page.goto('/maps');
    await expect(chip(page, views[2].id)).toBeVisible({ timeout: 30000 });
  }

  test('VBAR-01: a chip drags along the bar and the order persists', async ({ page }) => {
    await openMaps(page);
    const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/map_views'));
    await dndKitDrag(page, chip(page, views[2].id), chip(page, views[0].id), { drop: 'left' });
    await saved;
    await expect.poll(async () => mine(await order(page)), { timeout: 10000 })
      .toEqual([views[2].id, views[0].id, views[1].id]);
    await page.reload();
    await expect(chip(page, views[2].id)).toBeVisible({ timeout: 30000 });
    expect(mine(await order(page))).toEqual([views[2].id, views[0].id, views[1].id]);
  });

  test('VBAR-02: keyboard — Space lifts a chip, ArrowRight moves it, Space drops without opening the view', async ({ page }) => {
    await openMaps(page);
    const before = mine(await order(page));
    await dndKitKeyboardDrag(page, chip(page, before[0]), 'ArrowRight', 1);
    await expect.poll(async () => mine(await order(page)), { timeout: 10000 })
      .toEqual([before[1], before[0], before[2]]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

// ── Test Plans ──────────────────────────────────────────────────────────────

test.describe.serial('Test plan cases drag and drop (dnd-kit)', () => {
  test.setTimeout(90000);
  let idToken: string;
  let projId: string, catId: string, planId: string;
  const cases: { id: string; title: string }[] = [];

  test.beforeAll(async ({ browser }) => {
    idToken = await tokenFor(browser);
    projId = await post('projects', { project_name: uniqueName('PlanDnDProj'), closed: 0, sort_order: 99996 }, idToken);
    catId = await post('categories', { category_name: uniqueName('PlanDnDCat'), project_fk: projId, closed: 0, sort_order: 0 }, idToken);
    planId = await post('test_plans', { title: uniqueName('PlanDnD'), category_fk: catId }, idToken);
    for (let i = 0; i < 4; i++) {
      const title = uniqueName(`Case${i}`);
      const id = await post('test_cases', { title, epics: 'epic', expected: 'ok', test_type: 'manual', category_fk: catId }, idToken);
      cases.push({ id, title });
      await apiCall('test_plan_cases', 'POST', { test_plan_fk: planId, test_case_fk: id, sort_order: i + 1 }, idToken);
    }
  });

  test.afterAll(async () => {
    try { await apiDelete('test_plans', planId, idToken); } catch {}
    try { await apiDelete('projects', projId, idToken); } catch {}
  });

  const serverOrder = async () => {
    const rows = await apiCall(`test_plan_cases?test_plan_fk=${planId}&fields=test_case_fk,sort_order&sort=sort_order:asc`, 'GET', '', idToken) as Array<{ test_case_fk: string }>;
    return rows.map(r => String(r.test_case_fk));
  };

  test('TPLAN-01: a case lifts by its row, its neighbours slide aside, and the order persists', async ({ page }) => {
    await page.goto(`/swarm/testplans?plan=${planId}`);
    const dialog = page.getByTestId('test-plan-detail');
    await expect(dialog.getByTestId(`plan-case-${cases[3].id}`)).toBeVisible({ timeout: 30000 });
    // Press on the title text, not a handle — the whole row is the grip.
    await dndKitDrag(page, dialog.getByTestId(`plan-case-${cases[0].id}`).getByText(cases[0].title),
      dialog.getByTestId(`plan-case-${cases[2].id}`), { drop: 'lower' });
    await expect.poll(serverOrder, { timeout: 15000 })
      .toEqual([cases[1].id, cases[2].id, cases[0].id, cases[3].id]);
  });
});

// ── The phone calendar list ─────────────────────────────────────────────────

test.describe.serial('Phone calendar list drag and drop (dnd-kit)', () => {
  test.use({ hasTouch: true, viewport: { width: 412, height: 780 } });
  test.setTimeout(90000);
  let idToken: string;
  let domId: string, areaId: string, taskId: string;
  const desc = uniqueName('CalMove');
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const from = day(-1), to = day(-3);

  test.beforeAll(async ({ browser }) => {
    idToken = await tokenFor(browser);
    domId = await post('domains', { domain_name: uniqueName('CalDnD'), closed: 0, sort_order: 99997 }, idToken);
    areaId = await post('areas', { area_name: uniqueName('CalDnDArea'), domain_fk: domId, closed: 0, sort_order: 0 }, idToken);
    taskId = await post('tasks', { description: desc, area_fk: areaId, priority: 0, done: 1, done_ts: `${from}T12:00:00`, sort_order: 0 }, idToken);
    // A task on the target date, so that date is in the list.
    await post('tasks', { description: uniqueName('CalStay'), area_fk: areaId, priority: 0, done: 1, done_ts: `${to}T12:00:00`, sort_order: 1 }, idToken);
    // ...and one on today, so the moved task always has a later day to epic to.
    await post('tasks', { description: uniqueName('CalToday'), area_fk: areaId, priority: 0, done: 1, done_ts: `${day(0)}T12:00:00`, sort_order: 2 }, idToken);
  });

  test.afterAll(async () => {
    try { await apiDelete('domains', domId, idToken); } catch {}
  });

  test('CALM-01: hold a task, carry it onto another day — it moves to that date', async ({ page }) => {
    await page.goto('/calview');
    const row = page.getByTestId(`cal-mobile-event-t-${taskId}`);
    await expect(row).toBeVisible({ timeout: 30000 });
    const target = page.getByTestId(`cal-mobile-day-${to}`);
    await target.scrollIntoViewIfNeeded();
    await row.scrollIntoViewIfNeeded();
    await dndKitTouchDrag(page, row, target, { holdMs: LIFT_DELAY_MS + 150 });
    await expect(target.getByTestId(`cal-mobile-event-t-${taskId}`)).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => {
      const rows = await apiCall(`tasks?id=${taskId}&fields=id,done_ts`, 'GET', '', idToken) as Array<{ done_ts: string }>;
      return rows[0]?.done_ts?.slice(0, 10);
    }, { timeout: 10000 }).toBe(to);
  });

  test('CALM-03: keyboard — Space lifts a task, ArrowDown epics it to the next day, Space drops it there', async ({ page }) => {
    await page.goto('/calview');
    const row = page.getByTestId(`cal-mobile-event-t-${taskId}`);
    await expect(row).toBeVisible({ timeout: 30000 });
    // The day after the task's own in the list (days run oldest first).
    const days = await page.locator('[data-testid^="cal-mobile-day-"]').evaluateAll(els =>
      els.map(e => e.getAttribute('data-testid')!.replace('cal-mobile-day-', '')));
    const next = days[days.indexOf(to) + 1];
    expect(next).toBeTruthy();
    await dndKitKeyboardDrag(page, row, 'ArrowDown', 1);
    await expect.poll(async () => {
      const rows = await apiCall(`tasks?id=${taskId}&fields=id,done_ts`, 'GET', '', idToken) as Array<{ done_ts: string }>;
      return rows[0]?.done_ts?.slice(0, 10);
    }, { timeout: 10000 }).toBe(next);
  });

  test('CALM-02: a tap on a task still opens it', async ({ page }) => {
    await page.goto('/calview');
    const row = page.getByTestId(`cal-mobile-event-t-${taskId}`);
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.tap();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
  });
});
