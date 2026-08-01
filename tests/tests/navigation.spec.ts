import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('NAV-01: navigate between all views via NavBar', async ({ page }) => {
    // Enable the Swarm app group client-side so Requirements/Sessions/Dev Servers nav
    // links render. AuthContext reads profile from localStorage (primary) or the
    // 'profile' cookie (E2E fallback) on mount; auth.setup.ts seeds both with the
    // real DB profile, which has app_swarm=0 for the E2E user (per profile.spec.ts).
    // Mutating both locally + reload is enough — no DB write required.
    await page.goto('/');
    await page.evaluate(() => {
      const cached = localStorage.getItem('darwin-profile');
      if (cached) {
        const p = JSON.parse(cached);
        p.app_swarm = 1;
        localStorage.setItem('darwin-profile', JSON.stringify(p));
      }
      const match = document.cookie.match(/(?:^|; )profile=([^;]+)/);
      if (match) {
        const decoded = decodeURIComponent(match[1]);
        if (decoded.startsWith('j:')) {
          const obj = JSON.parse(decoded.slice(2));
          obj.app_swarm = 1;
          document.cookie = `profile=${encodeURIComponent('j:' + JSON.stringify(obj))}; path=/; max-age=86100`;
        }
      }
    });

    // Start at Plan view — reload so AuthContext picks up the mutated profile
    await page.goto('/taskcards');
    await expect(page).toHaveURL(/\/taskcards/);

    // Navigate to Calendar
    await page.getByRole('link', { name: /calendar/i }).click();
    await expect(page).toHaveURL(/\/calview/);
    // Wait for FullCalendar root to render before interacting with the bike menu.
    // networkidle is unreliable on CalendarFC which makes continuous polling API calls.
    await page.waitForSelector('.fc', { timeout: 10000 });

    // Navigate back to Plan (needed for settings menu)
    await page.getByRole('link', { name: /plan/i }).click();
    await expect(page).toHaveURL(/\/taskcards/);

    // Navigate to Domains (via Plan page settings menu)
    await page.getByTestId('settings-menu-button').click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 5000 });
    await page.getByRole('menuitem', { name: /domains/i }).click();
    await expect(page).toHaveURL(/\/domainedit/);

    // Navigate back to Plan, then to Areas (via settings menu)
    await page.getByRole('link', { name: /plan/i }).click();
    await page.getByTestId('settings-menu-button').click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 5000 });
    await page.getByRole('menuitem', { name: /areas/i }).click();
    await expect(page).toHaveURL(/\/areaedit/);

    // Navigate to Requirements (links to /swarm)
    await page.getByRole('link', { name: /requirements/i }).click();
    await expect(page).toHaveURL(/\/swarm$/);

    // Navigate to Projects (via Requirements page settings menu)
    await page.getByTestId('settings-menu-button').click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 5000 });
    await page.getByRole('menuitem', { name: /projects/i }).click();
    await expect(page).toHaveURL(/\/projectedit/);

    // Navigate back to Requirements, then to Categories (via settings menu)
    await page.getByRole('link', { name: /requirements/i }).click();
    await page.getByTestId('settings-menu-button').click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 5000 });
    await page.getByRole('menuitem', { name: /categories/i }).click();
    await expect(page).toHaveURL(/\/categoryedit/);

    // Scoped to the sidebar so a page-body link of the same name can't satisfy
    // an assertion below — used by both the Pipelines and Sessions L3 checks.
    const navbar = page.locator('.app-navbar');

    // Navigate to Pipelines
    await page.getByRole('link', { name: /pipelines/i }).click();
    await expect(page).toHaveURL(/\/swarm\/pipelines/);

    // Req #3236 — Epics, Features and Steps nest under Pipelines the same way
    // Sessions' L3s nest under it (req #3209): hidden until the +/- is clicked.
    // Assert absent first so a regression that renders them unconditionally
    // still fails here.
    const epicsLink = navbar.getByRole('link', { name: /^epics$/i });
    await expect(epicsLink).toHaveCount(0);
    await page.getByTestId('nav-expand-toggle-swarm-pipelines').click();
    // Wait explicitly rather than leaning on Playwright's actionability check to
    // ride out MUI's Collapse timeout="auto" animation.
    await expect(epicsLink).toHaveCount(1);
    await epicsLink.click();
    await expect(page).toHaveURL(/\/swarm\/epics/);

    // Collapsing hides them again — the toggle is not one-way.
    await page.getByTestId('nav-expand-toggle-swarm-pipelines').click();
    await expect(epicsLink).toHaveCount(0);

    // Navigate to Sessions
    await page.getByRole('link', { name: /sessions/i }).click();
    await expect(page).toHaveURL(/\/swarm\/sessions/);

    // Req #3209 — Sessions is an expandable L2: its L3s (Starts / Completes /
    // Undos) are hidden until the +/- is clicked. Assert they are absent first,
    // so a regression that renders them unconditionally still fails here.
    const startsLink = navbar.getByRole('link', { name: /^starts$/i });
    await expect(startsLink).toHaveCount(0);
    await page.getByTestId('nav-expand-toggle-swarm-sessions').click();
    // Wait explicitly rather than leaning on Playwright's actionability check to
    // ride out MUI's Collapse timeout="auto" animation.
    await expect(startsLink).toHaveCount(1);
    await startsLink.click();
    await expect(page).toHaveURL(/\/swarm\/swarm-starts/);

    // Collapsing hides them again — the toggle is not one-way.
    await page.getByTestId('nav-expand-toggle-swarm-sessions').click();
    await expect(startsLink).toHaveCount(0);

    // Navigate to Dev Servers
    await page.getByRole('link', { name: /dev servers/i }).click();
    await expect(page).toHaveURL(/\/devservers/);
  });
});
