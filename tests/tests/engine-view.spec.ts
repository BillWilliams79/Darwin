import { test, expect, Page, Route } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Req #3760 — the engine view (/swarm/engines). The user actions the page
// offers: open it, scrub an engine's history, follow an epic link into the
// plan view. Coverage map rows A19 (an executor launch that fails, then is
// admitted again and lands) and A20 (scrub engine history) in
// tests/engine/COVERAGE.md name this file.
//
// THE ROWS ARE THE ENGINE'S. Every engine table read is answered from
// `engineViewFixture.json`, whose decision records `core.decide()` produced
// (scripts/swarm/engine2/view_fixture.py; tests/engine/test_view_fixture.py
// fails when it goes stale). The E2E account owns no engine rows, and this spec
// must not depend on a live engine — req #3763's cutover is where a live one is
// checked. Stamps are shifted onto the wall clock so heartbeat AGES are real:
// the fixture's beating engine beat 20 s ago, its missing one 15 min ago.

const FIXTURE = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/SwarmView/engine/__tests__/engineViewFixture.json'), 'utf8'));
const STAMPS = ['create_ts', 'update_ts', 'beat_at', 'desired_at', 'actual_at', 'cycle_at'];

function shifted(rows: any[], offsetMs: number) {
  return rows.map((row) => {
    const out = { ...row };
    for (const k of STAMPS) {
      if (out[k]) {
        const t = new Date(`${String(out[k]).replace(' ', 'T')}Z`).getTime() + offsetMs;
        out[k] = new Date(t).toISOString().replace('T', ' ').slice(0, 19);
      }
    }
    return out;
  });
}

async function routeEngineTables(page: Page) {
  const offset = Date.now() - new Date(`${FIXTURE.now.replace(' ', 'T')}Z`).getTime();
  const tables: Record<string, any[]> = {
    engine_states: shifted(FIXTURE.engine_states, offset),
    engine_heartbeats: shifted(FIXTURE.engine_heartbeats, offset),
    engine_decision_records: shifted(FIXTURE.engine_decision_records, offset),
    engine_outcomes: shifted(FIXTURE.engine_outcomes, offset),
    machines: FIXTURE.machines,
    pipelines: FIXTURE.pipelines,
    initiatives: FIXTURE.initiatives,
    epics: FIXTURE.epics,
    requirements: [],
  };
  const answer = (name: string) => async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const url = new URL(route.request().url());
    let rows = tables[name];
    for (const col of ['id', 'pipeline_fk', 'record_fk']) {
      const v = url.searchParams.get(col);
      if (v != null && !v.startsWith('(')) rows = rows.filter((r) => String(r[col]) === v);
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  };
  for (const name of Object.keys(tables)) {
    // The API host only — `/swarm/pipelines` is also a PAGE route of the app.
    await page.route(new RegExp(`execute-api[^?]*/${name}(\\?|$)`), answer(name));
  }
}

const rowsOf = (machine: number) =>
  FIXTURE.engine_decision_records.filter((r: any) => r.machine_fk === machine);

