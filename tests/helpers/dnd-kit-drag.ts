import { Page, Locator, CDPSession } from '@playwright/test';

/**
 * Drive a dnd-kit drag the way a person does (req #3662).
 *
 * The react-dnd helper this replaced (deleted with react-dnd, req #3663) dispatched synthetic MouseEvents
 * from inside the page. dnd-kit listens for POINTER and TOUCH events and reads
 * real geometry, so this helper uses real input instead:
 *
 *   mouse  `page.mouse` — trusted pointer events. Press, travel past the 4 px
 *          activation distance, glide to the target in steps, release.
 *   touch  the Chrome DevTools Protocol's `Input.dispatchTouchEvent` —
 *          trusted touch events. Press, HOLD still past the lift delay, then
 *          move. (Playwright's touchscreen can only tap.)
 *
 * Each glide aims at its target's box as measured when that glide begins —
 * where a person aims, before the siblings slide aside — and a second glide
 * (`then`) is measured after the first, so a panel a tab hover-switch revealed
 * is aimed at where it actually appeared.
 *
 * Every DOM drag surface in the app is on dnd-kit — the editors, the Maps view
 * bar, Test Plans and the phone calendar list since req #3664, which removed
 * @hello-pangea/dnd and its helper, and the plan canvas's Orchestrables box
 * since req #3665. Only FullCalendar's desktop grid and the requirement marks
 * ON the plan canvas (Konva shapes) drag by other means — and those marks are
 * on the same press timeline, so this helper's touch input drives them too:
 * a source or target may be a client POINT instead of a locator (req #3665).
 */

/** Must match Darwin/src/dnd/pressTimeline.js. */
export const LIFT_DELAY_MS = 375;
export const TAB_HOVER_SWITCH_MS = 500;
export const LONG_PRESS_MS = 500;

type Where = 'center' | 'upper' | 'lower' | 'left' | 'right';

/** A client point — a spot on a canvas, where there is no element to aim at. */
export interface Point { x: number; y: number }

/** Where a drag starts or ends: an element, or a point on a canvas. */
export type Spot = Locator | Point;

const isPoint = (spot: Spot): spot is Point =>
  typeof (spot as Point).x === 'number' && typeof (spot as Point).y === 'number';

export interface DragOptions {
  /** Where on the source to press. Default 'center' — on the row's text. */
  grab?: Where;
  /** Where on the target to release. Default 'center'. */
  drop?: Where;
  /** Hover over the target this long before releasing (e.g. a tab hover-switch). */
  holdOverTargetMs?: number;
  /** After holding, continue to this locator before releasing (tab → panel). */
  then?: Locator;
  /** Where on `then` to release. Default 'center'. */
  thenDrop?: Where;
  /** Glide steps. */
  steps?: number;
  /** End the drag with Escape instead of releasing over the target. */
  cancelWithEscape?: boolean;
}

async function pointIn(spot: Spot, where: Where = 'center') {
  if (isPoint(spot)) return { x: spot.x, y: spot.y };
  const box = await spot.boundingBox();
  if (!box) throw new Error('dnd-kit-drag: element has no box (not visible?)');
  const x = where === 'left' ? box.x + Math.min(12, box.width / 4)
    : where === 'right' ? box.x + box.width - Math.min(12, box.width / 4)
    : box.x + box.width / 2;
  const y = where === 'upper' ? box.y + box.height * 0.25
    : where === 'lower' ? box.y + box.height * 0.75
    : box.y + box.height / 2;
  return { x, y };
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/**
 * Real input lands on whatever is on top. A MUI menu that was just used (the
 * card's sort menu) keeps its backdrop over the page while it fades out, and a
 * press there never reaches the item — wait for every popover to be gone.
 */
async function settle(page: Page) {
  await page.locator('.MuiPopover-root, .MuiMenu-root').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}

// ── Mouse ────────────────────────────────────────────────────────────────────

export async function dndKitDrag(page: Page, source: Locator, target: Locator, opts: DragOptions = {}) {
  await settle(page);
  await source.scrollIntoViewIfNeeded();
  const steps = opts.steps ?? 12;
  const start = await pointIn(source, opts.grab);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Past the 4 px activation distance, in two moves so the sensor sees travel.
  await page.mouse.move(start.x + 3, start.y + 3);
  await page.mouse.move(start.x + 8, start.y + 8);
  await pause(page, 60);

  const glide = async (to: Locator, where: Where | undefined, from: { x: number; y: number }) => {
    let last = from;
    // Aim where the target IS when the glide begins — siblings slide aside as
    // the item passes, and chasing the moving target lands one slot short.
    const end = await pointIn(to, where);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      last = { x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t };
      await page.mouse.move(last.x, last.y);
      await pause(page, 16);
    }
    return last;
  };

  let at = await glide(target, opts.drop, { x: start.x + 8, y: start.y + 8 });
  if (opts.holdOverTargetMs) {
    // Small jiggles so collision detection keeps re-reading the hovered target.
    const until = Date.now() + opts.holdOverTargetMs;
    while (Date.now() < until) {
      await page.mouse.move(at.x + 1, at.y);
      await pause(page, 80);
      await page.mouse.move(at.x, at.y);
      await pause(page, 80);
    }
  }
  if (opts.then) at = await glide(opts.then, opts.thenDrop, at);
  await pause(page, 120);
  if (opts.cancelWithEscape) {
    await page.keyboard.press('Escape');
    await page.mouse.up();
  } else {
    await page.mouse.up();
  }
  // Let the drop animation and the state update settle.
  await pause(page, 250);
}

