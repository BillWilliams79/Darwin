// E2E coverage for the editable agent instruction registry (req #3060).
//
// /agents/instructions became editable in req #3049 and was then REBUILT by req
// #3063: the edit modal, the membership checkbox list and the closed switch were
// all deleted. This spec is written against the surface that actually ships now —
// borderless editable card headings, outlined content fields, the roster palette,
// a per-card options menu, and a template row. Nothing here references the retired
// testids (`instruction-edit-dialog`, `link-agent-<id>`, `instruction-closed-switch`,
// `new-instruction-btn`, `instruction-sort-order-input-<id>`, …).
//
// WHY SERIAL. The registry is creator-scoped and this suite owns the whole of it
// for the E2E user, so the accounting line, the sort order and the `Closed` filter
// chip are all functions of every row the file has created. Running these in
// parallel against one shared catalog would make those three assertions
// meaningless. `workers: 1` is already the project default; `describe.serial` makes
// the dependency explicit and stops one failure cascading into a dozen.
//
// Beyond that, each test owns its own seeded rows and is individually runnable
// under `--grep`. There is exactly ONE ordering constraint, and it is worth
// knowing before reordering anything: AGENT-01 asserts that agent a1 holds
// exactly the slots {1,2,100}, and AGENT-04's bind-all later binds `c-bind` to
// every open agent — a1 included, at slot 101. AGENT-01 must therefore stay
// ahead of AGENT-04.
//
// WHY THE WRITES ARE INSPECTED, NOT INFERRED. Two of this page's contracts are
// invisible in the DOM: "one PUT per field" (a rejected name must not be able to
// take an edited body down with it) and "bind-all is ONE bulk POST" (a loop is the
// half-applied-set failure mode the design exists to avoid). Both are asserted by
// capturing the actual request bodies. `/instructions` is matched on the LAST PATH
// SEGMENT, never with `includes()` — `/agent_instructions` would match that.
//
// NO window.confirm ANYWHERE. Req #3060's spec warned that AgentDetail still used
// one for unlink, which would hang a Playwright run rather than fail it. Req #3071
// landed first: both unbind paths now go through InstructionUnbindDialog, so
// AGENT-05 clicks a real button and no dialog handler is registered.

import { test, expect, Page } from '@playwright/test';
import { getIdToken, apiCall, apiDelete, E2E_NAME_PREFIX } from '../helpers/api';

type Row = { id: number; name: string; content?: string; closed?: number };
type Link = { agent_fk: number; instruction_fk: number; sort_order: number | null };
type Write = { method: string; table: string; body: unknown };

// One stamp shared by every seeded name, so the seed's alphabetical order is
// fixed and the Name-sort assertion (AGENT-11) means something.
//
// ASSIGNED IN beforeAll, not at module scope. Playwright retries a serial block
// inside the SAME worker without re-importing the module, so a module-level stamp
// would be reused by the retry — and `createRow`'s resolve-by-name fallback would
// then silently adopt a leftover row instead of reporting the collision.
let STAMP = 0;
// The prefix is imported, never re-typed: `cleanupStaleData` reclaims an
// interrupted run by matching it, and a second copy that drifted would quietly
// stop that working.
const nm = (suffix: string) => `${E2E_NAME_PREFIX}${STAMP}-${suffix}`;

const SEED_CONTENT = 'Seeded binding text for the E2E instruction registry suite.';

/**
 * Rows out of a REST GET, distinguishing "empty" from "something went wrong".
 *
 * `apiCall` NEVER throws on a non-2xx — it parses and returns the error body. A
 * bare `Array.isArray(rows) ? rows : []` therefore turns a 500 into an empty
 * list, which is exactly the value every negative assertion in this file expects
 * ("the cascade removed the links", "the row is gone"). Those assertions would
 * then pass on an API outage. Lambda-Rest answers an empty result set with a 404
 * whose body is the string "NOT FOUND"; anything else that is not an array is a
 * failure and is raised as one.
 */
function asRows<T>(res: unknown, what: string): T[] {
  if (Array.isArray(res)) return res as T[];
  if (typeof res === 'string' && res.toUpperCase().includes('NOT FOUND')) return [];
  throw new Error(`Unexpected REST response for ${what}: ${JSON.stringify(res)}`);
}

/**
 * Create a row and return its id.
 *
 * Lambda-Rest's POST read-back has changed shape more than once (req #3057), so
 * this accepts an array or a bare object and falls back to resolving the row by
 * its UNIQUE `name` rather than trusting either.
 */
async function createRow(
  table: string, body: Record<string, unknown>, name: string, idToken: string,
): Promise<number> {
  const res = await apiCall(table, 'POST', body, idToken) as unknown;
  const row = (Array.isArray(res) ? res[0] : res) as { id?: number | string } | null;
  if (row && typeof row === 'object' && row.id !== undefined && row.id !== null) {
    return Number(row.id);
  }
  const found = asRows<{ id: number | string }>(await apiCall(
    `${table}?name=${encodeURIComponent(name)}&fields=id`, 'GET', '', idToken,
  ), `${table} by name`);
  if (found.length) return Number(found[0].id);
  throw new Error(`Failed to seed ${table} "${name}": ${JSON.stringify(res)}`);
}

