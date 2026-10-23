import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, uniqueName } from '../helpers/api';
import {
  dndKitTouchDrag, touchSwipe, touchHold, LIFT_DELAY_MS, LONG_PRESS_MS, Point,
} from '../helpers/dnd-kit-drag';

/**
 * The Pipeline plan canvas by TOUCH, on the shared press timeline (req #3665,
 * DnD part 4 of 4 — design req #3645):
 *
 *   PCDND-01  a swipe that starts on a requirement pans the canvas, lifts nothing
 *   PCDND-02  held still, a requirement lifts; dragged to another step and
 *             released, it is re-seated there (`moveStepRequirement`)
 *   PCDND-03  held still past the long press, it opens the title editor instead
 *   PCDND-04  an Orchestrables row, held and dragged by touch onto a step, is
 *             seated on it (dnd-kit + the canvas's own step hit test)
 *
 * Real input throughout: CDP touch events through the shared helper, which
 * takes a CLIENT POINT for a spot on the canvas. The requirement marks and step
 * names are Konva shapes, so their points are read off the live Konva stage
 * (`window.Konva.stages`) — the same nodes the canvas hit-tests.
 *
 * One throwaway plan (two steps in a chain), owned by the E2E user, created
 * and deleted through the REST gateway. Serial: the tests move its rows.
 */
