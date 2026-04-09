import { Page, Locator } from '@playwright/test';

/**
 * Simulate a react-dnd TouchBackend drag-and-drop operation.
 *
 * The app uses TouchBackend with enableMouseEvents: true, so mouse events
 * (mousedown → mousemove → mouseup) trigger DnD, not DragEvent.
 *
 * This helper uses page.evaluate to dispatch events directly on the source
 * and target DOM elements, bypassing coordinate calculation issues (e.g., the
 * source element collapsing to 0 height in hand-sort mode shifts all sibling
 * elements during drag).
 *
 * The approach:
 * 1. mousedown on source element (captures drag source ID in TouchBackend)
 * 2. mousemove away from source (>1px triggers beginDrag)
 * 3. mousemove over target element (registers hover → sets insertIndex)
 * 4. mouseup on target element (triggers drop)
 */
export async function dragAndDrop(page: Page, source: Locator, target: Locator): Promise<void> {
  // Get data-testid values for element lookup in page.evaluate
  const sourceTestId = await source.getAttribute('data-testid');
  const targetTestId = await target.getAttribute('data-testid');

  if (!sourceTestId || !targetTestId) {
    throw new Error('Source and target must have data-testid attributes');
  }

  await page.evaluate(
    async ({ sourceTestId, targetTestId }) => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      const sourceEl = document.querySelector(`[data-testid="${sourceTestId}"]`);
      const targetEl = document.querySelector(`[data-testid="${targetTestId}"]`);
      if (!sourceEl || !targetEl) {
        throw new Error(`Elements not found: source=${sourceTestId}, target=${targetTestId}`);
      }

      const srcRect = sourceEl.getBoundingClientRect();
      const srcX = srcRect.left + 12;
      const srcY = srcRect.top + srcRect.height / 2;

      function fireMouseEvent(el: Element, type: string, x: number, y: number) {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: type === 'mouseup' ? 0 : 1,
          clientX: x,
          clientY: y,
        }));
      }

      // Step 1: mousedown on source
      fireMouseEvent(sourceEl, 'mousedown', srcX, srcY);
      await delay(50);

      // Step 2: mousemove to trigger drag start (>1px from press position)
      fireMouseEvent(sourceEl, 'mousemove', srcX + 20, srcY);
      await delay(100);

      // Step 3: Re-read target position (source may have collapsed)
      const tgtRect = targetEl.getBoundingClientRect();
      const tgtX = tgtRect.left + tgtRect.width / 2;
      const tgtY = tgtRect.top + tgtRect.height * 0.75;

      // Step 4: mousemove to target (multiple moves for hover detection)
      fireMouseEvent(targetEl, 'mousemove', tgtX, tgtY);
      await delay(100);
      fireMouseEvent(targetEl, 'mousemove', tgtX + 3, tgtY);
      await delay(100);
      fireMouseEvent(targetEl, 'mousemove', tgtX - 3, tgtY);
      await delay(100);
      fireMouseEvent(targetEl, 'mousemove', tgtX, tgtY);
      await delay(100);

      // Step 5: mouseup to complete the drop
      fireMouseEvent(targetEl, 'mouseup', tgtX, tgtY);
    },
    { sourceTestId, targetTestId }
  );
}