/**
 * Bind instructions to agents in one array-body POST (`_rest_post_bulk`).
 *
 * The response IS checked. That endpoint is ONE multi-value INSERT, so a single
 * composite-PK collision fails the whole batch — and because `apiCall` does not
 * throw, an unchecked seed would surface much later as a testid that never
 * appears, with nothing pointing back here.
 */
async function seedLinks(links: Link[], idToken: string): Promise<void> {
  const res = await apiCall('agent_instructions', 'POST', links, idToken) as
    { inserted?: number } | unknown;
  const inserted = (res as { inserted?: number })?.inserted;
  if (inserted !== links.length) {
    throw new Error(
      `Seeding ${links.length} agent_instructions links failed: ${JSON.stringify(res)}`);
  }
}

/** The row, or null when it genuinely does not exist. */
async function fetchInstructionOrNull(id: number, idToken: string): Promise<Row | null> {
  const rows = asRows<Row>(await apiCall(
    `instructions?id=${id}&fields=id,name,content,closed`, 'GET', '', idToken,
  ), `instruction ${id}`);
  return rows.length ? rows[0] : null;
}

/** The row, or a thrown error. Use wherever the row is expected to exist. */
async function fetchInstruction(id: number, idToken: string): Promise<Row> {
  const row = await fetchInstructionOrNull(id, idToken);
  if (!row) throw new Error(`Instruction ${id} not found`);
  return row;
}

async function fetchMyInstructions(idToken: string): Promise<Row[]> {
  return asRows<Row>(await apiCall(
    'instructions?fields=id,name,closed', 'GET', '', idToken), 'instructions');
}

async function fetchLinksForInstruction(id: number, idToken: string): Promise<Link[]> {
  return asRows<Link>(await apiCall(
    `agent_instructions?instruction_fk=${id}&fields=agent_fk,instruction_fk,sort_order`,
    'GET', '', idToken), `links for instruction ${id}`);
}

async function fetchLinksForAgent(id: number, idToken: string): Promise<Link[]> {
  return asRows<Link>(await apiCall(
    `agent_instructions?agent_fk=${id}&fields=agent_fk,instruction_fk,sort_order`,
    'GET', '', idToken), `links for agent ${id}`);
}

/**
 * Record every mutating REST call the page makes, keyed by the table (the last
 * path segment) so `instructions` and `agent_instructions` can never be confused.
 */
function captureWrites(page: Page): Write[] {
  const writes: Write[] = [];
  page.on('request', (req) => {
    const method = req.method();
    if (method !== 'PUT' && method !== 'POST' && method !== 'DELETE') return;
    let table: string;
    try { table = new URL(req.url()).pathname.split('/').pop() || ''; } catch { return; }
    let body: unknown = null;
    try { body = JSON.parse(req.postData() || 'null'); } catch { body = req.postData(); }
    writes.push({ method, table, body });
  });
  return writes;
}

const writesTo = (writes: Write[], method: string, table: string) =>
  writes.filter(w => w.method === method && w.table === table);

/**
 * `page.on('request')` fires when a request is SENT, not when it lands, and an
 * edit-in-place field paints the typed value immediately — so for the two ghost
 * fields there is no DOM event that means "the database has it". Poll the row
 * back instead of reading it once and racing the Lambda.
 */
async function expectStored(
  id: number, field: 'name' | 'content', value: string, idToken: string,
): Promise<void> {
  await expect.poll(async () => (await fetchInstruction(id, idToken))[field],
    { timeout: 20000 }).toBe(value);
}

/**
 * A real network round trip, used purely to give a request that WAS going to be
 * sent time to reach the `page.on('request')` listener before a "no write
 * happened" assertion reads the array.
 *
 * `page.on('request')` is delivered to Node asynchronously over CDP, so a
 * negative assertion preceded only by injected-script polls (`toHaveCount(0)`,
 * `toBeVisible()`) can pass vacuously — it may simply have run first.
 */
async function settle(idToken: string): Promise<void> {
  await fetchMyInstructions(idToken);
}

/** Card ids in DOM order, template row excluded. */
async function cardOrder(page: Page): Promise<number[]> {
  return page.evaluate(() => Array.from(
    document.querySelectorAll('[data-testid^="instruction-row-"]'))
    .map(el => el.getAttribute('data-testid') || '')
    .filter(t => /^instruction-row-\d+$/.test(t))
    .map(t => Number(t.replace('instruction-row-', ''))));
}

/** Instruction ids in load order on /agents/:id. */
async function loadOrder(page: Page): Promise<number[]> {
  return page.evaluate(() => Array.from(
    document.querySelectorAll('[data-testid^="agent-instruction-"]'))
    .map(el => el.getAttribute('data-testid') || '')
    .filter(t => /^agent-instruction-\d+$/.test(t))
    .map(t => Number(t.replace('agent-instruction-', ''))));
}

async function gotoRegistry(page: Page): Promise<void> {
  await page.goto('/agents/instructions');
  await expect(page.getByTestId('instructions-registry')).toBeVisible({ timeout: 30000 });
}

async function openCardMenu(page: Page, rowId: number): Promise<void> {
  await page.getByTestId(`instruction-card-menu-${rowId}`).click();
  await expect(page.getByTestId(`instruction-card-menu-popup-${rowId}`)).toBeVisible();
}

