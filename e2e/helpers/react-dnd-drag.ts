import { Page, Locator } from '@playwright/test';

/**
 * Simulate a react-dnd HTML5Backend drag-and-drop operation.
 *
 * Fires the full event sequence: dragstart → dragenter → dragover (×3) → drop → dragend
 * using a shared DataTransfer object (required by react-dnd).
 */
export async function dragAndDrop(page: Page, source: Locator, target: Locator): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('Could not get bounding boxes for drag source or target');
  }

  const src = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const tgt = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };

  await page.evaluate(
    ({ src, tgt }) => {
      const dataTransfer = new DataTransfer();

      const sourceEl = document.elementFromPoint(src.x, src.y);
      const targetEl = document.elementFromPoint(tgt.x, tgt.y);
      if (!sourceEl || !targetEl) {
        throw new Error('Elements not found at coordinates');
      }

      function fire(el: Element, type: string, x: number, y: number) {
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: x,
            clientY: y,
          }),
        );
      }

      fire(sourceEl, 'dragstart', src.x, src.y);
      fire(targetEl, 'dragenter', tgt.x, tgt.y);
      // react-dnd needs multiple dragover events to register a valid hover
      fire(targetEl, 'dragover', tgt.x, tgt.y);
      fire(targetEl, 'dragover', tgt.x, tgt.y);
      fire(targetEl, 'dragover', tgt.x, tgt.y);
      fire(targetEl, 'drop', tgt.x, tgt.y);
      fire(sourceEl, 'dragend', src.x, src.y);
    },
    { src, tgt },
  );
}
