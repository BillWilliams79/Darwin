import { test, expect, Page, Route } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Req #3762 — the plan view's engine overlay (/swarm/pipeline/:id?mode=plan):
// the engine switch for this plan on this machine, the numbered launch-order
// badges on the epic cards, the cut line with the limits, the machine of each
// launch, and a held epic's reason on hover (a barrier-held epic with no
// launch in the queue draws no pill, req #4071).
//
//   OVL-01  switch ON from the plan view (A1, A21): the switch is written, an
//           authoring plan is set orchestrating (req #3965), the engine comes
//           up, and the badges and the cut become the engine's record exactly
//   OVL-02  switch OFF (A2): the engine goes down, the plan — no engine of it
//           left wanted on — is set orchestration_ready (req #3965), and the
//           overlay returns to the prediction from the derived block
//   OVL-03  an epic held by an upstream barrier draws no pill
//   OVL-A*  each plan-overlay user action of tests/engine/COVERAGE.md (A8–A18,
//           A21): before and after, the engine's record drawn on the plan
//
// THE ROWS ARE decide()'S. Every read is answered from `planOverlayFixture.json`
// (scripts/swarm/engine2/overlay_fixture.py — the scenario corpus run through
// `core.decide()`; tests/engine/test_overlay_fixture.py fails when it goes
// stale): the composed read, the machine's ceiling and live sessions, the live
// claims, and the engine's rows. No live engine is needed, and the E2E
// account's data is not touched — even the switch's writes land in this spec's
// in-memory tables.

const FIXTURE = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/SwarmView/engine/__tests__/planOverlayFixture.json'), 'utf8'));
const PLAN = 900;
const THIS_MACHINE: number = FIXTURE.this_machine;

const sql = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const action = (id: string) => FIXTURE.actions.find((a: any) => a.action === id);

type World = {
  state: any;                      // one action state from the fixture
  planStatus?: string;             // overrides the payload's pipeline_status
  engine: null | { desired: 'on' | 'off'; actual: string; published: boolean };
  bringUp: boolean;                // the "supervisor": a switch ON comes up and publishes
  writes: Array<{ table: string; method: string; body: any }>;
};

const RECORD_LIGHT = ['id', 'record_hash', 'prior_hash', 'pipeline_fk', 'initiative_fk', 'machine_fk',
  'claim_id', 'seq', 'cycle_at', 'verdict', 'admitted_count', 'queue_count', 'cut', 'create_ts'];

function tables(world: World): Record<string, any[]> {
  const now = Date.now();
  const st = world.state;
  const payload = JSON.parse(JSON.stringify(st.payload));
  if (world.planStatus) payload.pipeline.pipeline_status = world.planStatus;
  const claims = [...st.claims];
  const on = world.engine && world.engine.desired === 'on';
  if (on && st.engine_claim) claims.push(st.engine_claim);
  const recordRow = { ...st.record_row, machine_fk: THIS_MACHINE, cycle_at: sql(now - 20000),
    create_ts: sql(now - 20000) };
  return {
    pipeline_compose: [payload],
    pipelines: [{ id: PLAN, title: payload.pipeline.title, pipeline_status: payload.pipeline.pipeline_status,
      started_at: null, completed_at: null }],
    machines: FIXTURE.machines.map((m: any) => ({ ...m, hostname: m.title,
      max_live_sessions: m.id === THIS_MACHINE ? st.ceiling : 4 })),
    orchestration_claims: claims.map((c: any) => ({ id: c.id, pipeline_fk: c.pipeline_fk,
      initiative_fk: c.initiative_fk, machine_fk: c.machine_fk, terminal_pid: 4100 + c.id,
      engine_pid: 5100 + c.id, polls: 10, claimed_at: sql(now - 3600000),
      update_ts: sql(c.stale ? now - 3600000 : now - 5000), create_ts: sql(now - 3600000) })),
    swarm_sessions: Array.from({ length: st.live_sessions }, (_, i) => ({ id: 880000 + i,
      swarm_status: 'active', machine_fk: THIS_MACHINE, title: `live ${i}`, task_name: `live-${i}`,
      terminal_number: null, terminal_window_id: null })),
    engine_states: world.engine ? [{ id: 1, pipeline_fk: PLAN, initiative_fk: null, machine_fk: THIS_MACHINE,
      desired_state: world.engine.desired, desired_reason: 'user', desired_at: sql(now - 60000),
      actual_state: world.engine.actual, actual_detail: null, actual_at: sql(now - 30000),
      create_ts: sql(now - 3600000), update_ts: null }] : [],
    engine_heartbeats: world.engine && world.engine.published ? [{ id: 11, engine_state_fk: 1,
      // The claim the engine last beat on — still named after it is switched off.
      claim_fk: st.engine_claim ? st.engine_claim.id : null, terminal_pid: 4101, engine_pid: 5101,
      role: st.record_row.record.location.role, beats: 12,
      health: { degraded_count: 0, verdict: st.record_row.record.cycle.verdict, code_verdict: 'current',
        limits: st.engine.limits },
      create_ts: sql(now - 3600000),
      beat_at: sql(on ? now - 10000 : now - 900000) }] : [],
    engine_decision_records: world.engine && world.engine.published ? [recordRow] : [],
    engine_outcomes: [],
  };
}

