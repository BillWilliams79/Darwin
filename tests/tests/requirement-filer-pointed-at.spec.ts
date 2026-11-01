import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

// Req #3829 — the Requirement Filer records the page element it sits over.
// Drag the floating filer over a requirement card on /swarm and press its +:
// the filed requirement's description says `Pointed at:` naming that card (its
// testid path and title text) and its debug capture carries the element's rect;
// racked in the navbar the same press records pointedAt null with its reason;
// the field being typed in is never copied into the bundle. Each filing also
// proves it was aimed at production (req #3888, below).

// Req #3888 — the filer files into PRODUCTION from every build, while a local E2E
// run must never write to production (req #2750, helpers/api.ts). So a run
// against darwin_dev sends the filer's production calls on to darwin_dev — where
// the seeded project, category and card live — and records each one, so every
// test still proves the filer aimed at production. Only the filer reads these
// tables from production on a dev server (the Dev Servers dashboard's title
// lookup is a read; sending it to darwin_dev changes nothing here).
const TEST_DATABASE = process.env.TEST_DATABASE || 'darwin_dev';
const PROD_FILER_CALL = /\/eng\/darwin\/(requirements|requirement_debug_captures|projects|categories|machines)(\?|$)/;
let prodCalls: string[] = [];

let idToken: string;
let projectId: string;
let categoryId: string;
let targetId: string;
const projectName = uniqueName('FilerPointProj');
const targetTitle = uniqueName('FilerPointTarget');
const filed: string[] = [];
// Req #4158 — a plan to point at: pipeline → initiative → epic → requirement.
let planId: string;
let planInitiativeId: string;
let planEpicId: string;
let planReqId: string;
const planTitle = uniqueName('FilerPointPlan');
const planInitiativeTitle = uniqueName('FilerPointInitiative');
const planEpicTitle = uniqueName('FilerPointEpic');

