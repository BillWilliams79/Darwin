import { Page } from '@playwright/test';

// Safe-by-default: target darwin_dev unless explicitly overridden (req #2750).
// Local/dev E2E runs (run-e2e.sh) MUST NOT write to production darwin. The
// production smoke suite (playwright.production.config.ts) pins TEST_DATABASE=darwin.
const TEST_DATABASE = process.env.TEST_DATABASE || 'darwin_dev';
const API_BASE = 'https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng';
const DARWIN_API = `${API_BASE}/${TEST_DATABASE}`;

// Req #2697 — operational tables live exclusively in the production `darwin`
// schema. The app reads/writes them via `darwinOpsUri` (always `…/darwin`),
// regardless of the active dev database. So E2E seeds/reads of these tables MUST
// target `darwin` too: when TEST_DATABASE=darwin_dev, content tables (requirements,
// projects, domains, …) go to darwin_dev but ops tables must still go to darwin, or
// the UI (which reads ops from darwin) never sees the seeded rows — e.g. a seeded
// swarm_session shows up as "Session not found." This mirrors the app's
// darwinUri / darwinOpsUri split. Keep in sync with the `ops: true` entities in
// src/hooks/factory/devopsQueries.js.
const OPS_API = `${API_BASE}/darwin`;
const OPS_TABLES = new Set(['swarm_sessions', 'dev_servers', 'swarm_starts', 'swarm_start_sessions']);

/** Resolve the API base for a table (ops tables → production `darwin`). */
function apiBaseFor(tableWithQuery: string): string {
  const table = tableWithQuery.split('?')[0];
  return OPS_TABLES.has(table) ? OPS_API : DARWIN_API;
}

/** Extract the idToken from the browser context cookies. */
export async function getIdToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const tokenCookie = cookies.find(c => c.name === 'idToken');
  if (!tokenCookie) throw new Error('No idToken cookie found');
  return tokenCookie.value;
}

/** Call the Darwin REST API directly (bypasses the UI).
 *  Retries up to 3 times on server errors (5xx) to handle Lambda cold starts. */
