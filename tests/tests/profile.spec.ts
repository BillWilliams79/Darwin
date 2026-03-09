import { test, expect } from '@playwright/test';

test.describe('Profile', () => {
  test('PROF-01: navigate to profile page via bike icon link', async ({ page }) => {
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Open the bike menu (Profile/Domains/Areas are inside it)
    await page.getByTestId('bike-menu-button').click();
    // Click the Profile menu item
    await page.getByRole('menuitem', { name: /profile/i }).click();

    // Verify navigation to /profile
    await expect(page).toHaveURL(/\/profile/);

    // Profile.jsx renders 6 TextFields: Name, Timezone (Autocomplete), E-mail, Region, User Pool ID, Cognito Identifier
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });
    const textFields = page.locator('.MuiTextField-root');
    await expect(textFields).toHaveCount(6);

    // Verify profile labels are present
    await expect(page.locator('body')).toContainText('Name');
    await expect(page.locator('body')).toContainText('mail');
  });

  test('PROF-02: profile page via direct navigation', async ({ page }) => {
    // Navigate directly to /profile route
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Profile.jsx renders 6 TextFields: Name, Timezone (Autocomplete), E-mail, Region, User Pool ID, Cognito Identifier
    const textFields = page.locator('.MuiTextField-root');
    await expect(textFields).toHaveCount(6);

    // Verify profile labels are present
    await expect(page.locator('body')).toContainText('Name');
    await expect(page.locator('body')).toContainText('mail');
  });

  test('PROF-03: no save button on profile page', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Save button should not exist — profile auto-saves on blur
    await expect(page.getByTestId('profile-save')).toHaveCount(0);
  });

  test('PROF-04: name field auto-saves on blur', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    const nameField = page.getByTestId('profile-name').locator('input');
    const originalName = await nameField.inputValue();

    // Intercept PUT to profiles to verify auto-save fires on blur
    const putPromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );

    // Modify name and blur to trigger auto-save
    await nameField.fill(originalName + ' Test');
    await nameField.blur();

    const putRequest = await putPromise;
    const body = putRequest.postDataJSON();
    expect(body[0].name).toBe(originalName + ' Test');

    // Wait for the PUT response so Profile's .then() callback runs and updates
    // savedNameRef.current. Without this, the dedup check fires on the restore blur.
    await putRequest.response();

    // Restore original name — savedNameRef.current is now `originalName + ' Test'`,
    // so saving `originalName` will trigger the PUT (values differ).
    const restorePromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );
    await nameField.fill(originalName);
    await nameField.blur();
    await restorePromise;
  });

  test('PROF-05: export button visible and enabled on profile page', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    const exportButton = page.getByTestId('export-button');
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toBeEnabled();
    await expect(exportButton).toContainText('Export My Data');
  });

  test('PROF-06: export downloads valid JSON with expected structure', async ({ page }) => {
    // Mock the export API calls with deterministic test data.
    // The E2E user has no domains/sessions after cleanupStaleData(), and Lambda-Rest
    // returns 404 for empty tables (instead of []), which breaks fetchExportData.
    // These mocks ensure the export succeeds and the JSON structure can be verified.
    // Route matchers use URL predicate functions to match the specific API paths.
    const apiBase = 'k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/darwin';
    await page.route(url => url.href.includes(`${apiBase}/domains`), route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 'mock-dom-1', domain_name: 'Export Test Domain', closed: 0, sort_order: 1, create_ts: '2026-01-01', update_ts: '2026-01-01' }]),
    }));
    await page.route(url => url.href.includes(`${apiBase}/areas`), route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 'mock-area-1', area_name: 'Test Area', domain_fk: 'mock-dom-1', closed: 0, sort_order: 1, sort_mode: 'priority', create_ts: '2026-01-01', update_ts: '2026-01-01' }]),
    }));
    await page.route(url => url.href.includes(`${apiBase}/tasks`), route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 'mock-task-1', description: 'Test task', priority: 0, done: 0, area_fk: 'mock-area-1', sort_order: 1, create_ts: '2026-01-01', update_ts: '2026-01-01', done_ts: null }]),
    }));
    await page.route(url => url.href.includes(`${apiBase}/priorities`), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.href.includes(`${apiBase}/swarm_sessions`), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));

    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Spy on URL.createObjectURL to capture blob content via FileReader.
    // Playwright's download event is unreliable for programmatic blob: URL anchor clicks
    // in headless Chrome, so we intercept the blob directly in the page context.
    // FileReader.onloadend stores the text synchronously, making waitForFunction reliable.
    await page.evaluate(() => {
      const orig = URL.createObjectURL;
      (window as any).__exportJsonText = null;
      URL.createObjectURL = (blob: Blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          (window as any).__exportJsonText = reader.result as string;
        };
        reader.readAsText(blob);
        return orig(blob);
      };
    });

    await page.getByTestId('export-button').click();

    // Wait until FileReader has read the blob (synchronous predicate, reliable)
    const jsonHandle = await page.waitForFunction(
      () => (window as any).__exportJsonText as string | null,
      { timeout: 15000 }
    );
    const data = JSON.parse(await jsonHandle.jsonValue() as string);

    // Verify top-level export structure
    expect(data.exportVersion).toBe('1.0');
    expect(data.exportDate).toBeTruthy();
    expect(data.profile).toBeDefined();
    expect(data.domains).toBeDefined();
    expect(Array.isArray(data.domains)).toBe(true);
    expect(data.priorities).toBeDefined();
    expect(Array.isArray(data.priorities)).toBe(true);
    expect(data.swarmSessions).toBeDefined();
    expect(Array.isArray(data.swarmSessions)).toBe(true);

    // Verify profile has expected keys
    expect(data.profile).toHaveProperty('name');
    expect(data.profile).toHaveProperty('email');
    expect(data.profile).toHaveProperty('userName');

    // Verify domain structure in export (mocked data has 1 domain with 1 area)
    expect(data.domains.length).toBeGreaterThan(0);
    const firstDomain = data.domains[0];
    expect(firstDomain).toHaveProperty('id');
    expect(firstDomain).toHaveProperty('domain_name');
    expect(firstDomain).toHaveProperty('areas');
    expect(Array.isArray(firstDomain.areas)).toBe(true);
  });

  test('PROF-07: export button shows loading state during fetch', async ({ page }) => {
    // Mock all export API calls. domains/swarm_sessions return 404 when empty (E2E user
    // has no data after cleanup), causing the export to fail on the unmodified production code.
    // Also delay the domains response by 1s to test the loading state.
    const apiBase = 'k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/darwin';
    await page.route(url => url.href.includes(`${apiBase}/domains`), async (route) => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route(url => url.href.includes(`${apiBase}/areas`), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.href.includes(`${apiBase}/tasks`), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.href.includes(`${apiBase}/priorities`), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.href.includes(`${apiBase}/swarm_sessions`), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));

    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Spy on URL.createObjectURL to detect when the export completes.
    // FileReader stores a non-null string when done — reliable synchronous predicate.
    await page.evaluate(() => {
      const orig = URL.createObjectURL;
      (window as any).__exportComplete = false;
      URL.createObjectURL = (blob: Blob) => {
        const reader = new FileReader();
        reader.onloadend = () => { (window as any).__exportComplete = true; };
        reader.readAsText(blob);
        return orig(blob);
      };
    });

    const exportButton = page.getByTestId('export-button');
    await exportButton.click();

    // Button should be disabled and show loading text while fetching
    await expect(exportButton).toBeDisabled();
    await expect(exportButton).toContainText('Exporting...');

    // Wait for FileReader to finish reading — export is complete
    await page.waitForFunction(() => (window as any).__exportComplete === true, { timeout: 30000 });

    // Button should return to enabled state after export
    await expect(exportButton).toBeEnabled({ timeout: 10000 });
    await expect(exportButton).toContainText('Export My Data');
  });
});
