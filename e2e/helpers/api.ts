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
  // Lambda double-encodes JSON responses. The response format is typically:
  //   POST: '["[{\"id\": 168, ...}]"]'  (array containing a JSON string)
  //   GET:  '"[{\"id\": 168, ...}]"'     (string containing JSON)
  // The frontend handles this via JSON.parse(array) which coerces array.toString().
  // We replicate that approach: parse once, then if the result has a .length,
  // parse it again (matching the front-end's call_rest_api behavior).
  try {
    let data = JSON.parse(text);
    if (data?.length > 0) {
      try { data = JSON.parse(data); } catch { /* already final form */ }
    }
    return data;
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
