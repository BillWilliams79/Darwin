import { Page } from '@playwright/test';

const DARWIN_API = 'https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/darwin';

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

/** Click a sort mode option via the card's three-dot menu. */
export async function clickSortMode(page: Page, areaId: string, mode: 'priority' | 'hand'): Promise<void> {
  await page.getByTestId(`card-menu-${areaId}`).click();
  await page.getByTestId(`sort-${mode}-${areaId}`).click();
}