test.describe('Engine view (/swarm/engines)', () => {
  test.beforeEach(async ({ page }) => {
    await routeEngineTables(page);
  });

  test('ENG-01: opens on every engine — beating, missing by age, and off', async ({ page }) => {
    await page.goto('/swarm/engines');
    await expect(page.getByTestId('engines-page')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid^="engine-panel-"]')).toHaveCount(4);
    await expect(page.getByTestId('engines-summary')).toHaveText('4 engines · 2 beating · 1 missing · 1 off');
    // The latest decision of the lead, in plain words.
    await expect(page.getByTestId('engine-cycle-1')).toContainText('Cycle 7');
    // Missing says so by the age of the last beat, not by absence.
    await expect(page.getByTestId('engine-panel-2')).toHaveAttribute('data-health', 'missing');
    await expect(page.getByTestId('engine-missing-2')).toContainText('No heartbeat for 15m');
    // Off: greyed, with when it stopped, still showing its last record.
    await expect(page.getByTestId('engine-off-3')).toContainText('Turned off — stopped');
    await expect(page.getByTestId('engine-body-3')).toHaveCSS('opacity', '0.5');
    await expect(page.getByTestId('engine-cycle-3')).toContainText('Cycle 6');
    // Limits and the cut line.
    await expect(page.getByTestId('engine-limit-ceiling-4')).toHaveText('ceiling 2');
    await expect(page.getByTestId('engine-cut-4')).toBeVisible();
  });

  test('ENG-02: scrubs an engine\'s history back and returns to the latest (A20)', async ({ page }) => {
    await page.goto('/swarm/engines');
    const rows = rowsOf(3);
    await expect(page.getByTestId('engine-cycle-3')).toContainText('Cycle 6', { timeout: 15000 });
    await page.getByTestId(`engine-history-cell-3-${rows[1].id}`).click();
    await expect(page.getByTestId('engine-cycle-3')).toContainText('Cycle 2');
    await expect(page.getByTestId('engine-verdict-3')).toHaveText('BUDGET-DERIVED-ONLY');
    await expect(page.getByTestId('engine-queue-empty-3')).toBeVisible();
    await expect(page.getByTestId('engine-changes-3'))
      .toContainText('verdict NO-PAUSE-DERIVATION → BUDGET-DERIVED-ONLY');
    await page.getByTestId('engine-history-prev-3').click();
    await expect(page.getByTestId('engine-cycle-3')).toContainText('Cycle 1');
    await page.getByTestId('engine-history-latest-3').click();
    await expect(page.getByTestId('engine-cycle-3')).toContainText('Cycle 6');
  });

  test('ENG-03: a failed launch is admitted again and lands (A19)', async ({ page }) => {
    await page.goto('/swarm/engines');
    const rows = rowsOf(1);
    await expect(page.getByTestId('engine-cycle-1')).toContainText('Cycle 7', { timeout: 15000 });
    await page.getByTestId(`engine-history-cell-1-${rows[0].id}`).click();
    await expect(page.getByTestId('engine-outcome-1-3001')).toHaveAttribute('data-outcome', 'failed');
    await expect(page.getByTestId('engine-outcome-1-3001')).toContainText('iTerm launch refused');
    await page.getByTestId(`engine-history-cell-1-${rows[4].id}`).click();
    await expect(page.getByTestId('engine-cycle-1')).toContainText('Cycle 5');
    await expect(page.getByTestId('engine-queue-item-1-3001')).toContainText('announced again (attempt 3)');
    await expect(page.getByTestId('engine-outcome-1-3001')).toHaveAttribute('data-outcome', 'landed');
  });

  test('ENG-04: follows an epic link into the plan view, framed on that epic', async ({ page }) => {
    await page.goto('/swarm/engines');
    const link = page.getByTestId('engine-epic-row-link-4-102');
    await expect(link).toBeVisible({ timeout: 15000 });
    await link.click();
    await expect(page).toHaveURL(/\/swarm\/pipeline\/900\?mode=plan&epic=102&level=3$/);
    // The plan page mounted (the E2E account holds no plan 900, so it names the miss).
    await expect(page.getByTestId('pipeline-detail').or(page.getByTestId('pipeline-not-found')))
      .toBeVisible({ timeout: 15000 });
  });

  test('ENG-05: the Engines link sits under Pipelines in the navbar', async ({ page }) => {
    await page.goto('/swarm/pipelines');
    const navbar = page.locator('.app-navbar');
    const link = navbar.getByRole('link', { name: /^engines$/i });
    // Under Pipelines, hidden until its +/- is clicked (navigation.spec.ts).
    await expect(page.getByTestId('nav-expand-toggle-swarm-pipelines')).toBeVisible({ timeout: 15000 });
    if ((await link.count()) === 0) await page.getByTestId('nav-expand-toggle-swarm-pipelines').click();
    await expect(link).toHaveCount(1);
    await link.click();
    await expect(page).toHaveURL(/\/swarm\/engines$/);
    await expect(page.getByTestId('engines-page')).toBeVisible({ timeout: 15000 });
  });
});
