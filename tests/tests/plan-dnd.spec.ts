import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';
import {
  dndKitDrag, dndKitTouchDrag, dndKitKeyboardDrag, touchSwipe, touchHold, LIFT_DELAY_MS,
} from '../helpers/dnd-kit-drag';

// req #3662 — the Plan view on the hold-to-lift press timeline (dnd-kit).
//
// One spec per thing the requirement says the user SEES on /taskcards: the
// whole row (text included) is the grip, neighbours slide aside in a
// hand-sorted card, a priority-sorted card highlights as a whole, both previews
// exist (req #3524's two defects), cards and tabs reorder, a task crosses to
// another domain by hover-switch and the switch reverts on cancel, the keyboard
// drags, a touch hold lifts while a quick swipe scrolls, a long press on a tab
// edits while held, and the page scrolls when a drag nears its edge.
//
// Every drag here is real input — trusted pointer, touch (CDP) and key events —
// on a page where react-dnd's DndProvider is still mounted at the root, which
// is the coexistence check the requirement asks for in a real browser.

test.describe.serial('Plan view drag and drop (dnd-kit)', () => {
  test.setTimeout(90000);
  let idToken: string;
  const sub = () => process.env.E2E_TEST_COGNITO_SUB!;
  const domA = uniqueName('PlanDnD-A');
  const domB = uniqueName('PlanDnD-B');
  let domAId: string, domBId: string;
  let handId: string, prioId: string, targetAreaId: string;
  const hand: { id: string; desc: string }[] = [];
  const prio: { id: string; desc: string }[] = [];

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

    domAId = await post('domains', { domain_name: domA, closed: 0, sort_order: 990 });
    domBId = await post('domains', { domain_name: domB, closed: 0, sort_order: 991 });
    handId = await post('areas', { area_name: uniqueName('Hand'), domain_fk: domAId, closed: 0, sort_order: 0, sort_mode: 'hand' });
    prioId = await post('areas', { area_name: uniqueName('Prio'), domain_fk: domAId, closed: 0, sort_order: 1, sort_mode: 'priority' });
    targetAreaId = await post('areas', { area_name: uniqueName('Target'), domain_fk: domBId, closed: 0, sort_order: 0, sort_mode: 'hand' });
    for (let i = 0; i < 4; i++) {
      const desc = uniqueName(`H${i}`);
      hand.push({ id: await post('tasks', { description: desc, area_fk: handId, priority: 0, done: 0, sort_order: i }), desc });
    }
    for (let i = 0; i < 3; i++) {
      const desc = uniqueName(`P${i}`);
      prio.push({ id: await post('tasks', { description: desc, area_fk: prioId, priority: 1, done: 0, sort_order: i }), desc });
    }
  });

  test.afterAll(async () => {
    try { await apiDelete('domains', domAId, idToken); } catch {}
    try { await apiDelete('domains', domBId, idToken); } catch {}
  });

  const resetHand = () => apiCall('tasks', 'PUT',
    hand.map((t, i) => ({ id: t.id, sort_order: i, area_fk: handId })), idToken);

  async function open(page: Page, domainId = domAId) {
    await page.goto(`/taskcards?domain=${domainId}`);
    await page.waitForSelector(`[data-testid="area-card-${domainId === domAId ? handId : targetAreaId}"]`, { timeout: 30000 });
    await page.waitForSelector(`[data-testid="area-card-${domainId === domAId ? handId : targetAreaId}"] [data-testid^="task-"]`, { timeout: 15000 });
  }

  async function descs(page: Page, areaId: string) {
    return page.getByTestId(`area-card-${areaId}`)
      .locator('[data-testid^="task-"]:not([data-testid="task-template"]) [name="description"]')
      .evaluateAll(els => els.map(e => (e as HTMLTextAreaElement).value));
  }

  const row = (page: Page, id: string) => page.getByTestId(`task-${id}`);
  const tab = (page: Page, name: string) => page.getByRole('tab', { name });

  // ── Grip, feedback, preview ───────────────────────────────────────────────

  test('PDND-01: a quick click on a row\'s text places the caret and moves nothing', async ({ page }) => {
    await resetHand();
    await open(page);
    let puts = 0;
    await page.route('**/tasks*', r => { if (r.request().method() === 'PUT') puts++; r.continue(); });
    const field = row(page, hand[1].id).locator('[name="description"]');
    await field.click();
    await expect(field).toBeFocused();
    await page.waitForTimeout(400);
    expect(puts).toBe(0);
    expect(await descs(page, handId)).toEqual(hand.map(t => t.desc));
  });

  test('PDND-02: pressing ON THE TEXT lifts the row; neighbours slide aside; the preview is the row', async ({ page }) => {
    await resetHand();
    await open(page);
    const source = row(page, hand[0].id);
    const srcBox = (await source.boundingBox())!;
    const field = source.locator('[name="description"]');
    const fb = (await field.boundingBox())!;
    const target = (await row(page, hand[2].id).boundingBox())!;

    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.mouse.down();
    await page.mouse.move(fb.x + fb.width / 2 + 3, fb.y + fb.height / 2 + 3);
    await page.mouse.move(fb.x + fb.width / 2 + 8, fb.y + fb.height / 2 + 8);
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2 + (target.y - srcBox.y) * i / 10);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(300);

    // The faithful clone: the row's own text, at the row's own width.
    const overlay = page.getByTestId('drag-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('textarea').first()).toHaveValue(hand[0].desc);
    const ob = (await overlay.boundingBox())!;
    expect(Math.abs(ob.width - srcBox.width)).toBeLessThan(srcBox.width * 0.06);

    // A sibling the item has passed has slid up out of its way.
    const slid = await row(page, hand[1].id).evaluate(el => (el as HTMLElement).style.transform);
    expect(slid).toMatch(/translate3d\(0px, -\d/);

    await page.mouse.up();
    await expect.poll(() => descs(page, handId), { timeout: 10000 })
      .toEqual([hand[1].desc, hand[2].desc, hand[0].desc, hand[3].desc]);
    await page.reload();
    await page.waitForSelector(`[data-testid="task-${hand[0].id}"]`, { timeout: 30000 });
    expect(await descs(page, handId)).toEqual([hand[1].desc, hand[2].desc, hand[0].desc, hand[3].desc]);
  });

  test('PDND-03: a priority-sorted card highlights as a whole, its rows stay put, and the drop appends', async ({ page }) => {
    await resetHand();
    await open(page);
    const prioCard = page.getByTestId(`area-card-${prioId}`);
    const source = row(page, hand[3].id);
    const sb = (await source.boundingBox())!;
    const pb = (await prioCard.boundingBox())!;
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width / 2 + 8, sb.y + sb.height / 2 + 8);
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(sb.x + (pb.x + pb.width / 2 - sb.x) * i / 12, sb.y + (pb.y + pb.height / 2 - sb.y) * i / 12);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(250);
    await expect(prioCard).toHaveAttribute('data-drop-highlight', 'true');
    const moved = await prioCard.locator('[data-testid^="task-"]').evaluateAll(
      els => els.filter(e => (e as HTMLElement).style.transform).length);
    expect(moved).toBe(0);
    await page.mouse.up();
    await expect(prioCard.getByTestId(`task-${hand[3].id}`)).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId(`area-card-${handId}`).getByTestId(`task-${hand[3].id}`)).toHaveCount(0);
  });

  test('PDND-04: the priority card\'s rows drag with a preview and reorder in hand sort', async ({ page }) => {
    await open(page);
    // Show the card for this domain via its toggle; it opens in hand sort.
    await page.getByTestId(`priority-card-toggle-${domAId}`).click();
    const card = page.getByTestId('priority-card');
    await expect(card.getByTestId(`task-${prio[0].id}`)).toBeVisible({ timeout: 10000 });
    const rows = () => card.locator('[data-testid^="task-"] [name="description"]')
      .evaluateAll(els => els.map(e => (e as HTMLTextAreaElement).value));
    const before = await rows();
    const src = card.getByTestId(`task-${prio[0].id}`);
    const sb = (await src.boundingBox())!;
    const lastId = (await card.locator('[data-testid^="task-"]').last().getAttribute('data-testid'))!;
    const tb = (await card.getByTestId(lastId).boundingBox())!;
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width / 2 + 8, sb.y + sb.height / 2 + 8);
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + (tb.y - sb.y) * i / 10);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(250);
    // req #3524 defect 2: this drag used to show NO preview at all.
    const overlay = page.getByTestId('drag-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('textarea').first()).toHaveValue(before[0]);
    await page.mouse.up();
    await expect.poll(rows, { timeout: 10000 }).toEqual([...before.slice(1), before[0]]);
    await page.getByTestId(`priority-card-toggle-${domAId}`).click();
  });

  // ── Cards and tabs ────────────────────────────────────────────────────────

  test('PDND-05: an area card reorders within its domain and the order persists', async ({ page }) => {
    await open(page);
    const before = await page.locator('[role="tabpanel"]:visible [data-testid^="area-card-"]:not([data-testid="area-card-template"])')
      .evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
    expect(before.slice(0, 2)).toEqual([`area-card-${handId}`, `area-card-${prioId}`]);
    const putDone = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/areas'));
    await dndKitDrag(page, page.getByTestId(`area-card-${handId}`), page.getByTestId(`area-card-${prioId}`), { grab: 'upper', drop: 'right' });
    await putDone;
    const order = () => page.locator('[role="tabpanel"]:visible [data-testid^="area-card-"]:not([data-testid="area-card-template"])')
      .evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
    await expect.poll(order).toEqual([`area-card-${prioId}`, `area-card-${handId}`]);
    await page.reload();
    await page.waitForSelector(`[data-testid="area-card-${handId}"]`, { timeout: 30000 });
    expect(await order()).toEqual([`area-card-${prioId}`, `area-card-${handId}`]);
    await apiCall('areas', 'PUT', [{ id: handId, sort_order: 0 }, { id: prioId, sort_order: 1 }], idToken);
  });

  test('PDND-06: a domain tab reorders along the strip and the order persists', async ({ page }) => {
    await open(page);
    const tabA = tab(page, domA), tabB = tab(page, domB);
    await tabB.scrollIntoViewIfNeeded();
    const labels = () => page.locator('[role="tab"]').evaluateAll(els => els.map(e => e.textContent || ''));
    const idx = (ls: string[], n: string) => ls.findIndex(l => l.toLowerCase().includes(n.toLowerCase()));
    let ls = await labels();
    expect(idx(ls, domA)).toBe(idx(ls, domB) - 1);
    const putDone = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/domains'));
    await dndKitDrag(page, tabA, tabB, { drop: 'right' });
    await putDone;
    await expect.poll(async () => { const l = await labels(); return idx(l, domB) < idx(l, domA); }).toBe(true);
    // The selected tab followed its domain.
    await expect(tab(page, domA)).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await page.waitForSelector('[role="tab"]', { timeout: 30000 });
    ls = await labels();
    expect(idx(ls, domB)).toBeLessThan(idx(ls, domA));
    await apiCall('domains', 'PUT', [{ id: domAId, sort_order: 990 }, { id: domBId, sort_order: 991 }], idToken);
  });

  test('PDND-07: a task carried onto another domain\'s tab switches to it and lands in its card', async ({ page }) => {
    await resetHand();
    await open(page);
    await tab(page, domB).scrollIntoViewIfNeeded();
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/tasks'));
    await dndKitDrag(page, row(page, hand[2].id), tab(page, domB), {
      holdOverTargetMs: 900,
      then: page.getByTestId(`area-card-${targetAreaId}`),
    });
    await put;
    await expect(tab(page, domB)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`area-card-${targetAreaId}`).getByTestId(`task-${hand[2].id}`)).toBeVisible();
    // Persisted: reopen on the target domain and find it there.
    await open(page, domBId);
    await expect(page.getByTestId(`area-card-${targetAreaId}`).getByTestId(`task-${hand[2].id}`)).toBeVisible();
  });

  test('PDND-08: Esc after a hover-switch cancels cleanly — back on the first domain, nothing written', async ({ page }) => {
    await resetHand();
    await open(page);
    let puts = 0;
    await page.route('**/tasks*', r => { if (r.request().method() === 'PUT') puts++; r.continue(); });
    await tab(page, domB).scrollIntoViewIfNeeded();
    await dndKitDrag(page, row(page, hand[1].id), tab(page, domB), {
      holdOverTargetMs: 900,
      then: page.getByTestId(`area-card-${targetAreaId}`),
      cancelWithEscape: true,
    });
    await expect(tab(page, domA)).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(500);
    expect(puts).toBe(0);
    expect(await descs(page, handId)).toEqual(hand.map(t => t.desc));
    await expect(page.locator('[data-dragging="true"]')).toHaveCount(0);
  });

  test('PDND-10: a card carried across domains and back still shows the order just saved', async ({ page }) => {
    // Review finding (req #3662): a card carried into another domain REMOUNTS
    // and seeds from the query cache, which must already hold the new order.
    await resetHand();
    await open(page);
    const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/tasks'));
    await dndKitDrag(page, row(page, hand[3].id), row(page, hand[0].id));
    await saved;
    const reordered = [hand[3].desc, hand[0].desc, hand[1].desc, hand[2].desc];
    await expect.poll(() => descs(page, handId)).toEqual(reordered);
    await tab(page, domB).scrollIntoViewIfNeeded();
    await dndKitDrag(page, page.getByTestId(`area-card-${handId}`), tab(page, domB), {
      grab: 'upper', holdOverTargetMs: 900,
      then: page.getByTestId(`area-card-${targetAreaId}`), cancelWithEscape: true,
    });
    await expect(tab(page, domA)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => descs(page, handId)).toEqual(reordered);
  });

  test('PDND-11: a long click picks the row up — it sinks while held, then the preview pops up', async ({ page }) => {
    await resetHand();
    await open(page);
    const source = row(page, hand[1].id);
    const b = (await source.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    // Mid-hold: the press cue — the row sinks (scaled in), nothing lifted yet.
    await page.waitForTimeout(180);
    expect(await source.evaluate(el => (el as HTMLElement).style.transform)).toBe('scale(0.97)');
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
    // Past LIFT_DELAY_MS without moving: picked up.
    await page.waitForTimeout(LIFT_DELAY_MS);
    await expect(page.getByTestId('drag-overlay')).toBeVisible();
    await expect(source).toHaveAttribute('data-dragging', 'true');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('[data-dragging="true"]')).toHaveCount(0);
    expect(await descs(page, handId)).toEqual(hand.map(t => t.desc));
  });

  test('PDND-12: a quick click still only places the cursor — no press cue lingers, nothing lifts', async ({ page }) => {
    await open(page);
    const source = row(page, hand[2].id);
    await source.locator('[name="description"]').click();
    await expect(source.locator('[name="description"]')).toBeFocused();
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
    expect(await source.evaluate(el => (el as HTMLElement).style.transform)).not.toContain('scale');
  });

  test('PDND-13: a long click on the text that lifts the row puts the cursor back where it was clicked', async ({ page }) => {
    await resetHand();
    await open(page);
    const field = row(page, hand[1].id).locator('[name="description"]');
    const fb = (await field.boundingBox())!;
    // Click a few characters into the text and hold until it lifts.
    await page.mouse.move(fb.x + 40, fb.y + fb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(LIFT_DELAY_MS + 150);
    await expect(page.getByTestId('drag-overlay')).toBeVisible();
    await page.mouse.up();
    await expect(field).toBeFocused({ timeout: 2000 });
    const caret = await field.evaluate(el => (el as HTMLTextAreaElement).selectionStart);
    expect(caret).toBeGreaterThan(0);
    expect(caret).toBeLessThan(hand[1].desc.length);
  });

  test('PDND-14: the slot a tall task leaves while lifted is one row high; the preview shows all of it', async ({ page }) => {
    const long = Array(12).fill('a long multi-line task description').join(' ');
    await apiCall('tasks', 'PUT', [{ id: hand[3].id, description: long }], idToken);
    try {
      await resetHand();
      await open(page);
      const source = row(page, hand[3].id);
      const tall = (await source.boundingBox())!.height;
      expect(tall).toBeGreaterThan(60);
      const b = (await source.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + 10);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 8, b.y + 18);
      await page.waitForTimeout(250);
      const slot = (await source.boundingBox())!.height;
      expect(slot).toBeLessThanOrEqual(40);
      expect((await page.getByTestId('drag-overlay').boundingBox())!.height).toBeGreaterThan(60);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    } finally {
      await apiCall('tasks', 'PUT', [{ id: hand[3].id, description: hand[3].desc }], idToken);
    }
  });

  test('PDND-15: overshooting the bottom of the card at a turn keeps the rows where they are', async ({ page }) => {
    await resetHand();
    await open(page);
    const card = (await page.getByTestId(`area-card-${handId}`).boundingBox())!;
    const first = (await row(page, hand[0].id).boundingBox())!;
    const x = first.x + first.width / 2;
    await page.mouse.move(x, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(x + 3, first.y + first.height / 2 + 3);
    await page.mouse.move(x + 6, first.y + first.height / 2 + 8);
    const slotTop = () => page.locator('[data-dragging="true"]').evaluate(e => Math.round(e.getBoundingClientRect().top));
    // Down to the bottom of the card...
    for (let i = 1; i <= 15; i++) { await page.mouse.move(x, first.y + (card.y + card.height - 8 - first.y) * i / 15); await page.waitForTimeout(16); }
    await page.waitForTimeout(300);
    const atBottom = await slotTop();
    // ...overshoot 30 px past it, as an elevator-style drag does at the turn.
    await page.mouse.move(x, card.y + card.height + 30);
    await page.waitForTimeout(300);
    expect(Math.abs((await slotTop()) - atBottom)).toBeLessThan(4);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // ── Keyboard ──────────────────────────────────────────────────────────────

  test('PDND-09: keyboard — Space lifts, ArrowDown moves, Space drops', async ({ page }) => {
    await resetHand();
    await open(page);
    await dndKitKeyboardDrag(page, row(page, hand[0].id), 'ArrowDown', 1);
    await expect.poll(() => descs(page, handId), { timeout: 10000 })
      .toEqual([hand[1].desc, hand[0].desc, hand[2].desc, hand[3].desc]);
  });
});

// ── Touch: the press timeline on a phone ─────────────────────────────────────

test.describe.serial('Plan view drag and drop — touch (dnd-kit)', () => {
  test.use({ hasTouch: true, viewport: { width: 412, height: 780 } });
  test.setTimeout(90000);
  let idToken: string;
  const sub = () => process.env.E2E_TEST_COGNITO_SUB!;
  const dom = uniqueName('PlanTouch');
  let domId: string, areaId: string;
  const tasks: { id: string; desc: string }[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
    const post = async (table: string, body: object) =>
      ((await apiCall(table, 'POST', { creator_fk: sub(), ...body }, idToken)) as Array<{ id: string }>)[0].id;
    domId = await post('domains', { domain_name: dom, closed: 0, sort_order: 992 });
    areaId = await post('areas', { area_name: uniqueName('Hand'), domain_fk: domId, closed: 0, sort_order: 0, sort_mode: 'hand' });
    // Enough rows that the page scrolls at phone height.
    for (let i = 0; i < 18; i++) {
      const desc = uniqueName(`T${i}`);
      tasks.push({ id: await post('tasks', { description: desc, area_fk: areaId, priority: 0, done: 0, sort_order: i }), desc });
    }
  });

  test.afterAll(async () => {
    try { await apiDelete('domains', domId, idToken); } catch {}
  });

  async function open(page: Page) {
    await page.goto(`/taskcards?domain=${domId}`);
    await page.waitForSelector(`[data-testid="task-${tasks[0].id}"]`, { timeout: 30000 });
  }
  const descs = (page: Page) => page.getByTestId(`area-card-${areaId}`)
    .locator('[data-testid^="task-"]:not([data-testid="task-template"]) [name="description"]')
    .evaluateAll(els => els.map(e => (e as HTMLTextAreaElement).value));

  test('PTOUCH-01: hold still to lift, then drag — the row reorders', async ({ page }) => {
    await open(page);
    await dndKitTouchDrag(page, page.getByTestId(`task-${tasks[0].id}`), page.getByTestId(`task-${tasks[2].id}`));
    await expect.poll(() => descs(page), { timeout: 10000 }).toEqual(
      [tasks[1].desc, tasks[2].desc, tasks[0].desc, ...tasks.slice(3).map(t => t.desc)]);
  });

  test('PTOUCH-02: a quick swipe on a row scrolls the page and never lifts it', async ({ page }) => {
    await open(page);
    let puts = 0;
    await page.route('**/tasks*', r => { if (r.request().method() === 'PUT') puts++; r.continue(); });
    const before = await page.evaluate(() => window.scrollY);
    await touchSwipe(page, page.getByTestId(`task-${tasks[6].id}`), -260);
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 50);
    expect(puts).toBe(0);
  });

  test('PTOUCH-03: a hold-and-release in place drops the row where it was and opens no keyboard', async ({ page }) => {
    await open(page);
    const field = page.getByTestId(`task-${tasks[4].id}`).locator('[name="description"]');
    await touchHold(page, page.getByTestId(`task-${tasks[4].id}`), LIFT_DELAY_MS + 250);
    await expect(field).not.toBeFocused();
    await expect(page.locator('[data-dragging="true"]')).toHaveCount(0);
  });

  test('PTOUCH-04: a long press on a domain tab renames it while still held', async ({ page }) => {
    await open(page);
    const t = page.getByRole('tab', { name: dom });
    await t.scrollIntoViewIfNeeded();
    const index = (await t.getAttribute('data-testid'))!.replace('domain-tab-', '');
    await touchHold(page, t, 750);
    await expect(page.getByTestId(`domain-tab-edit-${index}`)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('PTOUCH-05: dragging near the bottom edge scrolls the page', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    const b = (await page.getByTestId(`task-${tasks[1].id}`).boundingBox())!;
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await page.waitForTimeout(LIFT_DELAY_MS + 120);
    const edge = 780 - 20;
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (edge - y) * i / 10, id: 1 }] });
      await page.waitForTimeout(16);
    }
    for (let i = 0; i < 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (i % 2), y: edge, id: 1 }] });
      await page.waitForTimeout(80);
    }
    const during = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Escape');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    expect(during).toBeGreaterThan(before + 40);
  });
});
