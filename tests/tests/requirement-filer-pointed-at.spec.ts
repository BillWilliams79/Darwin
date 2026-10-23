import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';

// Req #3829 — the Requirement Filer records the page element it sits over.
// Drag the floating filer over a requirement card on /swarm and press Create:
// the filed requirement's description says `Pointed at:` naming that card (its
// testid path and title text) and its debug capture carries the element's rect;
// racked in the navbar the same press records pointedAt null with its reason;
// the field being typed in is never copied into the bundle.

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
    await page.addInitScript(({ pid, cid, racked }) => {
      localStorage.setItem('darwin-swarm-view', 'cards');
      localStorage.setItem('darwin_requirement_filer', JSON.stringify({
        state: { show: true, open: true, dock: null, lastProjectId: pid, lastCategoryId: cid, defaults: {} }, version: 2 }));
      localStorage.setItem('darwin_panel_rack', JSON.stringify({
        state: { racked: racked ? ['requirement-filer'] : [], seeded: ['dev-servers'] }, version: 1 }));
    }, { pid: Number(projectId), cid: Number(categoryId), racked });
    await page.goto('/swarm');
    await page.getByRole('tab', { name: projectName }).click();
    await expect(page.getByTestId(`requirement-${targetId}`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('requirement-filer-new')).toBeVisible();
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

  /** Create → title → Create; returns the filed requirement's id, its description and bundle. */
  async function fileIt(page: Page, title: string) {
    await page.getByTestId('requirement-filer-new').click();
    await page.getByTestId('requirement-editor-field-title').fill(title);
    await expect(page.getByTestId('requirement-editor-save')).toBeEnabled({ timeout: 15000 });
    await page.getByTestId('requirement-editor-save').click();
    const link = page.getByTestId('requirement-editor-id-link');
    await expect(link).toBeVisible({ timeout: 15000 });
    const id = (await link.textContent())!.trim();
    filed.push(id);
    let description = '';
    await expect.poll(async () => {
      const rows = await apiCall(`requirements?id=${id}`, 'GET', '', idToken) as Array<{ description: string }>;
      description = rows?.[0]?.description ?? '';
      return description.includes('--- end Debug capture ---');
    }, { timeout: 20000 }).toBe(true);
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