async function serve(page: Page, world: World) {
  const answer = (name: string) => async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.continue();
    if (method !== 'GET') {
      const body = req.postDataJSON();
      world.writes.push({ table: name, method, body });
      if (name === 'engine_states') {
        const change = Array.isArray(body) ? body[0] : body;
        world.engine = { desired: change.desired_state, actual: world.engine?.actual || 'stopped',
          published: world.engine?.published || false };
        if (world.bringUp) {
          // The supervisor answers the switch: on → running and publishing,
          // off → stopped (its last record stays, its beat goes old).
          world.engine.actual = change.desired_state === 'on' ? 'running' : 'stopped';
          if (change.desired_state === 'on') world.engine.published = true;
        }
        const row = tables(world).engine_states[0];
        return route.fulfill({ status: method === 'POST' ? 201 : 200, contentType: 'application/json',
          body: JSON.stringify([row]) });
      }
      if (name === 'pipelines') {
        world.planStatus = (Array.isArray(body) ? body[0] : body).pipeline_status;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      return route.continue();
    }
    let rows = tables(world)[name];
    if (name === 'pipeline_compose') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows[0]) });
    }
    for (const col of ['id', 'pipeline_fk', 'machine_fk', 'record_fk']) {
      const v = url.searchParams.get(col);
      if (v != null && !v.startsWith('(')) rows = rows.filter((r) => String(r[col]) === v);
    }
    if (name === 'engine_decision_records' && !url.searchParams.get('id')) {
      rows = rows.map((r) => Object.fromEntries(RECORD_LIGHT.map((k) => [k, r[k]])));
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  };
  for (const name of Object.keys(tables(world))) {
    // The API host only — `/swarm/pipelines` is also a PAGE route of the app.
    await page.route(new RegExp(`execute-api[^?]*/${name}(\\?|$)`), answer(name));
  }
}

/** Every badge the answer implies, as the page must draw it. */
function expectedBadges(answer: any) {
  const out = new Map<number, { code: string; positions: number[] }>();
  for (const e of answer.epics) out.set(e.epic_id, { code: e.code, positions: [] });
  answer.queue.forEach((q: any, i: number) => {
    if (!out.has(q.epic_id)) out.set(q.epic_id, { code: q.code, positions: [] });
    out.get(q.epic_id)!.positions.push(i + 1);
  });
  // A barrier-held epic with no launch in the queue draws no pill (req #4071).
  for (const [id, b] of [...out]) if (b.code === 'BARRIER' && b.positions.length === 0) out.delete(id);
  return out;
}

async function expectOverlay(page: Page, answer: any, source: 'engine' | 'predicted') {
  await expect(page.getByTestId('plan-engine-strip')).toHaveAttribute('data-source', source, { timeout: 20000 });
  const badges = expectedBadges(answer);
  await expect(page.locator('[data-testid^="plan-engine-badge-"][data-code]')).toHaveCount(badges.size);
  for (const [epicId, b] of badges) {
    const badge = page.getByTestId(`plan-engine-badge-${epicId}`);
    await expect(badge).toHaveAttribute('data-code', b.code);
    await expect(badge).toHaveAttribute('data-positions', b.positions.join(','));
    await expect(badge).toHaveAttribute('data-source', source);
  }
  // The box itself shows only the slots taken of the capacity — the engine's
  // own, so switched off (a prediction) it shows none (req #3981).
  const l = answer.limits;
  const slots = page.getByTestId('plan-engine-slots');
  if (source === 'predicted') {
    await expect(slots).toHaveCount(0);
  } else if (l.ceiling == null) {
    await expect(slots).toHaveAttribute('data-known', 'false');
  } else {
    await expect(slots).toHaveAttribute('data-taken', String(l.live + (l.reserved || 0)));
    await expect(slots).toHaveAttribute('data-ceiling', String(l.ceiling));
  }
}

// The machine is named in the link (`engineMachine`): the Desktop Chrome
// profile reports a Windows platform, so the browser's own guess would be the
// fixture's WSL box rather than the machine its engine runs on.
async function open(page: Page) {
  await page.goto(`/swarm/pipeline/${PLAN}?mode=plan&engineMachine=${THIS_MACHINE}`);
  await expect(page.getByTestId('plan-engine-box')).toBeVisible({ timeout: 30000 });
}

const world = (state: any, engine: World['engine'], extra: Partial<World> = {}): World => ({
  state, engine, bringUp: true, writes: [], ...extra,
});

