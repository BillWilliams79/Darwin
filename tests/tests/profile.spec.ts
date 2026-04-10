import { test, expect } from '@playwright/test';

test.describe('Profile', () => {
  test('PROF-01: open profile dialog via bike icon', async ({ page }) => {
    await page.goto('/taskcards');
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });

    // Click bike icon — opens profile dialog (not a menu)
    await page.getByTestId('bike-menu-button').click();

    // Verify dialog opens with profile content
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText('Profile');

    // Dialog renders 3 TextFields: Name, Timezone (Autocomplete), E-mail
    const textFields = dialog.locator('.MuiTextField-root');
    await expect(textFields).toHaveCount(3);

    // Verify profile labels are present
    await expect(dialog).toContainText('Name');
    await expect(dialog).toContainText('mail');

    // Close dialog via X button
    await page.getByTestId('profile-dialog-close').click();
    await expect(dialog).not.toBeVisible();
  });

  test('PROF-02: profile page via direct navigation', async ({ page }) => {
    // Navigate directly to /profile route
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Profile.jsx renders 3 TextFields: Name, Timezone (Autocomplete), E-mail
    const textFields = page.locator('.MuiTextField-root');
    await expect(textFields).toHaveCount(3);

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
    // Route matchers use pathname.endsWith to avoid substring collisions
    // (e.g., /tasks vs /recurring_tasks, /map_partners vs /map_run_partners).
    await page.route(url => url.pathname.endsWith('/domains'), route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 'mock-dom-1', domain_name: 'Export Test Domain', closed: 0, sort_order: 1, create_ts: '2026-01-01', update_ts: '2026-01-01' }]),
    }));
    await page.route(url => url.pathname.endsWith('/areas'), route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 'mock-area-1', area_name: 'Test Area', domain_fk: 'mock-dom-1', closed: 0, sort_order: 1, sort_mode: 'priority', create_ts: '2026-01-01', update_ts: '2026-01-01' }]),
    }));
    await page.route(url => url.pathname.endsWith('/recurring_tasks'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.pathname.endsWith('/tasks'), route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 'mock-task-1', description: 'Test task', priority: 0, done: 0, area_fk: 'mock-area-1', sort_order: 1, recurring_task_fk: null, create_ts: '2026-01-01', update_ts: '2026-01-01', done_ts: null }]),
    }));
    await page.route(url => url.pathname.endsWith('/map_routes'), route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 'mock-route-1', route_id: 1, name: 'Test Route', create_ts: '2026-01-01', update_ts: null }]),
    }));
    await page.route(url => url.pathname.endsWith('/map_runs'), route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 'mock-run-1', run_id: 1, map_route_fk: 'mock-route-1', activity_id: 4, activity_name: 'Ride', start_time: '2026-01-01 12:00:00', run_time_sec: 3600, stopped_time_sec: 0, distance_mi: 10.0, ascent_ft: 100, descent_ft: 100, calories: 300, max_speed_mph: 20.0, avg_speed_mph: 10.0, notes: null, source: 'cyclemeter', create_ts: '2026-01-01', update_ts: null }]),
    }));
    await page.route(url => url.pathname.endsWith('/map_views'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.pathname.endsWith('/map_run_partners'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.pathname.endsWith('/map_partners'), route => route.fulfill({
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

    // Click Export My Data to open dialog, then click Export in dialog
    await page.getByTestId('export-button').click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await page.getByTestId('export-dialog-export').click();

    // Wait until FileReader has read the blob (synchronous predicate, reliable)
    const jsonHandle = await page.waitForFunction(
      () => (window as any).__exportJsonText as string | null,
      { timeout: 15000 }
    );
    const data = JSON.parse(await jsonHandle.jsonValue() as string);

    // Verify top-level export structure (v2.0 with selectedApps)
    expect(data.exportVersion).toBe('2.0');
    expect(data.exportDate).toBeTruthy();
    expect(data.selectedApps).toBeDefined();
    expect(data.profile).toBeDefined();

    // Verify profile has expected keys (including new fields)
    expect(data.profile).toHaveProperty('name');
    expect(data.profile).toHaveProperty('email');
    expect(data.profile).toHaveProperty('userName');
    expect(data.profile).toHaveProperty('timezone');
    expect(data.profile).toHaveProperty('theme_mode');

    // Verify Tasks data (E2E user has app_tasks=1)
    expect(data.domains).toBeDefined();
    expect(Array.isArray(data.domains)).toBe(true);
    expect(data.domains.length).toBeGreaterThan(0);
    const firstDomain = data.domains[0];
    expect(firstDomain).toHaveProperty('id');
    expect(firstDomain).toHaveProperty('domain_name');
    expect(firstDomain).toHaveProperty('areas');
    expect(Array.isArray(firstDomain.areas)).toBe(true);
    expect(data.recurringTasks).toBeDefined();

    // Verify Maps data (E2E user has app_maps=1)
    expect(data.mapRoutes).toBeDefined();
    expect(Array.isArray(data.mapRoutes)).toBe(true);
    expect(data.unassignedRuns).toBeDefined();
    expect(data.mapViews).toBeDefined();
    expect(data.mapPartners).toBeDefined();

    // Swarm data should NOT be present (E2E user has app_swarm=0)
    expect(data.requirements).toBeUndefined();
    expect(data.swarmSessions).toBeUndefined();
  });

  test('PROF-07a: appearance selector visible on profile page', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    const toggle = page.getByTestId('profile-theme-toggle');
    await expect(toggle).toBeVisible();
    // Should show Light, Dark, and System options
    await expect(toggle).toContainText('Light');
    await expect(toggle).toContainText('Dark');
    await expect(toggle).toContainText('System');
  });

  test('PROF-07b: dark mode toggle adds darwin-dark class to body', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Click the Dark thumbnail (second child of the toggle container)
    const toggle = page.getByTestId('profile-theme-toggle');
    const darkOption = toggle.locator('> div').nth(1);
    await darkOption.click();

    // Body should have darwin-dark class
    await expect(page.locator('body')).toHaveClass(/darwin-dark/);

    // Switch back to light
    const lightOption = toggle.locator('> div').nth(0);
    await lightOption.click();
    await expect(page.locator('body')).not.toHaveClass(/darwin-dark/);
  });

  test('PROF-07c: dark mode persists after page reload', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Enable dark mode
    const toggle = page.getByTestId('profile-theme-toggle');
    const darkOption = toggle.locator('> div').nth(1);
    await darkOption.click();
    await expect(page.locator('body')).toHaveClass(/darwin-dark/);

    // Verify localStorage was set
    const stored = await page.evaluate(() => localStorage.getItem('darwin-theme'));
    expect(stored).toBe('dark');

    // Reload page — ThemeWrapper reads localStorage synchronously on mount
    await page.reload();
    await page.waitForSelector('[data-testid="profile-theme-toggle"]', { timeout: 10000 });

    // Dark mode should persist (from localStorage → useState init → useEffect)
    await expect(page.locator('body')).toHaveClass(/darwin-dark/, { timeout: 10000 });

    // Restore light mode for other tests
    const toggle2 = page.getByTestId('profile-theme-toggle');
    const lightOption = toggle2.locator('> div').nth(0);
    await lightOption.click();
    await expect(page.locator('body')).not.toHaveClass(/darwin-dark/);
  });

  test('PROF-07d: dark mode toggle auto-saves to DB', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Intercept PUT to verify theme_mode is saved
    const putPromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );

    // Click dark mode
    const toggle = page.getByTestId('profile-theme-toggle');
    const darkOption = toggle.locator('> div').nth(1);
    await darkOption.click();

    const putRequest = await putPromise;
    const body = putRequest.postDataJSON();
    expect(body[0].theme_mode).toBe('dark');

    // Wait for PUT response so savedThemeModeRef updates to 'dark'
    await putRequest.response();

    // Restore to light — savedThemeModeRef is now 'dark', so 'light' triggers a new PUT
    const restorePromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );
    const lightOption = toggle.locator('> div').nth(0);
    await lightOption.click();
    const restoreRequest = await restorePromise;
    const restoreBody = restoreRequest.postDataJSON();
    expect(restoreBody[0].theme_mode).toBe('light');
  });

  test('PROF-07e: system mode follows OS color scheme', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Click the System thumbnail (third child of the toggle container)
    const toggle = page.getByTestId('profile-theme-toggle');
    const systemOption = toggle.locator('> div').nth(2);
    await systemOption.click();

    // Verify localStorage stores 'system'
    const stored = await page.evaluate(() => localStorage.getItem('darwin-theme'));
    expect(stored).toBe('system');

    // Emulate dark OS preference — body should get darwin-dark class
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('body')).toHaveClass(/darwin-dark/, { timeout: 5000 });

    // Emulate light OS preference — darwin-dark class should be removed
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('body')).not.toHaveClass(/darwin-dark/, { timeout: 5000 });

    // Restore to light mode for other tests
    const lightOption = toggle.locator('> div').nth(0);
    await lightOption.click();
  });

  test('PROF-07f: system mode auto-saves theme_mode to DB', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Intercept PUT to verify theme_mode is 'system'
    const putPromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );

    // Click the System thumbnail (third child)
    const toggle = page.getByTestId('profile-theme-toggle');
    const systemOption = toggle.locator('> div').nth(2);
    await systemOption.click();

    const putRequest = await putPromise;
    const body = putRequest.postDataJSON();
    expect(body[0].theme_mode).toBe('system');

    // Wait for PUT response so savedThemeModeRef updates
    await putRequest.response();

    // Restore to light
    const restorePromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );
    const lightOption = toggle.locator('> div').nth(0);
    await lightOption.click();
    const restoreRequest = await restorePromise;
    const restoreBody = restoreRequest.postDataJSON();
    expect(restoreBody[0].theme_mode).toBe('light');
  });

  test('PROF-07: export dialog shows loading state during fetch', async ({ page }) => {
    // Mock all export API calls with a delayed domains response to test loading state.
    // Route matchers use pathname.endsWith to avoid substring collisions.
    await page.route(url => url.pathname.endsWith('/domains'), async (route) => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route(url => url.pathname.endsWith('/areas'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.pathname.endsWith('/recurring_tasks'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.pathname.endsWith('/tasks'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.pathname.endsWith('/map_routes'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.pathname.endsWith('/map_runs'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.pathname.endsWith('/map_views'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.pathname.endsWith('/map_run_partners'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));
    await page.route(url => url.pathname.endsWith('/map_partners'), route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([]),
    }));

    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Spy on URL.createObjectURL to detect when the export completes.
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

    // Open dialog and click Export
    await page.getByTestId('export-button').click();
    const dialogExportBtn = page.getByTestId('export-dialog-export');
    await expect(dialogExportBtn).toBeVisible({ timeout: 3000 });
    await dialogExportBtn.click();

    // Dialog export button should be disabled and show loading text while fetching
    await expect(dialogExportBtn).toBeDisabled();
    await expect(dialogExportBtn).toContainText('Exporting...');

    // Wait for export to complete
    await page.waitForFunction(() => (window as any).__exportComplete === true, { timeout: 30000 });

    // Dialog should close after export completes
    await expect(page.getByTestId('export-dialog')).not.toBeVisible({ timeout: 10000 });
  });

  test('PROF-08a: applications section visible with 3 labels', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('[data-testid="profile-app-toggle"]', { timeout: 10000 });

    const toggle = page.getByTestId('profile-app-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('Tasks');
    await expect(toggle).toContainText('Maps');
    await expect(toggle).toContainText('Swarm');
  });

  test('PROF-08b: toggle changes highlight state', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('[data-testid="profile-app-toggle"]', { timeout: 10000 });

    const toggle = page.getByTestId('profile-app-toggle');
    // Swarm is disabled by default — its border should use divider color
    const swarmCard = toggle.locator('> div').nth(2).locator('.app-thumb');
    const swarmBorder = await swarmCard.evaluate(el => getComputedStyle(el).borderColor);

    // Click Swarm to enable it
    await toggle.locator('> div').nth(2).click();

    // Wait for PUT to complete
    await page.waitForTimeout(500);

    // Border should change to primary color (different from before)
    const swarmBorderAfter = await swarmCard.evaluate(el => getComputedStyle(el).borderColor);
    expect(swarmBorderAfter).not.toBe(swarmBorder);

    // Click Swarm again to disable — restore original state
    await toggle.locator('> div').nth(2).click();
    await page.waitForTimeout(500);
  });

  test('PROF-08c: toggle auto-saves app fields to DB', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('[data-testid="profile-app-toggle"]', { timeout: 10000 });

    // Intercept PUT to verify app_swarm is saved
    const putPromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );

    // Click Swarm (disabled by default) to enable it
    const toggle = page.getByTestId('profile-app-toggle');
    await toggle.locator('> div').nth(2).click();

    const putRequest = await putPromise;
    const body = putRequest.postDataJSON();
    expect(body[0].app_swarm).toBe(1);

    // Wait for response so saved ref updates
    await putRequest.response();

    // Restore — disable Swarm again
    const restorePromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );
    await toggle.locator('> div').nth(2).click();
    const restoreRequest = await restorePromise;
    const restoreBody = restoreRequest.postDataJSON();
    expect(restoreBody[0].app_swarm).toBe(0);
  });

  test('PROF-08d: disabled group hidden from sidebar', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('[data-testid="profile-app-toggle"]', { timeout: 10000 });

    // Verify MAPS group is visible in sidebar before disabling
    const sidebar = page.locator('.app-navbar');
    await expect(sidebar).toContainText('MAPS');

    // Intercept PUT and disable Maps
    const putPromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );
    const toggle = page.getByTestId('profile-app-toggle');
    await toggle.locator('> div').nth(1).click(); // Maps is second card
    await putPromise;

    // MAPS group should no longer be visible in sidebar
    await expect(sidebar).not.toContainText('MAPS', { timeout: 5000 });

    // Restore — re-enable Maps
    const restorePromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );
    await toggle.locator('> div').nth(1).click();
    await restorePromise;
    await expect(sidebar).toContainText('MAPS', { timeout: 5000 });
  });

  test('PROF-08e: cannot disable all apps — last one stays enabled', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('[data-testid="profile-app-toggle"]', { timeout: 10000 });

    const toggle = page.getByTestId('profile-app-toggle');

    // Disable Maps (Tasks and Maps are enabled by default, Swarm disabled)
    const put1 = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );
    await toggle.locator('> div').nth(1).click(); // disable Maps
    await put1;

    // Now only Tasks is enabled. Click Tasks — should be no-op (no PUT fires)
    // Use a race: if PUT fires within 1s, the guard failed
    const noSave = await Promise.race([
      page.waitForRequest(
        req => req.method() === 'PUT' && req.url().includes('/profiles'),
        { timeout: 1500 }
      ).then(() => 'PUT_FIRED'),
      new Promise(resolve => setTimeout(() => resolve('NO_PUT'), 1500)),
    ]);

    // Clicking Tasks when it's the last enabled app should NOT fire a PUT
    await toggle.locator('> div').nth(0).click(); // try to disable Tasks (last one)

    const result = await Promise.race([
      page.waitForRequest(
        req => req.method() === 'PUT' && req.url().includes('/profiles'),
        { timeout: 1500 }
      ).then(() => 'PUT_FIRED'),
      new Promise(resolve => setTimeout(() => resolve('NO_PUT'), 1500)),
    ]);
    expect(result).toBe('NO_PUT');

    // Restore — re-enable Maps
    const restorePromise = page.waitForRequest(
      req => req.method() === 'PUT' && req.url().includes('/profiles'),
      { timeout: 5000 }
    );
    await toggle.locator('> div').nth(1).click();
    await restorePromise;
  });

  test('PROF-09a: export dialog shows only enabled app checkboxes', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Open export dialog
    await page.getByTestId('export-button').click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // E2E user default: app_tasks=1, app_maps=1, app_swarm=0
    await expect(page.getByTestId('export-app-tasks')).toBeVisible();
    await expect(page.getByTestId('export-app-maps')).toBeVisible();
    await expect(page.getByTestId('export-app-swarm')).toHaveCount(0);

    // Close dialog
    await page.getByTestId('export-dialog-cancel').click();
    await expect(dialog).not.toBeVisible();
  });

  test('PROF-09b: export button disabled when no checkboxes checked', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Open export dialog
    await page.getByTestId('export-button').click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const exportBtn = page.getByTestId('export-dialog-export');

    // Both Tasks and Maps are checked by default — Export is enabled
    await expect(exportBtn).toBeEnabled();

    // Uncheck Tasks
    await page.getByTestId('export-app-tasks').click();
    await expect(exportBtn).toBeEnabled(); // Maps still checked

    // Uncheck Maps
    await page.getByTestId('export-app-maps').click();
    await expect(exportBtn).toBeDisabled(); // Nothing checked

    // Re-check Tasks
    await page.getByTestId('export-app-tasks').click();
    await expect(exportBtn).toBeEnabled();

    await page.getByTestId('export-dialog-cancel').click();
  });

  test('PROF-09c: GPS sub-option shows warning dialog', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('.MuiTextField-root', { timeout: 5000 });

    // Open export dialog
    await page.getByTestId('export-button').click();
    await expect(page.getByTestId('export-dialog')).toBeVisible({ timeout: 3000 });

    // GPS checkbox should not be visible until Maps is checked (it is by default)
    const gpsCheckbox = page.getByTestId('export-maps-gps');
    await expect(gpsCheckbox).toBeVisible();

    // Click GPS checkbox — warning dialog should appear
    await gpsCheckbox.click();
    const warning = page.getByTestId('export-gps-warning');
    await expect(warning).toBeVisible({ timeout: 3000 });
    await expect(warning).toContainText('long time to process');

    // Cancel warning — GPS should remain unchecked
    await page.getByTestId('export-gps-warning-cancel').click();
    await expect(warning).not.toBeVisible();
    await expect(gpsCheckbox).not.toBeChecked();

    // Click GPS again and confirm this time
    await gpsCheckbox.click();
    await expect(page.getByTestId('export-gps-warning')).toBeVisible({ timeout: 3000 });
    await page.getByTestId('export-gps-warning-confirm').click();
    await expect(gpsCheckbox).toBeChecked();

    // Uncheck Maps — GPS sub-option should disappear
    await page.getByTestId('export-app-maps').click();
    await expect(gpsCheckbox).not.toBeVisible();

    await page.getByTestId('export-dialog-cancel').click();
  });
});