// ── Touch ────────────────────────────────────────────────────────────────────

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x!), y: Math.round(y!), id: 1 }],
  });
}

export interface TouchDragOptions extends DragOptions {
  /** How long to hold still before moving. Default: past the lift delay. */
  holdMs?: number;
}

/** Press-and-hold, then drag, with real touch events. */
export async function dndKitTouchDrag(page: Page, source: Spot, target: Spot, opts: TouchDragOptions = {}) {
  await settle(page);
  if (!isPoint(source)) await source.scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  const steps = opts.steps ?? 14;
  const start = await pointIn(source, opts.grab);
  await touch(cdp, 'touchStart', start.x, start.y);
  await pause(page, opts.holdMs ?? LIFT_DELAY_MS + 120);

  const glide = async (to: Spot, where: Where | undefined, from: { x: number; y: number }) => {
    let last = from;
    // Aim where the target IS when the glide begins — siblings slide aside as
    // the item passes, and chasing the moving target lands one slot short.
    const end = await pointIn(to, where);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      last = { x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t };
      await touch(cdp, 'touchMove', last.x, last.y);
      await pause(page, 16);
    }
    return last;
  };

  let at = await glide(target, opts.drop, start);
  if (opts.holdOverTargetMs) {
    const until = Date.now() + opts.holdOverTargetMs;
    while (Date.now() < until) {
      await touch(cdp, 'touchMove', at.x + 1, at.y);
      await pause(page, 80);
      await touch(cdp, 'touchMove', at.x, at.y);
      await pause(page, 80);
    }
  }
  if (opts.then) at = await glide(opts.then, opts.thenDrop, at);
  await pause(page, 120);
  await touch(cdp, 'touchEnd');
  await pause(page, 250);
  await cdp.detach();
}

/**
 * A quick swipe that starts on a draggable and moves immediately — the case
 * that must SCROLL, never lift. Returns nothing; assert on scroll position.
 */
export async function touchSwipe(page: Page, on: Spot, dy: number, dx = 0) {
  const cdp = await page.context().newCDPSession(page);
  const start = await pointIn(on);
  await touch(cdp, 'touchStart', start.x, start.y);
  for (let i = 1; i <= 10; i++) {
    await touch(cdp, 'touchMove', start.x + (dx * i) / 10, start.y + (dy * i) / 10);
    await pause(page, 16);
  }
  await touch(cdp, 'touchEnd');
  await pause(page, 300);
  await cdp.detach();
}

/** Press and hold in place with touch for `ms`, then release where pressed. */
export async function touchHold(page: Page, on: Spot, ms: number) {
  const cdp = await page.context().newCDPSession(page);
  const start = await pointIn(on);
  await touch(cdp, 'touchStart', start.x, start.y);
  await pause(page, ms);
  await touch(cdp, 'touchEnd');
  await pause(page, 250);
  await cdp.detach();
}

/** Keyboard drag: focus the item, Space lifts, `moves` arrow presses, Space drops. */
export async function dndKitKeyboardDrag(page: Page, source: Locator, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', moves: number) {
  await source.focus();
  await page.keyboard.press('Space');
  await pause(page, 120);
  for (let i = 0; i < moves; i++) {
    await page.keyboard.press(key);
    await pause(page, 120);
  }
  await page.keyboard.press('Space');
  await pause(page, 300);
}