test.describe('Plan view engine overlay (req #3762)', () => {
  test.setTimeout(120000);
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('OVL-01: switching the engine on brings it up and draws its record exactly (A1, A21)', async ({ page }) => {
    const state = action('A1').states[0];
    const w = world(state, null, { planStatus: 'authoring' });
    await serve(page, w);
    await open(page);
    // Off: the prediction from the derived block, with the limits it was cut against.
    await expect(page.getByTestId('plan-engine-switch')).toHaveAttribute('data-on', 'false');
    await expectOverlay(page, state.predicted, 'predicted');

    await page.getByTestId('plan-engine-switch').click();
    await expect(page.getByTestId('plan-engine-switch')).toHaveAttribute('data-on', 'true', { timeout: 20000 });
    // The switch went through the lifecycle contract: desired on, by the user…
    const write = w.writes.find((x) => x.table === 'engine_states');
    expect(write?.method).toBe('POST');
    expect(write?.body).toMatchObject({ pipeline_fk: PLAN, machine_fk: THIS_MACHINE, desired_state: 'on',
      desired_reason: 'user' });
    // …and the plan was set orchestrating in the same act (A21, req #3965) —
    // the status alone: the gateway derives the timestamps.
    const planWrite = w.writes.find((x) => x.table === 'pipelines');
    expect(planWrite?.body).toEqual([{ id: PLAN, pipeline_status: 'orchestrating' }]);
    // It comes up, and the overlay is now the engine's own record.
    await expect(page.getByTestId('plan-engine-strip')).toHaveAttribute('data-actual', 'running', { timeout: 20000 });
    await expect(page.getByTestId('plan-engine-strip')).toHaveAttribute('data-health', 'ok');
    await expectOverlay(page, state.engine, 'engine');
    await expect(page.getByTestId('plan-engine-strip')).toHaveAttribute('data-seq', String(state.record_row.seq));
    // On, it reports the role the record holds (req #3981).
    await expect(page.getByTestId('plan-engine-role')).toHaveText('Primary');
    // The cut line where the record put it: two admitted, epic 102's launch after it.
    await expect(page.getByTestId('plan-engine-badge-102')).toHaveAttribute('data-cut-before', 'true');
  });

  test('OVL-02: switching it off takes it down and returns to the prediction (A2)', async ({ page }) => {
    const state = action('A2').states[0];
    const w = world(state, { desired: 'on', actual: 'running', published: true });
    await serve(page, w);
    await open(page);
    await expectOverlay(page, state.engine, 'engine');
    await page.getByTestId('plan-engine-switch').click();
    await expect(page.getByTestId('plan-engine-switch')).toHaveAttribute('data-on', 'false', { timeout: 20000 });
    const write = w.writes.find((x) => x.table === 'engine_states');
    expect(write?.method).toBe('PUT');
    expect(write?.body[0]).toMatchObject({ id: 1, desired_state: 'off', desired_reason: 'user' });
    // req #3965 — no engine of the plan is still wanted on, so the
    // orchestrating plan is set orchestration_ready.
    const planWrite = w.writes.find((x) => x.table === 'pipelines');
    expect(planWrite?.body).toEqual([{ id: PLAN, pipeline_status: 'orchestration_ready' }]);
    await expect(page.getByTestId('plan-engine-strip')).toHaveAttribute('data-actual', 'stopped', { timeout: 20000 });
    await expect(page.getByTestId('plan-engine-role')).toHaveCount(0);
    await expectOverlay(page, state.predicted, 'predicted');
  });

  test('OVL-03: an epic held by an upstream barrier draws no pill (req #4071)', async ({ page }) => {
    const state = action('A8').states[0];
    await serve(page, world(state, { desired: 'on', actual: 'running', published: true }));
    await open(page);
    // Epic 101 (admitted) draws its badge, so the overlay has rendered; the
    // barrier-held epic 102 has none — "Barrier" on it read as though it were
    // the barrier itself.
    await expect(page.getByTestId('plan-engine-badge-101')).toHaveAttribute('data-code', 'ADMITTED', { timeout: 20000 });
    await expect(page.getByTestId('plan-engine-badge-102')).toHaveCount(0);
  });

  // Each plan-overlay action: every state of its scenario whose engine runs on
  // this machine, drawn from the engine's record — and with the engine off,
  // the prediction from the same derived block.
  for (const id of ['A8', 'A9', 'A10', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A21', 'A22']) {
    test(`OVL-${id}: ${action(id).scenario} — the engine's reaction on the plan`, async ({ page }) => {
      const states = action(id).states
        .map((s: any, i: number) => ({ s, i }))
        .filter(({ s }: any) => s.record_row.machine_fk === THIS_MACHINE);
      expect(states.length).toBeGreaterThan(0);
      const w = world(states[0].s, { desired: 'on', actual: 'running', published: true });
      await serve(page, w);
      for (const { s } of states) {
        w.state = s;
        await open(page);
        await expectOverlay(page, s.engine, 'engine');
      }
      // Off: the same plan, predicted.
      w.engine = { desired: 'off', actual: 'stopped', published: true };
      const last = states[states.length - 1].s;
      w.state = last;
      await open(page);
      await expectOverlay(page, last.predicted, 'predicted');
    });
  }
});
