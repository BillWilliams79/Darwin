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

/** Call the Darwin REST API directly (bypasses the UI). */
export async function apiCall(
  table: string,
  method: string,
  body: unknown,
  idToken: string,
): Promise<unknown> {
  const res = await fetch(`${DARWIN_API}/${table}`, {
    method,
    headers: { Authorization: idToken },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  // Lambda responses are single-encoded JSON.
  try {
    return JSON.parse(text);
  } catch {
    return text;
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
 * Navigate to DomainEdit and wait for the table to render.
 * DomainEdit conditionally renders <Table> only after the domains API call succeeds.
 * With accumulated test domains (1000+), the page can take 10-40s to render all
 * DnD rows. Use 60s timeout to handle slow renders under load.
 */
export async function navigateToDomainEdit(page: Page): Promise<void> {
  await page.goto('/domainedit');
  await page.waitForSelector('table', { timeout: 60000 });
}

/**
 * Wait for the DomainEdit table to render. Use after page.reload().
 * See navigateToDomainEdit for timeout rationale.
 */
export async function waitForDomainTable(page: Page): Promise<void> {
  await page.waitForSelector('table', { timeout: 60000 });
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

/** Click a sort mode option via the card's three-dot menu. */
export async function clickSortMode(page: Page, areaId: string, mode: 'priority' | 'hand'): Promise<void> {
  await page.getByTestId(`card-menu-${areaId}`).click();
  await page.getByTestId(`sort-${mode}-${areaId}`).click();
}