export async function apiCall(
  table: string,
  method: string,
  body: unknown,
  idToken: string,
  retries = 3,
): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${apiBaseFor(table)}/${table}`, {
        method,
        headers: { Authorization: idToken },
        body: method === 'GET' ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // Transient network failure (DNS/connection reset talking to the cloud API
      // — surfaces as `TypeError: fetch failed`). Retry with backoff so a blip in
      // a beforeAll seed doesn't abort an entire serial describe.
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw err;
    }

    const text = await res.text();

    if (res.status >= 500 && attempt < retries) {
      await new Promise(r => setTimeout(r, 2000 * attempt));
      continue;
    }

    // Lambda responses are single-encoded JSON.
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

/** DELETE a record by id. */
export async function apiDelete(table: string, id: number | string, idToken: string): Promise<void> {
  await fetch(`${apiBaseFor(table)}/${table}`, {
    method: 'DELETE',
    headers: { Authorization: idToken },
    body: JSON.stringify({ id }),
  });
}

/** Generate a unique name with e2e prefix for test data. */
export function uniqueName(prefix: string): string {
  return `e2e-${Date.now()}-${prefix}`;
}

/**
 * Navigate to DomainEdit and wait for domain rows to render.
 * DomainEdit conditionally renders rows only after the domains API call succeeds.
 * With accumulated test domains (1000+), the page can take 10-40s to render all
 * DnD rows. Use 60s timeout to handle slow renders under load.
 */
export async function navigateToDomainEdit(page: Page): Promise<void> {
  await page.goto('/domainedit');
  await page.waitForSelector('[data-testid="domain-row-template"]', { timeout: 60000 });
}

/**
 * Wait for the DomainEdit rows to render. Use after page.reload().
 * See navigateToDomainEdit for timeout rationale.
 */
export async function waitForDomainTable(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="domain-row-template"]', { timeout: 60000 });
}

/**
 * Get all domain names from the DomainEdit table in a single browser call.
 * With 1000+ accumulated test domains, iterating via individual Playwright
 * inputValue() calls takes minutes. This runs in-browser for O(1) overhead.
 */
export async function getAllDomainNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const inputs = document.querySelectorAll('input[name="domain-name"]');
    return Array.from(inputs).map(input => (input as HTMLInputElement).value);
  });
}

/**
 * Find the index of a domain name field in the DomainEdit table.
 * Returns -1 if not found. Uses in-browser evaluation for speed.
 */
export async function findDomainIndex(page: Page, domainName: string): Promise<number> {
  return page.evaluate((name) => {
    const inputs = document.querySelectorAll('input[name="domain-name"]');
    for (let i = 0; i < inputs.length; i++) {
      if ((inputs[i] as HTMLInputElement).value === name) return i;
    }
    return -1;
  }, domainName);
}

/**
 * Navigate to ProjectEdit and wait for project rows to render.
 */
export async function navigateToProjectEdit(page: Page): Promise<void> {
  await page.goto('/projectedit');
  await page.waitForSelector('[data-testid="project-row-template"]', { timeout: 60000 });
}

/**
 * Wait for the ProjectEdit rows to render. Use after page.reload().
 */
export async function waitForProjectTable(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="project-row-template"]', { timeout: 60000 });
}

/**
 * Get all project names from the ProjectEdit table in a single browser call.
 */
export async function getAllProjectNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const inputs = document.querySelectorAll('input[name="project-name"]');
    return Array.from(inputs).map(input => (input as HTMLInputElement).value);
  });
}

/**
 * Find the index of a project name field in the ProjectEdit table.
 * Returns -1 if not found. Uses in-browser evaluation for speed.
 */
export async function findProjectIndex(page: Page, projectName: string): Promise<number> {
  return page.evaluate((name) => {
    const inputs = document.querySelectorAll('input[name="project-name"]');
    for (let i = 0; i < inputs.length; i++) {
      if ((inputs[i] as HTMLInputElement).value === name) return i;
    }
    return -1;
  }, projectName);
}

/** Click a sort mode option via the card's three-dot menu (TaskPlanView areas). */
export async function clickSortMode(page: Page, areaId: string, mode: 'priority' | 'hand'): Promise<void> {
  await page.getByTestId(`card-menu-${areaId}`).click();
  await page.getByTestId(`sort-${mode}-${areaId}`).click();
}

/** Click a sort mode option via the category card's three-dot menu (SwarmView categories). */
export async function clickCategorySortMode(page: Page, categoryId: string, mode: 'process' | 'hand'): Promise<void> {
  await page.getByTestId(`card-menu-${categoryId}`).click();
  await page.getByTestId(`sort-${mode}-${categoryId}`).click();
}

/**
 * Clean up all stale E2E data for the current test user.
 *
 * Deletes in FK-safe order (req #2750):
 *   requirement_sessions → swarm_sessions → requirements → categories → projects → domains
 *
 * Earlier this function deleted ONLY projects, assuming CASCADE would clear
 * categories → requirements. It can't: requirements.category_fk is ON DELETE
 * RESTRICT (migration 041) and requirements.project_fk is ON DELETE SET NULL.
 * So a project DELETE SET-NULLs its requirements then RESTRICT-fails on the
 * category cascade — the error was swallowed and requirements/categories/projects
 * survived forever. We now delete requirements first, then categories, then
 * projects, mirroring DarwinSQL/scripts/cleanup_e2e.py.
 *
 * Called once at the start of each test run from auth.setup.ts.
 */
export async function cleanupStaleData(idToken: string): Promise<{ domains: number; projects: number; categories: number; requirements: number; sessions: number }> {
  const sub = process.env.E2E_TEST_COGNITO_SUB;
  if (!sub) return { domains: 0, projects: 0, categories: 0, requirements: 0, sessions: 0 };

  const summary = { domains: 0, projects: 0, categories: 0, requirements: 0, sessions: 0 };

  // Helper: fetch all ids for a table scoped to this creator, then delete each.
  const deleteAllForCreator = async (table: string): Promise<number> => {
    try {
      const rows = await apiCall(
        `${table}?creator_fk=${sub}&fields=id`, 'GET', '', idToken,
      ) as Array<{ id: number | string }>;
      if (!Array.isArray(rows)) return 0;
      for (const row of rows) {
        try { await apiDelete(table, row.id, idToken); } catch { /* best-effort */ }
      }
      return rows.length;
    } catch { /* best-effort */ return 0; }
  };

  // 1. swarm_sessions (and their requirement_sessions links)
  try {
    const sessions = await apiCall(
      `swarm_sessions?creator_fk=${sub}&fields=id`, 'GET', '', idToken,
    ) as Array<{ id: string }>;
    if (Array.isArray(sessions)) {
      for (const sess of sessions) {
        try {
          // Delete requirement_sessions linking to this session
          await fetch(`${DARWIN_API}/requirement_sessions`, {
            method: 'DELETE',
            headers: { Authorization: idToken },
            body: JSON.stringify({ session_fk: sess.id }),
          });
        } catch { /* best-effort */ }
        try { await apiDelete('swarm_sessions', sess.id, idToken); } catch { /* best-effort */ }
      }
      summary.sessions = sessions.length;
    }
  } catch { /* best-effort */ }

  // 2. requirements — must go before categories (category_fk is ON DELETE RESTRICT).
  summary.requirements = await deleteAllForCreator('requirements');

  // 3. categories — now deletable since their requirements are gone.
  summary.categories = await deleteAllForCreator('categories');

  // 4. projects — categories already cleared, so the delete succeeds cleanly.
  summary.projects = await deleteAllForCreator('projects');

  // 5. domains (CASCADE handles areas → tasks).
  summary.domains = await deleteAllForCreator('domains');

  return summary;
}
