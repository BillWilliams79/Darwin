import { test, expect, type Page } from '@playwright/test';

// The dashboard sizes to its rows, and they land over several reads (the dev
// servers, then the machines, then each row's requirement title), so a
// content-sized panel docked bottom-right grows up and left while they arrive
// — and carries its head with it. Measured (req #3783): grabbed while the badge
// still read "…", the head was at y=1355; ~50ms–1s later the rows had landed
// and it was at y=1311, so the press fell on a row, no drag began, and the
// navbar never armed. Start a head gesture only once the count is final and
// the head has stopped moving.
async function settledDashboardHead(page: Page, count: string) {
  const badge = page.getByTestId('devserver-dashboard-count');
  await expect(badge).toHaveText(count, { timeout: 10000 });
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await badge.boundingBox());
    const still = now === last;
    last = now;
    return still;
  }, { intervals: [250] }).toBe(true);
}

test.describe('Dev Servers View', () => {
  test('DEV-01: /devservers renders DataGrid', async ({ page }) => {
    await page.goto('/devservers');
    await expect(page.getByTestId('dev-servers-datagrid')).toBeVisible({ timeout: 10000 });
  });

  test('DEV-02: Dev Servers navbar link navigates correctly', async ({ page }) => {
    await page.goto('/taskcards');
    // Req #3771 — Dev Servers is an L3 under Sessions, hidden until it is expanded.
    await page.getByTestId('nav-expand-toggle-swarm-sessions').click();
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
  // Req #3720 — the dashboard is RACKABLE: dragged onto the Darwin navbar, the
  // navbar glows in the panel's frame colour (req #3728); dropped, the
  // panel takes the navbar's width and locks in below the nav buttons; dragged
  // back off, it floats.
  test('DEV-05: Dev Servers dashboard racks into the navbar and floats back out', async ({ page }) => {
    // Tall enough for the whole nav list and the panel below it: the nav list
    // takes all the height it wants, the rack only the rest (req #3751).
    await page.setViewportSize({ width: 1280, height: 1400 });
    const rows = [3001, 3002].map((port, i) => ({
      id: 950 + i, port, pid: 1, machine_fk: null, session_fk: null, terminal_number: 20 + i,
      workspace_path: `/x/sessions/37${20 + i}-make-dev-server-rackable-${i}`,
      started_at: '2026-10-20T00:00:00', create_ts: '2026-10-20T00:00:00',
    }));
    await page.route(/\/dev_servers(\?|$)/, r => r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
      : r.continue());
    await page.goto('/devservers');
    const chip = page.getByTestId('dev-servers-page-dashboard-chip');
    await expect(chip).toBeVisible({ timeout: 10000 });
    if ((await chip.getAttribute('aria-pressed')) === 'false') await chip.click();
    const dash = page.getByTestId('devserver-dashboard');
    await expect(dash).toHaveAttribute('data-racked', '0');
    const zone = page.getByTestId('navbar-rack-zone');
    await expect(zone).toHaveAttribute('data-rack-drop', 'off');

    await settledDashboardHead(page, '2');
    const badge = (await page.getByTestId('devserver-dashboard-count').boundingBox())!;
    const grabX = badge.x + badge.width + 6;
    const grabY = badge.y + badge.height / 2;
    const nav = (await zone.boundingBox())!;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(600, 400, { steps: 6 });
    // Moving anywhere: the navbar does not change in any way (req #3728).
    await expect(zone).toHaveAttribute('data-rack-drop', 'armed');
    const navLook = () => zone.evaluate(el => {
      const cs = getComputedStyle(el.firstElementChild!);
      return { outline: cs.outlineStyle, bg: cs.backgroundColor, glow: cs.boxShadow };
    });
    const idle = await navLook();
    expect(idle.glow).toBe('none');
    await page.mouse.move(nav.x + nav.width / 2, nav.y + nav.height * 0.8, { steps: 8 });
    // Over the navbar: only a glow in the panel's frame purple — no
    // text, no landing zone, no outline or background change.
    await expect(zone).toHaveAttribute('data-rack-drop', 'over');
    // The glow's colour is the dashboard's own frame colour at 75%:
    // resolved by the browser the same way on a probe, compared once the
    // glow's transition has settled.
    const glowColour = (shadow: string) => shadow.match(/^\w+\([^)]*\)/)?.[0] ?? shadow;
    const expected = await dash.evaluate(el => {
      const probe = document.createElement('div');
      probe.style.boxShadow = `inset 0 0 1px color-mix(in srgb, ${getComputedStyle(el).borderTopColor} 75%, transparent)`;
      document.body.appendChild(probe);
      const shadow = getComputedStyle(probe).boxShadow;
      probe.remove();
      return shadow;
    });
    await expect.poll(async () => glowColour((await navLook()).glow)).toBe(glowColour(expected));
    const over = await navLook();
    expect(over.outline).toBe(idle.outline);
    expect(over.bg).toBe(idle.bg);
    await expect(page.getByTestId('navbar-rack-drop')).toHaveCount(0);
    await expect(zone.getByText('Drop to rack', { exact: true })).toHaveCount(0);
    await page.mouse.up();
    await expect(zone).toHaveAttribute('data-rack-drop', 'off');

    // Racked: the navbar's width, below the nav buttons, inside the navbar.
    await expect(dash).toHaveAttribute('data-racked', '1');
    const racked = (await dash.boundingBox())!;
    expect(Math.abs(racked.x - nav.x)).toBeLessThan(1);
    expect(Math.abs(racked.width - nav.width)).toBeLessThan(1);
    const navLinks = (await page.locator('[data-testid="navbar-rack"]').evaluate(
      el => el.previousElementSibling!.getBoundingClientRect().bottom));
    expect(racked.y).toBeGreaterThanOrEqual(navLinks - 1);
    // Whole and on top: nothing in the navbar covers it.
    expect(racked.y + racked.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const hit = async () => page.getByTestId('devserver-dashboard-count').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width + 6, r.top + r.height / 2);
      return !!at?.closest('[data-testid="devserver-dashboard"]');
    });
    expect(await hit()).toBe(true);
    await expect(page.getByTestId('devserver-dashboard-count')).toHaveText('2');

    // It stays racked across a page change.
    await page.goto('/taskcards');
    await expect(page.getByTestId('devserver-dashboard')).toHaveAttribute('data-racked', '1', { timeout: 10000 });
    await expect(page.getByTestId('devserver-dashboard-count')).toHaveText('2');
    // The navbar is still settling (its groups load and open): grab the head
    // only once it has stopped moving.
    let last = '';
    await expect.poll(async () => {
      const b = await page.getByTestId('devserver-dashboard-count').boundingBox();
      const now = JSON.stringify(b);
      const still = now === last;
      last = now;
      return still;
    }, { intervals: [250] }).toBe(true);
    expect(await hit()).toBe(true);

    // Dragged off the navbar, it floats again where it was dropped.
    const b2 = (await page.getByTestId('devserver-dashboard-count').boundingBox())!;
    const inRack = (await page.getByTestId('devserver-dashboard').boundingBox())!;
    const gx = b2.x + b2.width + 6;
    const gy = b2.y + b2.height / 2;
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(700, 300, { steps: 8 });
    await page.mouse.up();
    const out = page.getByTestId('devserver-dashboard');
    await expect(out).toHaveAttribute('data-racked', '0');
    // Drawn where it was dropped — its left and top under the pointer as it
    // was grabbed — whichever sides it then docks to.
    await expect(out).toHaveAttribute('data-dock', /^[lr]\d+,[tb]\d+$/);
    const floated = (await out.boundingBox())!;
    expect(Math.abs(floated.x - (700 - (gx - inRack.x)))).toBeLessThan(3);
    expect(Math.abs(floated.y - (300 - (gy - inRack.y)))).toBeLessThan(3);
  });
  // Req #3744 (reversing #3729's top) — "first in, at the bottom", then drag
  // to reorder. The dev build racks its own Dev Server panel by default, so the
  // dashboard joins a stack of one: released BELOW the stack it lands last; its
  // head dragged up onto the Dev Server panel's upper half moves it above it —
  // still racked.
  test('DEV-06: a panel racked below the stack lands last, then reorders by drag', async ({ page }) => {
    // Tall enough that the navbar has empty room below the stack (re-sized to
    // the stack below, once it is drawn).
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.route(/\/dev_servers(\?|$)/, r => r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      : r.continue());
    await page.goto('/devservers');
    const info = page.getByTestId('devserver-info');
    await expect(info).toHaveAttribute('data-racked', '1', { timeout: 10000 });
    const chip = page.getByTestId('dev-servers-page-dashboard-chip');
    await expect(chip).toBeVisible({ timeout: 10000 });
    if ((await chip.getAttribute('aria-pressed')) === 'false') await chip.click();
    const dash = page.getByTestId('devserver-dashboard');
    await expect(dash).toHaveAttribute('data-racked', '0');
    const zone = page.getByTestId('navbar-rack-zone');
    const order = () => page.evaluate(() => JSON.parse(localStorage.getItem('darwin_panel_rack') || '{}').state?.racked);
    const grab = async () => {
      const b = (await page.getByTestId('devserver-dashboard-count').boundingBox())!;
      return [b.x + b.width + 6, b.y + b.height / 2];
    };

    // Room in the navbar below the stack. Where the stack ends is not this
    // test's to fix: the nav list above it is the account's (its apps, and on
    // /devservers the Sessions item open on its Dev Servers L3, req #3771) and
    // the Dev Server panel holds this dev server's own requirement title, up
    // to three lines. Measured (req #3783): nav list to 996.8px, panel 183.6px
    // with a three-line title — the stack ended at 1186.4px, past a fixed
    // 1200px viewport's room. So, as DEV-08 does, size the viewport to the
    // stack once the navbar has settled (its groups load and open).
    let lastEdge = '';
    await expect.poll(async () => {
      const now = JSON.stringify(await page.getByTestId('navbar-rack').boundingBox());
      const still = now === lastEdge;
      lastEdge = now;
      return still;
    }, { intervals: [250] }).toBe(true);
    const stackEnd = await page.getByTestId('navbar-rack').evaluate(el => el.getBoundingClientRect().bottom);
    await page.setViewportSize({ width: 1280, height: Math.max(1200, Math.ceil(stackEnd) + 240) });
    const nav = (await zone.boundingBox())!;
    // The rack stays as tall as its panels: the new room is below it.
    const rackBox = (await page.getByTestId('navbar-rack').boundingBox())!;
    expect(rackBox.y + rackBox.height).toBeLessThan(nav.height - 40);
    await settledDashboardHead(page, '0');
    // Released below the stack: last, under the Dev Server panel.
    let [gx, gy] = await grab();
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(600, 400, { steps: 6 });
    await page.mouse.move(nav.x + nav.width / 2, nav.y + nav.height - 20, { steps: 8 });
    await expect(zone).toHaveAttribute('data-rack-drop', 'over');
    await page.mouse.up();
    await expect(dash).toHaveAttribute('data-racked', '1');
    expect((await order()).slice(0, 2)).toEqual(['devserver-info', 'devservers']);
    expect((await dash.boundingBox())!.y).toBeGreaterThan((await info.boundingBox())!.y);

    // Dragged up onto the Dev Server panel's upper half: reordered above it.
    let last = '';
    await expect.poll(async () => {
      const now = JSON.stringify(await info.boundingBox());
      const still = now === last;
      last = now;
      return still;
    }, { intervals: [250] }).toBe(true);
    [gx, gy] = await grab();
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    const ib = (await info.boundingBox())!;
    await page.mouse.move(gx, ib.y + 4, { steps: 10 });
    await expect(zone).toHaveAttribute('data-rack-drop', 'over');
    await page.mouse.up();
    await expect(dash).toHaveAttribute('data-racked', '1');
    expect((await order()).slice(0, 2)).toEqual(['devservers', 'devserver-info']);
    expect((await dash.boundingBox())!.y).toBeLessThan((await info.boundingBox())!.y);
  });

  // Req #3747 — a racked panel takes only the space its content needs. Three
  // dev servers used to stretch across the whole bottom of the navbar; now the
  // dashboard is as tall as its rows and the rack ends below the last panel.
  // When the rows outgrow the navbar, the panels share it fairly: the small Dev
  // Server panel keeps all of its content and the dashboard scrolls the rest.
  test('DEV-07: racked panels take only the height they need, and share a short navbar fairly', async ({ page }) => {
    // Room below the whole nav list for three rows (req #3751: the nav list is
    // never squeezed for the rack).
    await page.setViewportSize({ width: 1280, height: 1400 });
    const row = (i: number) => ({
      id: 970 + i, port: 3001 + i, pid: 1, machine_fk: null, session_fk: null, terminal_number: 30 + i,
      workspace_path: `/x/sessions/37${47 + i}-info-pop-up-in-navbar-${i}`,
      started_at: '2026-10-21T00:00:00', create_ts: '2026-10-21T00:00:00',
    });
    let rows = [0, 1, 2].map(row);
    await page.route(/\/dev_servers(\?|$)/, r => r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
      : r.continue());
    await page.goto('/devservers');
    const info = page.getByTestId('devserver-info');
    await expect(info).toHaveAttribute('data-racked', '1', { timeout: 10000 });
    const chip = page.getByTestId('dev-servers-page-dashboard-chip');
    await expect(chip).toBeVisible({ timeout: 10000 });
    if ((await chip.getAttribute('aria-pressed')) === 'false') await chip.click();
    const dash = page.getByTestId('devserver-dashboard');
    await expect(dash).toHaveAttribute('data-racked', '0');
    const items = page.locator('[data-testid^="devserver-dashboard-item-"]');
    await expect(items).toHaveCount(3);
    await settledDashboardHead(page, '3');
    const zone = page.getByTestId('navbar-rack-zone');
    const nav = (await zone.boundingBox())!;
    const b = (await page.getByTestId('devserver-dashboard-count').boundingBox())!;
    await page.mouse.move(b.x + b.width + 6, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(600, 400, { steps: 6 });
    await page.mouse.move(nav.x + nav.width / 2, nav.y + nav.height - 20, { steps: 8 });
    await expect(zone).toHaveAttribute('data-rack-drop', 'over');
    await page.mouse.up();
    await expect(dash).toHaveAttribute('data-racked', '1');
    await expect(dash).toHaveAttribute('data-rack-open', '1');

    // Each body's drawn height, against the height its rows need — measured
    // from the rows themselves, not scrollHeight (which never reports less
    // than the drawn height, so it cannot see empty space).
    // From the body's top to the last row's bottom edge, so gaps and margins
    // between rows count.
    const fit = (testid: string) => page.getByTestId(`${testid}-body`).evaluate(el => {
      const cs = getComputedStyle(el);
      const top = el.getBoundingClientRect().top + parseFloat(cs.borderTopWidth) - el.scrollTop;
      const end = Math.max(...[...el.children].map(c =>
        c.getBoundingClientRect().bottom + parseFloat(getComputedStyle(c).marginBottom)));
      return { drawn: el.clientHeight,
        needs: Math.round(end - top + parseFloat(cs.paddingBottom)) };
    });
    const settle = async () => {
      let last = '';
      await expect.poll(async () => {
        const now = JSON.stringify([await fit('devserver-dashboard'), await fit('devserver-info')]);
        const still = now === last;
        last = now;
        return still;
      }, { intervals: [250] }).toBe(true);
    };
    await settle();

    // Three rows: no empty space inside either panel, none below the stack.
    for (const id of ['devserver-dashboard', 'devserver-info']) {
      const f = await fit(id);
      expect(Math.abs(f.drawn - f.needs), `${id} ${JSON.stringify(f)}`).toBeLessThanOrEqual(2);
    }
    const rackEdge = () => page.getByTestId('navbar-rack').evaluate(el => {
      const panels = [...el.querySelectorAll('[data-rack-id]')].map(p => p.getBoundingClientRect().bottom);
      return { rack: el.getBoundingClientRect().bottom, last: Math.max(...panels) };
    });
    const few = await rackEdge();
    expect(few.rack - few.last).toBeLessThanOrEqual(8);
    expect(few.rack).toBeLessThan(nav.y + nav.height - 100);

    // Rows past the navbar's height: the rack fills it, the small panel keeps
    // all of its content, the dashboard scrolls the rest.
    rows = Array.from({ length: 80 }, (_, i) => row(i));
    await page.reload();
    await expect(dash).toHaveAttribute('data-racked', '1', { timeout: 10000 });
    await expect(items).toHaveCount(80);
    await settle();
    const small = await fit('devserver-info');
    expect(Math.abs(small.drawn - small.needs), JSON.stringify(small)).toBeLessThanOrEqual(2);
    const big = await fit('devserver-dashboard');
    expect(big.needs, JSON.stringify(big)).toBeGreaterThan(big.drawn + 50);
    const many = await rackEdge();
    expect(many.rack).toBeGreaterThan(nav.y + nav.height - 20);
    expect(many.last).toBeLessThanOrEqual(nav.y + nav.height + 1);
  });

  // Req #3751 — the navbar's own options come first. An open racked panel used
  // to cap the nav list at 40vh, so the nav buttons scrolled; now the nav list
  // takes all the height it wants and the racked panels share what is left.
  test('DEV-08: the nav buttons take all the height they want; racked panels get the rest', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    const rows = Array.from({ length: 80 }, (_, i) => ({
      id: 990 + i, port: 3001 + i, pid: 1, machine_fk: null, session_fk: null, terminal_number: 40 + i,
      workspace_path: `/x/sessions/3751-darwin-ui-navbar-takes-precedence-${i}`,
      started_at: '2026-10-21T00:00:00', create_ts: '2026-10-21T00:00:00',
    }));
    await page.route(/\/dev_servers(\?|$)/, r => r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
      : r.continue());
    await page.goto('/devservers');
    await expect(page.getByTestId('devserver-info')).toHaveAttribute('data-racked', '1', { timeout: 10000 });
    const chip = page.getByTestId('dev-servers-page-dashboard-chip');
    await expect(chip).toBeVisible({ timeout: 10000 });
    if ((await chip.getAttribute('aria-pressed')) === 'false') await chip.click();
    const dash = page.getByTestId('devserver-dashboard');
    await settledDashboardHead(page, '80');
    const zone = page.getByTestId('navbar-rack-zone');
    const nav = (await zone.boundingBox())!;
    const b = (await page.getByTestId('devserver-dashboard-count').boundingBox())!;
    await page.mouse.move(b.x + b.width + 6, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(600, 400, { steps: 6 });
    await page.mouse.move(nav.x + nav.width / 2, nav.y + nav.height - 20, { steps: 8 });
    await page.mouse.up();
    await expect(dash).toHaveAttribute('data-racked', '1');
    await expect(dash).toHaveAttribute('data-rack-open', '1');
    // A short navbar: the whole nav list and 260px below it — less than the
    // two open panels need. (Before req #3751 the nav list was cut to 40vh.)
    const navEnd = await page.getByTestId('navbar-nav-list').evaluate(el => el.getBoundingClientRect().bottom);
    await page.setViewportSize({ width: 1280, height: Math.round(navEnd) + 260 });

    const look = () => page.evaluate(() => {
      const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      const list = q('navbar-nav-list'), body = q('navbar-body'), rack = q('navbar-rack');
      const panels = [...rack.querySelectorAll('[data-rack-id]')].map(p => p.getBoundingClientRect());
      return {
        listScroll: list.scrollHeight - list.clientHeight,
        listBottom: list.getBoundingClientRect().bottom,
        bodyScroll: body.scrollHeight - body.clientHeight,
        bodyBottom: body.getBoundingClientRect().bottom,
        rackTop: rack.getBoundingClientRect().top,
        rackBottom: rack.getBoundingClientRect().bottom,
        lastPanel: Math.max(...panels.map(r => r.bottom)),
      };
    });
    let last = '';
    await expect.poll(async () => {
      const now = JSON.stringify(await look());
      const still = now === last;
      last = now;
      return still;
    }, { intervals: [250] }).toBe(true);
    const l = await look();
    // The nav list is never scrolled or squeezed for the racked panels…
    expect(l.listScroll, JSON.stringify(l)).toBeLessThanOrEqual(1);
    expect(l.bodyScroll, JSON.stringify(l)).toBeLessThanOrEqual(1);
    // …and the rack takes exactly what is left below it, its panels inside it.
    expect(l.rackTop).toBeGreaterThanOrEqual(l.listBottom - 1);
    expect(Math.abs(l.rackBottom - l.bodyBottom), JSON.stringify(l)).toBeLessThanOrEqual(1);
    expect(l.lastPanel).toBeLessThanOrEqual(l.rackBottom + 1);
    // 80 rows do not fit: the dashboard scrolls inside its share.
    const big = await page.getByTestId('devserver-dashboard-body').evaluate(el => el.scrollHeight - el.clientHeight);
    expect(big).toBeGreaterThan(50);
  });

  // Req #3748 — each row's terminal and port are ONE two-sided pill, and the
  // dashboard must show both halves in full at every width it can be shaped
  // to: "Term N" content-sized or from 210px, "TN" narrower, stacked below
  // 144px. jsdom has no layout, so the fit is checked here: no row overflows
  // the body, and the port halves line up row to row.
  test('DEV-07: Dev Servers dashboard terminal|port pill fits at every width (req #3748)', async ({ page }) => {
    const rows = [[3001, 10], [3002, 3], [3003, null]].map(([port, terminal], i) => ({
      id: 970 + i, port, pid: 1, machine_fk: null, session_fk: null, terminal_number: terminal,
      workspace_path: `/x/sessions/37${48 + i}-trial-t2-3000-combo-button-${i}`,
      started_at: '2026-10-21T00:00:00', create_ts: '2026-10-21T00:00:00',
    }));
    await page.route(/\/dev_servers(\?|$)/, r => r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
      : r.continue());
    const cases: Array<[number | null, string]> = [
      [null, 'wide'], [420, 'wide'], [210, 'wide'], [209, 'short'], [152, 'short'],
      [144, 'short'], [143, 'stacked'], [120, 'stacked'],
    ];
    await page.goto('/devservers');
    for (const [w, size] of cases) {
      await page.evaluate((width) => {
        localStorage.setItem('darwin_devserver_dashboard', JSON.stringify({
          state: { show: true, open: true,
                   dock: width == null ? null : { h: 'r', x: 16, v: 'b', y: 16, w: width, ht: null } },
          version: 2 }));
        localStorage.setItem('darwin_panel_rack',
          JSON.stringify({ state: { racked: [], seeded: [] }, version: 1 }));
      }, w);
      await page.reload();
      const pills = page.locator('[data-testid^="devserver-dashboard-pill-"]');
      await expect(pills).toHaveCount(3, { timeout: 10000 });
      for (const pill of await pills.all()) await expect(pill).toHaveAttribute('data-size', size);
      const fit = await page.getByTestId('devserver-dashboard-body').evaluate((body) => {
        const right = body.getBoundingClientRect().left + body.clientWidth;
        const halves = [...body.querySelectorAll('[data-testid^="devserver-dashboard-port-"]')]
          .map(el => el.getBoundingClientRect());
        return { overflow: body.scrollWidth - body.clientWidth,
                 portRight: Math.max(...halves.map(r => r.right)) - right,
                 portLeft: halves.map(r => Math.round(r.left * 10) / 10) };
      });
      expect(fit.overflow, `width ${w}`).toBeLessThanOrEqual(0);
      expect(fit.portRight, `width ${w}`).toBeLessThanOrEqual(0.5);
      expect(new Set(fit.portLeft).size, `width ${w}: ports line up`).toBe(1);
    }
  });
});
