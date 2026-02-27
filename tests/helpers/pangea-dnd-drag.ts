import { Page, Locator } from '@playwright/test';

/**
 * Simulate a @hello-pangea/dnd drag-and-drop operation using native mouse events.
 *
 * @hello-pangea/dnd uses a "sloppy click" threshold (5px movement required before
 * drag initiates via its mouse sensor). This helper:
 * 1. Hovers the source to ensure correct element targeting
 * 2. mousedown + small move with steps to exceed sloppy-click threshold
 * 3. Smooth multi-step move to target position
 * 4. mouseup to complete the drop
 *
 * The `steps` parameter on mouse.move generates intermediate mousemove events
 * that @hello-pangea/dnd's sensor needs to detect drag initiation and track position.
 */
export async function pangeaDragAndDrop(page: Page, source: Locator, target: Locator): Promise<void> {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('Could not get bounding boxes for drag source or target');
  }

  const srcX = sourceBox.x + sourceBox.width / 2;
  const srcY = sourceBox.y + sourceBox.height / 2;
  // Target above the target element's center so @hello-pangea/dnd's center-line
  // comparison places the dragged item before the target
  const tgtX = targetBox.x + targetBox.width / 2;
  const tgtY = targetBox.y + targetBox.height / 4;

  // Hover source to ensure Playwright targets the correct element
  await source.hover();
  await page.waitForTimeout(200);

  // Press mouse button at source center
  await page.mouse.down();
  await page.waitForTimeout(150);

  // Move with steps to exceed the 5px sloppy-click threshold and trigger fluidLift
  // Using steps generates intermediate mousemove events the sensor needs
  await page.mouse.move(srcX, srcY - 15, { steps: 5 });
  await page.waitForTimeout(200);

  // Smooth multi-step move to target position
  await page.mouse.move(tgtX, tgtY, { steps: 20 });
  await page.waitForTimeout(300);

  // Release and wait for drop animation + API PUT to complete
  await page.mouse.up();
  await page.waitForTimeout(1000);
}
