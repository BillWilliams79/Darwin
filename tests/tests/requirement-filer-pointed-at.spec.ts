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
  });

  test.afterAll(async () => {
    test.setTimeout(60000);
    for (const id of [...filed, targetId]) { try { await apiDelete('requirements', id, idToken); } catch {} }
    try { await apiDelete('projects', projectId, idToken); } catch {}
  });

  /** /swarm on the seeded project's tab, the filer shown — floating, or racked. */
  async function openSwarm(page: Page, racked: boolean) {
    prodCalls = [];
    if (TEST_DATABASE !== 'darwin') {
      await page.route(PROD_FILER_CALL, (route) => {
        const req = route.request();
        prodCalls.push(`${req.method()} ${new URL(req.url()).pathname}`);
        return route.continue({ url: req.url().replace('/eng/darwin/', `/eng/${TEST_DATABASE}/`) });
      });
    }
    await page.addInitScript(({ pid, cid, racked }) => {
      localStorage.setItem('darwin-swarm-view', 'cards');
      localStorage.setItem('darwin_requirement_filer', JSON.stringify({
        state: { show: true, open: true, dock: null, lastProjectId: pid, lastCategoryId: cid, defaults: {} }, version: 3 }));
      localStorage.setItem('darwin_panel_rack', JSON.stringify({
        state: { racked: racked ? ['requirement-filer'] : [], seeded: ['dev-servers'] }, version: 1 }));
    }, { pid: Number(projectId), cid: Number(categoryId), racked });
    await page.goto('/swarm');
    await page.getByRole('tab', { name: projectName }).click();
    await expect(page.getByTestId(`requirement-${targetId}`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('requirement-filer-add')).toBeVisible();
  }

  /** Drags the floating filer by its head so its centre sits on `target`'s centre. */
  async function dragFilerOnto(page: Page, targetTestid: string) {
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
    await page.mouse.up();
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
    await dragFilerOnto(page, `requirement-${targetId}`);
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

  test('FPA-03: racked in the navbar, the press points at nothing and says why', async ({ page }) => {
    await openSwarm(page, true);
    await expect(page.getByTestId('requirement-filer')).toHaveAttribute('data-racked', '1');
    const { description, filedFrom } = await fileIt(page, uniqueName('FilerRacked'));
    expect(filedFrom.pointedAt).toBeNull();
    expect(filedFrom.pointedAtReason).toMatch(/racked/);
    expect(description).not.toContain('Pointed at:');
  });
});
