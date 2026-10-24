import { test, expect } from '@playwright/test';

// Req #3792 — AI Architecture shows its own toolbar (the topology page's navbar,
// in a same-origin iframe), and an Action Popup docks against it by the Darwin
// navbar's rules: racked there, glowing for a drop, floating when dragged off,
// racking again when dropped back. Req #3886 — it is a SECOND rack beside the
// Darwin navbar's, not a take-over: both are drop zones at once, each keeps the
// popups dropped on it, and a minimized bar shows each of its popups as one
// icon in a box of the popup's frame colour. The dev build racks its own Dev
// Server panel in the Darwin navbar by default, so it starts there.
test.describe('AI Architecture toolbar rack (req #3792, #3886)', () => {
  test('TR-01: popups rack in either bar, stay there, and are icons while their bar is minimized', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto('/systems2?opt=tpu8t-superpod-3d');
    const frameEl = page.locator('iframe[title="NVLink System Views"]');
    const frame = page.frameLocator('iframe[title="NVLink System Views"]');
    const toolbar = frame.locator('nav.navbar');
    const rack = frame.getByTestId('toolbar-rack');
    const inToolbar = frame.getByTestId('devserver-info');
    const navZone = page.getByTestId('navbar-rack-zone');
    const inNavbar = page.getByTestId('navbar-rack-slot').getByTestId('devserver-info');
    const centre = (b: { x: number; y: number; width: number; height: number }) =>
      [b.x + b.width / 2, b.y + b.height / 2] as const;

    // Racked in the Darwin navbar, the toolbar beside it: it stays in the navbar.
    await expect(inNavbar).toHaveAttribute('data-racked', '1', { timeout: 20000 });
    await expect(rack).toHaveCount(1, { timeout: 20000 });
    await expect(inToolbar).toHaveCount(0);
    await expect(toolbar).toHaveAttribute('data-rack-drop', 'off');

    // Carried onto the toolbar, the toolbar glows in its frame colour and the
    // navbar does not; dropped there it racks in the toolbar.
    let [hx, hy] = centre((await page.getByTestId('devserver-info-title').boundingBox())!);
    const nav = (await toolbar.boundingBox())!;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(nav.x + nav.width / 2, 1000, { steps: 12 });
    await expect(toolbar).toHaveAttribute('data-rack-drop', 'over');
    await expect(navZone).toHaveAttribute('data-rack-drop', 'armed');
    expect(await toolbar.evaluate(el => getComputedStyle(el).boxShadow)).toContain('inset');
    await page.mouse.up();
    await expect(inToolbar).toHaveAttribute('data-racked', '1');
    await expect(inNavbar).toHaveCount(0);

    // Below the toolbar's buttons, at its width, styled as in the navbar.
    const rb = (await rack.boundingBox())!;
    let box = (await inToolbar.boundingBox())!;
    expect(Math.abs(box.x - rb.x)).toBeLessThan(1);
    expect(Math.abs(box.width - rb.width)).toBeLessThan(1);
    const buttonsBottom = await rack.evaluate(el => {
      const host = (el.getRootNode() as ShadowRoot).host;
      return host.previousElementSibling!.getBoundingClientRect().bottom;
    });
    const frameTop = (await frameEl.boundingBox())!.y;
    expect(box.y).toBeGreaterThanOrEqual(frameTop + buttonsBottom - 1);
    expect(box.y - (frameTop + buttonsBottom)).toBeLessThan(8);
    const look = await inToolbar.evaluate(el => {
      const cs = getComputedStyle(el);
      return { border: cs.borderTopColor, position: cs.position, radius: cs.borderTopLeftRadius, font: cs.fontFamily };
    });
    expect(look).toMatchObject({ border: 'rgb(255, 107, 53)', position: 'relative', radius: '0px' });
    expect(look.font).toContain('Mono');

    // The toolbar folded to its strip KEEPS it: one list icon in its orange box.
    await frame.getByTestId('topo-nav-collapse').click();
    const toolbarIcon = frame.getByTestId('devserver-info-rack-icon');
    await expect(toolbarIcon).toBeVisible();
    await expect(inNavbar).toHaveCount(0);
    expect(await toolbarIcon.evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgb(255, 107, 53)');
    await expect(toolbarIcon.locator('[data-testid="FormatListBulletedIcon"]')).toHaveCount(1);
    // Clicking the icon unfolds the toolbar: the whole popup again.
    await toolbarIcon.click();
    await expect(toolbar).not.toHaveClass(/nav-collapsed/);
    await expect(frame.getByTestId('devserver-info-title')).toBeVisible();

    // Its ▾ folds it in place, from inside the toolbar.
    await frame.getByTestId('devserver-info-toggle').click();
    await expect(frame.getByTestId('devserver-info-body')).toHaveAttribute('data-folded', '1');
    await frame.getByTestId('devserver-info-toggle').click();
    await expect(frame.getByTestId('devserver-info-body')).toHaveAttribute('data-folded', '0');

    // Dragged off the toolbar, it floats in Darwin's page where it was dropped.
    const tb = (await frame.getByTestId('devserver-info-title').boundingBox())!;
    box = (await inToolbar.boundingBox())!;
    [hx, hy] = centre(tb);
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(900, 500, { steps: 10 });
    await expect(toolbar).toHaveAttribute('data-rack-drop', 'armed');
    await page.mouse.up();
    const floating = page.getByTestId('devserver-info');
    await expect(floating).toHaveAttribute('data-racked', '0');
    await expect(inToolbar).toHaveCount(0);
    const fb = (await floating.boundingBox())!;
    expect(Math.abs(fb.x - (900 - (hx - box.x)))).toBeLessThan(3);
    expect(Math.abs(fb.y - (500 - (hy - box.y)))).toBeLessThan(3);

    // Back onto the toolbar, then from the toolbar straight onto the Darwin
    // navbar: lifted into Darwin's page on the way, never clipped by the frame.
    [hx, hy] = centre((await page.getByTestId('devserver-info-title').boundingBox())!);
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(nav.x + nav.width / 2, 1000, { steps: 12 });
    await page.mouse.up();
    await expect(inToolbar).toHaveAttribute('data-racked', '1');
    [hx, hy] = centre((await frame.getByTestId('devserver-info-title').boundingBox())!);
    const darwinNav = (await navZone.boundingBox())!;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(darwinNav.x + darwinNav.width / 2, 1000, { steps: 12 });
    await expect(navZone).toHaveAttribute('data-rack-drop', 'over');
    await expect(toolbar).toHaveAttribute('data-rack-drop', 'armed');
    const lifted = page.getByTestId('devserver-info');
    await expect(lifted).toHaveCount(1);
    await page.mouse.up();
    await expect(inNavbar).toHaveAttribute('data-racked', '1');
    await expect(inToolbar).toHaveCount(0);

    // The toolbar is not drawn over it any more: the navbar keeps it.
    await frame.getByTestId('topo-nav-collapse').click();
    await expect(inNavbar).toHaveCount(1);
    await frame.getByTestId('topo-nav-collapse').click();

    // The Darwin navbar minimized: its popup is one icon; a click unfolds it.
    await page.getByTestId('navbar-collapse-toggle').click();
    const navIcon = page.getByTestId('devserver-info-rack-icon');
    await expect(navIcon).toBeVisible();
    expect(await navIcon.evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgb(255, 107, 53)');
    await navIcon.click();
    await expect(page.getByTestId('devserver-info-title')).toBeVisible();
    await expect(inNavbar).toHaveAttribute('data-racked', '1');
  });
});
