import { Page } from '@playwright/test';

const TEST_DATABASE = process.env.TEST_DATABASE || 'darwin';
const DARWIN_API = `https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/${TEST_DATABASE}`;

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
    const res = await fetch(`${DARWIN_API}/${table}`, {
      method,
      headers: { Authorization: idToken },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });

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
  await fetch(`${DARWIN_API}/${table}`, {
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

/** Click a sort mode option via the card's three-dot menu. */
export async function clickSortMode(page: Page, areaId: string, mode: 'priority' | 'hand'): Promise<void> {
  await page.getByTestId(`card-menu-${areaId}`).click();
  await page.getByTestId(`sort-${mode}-${areaId}`).click();
}

/**
 * Clean up all stale E2E data for the current test user.
 * Deletes in FK-safe order: priority_sessions → swarm_sessions → projects → domains.
 * CASCADE handles children (categories/priorities under projects, areas/tasks under domains).
 * Called once at the start of each test run from auth.setup.ts.
 */
export async function cleanupStaleData(idToken: string): Promise<{ domains: number; projects: number; sessions: number }> {
  const sub = process.env.E2E_TEST_COGNITO_SUB;
  if (!sub) return { domains: 0, projects: 0, sessions: 0 };

  const summary = { domains: 0, projects: 0, sessions: 0 };

  // 1. Fetch and delete swarm_sessions (and their priority_sessions links)
  try {
    const sessions = await apiCall(
      `swarm_sessions?creator_fk=${sub}&fields=id`, 'GET', '', idToken,
    ) as Array<{ id: string }>;
    if (Array.isArray(sessions)) {
      for (const sess of sessions) {
        try {
          // Delete priority_sessions linking to this session
          await fetch(`${DARWIN_API}/priority_sessions`, {
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

  // 2. Fetch and delete projects (CASCADE handles categories → priorities)
  try {
    const projects = await apiCall(
      `projects?creator_fk=${sub}&fields=id`, 'GET', '', idToken,
    ) as Array<{ id: string }>;
    if (Array.isArray(projects)) {
      for (const proj of projects) {
        try { await apiDelete('projects', proj.id, idToken); } catch { /* best-effort */ }
      }
      summary.projects = projects.length;
    }
  } catch { /* best-effort */ }

  // 3. Fetch and delete domains (CASCADE handles areas → tasks)
  try {
    const domains = await apiCall(
      `domains?creator_fk=${sub}&fields=id`, 'GET', '', idToken,
    ) as Array<{ id: string }>;
    if (Array.isArray(domains)) {
      for (const dom of domains) {
        try { await apiDelete('domains', dom.id, idToken); } catch { /* best-effort */ }
      }
      summary.domains = domains.length;
    }
  } catch { /* best-effort */ }

  return summary;
}