test.describe('Requirement Filer — pointed at (req #3829)', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60000);
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();
    const sub = process.env.E2E_TEST_COGNITO_SUB!;
    const proj = await apiCall('projects', 'POST', { creator_fk: sub, project_name: projectName, closed: 0, sort_order: 0 }, idToken) as Array<{ id: string }>;
    projectId = proj[0].id;
    const cat = await apiCall('categories', 'POST', { creator_fk: sub, category_name: uniqueName('FilerPointCat'), project_fk: projectId, closed: 0, sort_order: 0 }, idToken) as Array<{ id: string }>;
    categoryId = cat[0].id;
    const req = await apiCall('requirements', 'POST', { creator_fk: sub, title: targetTitle, category_fk: categoryId, requirement_status: 'authoring' }, idToken) as Array<{ id: string }>;
    targetId = req[0].id;
    const post = async (table: string, body: object) => {
      const r = await apiCall(table, 'POST', { creator_fk: sub, ...body }, idToken) as Array<{ id: string }>;
      if (!Array.isArray(r) || r[0]?.id == null) throw new Error(`Failed to create ${table}: ${JSON.stringify(r)}`);
      return r[0].id;
    };
    planReqId = await post('requirements', { title: uniqueName('FilerPointSeated'), category_fk: categoryId, requirement_status: 'authoring' });
    planId = await post('pipelines', { title: planTitle, pipeline_status: 'authoring' });
    planInitiativeId = await post('initiatives', { pipeline_fk: planId, title: planInitiativeTitle, category_fk: categoryId });
    planEpicId = await post('epics', { initiative_fk: planInitiativeId, title: planEpicTitle });
    await apiCall('epic_requirements', 'POST', { epic_fk: planEpicId, requirement_fk: planReqId }, idToken);
  });

  test.afterAll(async () => {
    test.setTimeout(60000);
    try { await apiDelete('epics', planEpicId, idToken); } catch {}
    try { await apiDelete('initiatives', planInitiativeId, idToken); } catch {}
    try { await apiDelete('pipelines', planId, idToken); } catch {}
    for (const id of [...filed, targetId, planReqId]) { try { await apiDelete('requirements', id, idToken); } catch {} }
    try { await apiDelete('projects', projectId, idToken); } catch {}
  });

  /** Sends the filer's production calls on to the test database (req #3888, above). */
  async function routeProd(page: Page) {
    prodCalls = [];
    if (TEST_DATABASE !== 'darwin') {
      await page.route(PROD_FILER_CALL, (route) => {
        const req = route.request();
        prodCalls.push(`${req.method()} ${new URL(req.url()).pathname}`);
        return route.continue({ url: req.url().replace('/eng/darwin/', `/eng/${TEST_DATABASE}/`) });
      });
    }
  }

  /** /swarm on the seeded project's tab, the filer shown — floating, or racked. */
  async function openSwarm(page: Page, racked: boolean, pinned = true) {
    await routeProd(page);
    await page.addInitScript(({ pid, cid, racked, pinned }) => {
      localStorage.setItem('darwin-swarm-view', 'cards');
      // The pushpin (req #3958): pressed, the + records the place.
      localStorage.setItem('darwin_requirement_filer', JSON.stringify({
        state: { show: true, open: true, dock: null, pinned, lastProjectId: pid, lastCategoryId: cid, defaults: {} }, version: 3 }));
      localStorage.setItem('darwin_panel_rack', JSON.stringify({
        state: { racked: racked ? ['requirement-filer'] : [], seeded: ['dev-servers'] }, version: 1 }));
    }, { pid: Number(projectId), cid: Number(categoryId), racked, pinned });
    await page.goto('/swarm');
    await page.getByRole('tab', { name: projectName }).click();
    await expect(page.getByTestId(`requirement-${targetId}`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('requirement-filer-add')).toBeVisible();
  }

  /** Drags the floating filer by its head so its centre sits on `target`'s centre. */
  async function dragFilerOnto(page: Page, targetTestid: string, beforeRelease?: () => Promise<void>) {
    const filer = (await page.getByTestId('requirement-filer').boundingBox())!;
    const head = (await page.getByTestId('requirement-filer-header').boundingBox())!;
    const t = (await page.getByTestId(targetTestid).boundingBox())!;
    const dx = (t.x + t.width / 2) - (filer.x + filer.width / 2);
    const dy = (t.y + t.height / 2) - (filer.y + filer.height / 2);
    const sx = head.x + head.width / 2;
    const sy = head.y + head.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sx + (dx * i) / 10, sy + (dy * i) / 10);
    if (beforeRelease) await beforeRelease();
    await page.mouse.up();
  }

  /** Drags the floating filer by its head so its centre sits on client point `p`. */
  async function dragFilerTo(page: Page, p: { x: number; y: number }, beforeRelease?: () => Promise<void>) {
    const filer = (await page.getByTestId('requirement-filer').boundingBox())!;
    const head = (await page.getByTestId('requirement-filer-header').boundingBox())!;
    const dx = p.x - (filer.x + filer.width / 2);
    const dy = p.y - (filer.y + filer.height / 2);
    const sx = head.x + head.width / 2;
    const sy = head.y + head.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(sx + (dx * i) / 12, sy + (dy * i) / 12);
    if (beforeRelease) await beforeRelease();
    await page.mouse.up();
  }

  /** The client point inside the plan canvas's node carrying `attr` = `value` (fx across, near its top). */
  async function canvasNode(page: Page, attr: string, value: number, fx = 0.5) {
    const handle = await page.waitForFunction(({ attr, value, fx }) => {
      const stage = (window as any).Konva?.stages?.find((s: any) => s.container().isConnected);
      const node = stage?.findOne((n: any) => n.getAttr(attr) === value);
      if (!node) return null;
      const r = node.getClientRect();
      const c = stage.container().getBoundingClientRect();
      return { x: c.left + r.x + r.width * fx, y: c.top + r.y + Math.min(r.height / 2, 6), top: c.top + r.y, left: c.left + r.x };
    }, { attr, value, fx }, { timeout: 20000 });
    return await handle.jsonValue() as { x: number; y: number; top: number; left: number };
  }

  /** What the outline names, once it settles on something matching `re`. */
  async function aimSettlesOn(page: Page, re: RegExp) {
    await expect.poll(async () => page.getByTestId('requirement-aim').getAttribute('data-aim', { timeout: 500 }).catch(() => null),
      { timeout: 5000 }).toMatch(re);
  }

  /** + → title → Create; returns the filed requirement's id, its description and bundle. */
  async function fileIt(page: Page, title: string) {
    await page.getByTestId('requirement-filer-add').click();
    await page.getByTestId('requirement-editor-field-title').fill(title);
    await expect(page.getByTestId('requirement-editor-save')).toBeEnabled({ timeout: 15000 });
    await page.getByTestId('requirement-editor-save').click();
    // Create closes the editor at the press (req #3860); the requirement joins the
    // filer's list once its POST lands — the list's only row in this fresh browser.
    const item = page.locator('[data-testid^="requirement-filer-item-"]').first();
    await expect(item).toBeVisible({ timeout: 15000 });
    const id = (await item.getAttribute('data-testid'))!.replace('requirement-filer-item-', '');
    filed.push(id);
    if (TEST_DATABASE !== 'darwin') {
      // Filed into production (req #3888): the create went to /darwin, and back in
      // the editor from the list its id opens on darwin.one.
      expect(prodCalls).toContain('POST /eng/darwin/requirements');
      await item.click();
      const link = page.getByTestId('requirement-editor-id-link');
      await expect(link).toHaveText(id, { timeout: 15000 });
      await expect(link).toHaveAttribute('href', `https://www.darwin.one/swarm/requirement/${id}`);
    }
    let description = '';
    await expect.poll(async () => {
      const rows = await apiCall(`requirements?id=${id}`, 'GET', '', idToken) as Array<{ description: string }>;
      description = rows?.[0]?.description ?? '';
      return description.includes('--- end Debug capture ---');
    }, { timeout: 20000 }).toBe(true);
    if (TEST_DATABASE !== 'darwin') expect(prodCalls).toContain('POST /eng/darwin/requirement_debug_captures');
    const caps = await apiCall(`requirement_debug_captures?requirement_fk=${id}`, 'GET', '', idToken) as Array<{ bundle: string }>;
    return { id, description, bundle: caps[0].bundle, filedFrom: JSON.parse(caps[0].bundle).filedFrom };
  }

  test('FPA-01: over a requirement card, the description names it and the bundle carries its rect', async ({ page }) => {
    await openSwarm(page, false);
    // Pinned (req #3958): mid-drag the card is outlined — or, as the outline names
    // the innermost testid under the filer's centre, the element of it there (its
    // title field, FPA-02), never the category card around it (req #4046).
    const row = page.getByTestId(`requirement-${targetId}`);
    await dragFilerOnto(page, `requirement-${targetId}`, async () => {
      await expect.poll(async () => {
        const aim = await page.getByTestId('requirement-aim').getAttribute('data-aim', { timeout: 500 }).catch(() => null);
        if (!aim) return null;
        return aim === `requirement-${targetId}` || await row.locator(`[data-testid="${aim}"]`).count() > 0 ? 'in the row' : aim;
      }).toBe('in the row');
    });
    const { description, filedFrom } = await fileIt(page, uniqueName('FilerPointed'));
    const line = description.split('\n').find(l => l.startsWith('Pointed at: '));
    expect(line).toBeDefined();
    expect(line).toContain(`requirement-${targetId}`);
    expect(line).toContain(targetTitle);
    const card = filedFrom.pointedAt.find((p: { testidPath: string[] }) => p.testidPath.includes(`requirement-${targetId}`));
    expect(card.rect.w).toBeGreaterThan(0);
    expect(card.rect.h).toBeGreaterThan(0);
    expect(JSON.stringify(filedFrom.pointedAt)).not.toContain('requirement-filer');
  });

  test('FPA-06: pinned over the plan canvas, the outline and Pointed at name the epic, requirement and band — and the block names the plan (req #4158)', async ({ page }) => {
    test.setTimeout(120000);
    await routeProd(page);
    await page.addInitScript(({ pid, cid }) => {
      localStorage.setItem('darwin_requirement_filer', JSON.stringify({
        state: { show: true, open: true, dock: null, pinned: true, lastProjectId: pid, lastCategoryId: cid, defaults: {} }, version: 3 }));
      localStorage.setItem('darwin_panel_rack', JSON.stringify({ state: { racked: [], seeded: ['dev-servers'] }, version: 1 }));
    }, { pid: Number(projectId), cid: Number(categoryId) });
    await page.goto(`/swarm/pipeline/${planId}?mode=plan&level=3`);
    await expect(page.getByTestId('pipeline-plan-visualizer')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('requirement-filer-add')).toBeVisible();

    // A requirement row: its own row, not the card around it.
    const row = await canvasNode(page, 'dragReqId', Number(planReqId), 0.3);
    await dragFilerTo(page, row, () => aimSettlesOn(page, new RegExp(`^requirement #${planReqId} `)));
    // The epic's title area.
    const epic = await canvasNode(page, 'pressEpicId', Number(planEpicId), 0.5);
    await dragFilerTo(page, epic, () => aimSettlesOn(page, new RegExp(`^epic #${planEpicId} "${planEpicTitle}" · pipeline-plan-visualizer$`)));
    // The band, left of the card and below the initiative's chip: no card there.
    const chip = (await page.getByTestId(`pipeline-viz-initiative-pause-${planInitiativeId}`).boundingBox())!;
    await dragFilerTo(page, { x: Math.max(4, epic.left - 12), y: chip.y + chip.height + 30 },
      () => aimSettlesOn(page, new RegExp(`^initiative #${planInitiativeId} `)));
    // Back on the epic, let go and file.
    await dragFilerTo(page, epic, () => aimSettlesOn(page, new RegExp(`^epic #${planEpicId} `)));
    const { description, filedFrom } = await fileIt(page, uniqueName('FilerPlanPointed'));
    const lines = description.split('\n');
    // The centre's object first; a corner probe may add more (`(+N more in the bundle)`).
    const pointed = lines.find((l: string) => l.startsWith('Pointed at: '))!;
    expect(pointed.startsWith(`Pointed at: epic #${planEpicId} "${planEpicTitle}" (pipeline-plan-visualizer)`)).toBe(true);
    expect(filedFrom.pointedAt[0].object).toEqual({ kind: 'epic', id: Number(planEpicId), title: planEpicTitle });
    // The location lines: the plan by name, its database, and the level drawn.
    const subject = lines.find((l: string) => l.startsWith('Subject: '))!;
    expect(subject).toContain(`pipeline ${planId} "${planTitle}" (1 initiative, 1 epic`);
    expect(subject).toContain(TEST_DATABASE === 'darwin' ? 'production ids (darwin)' : `${TEST_DATABASE} ids`);
    expect(filedFrom.subject[0]).toMatchObject({ kind: 'pipeline', id: Number(planId), title: planTitle });
    const surface = lines.find((l: string) => l.startsWith('Surface: '))!;
    expect(surface).toMatch(new RegExp(`^Surface: /swarm/pipeline/${planId}\\?mode=plan&level=3&color=`));
    expect(filedFrom.options.page).toMatchObject({ view: 'plan', level: 'in', levelNumber: 3 });
  });

  test('FPA-05: pinned, it is carried half off screen to the edge, and let go there the place is held and recorded (req #4046)', async ({ page }) => {
    await openSwarm(page, false);
    const vw = page.viewportSize()!.width;
    const filer = (await page.getByTestId('requirement-filer').boundingBox())!;
    const head = (await page.getByTestId('requirement-filer-header').boundingBox())!;
    const t = (await page.getByTestId(`requirement-${targetId}`).boundingBox())!;
    // The centre to the last pixel column, at the card's height — half the filer past the edge.
    const aim = { x: vw - 1, y: t.y + t.height / 2 };
    const sx = head.x + head.width / 2;
    const sy = head.y + head.height / 2;
    const dx = aim.x - (filer.x + filer.width / 2);
    const dy = aim.y - (filer.y + filer.height / 2);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sx + (dx * i) / 10, sy + (dy * i) / 10);
    const carried = (await page.getByTestId('requirement-filer').boundingBox())!;
    expect(carried.x + carried.width).toBeGreaterThan(vw);
    await expect(page.getByTestId('requirement-aim')).toHaveAttribute('data-aim', /.+/);
    await page.mouse.up();
    // Let go: it slides back whole on screen; the place is still outlined, its reticle at the edge.
    await expect.poll(async () => {
      const b = (await page.getByTestId('requirement-filer').boundingBox())!;
      return b.x + b.width <= vw;
    }).toBe(true);
    const held = await page.getByTestId('requirement-aim').getAttribute('data-aim');
    expect(held).toBeTruthy();
    const point = (await page.getByTestId('requirement-aim-point').boundingBox())!;
    expect(Math.abs(point.x + point.width / 2 - aim.x)).toBeLessThanOrEqual(2);
    // + records the held place, not where the filer now sits.
    const { filedFrom } = await fileIt(page, uniqueName('FilerHeld'));
    const centre = filedFrom.pointedAt.find((p: { points: string[] }) => p.points.includes('centre'));
    expect(centre.testidPath[0]).toBe(held);
    expect(centre.rect.x + centre.rect.w).toBeGreaterThanOrEqual(aim.x);
  });

  test('FPA-02: the field being typed in is named, never copied', async ({ page }) => {
    await openSwarm(page, false);
    await dragFilerOnto(page, `requirement-${targetId}`);
    const sentinel = 'zz-typed-not-copied';
    const field = page.getByTestId(`req-title-${targetId}`).locator('textarea:not([aria-hidden])');
    // Focused without a click — the filer floats over the field's centre.
    await field.focus();
    await page.keyboard.press('End');
    await page.keyboard.type(` ${sentinel}`);
    const { bundle, filedFrom } = await fileIt(page, uniqueName('FilerTyping'));
    expect(bundle).not.toContain(sentinel);
    const fields = filedFrom.pointedAt.filter((p: { field?: unknown }) => p.field);
    expect(fields.length).toBeGreaterThan(0);
    for (const p of fields) expect(p.field.copied).toBe(false);
  });

  test('FPA-04: unpinned over a requirement card, the press records no place and says why (req #3958)', async ({ page }) => {
    await openSwarm(page, false, false);
    await expect(page.getByTestId('requirement-filer-pin')).toHaveAttribute('aria-pressed', 'false');
    // Mid-drag, over the card: no outline.
    await dragFilerOnto(page, `requirement-${targetId}`, async () => {
      await expect(page.getByTestId('requirement-aim')).toHaveCount(0);
    });
    const { description, filedFrom } = await fileIt(page, uniqueName('FilerUnpinned'));
    expect(filedFrom.pointedAt).toBeNull();
    expect(filedFrom.pointedAtReason).toMatch(/not pinned/);
    expect(description).not.toContain('Pointed at:');
  });

  test('FPA-03: racked in the navbar, the press points at nothing and says why', async ({ page }) => {
    await openSwarm(page, true);
    await expect(page.getByTestId('requirement-filer')).toHaveAttribute('data-racked', '1');
    const { description, filedFrom } = await fileIt(page, uniqueName('FilerRacked'));
    expect(filedFrom.pointedAt).toBeNull();
    expect(filedFrom.pointedAtReason).toMatch(/racked/);
    expect(description).not.toContain('Pointed at:');
  });
});