// NOT FOR THE PRODUCTION SMOKE RUN.
//
// `playwright.production.config.ts` pins TEST_DATABASE=darwin and applies no
// testMatch, so without this guard the whole suite would run against production —
// and unlike every other spec here, this one's subject is a SHARED CATALOG. Its
// beforeAll would POST 4 agents + 10 instructions into the production registry,
// AGENT-04's bind-all would bind an e2e instruction to every open agent the test
// user owns, and the two new cleanup steps would sweep production too. Blast
// radius is bounded by creator_fk and afterAll cleans up, but an interrupted run
// would leave rows in the registry the daemon reads at boot. That is exactly the
// argument helpers/api.ts makes for prefix-filtering the cleanup, and it applies
// twice as hard to seeding. Same idiom as build-visualizer.spec.ts.
const isDevHost = (process.env.BASE_URL || 'https://localhost:3000').includes('localhost');

test.describe.serial('Instruction registry (/agents/instructions)', () => {
  test.skip(!isDevHost,
    'Seeds the shared agent registry — never run against production darwin');
  test.setTimeout(120_000);

  let idToken: string;
  let sub: string;

  // Agents. AGENT-1 owns the load-order fixture and nothing else touches it.
  const agentIds: Record<string, number> = {};
  // Instructions, one per concern so a serial failure cannot poison its neighbours.
  const instrIds: Record<string, number> = {};
  const createdAgentIds: number[] = [];
  const createdInstructionIds: number[] = [];

  test.beforeAll(async ({ browser }) => {
    // Belt and braces on the describe-level skip above. Whether Playwright runs a
    // beforeAll for a fully-skipped group is an implementation detail, and the
    // thing on the other side of that detail is writing rows into the production
    // agent registry. Guard it here too rather than depend on the answer.
    if (!isDevHost) return;
    test.setTimeout(180_000);
    const context = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await context.newPage();
    idToken = await getIdToken(page);
    await context.close();

    sub = process.env.E2E_TEST_COGNITO_SUB!;
    if (!sub) throw new Error('E2E_TEST_COGNITO_SUB is required to seed the registry');
    STAMP = Date.now();

    // ----- agents -----
    // `name` and `file_name` both carry UNIQUE keys, so both are stamped.
    for (const key of ['a1', 'a2', 'a3', 'a4']) {
      const name = nm(`agent-${key}`);
      agentIds[key] = await createRow('agents', {
        creator_fk: sub, name, file_name: `${name}.md`,
        overview: `E2E seeded architect ${key}.`,
        ai_model: 'opus', effort: 'high', closed: 0, sort_order: 0,
      }, name, idToken);
      createdAgentIds.push(agentIds[key]);
    }

    // ----- instructions -----
    // The suffixes are alphabetically ordered on purpose: AGENT-11 asserts the
    // Name sort against the live catalog, and a deterministic seed makes a
    // failure there readable instead of a shuffle of opaque ids.
    const suffixes = [
      'a-order-1', 'a-order-2', 'a-order-3',
      'b-edit', 'c-bind', 'd-unbind',
      'e-close-unbound', 'f-close-bound',
      'g-del-guard', 'h-del-hard',
    ];
    for (const suffix of suffixes) {
      const name = nm(suffix);
      instrIds[suffix] = await createRow('instructions', {
        creator_fk: sub, name, content: SEED_CONTENT, closed: 0,
      }, name, idToken);
      createdInstructionIds.push(instrIds[suffix]);
    }

    // ----- junction -----
    // BANDED slots, the layout `repairInstructionOrders` and migration 073's
    // UNIQUE (agent_fk, sort_order) both exist to preserve: per-agent rules at
    // 1..N, the shared rows together at 100+. AGENT-01 proves a reorder keeps
    // exactly this value set rather than renumbering it to 1,2,3.
    await seedLinks([
      { agent_fk: agentIds.a1, instruction_fk: instrIds['a-order-1'], sort_order: 1 },
      { agent_fk: agentIds.a1, instruction_fk: instrIds['a-order-2'], sort_order: 2 },
      { agent_fk: agentIds.a1, instruction_fk: instrIds['a-order-3'], sort_order: 100 },
      { agent_fk: agentIds.a2, instruction_fk: instrIds['f-close-bound'], sort_order: 1 },
      { agent_fk: agentIds.a2, instruction_fk: instrIds['g-del-guard'], sort_order: 2 },
      { agent_fk: agentIds.a2, instruction_fk: instrIds['h-del-hard'], sort_order: 3 },
      { agent_fk: agentIds.a3, instruction_fk: instrIds['d-unbind'], sort_order: 1 },
      { agent_fk: agentIds.a3, instruction_fk: instrIds['g-del-guard'], sort_order: 2 },
      { agent_fk: agentIds.a4, instruction_fk: instrIds['h-del-hard'], sort_order: 1 },
      // `d-unbind` is bound TWICE on purpose. With a single link, AGENT-05's
      // post-condition ("no links remain") is satisfied just as well by an
      // over-broad DELETE that dropped `agent_fk` from its composite key and
      // removed every binding of the instruction. The second link is what turns
      // that assertion into a real one.
      { agent_fk: agentIds.a4, instruction_fk: instrIds['d-unbind'], sort_order: 2 },
    ], idToken);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    // `agent_instructions` CASCADEs on both FKs, so deleting the parents is the
    // whole teardown. Agents first: a stranded junction row belongs to an agent.
    for (const id of createdAgentIds) {
      try { await apiDelete('agents', id, idToken); } catch { /* best-effort */ }
    }
    for (const id of createdInstructionIds) {
      try { await apiDelete('instructions', id, idToken); } catch { /* best-effort */ }
    }
  });

  // -------------------------------------------------------------------------
  // AGENT-01 — the load-order invariant, end to end.
  //
  // THE HIGHEST-VALUE TEST IN THIS FILE. `planInstructionSwap` is unit-tested,
  // but the SWAP-NOT-RENUMBER guarantee is a property of the whole round trip:
  // the planner decides two writes, `setAgentInstructionOrder` DELETEs both rows
  // and re-POSTs them in one array body, and migration 073's
  // UNIQUE (agent_fk, sort_order) has to tolerate that sequence. Until now none
  // of that was exercised together, and a rewrite of the apply step into a
  // per-row move would pass every existing test while corrupting the bands.
  // -------------------------------------------------------------------------
  test('AGENT-01: reordering load order swaps slots and preserves the banded values', async ({ page }) => {
    const [one, two, three] = ['a-order-1', 'a-order-2', 'a-order-3'].map(k => instrIds[k]);

    await page.goto(`/agents/${agentIds.a1}`);
    await expect(page.getByTestId(`agent-detail-${agentIds.a1}`)).toBeVisible({ timeout: 30000 });

    await expect(page.getByTestId(`agent-instruction-order-${one}`)).toHaveText('#1');
    expect(await loadOrder(page)).toEqual([one, two, three]);

    await page.getByTestId(`agent-instruction-down-${one}`).click();

    // The captions are rendered from the refetched junction rows, so waiting on
    // them is waiting on the write, not on an optimistic paint.
    await expect(page.getByTestId(`agent-instruction-order-${one}`)).toHaveText('#2', { timeout: 20000 });
    await expect(page.getByTestId(`agent-instruction-order-${two}`)).toHaveText('#1');
    await expect(page.getByTestId(`agent-instruction-order-${three}`)).toHaveText('#100');

    expect(await loadOrder(page)).toEqual([two, one, three]);

    // The stored truth: the VALUE SET is untouched. A renumber would leave
    // {1,2,3} here and the UI would look identical.
    const links = await fetchLinksForAgent(agentIds.a1, idToken);
    const byInstruction = new Map(links.map(l => [l.instruction_fk, l.sort_order]));
    expect(byInstruction.get(one)).toBe(2);
    expect(byInstruction.get(two)).toBe(1);
    expect(byInstruction.get(three)).toBe(100);
    expect([...byInstruction.values()].sort((a, b) => (a || 0) - (b || 0))).toEqual([1, 2, 100]);
  });

  // -------------------------------------------------------------------------
  // AGENT-02 — edit in place, ONE PUT PER FIELD.
  // -------------------------------------------------------------------------
  test('AGENT-02: name and content each commit alone, one PUT per field', async ({ page }) => {
    const rowId = instrIds['b-edit'];
    const newName = `${nm('b-edit')}-renamed`;
    const newContent = 'Rewritten binding text — only the content column may move.';

    const writes = captureWrites(page);
    await gotoRegistry(page);

    // --- name ---
    const nameField = page.getByTestId(`instruction-name-input-${rowId}`);
    await expect(nameField).toHaveValue(nm('b-edit'));
    await nameField.fill(newName);
    await nameField.blur();

    await expect.poll(() => writesTo(writes, 'PUT', 'instructions').length,
      { timeout: 20000 }).toBe(1);

    const namePut = writesTo(writes, 'PUT', 'instructions')[0].body as Array<Record<string, unknown>>;
    expect(Array.isArray(namePut)).toBe(true);
    expect(namePut).toHaveLength(1);
    // The contract, asserted as a KEY SET: a name edit carries nothing else.
    expect(Object.keys(namePut[0]).sort()).toEqual(['id', 'name']);
    expect(Number(namePut[0].id)).toBe(rowId);
    expect(namePut[0].name).toBe(newName);

    await expectStored(rowId, 'name', newName, idToken);
    // Untouched by a name write — the whole point of one PUT per field.
    expect((await fetchInstruction(rowId, idToken)).content).toBe(SEED_CONTENT);
    // Re-read the counter AFTER those round trips. `expect.poll(...).toBe(1)`
    // resolves the instant it sees 1 and stops looking, so on its own it asserts
    // "reached one PUT", not "issued exactly one" — a duplicate arriving a beat
    // later would never be seen.
    expect(writesTo(writes, 'PUT', 'instructions')).toHaveLength(1);

    // --- content ---
    const contentField = page.getByTestId(`instruction-content-input-${rowId}`);
    await contentField.fill(newContent);
    await contentField.blur();

    await expect.poll(() => writesTo(writes, 'PUT', 'instructions').length,
      { timeout: 20000 }).toBe(2);

    const contentPut = writesTo(writes, 'PUT', 'instructions')[1].body as Array<Record<string, unknown>>;
    expect(contentPut).toHaveLength(1);
    expect(Object.keys(contentPut[0]).sort()).toEqual(['content', 'id']);
    expect(contentPut[0].content).toBe(newContent);

    await expectStored(rowId, 'content', newContent, idToken);
    expect((await fetchInstruction(rowId, idToken)).name).toBe(newName);  // untouched
    // Exactly two PUTs across the whole test — one per field, no more.
    expect(writesTo(writes, 'PUT', 'instructions')).toHaveLength(2);

    // Both survive a reload — the fields are showing the database, not local state.
    await gotoRegistry(page);
    await expect(page.getByTestId(`instruction-name-input-${rowId}`)).toHaveValue(newName);
    await expect(page.getByTestId(`instruction-content-input-${rowId}`)).toHaveValue(newContent);
  });

  // -------------------------------------------------------------------------
  // AGENT-03 — a blocked value writes NOTHING and says so.
  //
  // The highest-value assertion on the page. There is no Save button, so the
  // `unsaved` chip is the ONLY signal that a typed value was not written; without
  // it the user navigates away believing the edit landed.
  // -------------------------------------------------------------------------
  test('AGENT-03: a duplicate name is refused, kept on screen and flagged unsaved', async ({ page }) => {
    const rowId = instrIds['c-bind'];
    const taken = (await fetchInstruction(instrIds['a-order-1'], idToken)).name;

    const writes = captureWrites(page);
    await gotoRegistry(page);

    const nameField = page.getByTestId(`instruction-name-input-${rowId}`);
    await nameField.fill(taken);
    await nameField.blur();

    // The rejection is client-side, so "no write" is the assertion — not "a write
    // that failed". Give the page long enough that a PUT would have been seen.
    await expect(page.getByTestId(`instruction-name-input-${rowId}-message`))
      .toContainText('already exists');
    await expect(page.getByTestId(`instruction-unsaved-${rowId}`)).toBeVisible();
    await expect(nameField).toHaveValue(taken);      // the dirty text survives blur

    // Read the row back FIRST. That round trip is what gives a PUT time to have
    // appeared, so the "no write" assertion below is a real negative rather than
    // a race the page happened to win.
    const stored = await fetchInstruction(rowId, idToken);
    expect(stored.name).toBe(nm('c-bind'));
    expect(writesTo(writes, 'PUT', 'instructions')).toHaveLength(0);

    // Escape abandons the edit: the message, the chip and the text all go.
    await nameField.click();
    await nameField.press('Escape');
    await expect(page.getByTestId(`instruction-unsaved-${rowId}`)).toHaveCount(0);
    await expect(nameField).toHaveValue(nm('c-bind'));
    // Same discipline as above — a round trip first, so a PUT the abandon latch
    // failed to suppress has demonstrably had time to be recorded.
    await settle(idToken);
    expect(writesTo(writes, 'PUT', 'instructions')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AGENT-04 — membership through the roster palette.
  // -------------------------------------------------------------------------
  test('AGENT-04: the palette binds one agent at max+1 and the rest in one bulk POST', async ({ page }) => {
    const rowId = instrIds['c-bind'];

    // max(slot)+1 is read from the database NOW rather than assumed, so the
    // assertion does not depend on what earlier tests did to this agent.
    const before = await fetchLinksForAgent(agentIds.a2, idToken);
    const expectedSlot = Math.max(0, ...before
      .map(l => l.sort_order)
      .filter((o): o is number => Number.isFinite(o as number))) + 1;

    const writes = captureWrites(page);
    await gotoRegistry(page);

    // Resting card: no palette, and the row is unbound.
    await expect(page.getByTestId(`instruction-unbound-${rowId}`)).toBeVisible();
    await expect(page.getByTestId(`instruction-${rowId}-bind-${agentIds.a2}`)).toHaveCount(0);

    await page.getByTestId(`instruction-${rowId}-agent-add`).click();
    await expect(page.getByTestId(`instruction-${rowId}-bind-${agentIds.a2}`)).toBeVisible();

    await page.getByTestId(`instruction-${rowId}-bind-${agentIds.a2}`).click();
    // Ghost chip → solid chip, in place.
    await expect(page.getByTestId(`instruction-${rowId}-agent-${agentIds.a2}`))
      .toBeVisible({ timeout: 20000 });

    const afterOne = await fetchLinksForInstruction(rowId, idToken);
    expect(afterOne).toHaveLength(1);
    expect(afterOne[0].agent_fk).toBe(agentIds.a2);
    expect(afterOne[0].sort_order).toBe(expectedSlot);

    // --- bind all the remaining agents in ONE round trip ---
    //
    // `bindableAgents` is EVERY open agent this creator owns, not just the four
    // seeded here — which is why the count is read off the live chip rather than
    // hard-coded. The consequence worth knowing: on a test user that owns other
    // agents, this binds an e2e instruction to them too. That self-heals, because
    // deleting the e2e instruction CASCADEs the junction rows away, and
    // `cleanupStaleData` deletes it by name prefix on the next run.
    const bindAll = page.getByTestId(`instruction-${rowId}-agent-bind-all`);
    await expect(bindAll).toBeVisible();
    const remaining = Number((await bindAll.textContent() || '').replace(/\D+/g, ''));
    expect(remaining).toBeGreaterThanOrEqual(3);     // a1, a3, a4 at minimum

    const postsBefore = writesTo(writes, 'POST', 'agent_instructions').length;
    await bindAll.click();

    for (const key of ['a1', 'a3', 'a4']) {
      await expect(page.getByTestId(`instruction-${rowId}-agent-${agentIds[key]}`))
        .toBeVisible({ timeout: 20000 });
    }

    const bulk = writesTo(writes, 'POST', 'agent_instructions').slice(postsBefore);
    // ONE multi-value INSERT, not a loop. A loop is the half-applied-set failure
    // mode `linkAgentInstructions` was adopted to remove.
    expect(bulk).toHaveLength(1);
    expect(Array.isArray(bulk[0].body)).toBe(true);
    expect(bulk[0].body as unknown[]).toHaveLength(remaining);

    const afterAll = await fetchLinksForInstruction(rowId, idToken);
    expect(afterAll.length).toBe(1 + remaining);
    // Every link carries a real slot — a NULL here would sort the row last in
    // that agent's boot payload regardless of intent.
    for (const link of afterAll) expect(Number.isFinite(link.sort_order)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AGENT-05 — unbind is confirmed by a real dialog (req #3071), not window.confirm.
  // -------------------------------------------------------------------------
  test('AGENT-05: unbinding a chip is confirmed and removes only that one link', async ({ page }) => {
    const rowId = instrIds['d-unbind'];

    await gotoRegistry(page);

    // Seeded with TWO bindings so "only that one link" is testable at all.
    expect(await fetchLinksForInstruction(rowId, idToken)).toHaveLength(2);

    const chip = page.getByTestId(`instruction-${rowId}-agent-${agentIds.a3}`);
    await expect(chip).toBeVisible();
    await chip.locator('.MuiChip-deleteIcon').click();

    const dialog = page.getByTestId('instruction-unbind-dialog');
    await expect(dialog).toBeVisible();
    // The slot warning is the one consequence the card cannot show: a rebind
    // appends at max+1 rather than restoring this position.
    await expect(page.getByTestId('instruction-unbind-slot-warning')).toBeVisible();

    // Cancel really cancels.
    await page.getByTestId('instruction-unbind-cancel-btn').click();
    await expect(dialog).toBeHidden();
    expect(await fetchLinksForInstruction(rowId, idToken)).toHaveLength(2);

    await chip.locator('.MuiChip-deleteIcon').click();
    await expect(dialog).toBeVisible();
    await page.getByTestId('instruction-unbind-confirm-btn').click();

    await expect(page.getByTestId(`instruction-${rowId}-agent-${agentIds.a3}`))
      .toHaveCount(0, { timeout: 20000 });

    // THE ASSERTION THAT MATTERS: a3's link is gone and a4's is untouched, slot
    // and all. `agent_instructions` has a composite PK, so an unbind that lost
    // its `agent_fk` would delete both — and against a single-link fixture that
    // would look identical to success.
    const remaining = await fetchLinksForInstruction(rowId, idToken);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].agent_fk).toBe(agentIds.a4);
    expect(remaining[0].sort_order).toBe(2);
    await expect(page.getByTestId(`instruction-${rowId}-agent-${agentIds.a4}`)).toBeVisible();

    // The instruction row itself survives — only the binding was removed.
    expect(await fetchInstructionOrNull(rowId, idToken)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // AGENT-06 — graduated close, UNBOUND path: no ceremony, because there is
  // nothing to disclose.
  // -------------------------------------------------------------------------
  test('AGENT-06: closing an unbound row skips the dialog, and reopen restores it', async ({ page }) => {
    const rowId = instrIds['e-close-unbound'];

    await gotoRegistry(page);
    expect(await fetchLinksForInstruction(rowId, idToken)).toHaveLength(0);

    await openCardMenu(page, rowId);
    // No ellipsis on the label: this row closes immediately.
    await expect(page.getByTestId(`instruction-menu-close-${rowId}`))
      .toHaveText('Close instruction');
    await page.getByTestId(`instruction-menu-close-${rowId}`).click();

    // Two-sided proof that no dialog was involved: nothing is rendered, AND the
    // row closes anyway — a dialog would have parked the write behind a button.
    await expect(page.getByTestId('instruction-delete-dialog')).toHaveCount(0);
    await expect(page.getByTestId(`instruction-row-${rowId}`)).toHaveCount(0, { timeout: 20000 });
    expect((await fetchInstruction(rowId, idToken)).closed).toBe(1);

    // The Closed filter chip is what makes a closed row reachable again.
    const showClosed = page.getByTestId('instructions-show-closed');
    await expect(showClosed).toBeVisible();
    await showClosed.click();
    await expect(page.getByTestId(`instruction-row-${rowId}`)).toBeVisible();
    await expect(page.getByTestId(`instruction-closed-${rowId}`)).toBeVisible();

    // Reopen restores a duty rather than removing one, so it has no dialog either.
    await openCardMenu(page, rowId);
    await page.getByTestId(`instruction-menu-reopen-${rowId}`).click();
    await expect(page.getByTestId(`instruction-closed-${rowId}`)).toHaveCount(0, { timeout: 20000 });
    expect((await fetchInstruction(rowId, idToken)).closed).toBe(0);
  });

  // -------------------------------------------------------------------------
  // AGENT-07 — graduated close, BOUND path: the dialog IS shown, because closing
  // drops the row out of every bound agent's boot payload.
  // -------------------------------------------------------------------------
  test('AGENT-07: closing a bound row goes through the dialog and keeps its links', async ({ page }) => {
    const rowId = instrIds['f-close-bound'];
    const linksBefore = await fetchLinksForInstruction(rowId, idToken);
    expect(linksBefore.length).toBeGreaterThan(0);

    await gotoRegistry(page);

    await openCardMenu(page, rowId);
    // The trailing ellipsis is the affordance that tells the two paths apart.
    await expect(page.getByTestId(`instruction-menu-close-${rowId}`))
      .toHaveText('Close instruction…');
    await page.getByTestId(`instruction-menu-close-${rowId}`).click();

    const dialog = page.getByTestId('instruction-delete-dialog');
    await expect(dialog).toBeVisible();
    // Opened from "Close", so it must not be titled "Delete".
    await expect(dialog).toContainText(`Close “${nm('f-close-bound')}”?`);
    await expect(dialog).toContainText(nm('agent-a2'));   // the blast radius, named

    await page.getByTestId('instruction-delete-close-btn').click();

    await expect(page.getByTestId(`instruction-row-${rowId}`)).toHaveCount(0, { timeout: 20000 });
    expect((await fetchInstruction(rowId, idToken)).closed).toBe(1);
    // CLOSING IS NOT DELETING: every binding survives, which is what makes it
    // reversible.
    expect(await fetchLinksForInstruction(rowId, idToken)).toHaveLength(linksBefore.length);

    // And the agent page accounts for what it stopped loading.
    await page.goto(`/agents/${agentIds.a2}`);
    await expect(page.getByTestId(`agent-detail-${agentIds.a2}`)).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('agent-instructions-closed-note')).toBeVisible();
    await expect(page.getByTestId('agent-instructions-closed-note')).toContainText('closed');
    // A closed instruction must not render in the boot-order list.
    expect(await loadOrder(page)).not.toContain(rowId);
  });

  // -------------------------------------------------------------------------
  // AGENT-08 — the delete guardrail.
  // -------------------------------------------------------------------------
  test('AGENT-08: delete is gated on typing the exact name, and Close instead keeps the links', async ({ page }) => {
    const rowId = instrIds['g-del-guard'];
    const name = nm('g-del-guard');
    const linksBefore = await fetchLinksForInstruction(rowId, idToken);
    // The typed-name challenge is reserved for SHARED rows (refCount >= 2).
    expect(linksBefore.length).toBeGreaterThanOrEqual(2);

    await gotoRegistry(page);

    await openCardMenu(page, rowId);
    await page.getByTestId(`instruction-menu-delete-${rowId}`).click();

    const dialog = page.getByTestId('instruction-delete-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Delete “${name}”?`);

    const confirm = page.getByTestId('instruction-delete-confirm-btn');
    const challenge = page.getByTestId('instruction-delete-challenge-input');
    await expect(challenge).toBeVisible();
    await expect(confirm).toBeDisabled();

    // A near miss is still a miss.
    await challenge.fill(`${name}x`);
    await expect(confirm).toBeDisabled();
    await challenge.fill(name.slice(0, -1));
    await expect(confirm).toBeDisabled();

    await challenge.fill(name);
    await expect(confirm).toBeEnabled();

    // Take the reversible exit the dialog pushes: same effect at boot, no data loss.
    await page.getByTestId('instruction-delete-close-btn').click();
    await expect(dialog).toBeHidden({ timeout: 20000 });

    expect((await fetchInstruction(rowId, idToken)).closed).toBe(1);
    expect(await fetchLinksForInstruction(rowId, idToken)).toHaveLength(linksBefore.length);
  });

  // -------------------------------------------------------------------------
  // AGENT-09 — the hard delete really cascades.
  // -------------------------------------------------------------------------
  test('AGENT-09: confirming the challenge deletes the row and cascades its bindings', async ({ page }) => {
    const rowId = instrIds['h-del-hard'];
    const name = nm('h-del-hard');
    expect((await fetchLinksForInstruction(rowId, idToken)).length).toBeGreaterThanOrEqual(2);

    await gotoRegistry(page);

    await openCardMenu(page, rowId);
    await page.getByTestId(`instruction-menu-delete-${rowId}`).click();

    const dialog = page.getByTestId('instruction-delete-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('instruction-delete-challenge-input').fill(name);
    await page.getByTestId('instruction-delete-confirm-btn').click();

    await expect(page.getByTestId(`instruction-row-${rowId}`)).toHaveCount(0, { timeout: 20000 });
    // Gone, not closed.
    expect(await fetchInstructionOrNull(rowId, idToken)).toBeNull();
    // `agent_instructions` CASCADEs on both FKs — the junction rows go with it.
    expect(await fetchLinksForInstruction(rowId, idToken)).toHaveLength(0);

    // Agent a4 drops the deleted row and KEEPS everything else it loads. Asserting
    // only "does not contain" would pass just as well on a page that rendered no
    // instruction list at all, so the survivors are asserted positively.
    await page.goto(`/agents/${agentIds.a4}`);
    await expect(page.getByTestId(`agent-detail-${agentIds.a4}`)).toBeVisible({ timeout: 30000 });
    // Closed rows are excluded from the boot-order list on purpose — listing them
    // would misrepresent what the agent loads — so the expectation excludes them
    // too, computed from the catalog rather than assumed.
    const openIds = new Set((await fetchMyInstructions(idToken))
      .filter(r => !r.closed).map(r => r.id));
    const a4Expected = (await fetchLinksForAgent(agentIds.a4, idToken))
      .filter(l => openIds.has(l.instruction_fk))
      .sort((x, y) => (x.sort_order ?? Infinity) - (y.sort_order ?? Infinity))
      .map(l => l.instruction_fk);
    expect(a4Expected.length).toBeGreaterThan(0);
    expect(await loadOrder(page)).toEqual(a4Expected);

    const idx = createdInstructionIds.indexOf(rowId);
    if (idx >= 0) createdInstructionIds.splice(idx, 1);   // already gone
  });

  // -------------------------------------------------------------------------
  // AGENT-10 — the template row.
  //
  // The row must be created when the SECOND field is filled, never the first
  // (both columns are NOT NULL), and the template must come back EMPTY. A real
  // defect in development had the blank template inheriting the created row's
  // content, so the next row silently carried the previous one's binding text.
  // -------------------------------------------------------------------------
  test('AGENT-10: the template creates on the second field and then empties itself', async ({ page }) => {
    const name = nm('i-template');
    const content = 'Created through the template row, not a button.';

    const writes = captureWrites(page);
    await gotoRegistry(page);

    const nameField = page.getByTestId('instruction-name-input-template');
    const contentField = page.getByTestId('instruction-content-input-template');

    // First field alone: NOT a create. `settle` first — `toBeVisible()` on an
    // always-rendered field resolves immediately and would give a POST no chance
    // to reach the listener, making this pass vacuously.
    await nameField.fill(name);
    await nameField.blur();
    await settle(idToken);
    expect(writesTo(writes, 'POST', 'instructions')).toHaveLength(0);
    expect((await fetchMyInstructions(idToken)).some(r => r.name === name)).toBe(false);

    // Second field completes the row.
    await contentField.fill(content);
    await contentField.blur();

    // Poll the catalog, not the captured request: a request is recorded when it
    // is sent, so counting POSTs first would race the INSERT.
    await expect.poll(async () => (await fetchMyInstructions(idToken))
      .some(r => r.name === name), { timeout: 20000 }).toBe(true);
    expect(writesTo(writes, 'POST', 'instructions')).toHaveLength(1);

    const created = (await fetchMyInstructions(idToken)).find(r => r.name === name);
    expect(created).toBeTruthy();
    createdInstructionIds.push(created!.id);

    await expect(page.getByTestId(`instruction-row-${created!.id}`)).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId(`instruction-content-input-${created!.id}`)).toHaveValue(content);
    // Born unbound — membership needs a row id, so a new row is bound afterwards
    // through its own chips.
    await expect(page.getByTestId(`instruction-unbound-${created!.id}`)).toBeVisible();
    expect(await fetchLinksForInstruction(created!.id, idToken)).toHaveLength(0);

    // THE REGRESSION: both template fields come back blank.
    await expect(nameField).toHaveValue('');
    await expect(contentField).toHaveValue('');
  });

  // -------------------------------------------------------------------------
  // AGENT-11 — the viewer header.
  // -------------------------------------------------------------------------
  test('AGENT-11: header renders the accounting line and the Name sort reorders the grid', async ({ page }) => {
    // The sort MODE persists cross-tab in localStorage, and `chooseSort` behaves
    // differently when the clicked mode is already active — it flips the
    // direction and deliberately leaves the menu OPEN. Clear the key so this test
    // asserts a known starting state rather than depending on the saved
    // storageState never having visited this page.
    await page.goto('/agents/instructions');
    await page.evaluate(() => localStorage.removeItem('darwin-instructions-sort'));
    await gotoRegistry(page);

    await expect(page.getByTestId('instructions-view-toggle')).toBeVisible();
    await expect(page.getByTestId('view-toggle-cards')).toHaveAttribute('aria-pressed', 'true');

    // --- accounting line, computed from the live catalog rather than hard-coded ---
    const catalog = await fetchMyInstructions(idToken);
    const allLinks = await apiCall(
      'agent_instructions?fields=agent_fk,instruction_fk,sort_order', 'GET', '', idToken) as Link[];
    const bound = new Set((Array.isArray(allLinks) ? allLinks : []).map(l => l.instruction_fk));
    const openRows = catalog.filter(r => !r.closed);
    const closedCount = catalog.length - openRows.length;
    const unboundCount = openRows.filter(r => !bound.has(r.id)).length;
    const expected = [
      `${openRows.length} instruction${openRows.length === 1 ? '' : 's'}`,
      unboundCount > 0 && `${unboundCount} not bound`,
      closedCount > 0 && `${closedCount} closed`,
    ].filter(Boolean).join(' · ');
    await expect(page.getByTestId('instructions-accounting')).toHaveText(expected);

    // --- sort ---
    await page.getByTestId('instructions-settings-button').click();
    await expect(page.getByTestId('instructions-sort-menu')).toBeVisible();
    await expect(page.getByTestId('instructions-sort-agents')).toBeVisible();
    await expect(page.getByTestId('instructions-sort-date')).toBeVisible();
    await page.getByTestId('instructions-sort-name').click();
    await expect(page.getByTestId('instructions-sort-menu')).toBeHidden();

    // Name mode is ASCENDING by default (`defaultDesc: false`). Assert the order
    // of the rows this suite owns; anything else on the page is not our business.
    //
    // The expectation is sorted INSIDE THE BROWSER on purpose. `compareInstructionRows`
    // uses `localeCompare`, whose tie-breaking of '-' against alphanumerics is an
    // ICU collation detail — computing it in Node would be comparing the page
    // against a different collator and could fail for a reason that is not a bug.
    const mine = new Set(openRows.map(r => r.id));
    const expectedOrder = await page.evaluate(
      (rows: Array<{ id: number; name: string }>) => rows
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(r => r.id),
      openRows.map(r => ({ id: r.id, name: r.name })));
    await expect.poll(async () => (await cardOrder(page)).filter(id => mine.has(id)),
      { timeout: 20000 }).toEqual(expectedOrder);
  });
});
