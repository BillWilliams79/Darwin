import { test, expect } from '@playwright/test';

test.describe('Dev Servers View', () => {
  test('DEV-01: /devservers renders DataGrid', async ({ page }) => {
    await page.goto('/devservers');
    await expect(page.getByTestId('dev-servers-datagrid')).toBeVisible({ timeout: 10000 });
  });

  test('DEV-02: Dev Servers navbar link navigates correctly', async ({ page }) => {
    await page.goto('/taskcards');
    await page.getByRole('link', { name: /dev servers/i }).click();
    await expect(page).toHaveURL(/\/devservers/);
    await expect(page.getByTestId('dev-servers-datagrid')).toBeVisible({ timeout: 10000 });
  });

  test('DEV-03: Dev Servers page shows heading', async ({ page }) => {
    await page.goto('/devservers');
    await expect(page.getByRole('heading', { name: 'Dev Servers' })).toBeVisible({ timeout: 10000 });
  });

  // Req #3643 — the viewport-docked dashboard. auth.setup hands every spec the
  // dashboard hidden; this one turns it on from the page chip and checks the
  // anchored-collapse pattern (memory/anchored-collapse-pattern.md) in a real
  // layout: the head row is on top and its ▾ never moves when clicked — from
  // the bottom-right home, where folding must re-anchor the panel to the top —
  // a move keeps the head under the pointer, an edge reshapes, and the spot
  // survives a page change.
  test('DEV-04: Dev Servers dashboard collapses into its head, moves, reshapes, hides', async ({ page }) => {
    // Rows wider than the head, so a fold that let the panel shrink to the
    // head's width would move a right-docked head sideways — the defect the
    // head-position checks below exist to catch. (The E2E user has no dev
    // servers of its own.)
    const rows = [3001, 3002, 3003].map((port, i) => ({
      id: 900 + i, port, pid: 1, machine_fk: null, session_fk: null, terminal_number: 10 + i,
      workspace_path: `/x/sessions/36${40 + i}-a-long-enough-session-name-to-widen-it-${i}`,
      started_at: '2026-10-19T00:00:00', create_ts: '2026-10-19T00:00:00',
    }));
    await page.route(/\/dev_servers(\?|$)/, r => r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
      : r.continue());
    await page.goto('/devservers');
    const chip = page.getByTestId('dev-servers-page-dashboard-chip');
    await expect(chip).toHaveAttribute('aria-pressed', 'false', { timeout: 10000 });
    await chip.click();
    const dash = page.getByTestId('devserver-dashboard');
    await expect(dash).toBeVisible();
    await expect(dash).toHaveAttribute('data-dock', 'r16,b16');

    // THE HEAD IS THE ANCHOR: collapse and expand leave it exactly in place.
    const head = page.getByTestId('devserver-dashboard-toggle');
    const at = async () => { const b = await head.boundingBox(); if (!b) throw new Error('no head'); return b; };
    await expect(page.getByTestId('devserver-dashboard-count')).toHaveText('3');
    // The head row is the panel's top row.
    const panelBox = (await dash.boundingBox())!;
    const headBox = (await page.getByTestId('devserver-dashboard-header').boundingBox())!;
    expect(headBox.y - panelBox.y).toBeLessThan(4);
    const open0 = await at();
    const open0Panel = (await dash.boundingBox())!;
    await head.click();
    await expect(page.getByTestId('devserver-dashboard-body')).toHaveAttribute('data-folded', '1');
    const folded = await at();
    expect(Math.abs(folded.x - open0.x)).toBeLessThan(1);
    expect(Math.abs(folded.y - open0.y)).toBeLessThan(1);
    // Folded tight: × follows the title, and the right edge pulled in to it.
    const tight = (await dash.boundingBox())!;
    const close = (await page.getByTestId('devserver-dashboard-close').boundingBox())!;
    const title = (await page.getByTestId('devserver-dashboard-title').boundingBox())!;
    expect(tight.width).toBeLessThan(open0Panel.width - 100);
    expect(close.x - (title.x + title.width)).toBeLessThan(15);
    expect(tight.x + tight.width - (close.x + close.width)).toBeLessThan(15);
    await head.click();
    await expect(page.getByTestId('devserver-dashboard-body')).toHaveAttribute('data-folded', '0');
    const open1 = await at();
    expect(Math.abs(open1.x - open0.x)).toBeLessThan(1);
    expect(Math.abs(open1.y - open0.y)).toBeLessThan(1);
    // …and it is bottom-anchored again, so it keeps its corner as the window resizes.
    await expect(dash).toHaveAttribute('data-dock', /^r16,b\d+$/);

    // Folded at home — the head on the very bottom edge — unfolding has no room
    // below the head, so the panel rises just enough to show every row.
    await head.click();
    await page.getByTestId('devserver-dashboard-title').dblclick();
    await expect(dash).toHaveAttribute('data-dock', 'r16,b16');
    await head.click();
    const body = page.getByTestId('devserver-dashboard-body');
    await expect(body).toHaveAttribute('data-folded', '0');
    await expect.poll(async () => {
      const b = (await body.boundingBox())!;
      return b.height;
    }).toBeGreaterThan(50);
    const risen = (await dash.boundingBox())!;
    expect(risen.y + risen.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const open2 = await at();

    // A move: the head row's non-button space (the title) is the handle.
    const badge = await page.getByTestId('devserver-dashboard-count').boundingBox();
    if (!badge) throw new Error('no badge');
    const grabX = badge.x + badge.width + 6;
    const grabY = badge.y + badge.height / 2;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(300, 200, { steps: 8 });
    await page.mouse.up();
    await expect(dash).toHaveAttribute('data-dock', /^l\d+,t\d+$/);
    // The panel moved rigidly: its head is where the pointer left it.
    const dropped = await at();
    expect(Math.abs(dropped.y + (grabY - open2.y) - 200)).toBeLessThan(3);

    // Reshape from the bottom edge: taller, and only taller.
    const before = await dash.boundingBox();
    if (!before) throw new Error('no panel');
    const edge = await page.getByTestId('devserver-dashboard-edge-s').boundingBox();
    if (!edge) throw new Error('no bottom edge');
    const ex = edge.x + edge.width / 2;
    const ey = edge.y + edge.height / 2;
    await page.mouse.move(ex, ey);
    await page.mouse.down();
    await page.mouse.move(ex, ey + 120, { steps: 6 });
    await page.mouse.up();
    const after = await dash.boundingBox();
    if (!after) throw new Error('no panel');
    expect(after.height).toBeGreaterThan(before.height + 100);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    const docked = await dash.getAttribute('data-dock');

    await page.goto('/taskcards');
    await expect(page.getByTestId('devserver-dashboard')).toHaveAttribute('data-dock', docked!, { timeout: 10000 });

    await page.getByTestId('devserver-dashboard-close').click();
    await expect(page.getByTestId('devserver-dashboard')).toHaveCount(0);
  });
});
