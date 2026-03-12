import { Page, Locator } from '@playwright/test';

/**
 * Simulate a react-dnd TouchBackend drag-and-drop operation.
 *
 * Uses Playwright's native mouse API (mousedown → mousemove → mouseup)
 * which matches what TouchBackend (enableMouseEvents: true) listens for.
 *
 * HTML5 DragEvents (dragstart/dragover/drop) are ignored by TouchBackend.
 *
 * A 100ms pause after mousedown lets TouchBackend's internal handleTopMoveStart
 * callback (deferred via setTimeout(0)) fire before the first mousemove arrives,
 * ensuring the drag is fully initialized before we move toward the target.
 */
export async function dragAndDrop(page: Page, source: Locator, target: Locator): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('Could not get bounding boxes for drag source or target');
  }

  const srcX = sourceBox.x + sourceBox.width / 2;
  const srcY = sourceBox.y + sourceBox.height / 2;
  const tgtX = targetBox.x + targetBox.width / 2;
  const tgtY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(srcX, srcY);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(tgtX, tgtY, { steps: 10 });
  await page.waitForTimeout(50);
  await page.mouse.up();
}
