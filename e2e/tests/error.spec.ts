import { test, expect } from '@playwright/test';

test.describe('Error Handling P1', () => {

  test('ERR-01: API error shows snackbar', async ({ page }) => {
    // Intercept API calls to return a 500 error.
    // The Darwin API base URL is used by call_rest_api via darwinUri.
    // We intercept the tasks endpoint to trigger an error when TaskPlanView loads tasks.
    await page.route('**/eng/darwin/tasks**', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
    });

    // Navigate to a view that fetches tasks — TaskPlanView loads tasks per area
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Click on a domain tab to trigger task fetching
    // The first tab should be pre-selected, but click it to ensure it loads
    const firstTab = page.locator('[role="tab"]').first();
    await firstTab.click();
    await page.waitForTimeout(2000);

    // The SnackBar should appear with an error message.
    // Each TaskCard has its own SnackBar, so multiple may appear.
    // MUI renders the message inside a .MuiSnackbarContent-message element.
    // Use .first() since multiple snackbars fire (one per area card).
    const snackbarMessage = page.locator('.MuiSnackbarContent-message').first();
    await expect(snackbarMessage).toBeVisible({ timeout: 10000 });

    // Verify the message contains error text
    // snackBarError formats: `${error_text} ${error.httpStatus.httpStatus}`
    const messageText = await snackbarMessage.textContent();
    expect(messageText).toContain('Unable to read tasks');
    expect(messageText).toContain('500');

    // Verify snackbar auto-hides after 2 seconds (autoHideDuration=2000)
    await expect(snackbarMessage).not.toBeVisible({ timeout: 5000 });
  });
});