test.describe.serial('Plan canvas — touch drag and drop (req #3665)', () => {
  test.setTimeout(90000);
  test.use({ hasTouch: true, viewport: { width: 1280, height: 860 } });

  let idToken: string;
  let projectId: string;
  let categoryId: string;
  let pipelineId: string;
  let initiativeId: string;
  let step1Id: string;
  let step2Id: string;
  let seatedReqId: string;
  let readyReqId: string;

  const sub = () => process.env.E2E_TEST_COGNITO_SUB!;
  const post = async (table: string, body: object) => {
    const r = await apiCall(table, 'POST', { creator_fk: sub(), ...body }, idToken) as Array<{ id: string }>;
    if (!Array.isArray(r) || r[0]?.id == null) throw new Error(`Failed to create ${table}: ${JSON.stringify(r)}`);
    return r[0].id;
  };
  // A junction carries no `creator_fk` (its ownership is derived through the
  // step it names, req #3122) and its POST echoes no row — so it is proved by
  // reading it back.
  const link = async (table: string, body: Record<string, string>, readBack: string) => {
    await apiCall(table, 'POST', body, idToken);
    const rows = await apiCall(`${table}?${readBack}`, 'GET', '', idToken);
    if (!Array.isArray(rows) || !rows.length) throw new Error(`Failed to create ${table}: ${JSON.stringify(rows)}`);
  };
  const seatOf = async (reqId: string) => {
    const rows = await apiCall(`pipeline_step_requirements?requirement_fk=${reqId}`, 'GET', '', idToken) as
      Array<{ step_fk: string | number }>;
    return Array.isArray(rows) && rows.length ? String(rows[0].step_fk) : null;
  };

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    projectId = await post('projects', { project_name: uniqueName('PlanDnD'), closed: 0, sort_order: 992 });
    categoryId = await post('categories', { category_name: uniqueName('PlanDnDCat'), project_fk: projectId, closed: 0, sort_order: 0, sort_mode: 'hand' });
    seatedReqId = await post('requirements', { title: uniqueName('Seated'), category_fk: categoryId, requirement_status: 'swarm_ready' });
    readyReqId = await post('requirements', { title: uniqueName('Orchestrable'), category_fk: categoryId, requirement_status: 'swarm_ready' });
    pipelineId = await post('pipelines', { title: uniqueName('PlanDnD plan'), pipeline_status: 'draft' });
    initiativeId = await post('initiatives', { pipeline_fk: pipelineId, title: uniqueName('PlanDnD initiative'), category_fk: categoryId });
    step1Id = await post('pipeline_steps', { initiative_fk: initiativeId, title: 'Design' });
    step2Id = await post('pipeline_steps', { initiative_fk: initiativeId, title: 'Implement' });
    await link('pipeline_step_deps', { step_fk: step2Id, dep_step_fk: step1Id }, `step_fk=${step2Id}`);
    await link('pipeline_step_requirements', { step_fk: step1Id, requirement_fk: seatedReqId },
      `requirement_fk=${seatedReqId}`);
  });

  test.afterAll(async () => {
    // Dependent step first: the dependency edge RESTRICTs its target's delete.
    for (const id of [step2Id, step1Id]) if (id) await apiDelete('pipeline_steps', id, idToken);
    if (initiativeId) await apiDelete('initiatives', initiativeId, idToken);
    if (pipelineId) await apiDelete('pipelines', pipelineId, idToken);
    for (const id of [seatedReqId, readyReqId]) if (id) await apiDelete('requirements', id, idToken);
    if (categoryId) await apiDelete('categories', categoryId, idToken);
    if (projectId) await apiDelete('projects', projectId, idToken);
  });

  const panel = (page: Page) => page.locator('[data-insert-edges]');

  /** Open the plan at the level that draws requirement ids, the box at home. */
  async function openPlan(page: Page) {
    await page.addInitScript(() => {
      localStorage.setItem('darwin-pipeline-viz-level', '3');
      localStorage.removeItem('darwin-plan-unseated-box-window-pos');
    });
    await page.goto(`/swarm/pipeline/${pipelineId}?mode=plan`);
    await expect(page.getByTestId('pipeline-plan-visualizer')).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(() => (window as any).Konva?.stages?.some((s: any) => s.container().isConnected));
  }

  /** A point inside the canvas node carrying `attr` = `value`, `fx` of the way across. */
  async function nodeAt(page: Page, attr: string, value: number, fx: number): Promise<Point> {
    const handle = await page.waitForFunction(({ attr, value, fx }) => {
      const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected);
      const node = stage?.findOne((n: any) => n.getAttr(attr) === value);
      if (!node) return null;
      const r = node.getClientRect();
      const c = stage.container().getBoundingClientRect();
      return { x: c.left + r.x + r.width * fx, y: c.top + r.y + Math.min(r.height / 2, 8) };
    }, { attr, value: Number(value), fx }, { timeout: 15000 });
    return await handle.jsonValue() as Point;
  }

  /** The centre, in client px, of the canvas node carrying `attr` = `value`. */
  async function nodeCentre(page: Page, attr: string, value: number): Promise<Point> {
    const handle = await page.waitForFunction(({ attr, value }) => {
      const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected);
      const node = stage?.findOne((n: any) => n.getAttr(attr) === value);
      if (!node) return null;
      const r = node.getClientRect();
      const c = stage.container().getBoundingClientRect();
      return { x: c.left + r.x + Math.min(r.width / 2, 12), y: c.top + r.y + r.height / 2 };
    }, { attr, value: Number(value) }, { timeout: 15000 });
    return await handle.jsonValue() as Point;
  }
  const transform = async (page: Page) => (await panel(page).getAttribute('data-transform')) ?? '';

  test('PCDND-01: a swipe from a requirement pans the canvas and lifts nothing', async ({ page }) => {
    await openPlan(page);
    const mark = await nodeCentre(page, 'dragReqId', Number(seatedReqId));
    const before = await transform(page);
    await touchSwipe(page, mark, 0, -160);
    expect(await panel(page).getAttribute('data-req-drag')).toBe('');
    expect(await transform(page)).not.toBe(before);
    expect(await seatOf(seatedReqId)).toBe(String(step1Id));
  });

  test('PCDND-02: held still, a requirement lifts and moves to another step', async ({ page }) => {
    await openPlan(page);
    const mark = await nodeCentre(page, 'dragReqId', Number(seatedReqId));
    const target = await nodeCentre(page, 'pressStepId', Number(step2Id));
    // Moved soon after the lift, well before the long press would edit.
    await dndKitTouchDrag(page, mark, target, { holdMs: LIFT_DELAY_MS + 40 });
    await expect.poll(() => seatOf(seatedReqId), { timeout: 15000 }).toBe(String(step2Id));
    expect(await panel(page).getAttribute('data-req-drag')).toBe('');
  });

  test('PCDND-03: held still past the long press and let go, it opens the title editor', async ({ page }) => {
    await openPlan(page);
    const mark = await nodeCentre(page, 'dragReqId', Number(seatedReqId));
    await touchHold(page, mark, LONG_PRESS_MS + 200);
    await expect(page.getByTestId(`pipeline-viz-req-edit-${seatedReqId}`)).toBeVisible();
    expect(await panel(page).getAttribute('data-req-drag')).toBe('');
    await page.keyboard.press('Escape');
    // The hold moved nothing.
    expect(await seatOf(seatedReqId)).toBe(String(step2Id));
  });

  test('PCDND-04: an Orchestrables row, held and dragged by touch, seats onto a step', async ({ page }) => {
    await openPlan(page);
    const row = page.getByTestId(`pipeline-viz-unseated-item-${readyReqId}`);
    await expect(row).toBeVisible({ timeout: 15000 });
    const target = await nodeCentre(page, 'pressStepId', Number(step1Id));
    await dndKitTouchDrag(page, row, target, { holdMs: LIFT_DELAY_MS + 60 });
    await expect.poll(() => seatOf(readyReqId), { timeout: 15000 }).toBe(String(step1Id));
    await expect(row).toHaveCount(0);
  });

  test('PCDND-05: a finger held past the long press and then dragged is a drag, never the title edit', async ({ page }) => {
    await openPlan(page);
    const mark = await nodeCentre(page, 'dragReqId', Number(seatedReqId));
    const target = await nodeCentre(page, 'pressStepId', Number(step1Id));
    await dndKitTouchDrag(page, mark, target, { holdMs: LONG_PRESS_MS + 300 });
    await expect.poll(() => seatOf(seatedReqId), { timeout: 15000 }).toBe(String(step1Id));
    await expect(page.getByTestId(`pipeline-viz-req-edit-${seatedReqId}`)).toHaveCount(0);
  });

  test('PCDND-06: by mouse, held still it opens the editor while held, caret in it; moved, it drags', async ({ page }) => {
    await openPlan(page);
    let mark = await nodeCentre(page, 'dragReqId', Number(seatedReqId));
    const editor = page.getByTestId(`pipeline-viz-req-edit-${seatedReqId}`);
    await page.mouse.move(mark.x, mark.y);
    await page.mouse.down();
    await page.waitForTimeout(LONG_PRESS_MS + 200);
    // Still held: the editor is open and has the caret, the requirement never lifted.
    await expect(editor).toBeVisible();
    await expect(editor).toBeFocused();
    expect(await panel(page).getAttribute('data-req-drag')).toBe('');
    await page.mouse.up();
    await expect(editor).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);

    // A press that moves drags at once — back to step 2.
    mark = await nodeCentre(page, 'dragReqId', Number(seatedReqId));
    const target = await nodeCentre(page, 'pressStepId', Number(step2Id));
    await page.mouse.move(mark.x, mark.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(mark.x + (target.x - mark.x) * i / 12, mark.y + (target.y - mark.y) * i / 12);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await expect.poll(() => seatOf(seatedReqId), { timeout: 15000 }).toBe(String(step2Id));
    await expect(editor).toHaveCount(0);
  });

  test('PCDND-07: a long press puts the caret where the text was pressed, never a select-all', async ({ page }) => {
    await openPlan(page);
    // A requirement title, pressed part-way along it.
    const title = await nodeAt(page, 'dragReqId', Number(seatedReqId), 0.6);
    await page.mouse.move(title.x, title.y);
    await page.mouse.down();
    await page.waitForTimeout(LONG_PRESS_MS + 200);
    await page.mouse.up();
    const reqEditor = page.getByTestId(`pipeline-viz-req-edit-${seatedReqId}`);
    await expect(reqEditor).toBeFocused();
    const req = await reqEditor.evaluate((el) => {
      const sel = window.getSelection()!;
      const r = document.createRange();
      r.setStart(el, 0);
      r.setEnd(sel.anchorNode!, sel.anchorOffset);
      return { collapsed: sel.isCollapsed, at: r.toString().length, len: (el.textContent || '').length };
    });
    expect(req.collapsed).toBe(true);
    expect(req.at).toBeGreaterThan(0);
    expect(req.at).toBeLessThan(req.len);
    await page.keyboard.press('Escape');
    await expect(reqEditor).toHaveCount(0);

    // A step name ("Implement"), pressed in its middle.
    const name = await nodeAt(page, 'pressStepId', Number(step2Id), 0.5);
    await page.mouse.move(name.x, name.y);
    await page.mouse.down();
    await page.waitForTimeout(LONG_PRESS_MS + 200);
    await page.mouse.up();
    const stepEditor = page.getByTestId(`pipeline-viz-step-edit-${step2Id}`);
    await expect(stepEditor).toBeFocused();
    const step = await stepEditor.evaluate((el: HTMLInputElement) =>
      ({ start: el.selectionStart!, end: el.selectionEnd!, len: el.value.length }));
    expect(step.start).toBe(step.end);
    expect(step.start).toBeGreaterThan(0);
    expect(step.start).toBeLessThan(step.len);
    await page.keyboard.press('Escape');
  });
});
