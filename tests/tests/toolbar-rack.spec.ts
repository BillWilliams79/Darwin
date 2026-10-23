import { test, expect } from '@playwright/test';

// Req #3792 — AI Architecture shows its own toolbar (the topology page's navbar,
// in a same-origin iframe), and every Action Popup docks against
// it by the Darwin navbar's rules: racked there, glowing for a drop, floating
// when dragged off, racking again when dropped back. The dev build racks its
// own Dev Server panel by default, so it starts in the toolbar.
test.describe('AI Architecture toolbar rack (req #3792)', () => {
  test('TR-01: the Action Popups rack in the AI Architecture toolbar, float off it, and rack back', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto('/systems2?opt=tpu8t-superpod-3d');
    const frame = page.frameLocator('iframe[title="NVLink System Views"]');
    const toolbar = frame.locator('nav.navbar');
    const rack = frame.getByTestId('toolbar-rack');
    const racked = frame.getByTestId('devserver-info');

    // Racked in the toolbar, below its buttons, at its width — not in the navbar.
    await expect(racked).toHaveAttribute('data-racked', '1', { timeout: 20000 });
    await expect(page.getByTestId('navbar-rack-slot').locator('[data-rack-id]')).toHaveCount(0);
    await expect(toolbar).toHaveAttribute('data-rack-drop', 'off');
    const rb = (await rack.boundingBox())!;
    let box = (await racked.boundingBox())!;
    expect(Math.abs(box.x - rb.x)).toBeLessThan(1);
    expect(Math.abs(box.width - rb.width)).toBeLessThan(1);
    const buttonsBottom = await rack.evaluate(el => {
      const host = (el.getRootNode() as ShadowRoot).host;
      return host.previousElementSibling!.getBoundingClientRect().bottom;
    });
    const frameTop = (await page.locator('iframe[title="NVLink System Views"]').boundingBox())!.y;
    expect(box.y).toBeGreaterThanOrEqual(frameTop + buttonsBottom - 1);
    // As close under the buttons as in the navbar: its 6px, not the toolbar's section gap.
    expect(box.y - (frameTop + buttonsBottom)).toBeLessThan(8);
    // Styled as in the navbar: its own orange frame, square, in the rack's flow.
    const look = await racked.evaluate(el => {
      const cs = getComputedStyle(el);
      return { border: cs.borderTopColor, position: cs.position, radius: cs.borderTopLeftRadius, font: cs.fontFamily };
    });
    expect(look).toMatchObject({ border: 'rgb(255, 107, 53)', position: 'relative', radius: '0px' });
    expect(look.font).toContain('Mono');

    // Dragged off the toolbar, it floats in Darwin's page where it was dropped.
    const title = frame.getByTestId('devserver-info-title');
    const tb = (await title.boundingBox())!;
    const gx = tb.x + tb.width / 2;
    const gy = tb.y + tb.height / 2;
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(900, 500, { steps: 10 });
    await expect(toolbar).toHaveAttribute('data-rack-drop', 'armed');
    await page.mouse.up();
    const floating = page.getByTestId('devserver-info');
    await expect(floating).toHaveAttribute('data-racked', '0');
    await expect(racked).toHaveCount(0);
    await expect(toolbar).toHaveAttribute('data-rack-drop', 'off');
    const fb = (await floating.boundingBox())!;
    expect(Math.abs(fb.x - (900 - (gx - box.x)))).toBeLessThan(3);
    expect(Math.abs(fb.y - (500 - (gy - box.y)))).toBeLessThan(3);

    // Carried back over the toolbar it glows in the window's frame colour;
    // dropped there it racks again. The Darwin navbar is no drop zone here.
    const ft = (await page.getByTestId('devserver-info-title').boundingBox())!;
    const nav = (await toolbar.boundingBox())!;
    await page.mouse.move(ft.x + ft.width / 2, ft.y + ft.height / 2);
    await page.mouse.down();
    const darwinNav = (await page.getByTestId('navbar-rack-zone').boundingBox())!;
    await page.mouse.move(darwinNav.x + darwinNav.width / 2, 900, { steps: 10 });
    await expect(page.getByTestId('navbar-rack-zone')).toHaveAttribute('data-rack-drop', 'off');
    await expect(toolbar).toHaveAttribute('data-rack-drop', 'armed');
    await page.mouse.move(nav.x + nav.width / 2, 1000, { steps: 10 });
    await expect(toolbar).toHaveAttribute('data-rack-drop', 'over');
    expect(await toolbar.evaluate(el => getComputedStyle(el).boxShadow)).toContain('inset');
    await page.mouse.up();
    await expect(racked).toHaveAttribute('data-racked', '1');
    await expect(page.getByTestId('devserver-info')).toHaveCount(0);
    box = (await racked.boundingBox())!;
    expect(Math.abs(box.x - rb.x)).toBeLessThan(1);

    // Dragged out over Darwin's own navbar, it follows the pointer there — lifted
    // into Darwin's page, never clipped by the frame — and floats where dropped.
    const t2 = (await title.boundingBox())!;
    const r2 = (await racked.boundingBox())!;
    await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2);
    await page.mouse.down();
    await page.mouse.move(150, 700, { steps: 12 });
    const lifted = page.getByTestId('devserver-info');
    await expect(lifted).toHaveCount(1);
    const lb = (await lifted.boundingBox())!;
    expect(Math.abs(lb.x - Math.max(0, 150 - (t2.x + t2.width / 2 - r2.x)))).toBeLessThan(3);
    expect(await lifted.evaluate((el, at) => !!document.elementFromPoint(at.x, at.y)?.closest('[data-testid="devserver-info"]'),
      { x: lb.x + 4, y: lb.y + 4 })).toBe(true);
    await page.mouse.up();
    await expect(lifted).toHaveAttribute('data-racked', '0');
    await expect(racked).toHaveCount(0);
    // …and back onto the toolbar.
    const t3 = (await page.getByTestId('devserver-info-title').boundingBox())!;
    await page.mouse.move(t3.x + t3.width / 2, t3.y + t3.height / 2);
    await page.mouse.down();
    await page.mouse.move(nav.x + nav.width / 2, 1000, { steps: 12 });
    await page.mouse.up();
    await expect(racked).toHaveAttribute('data-racked', '1');

    // Its ▾ folds it in place, from inside the toolbar.
    await frame.getByTestId('devserver-info-toggle').click();
    await expect(frame.getByTestId('devserver-info-body')).toHaveAttribute('data-folded', '1');
    await frame.getByTestId('devserver-info-toggle').click();
    await expect(frame.getByTestId('devserver-info-body')).toHaveAttribute('data-folded', '0');

    // The toolbar folded to its strip gives the windows back to the Darwin navbar.
    await frame.getByTestId('topo-nav-collapse').click();
    await expect(page.getByTestId('devserver-info')).toHaveAttribute('data-racked', '1');
    await expect(page.getByTestId('navbar-rack-slot').getByTestId('devserver-info')).toHaveCount(1);
    await frame.getByTestId('topo-nav-collapse').click();
    await expect(racked).toHaveAttribute('data-racked', '1');
  });
});
