// pipelineComposedFixture.js — a minimal, valid `pipeline_compose` payload
// for PipelineDetail's component tests (req #3381). NOT imported by
// `pipelineAdapter.test.js` — that file builds its own payloads inline to
// exercise specific shapes; this one exists purely so the component tests
// that mount `PipelineDetail` (which need SOME composed read to get past
// `isLoading` and the not-found branch) do not each hand-roll the same
// `{pipeline, initiatives, steps, ..., derived}` skeleton.
//
// Deliberately NOT itself mocked or imported by a `vi.mock` factory — plain
// data a test file's OWN factory imports, matching every other fixture in
// this directory (`substrateRebuildFixture.js`, `initiativeZoomFixture.js`).

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * @param {Object} [options]
 * @param {number} [options.id]
 * @param {string} [options.title]
 * @param {string} [options.pipelineStatus]
 * @param {Object[]} [options.steps]  `{id, initiative_fk, title, run, notes, not_before}`
 * @param {Object[]} [options.initiatives]
 * @param {Object[]} [options.requirements]
 * @param {Object[]} [options.stepRequirements]  `{step_fk, requirement_fk}`
 * @param {Object[]} [options.stepDeps]          `{id, step_fk, dep_step_fk}`
 * @returns {Object} a composed `pipeline_compose` payload, `derived` present
 */
export function composedFixture({
    id = 2,
    title = 'Darwin',
    pipelineStatus = 'active',
    steps = [{
        id: 47, initiative_fk: null, title: 'Session Drain', run: 'auto',
        notes: null, not_before: null,
    }],
    initiatives = [],
    requirements = [],
    stepRequirements = [],
    stepDeps = [],
} = {}) {
    const linksByStep = new Map();
    for (const link of asArray(stepRequirements)) {
        if (!linksByStep.has(link.step_fk)) linksByStep.set(link.step_fk, []);
        linksByStep.get(link.step_fk).push(link.requirement_fk);
    }
    const depsByStep = new Map();
    for (const dep of asArray(stepDeps)) {
        if (dep.dep_step_fk == null) continue;
        if (!depsByStep.has(dep.step_fk)) depsByStep.set(dep.step_fk, []);
        depsByStep.get(dep.step_fk).push(dep.dep_step_fk);
    }

    // req #3750 — a step has no state; the server sends each row's OPEN WORK
    // (gating requirements not met/deferred/wontfix; an unresolved id is open).
    const TERMINAL = ['met', 'deferred', 'wontfix'];
    const statusById = new Map(asArray(requirements).map((r) => [r.id, r.requirement_status]));
    const openOf = (ids) => ids.filter((rid) => !TERMINAL.includes(statusById.get(rid)));
    const rows = asArray(steps).map((s) => ({
        id: s.id,
        open_req_ids: openOf(linksByStep.get(s.id) || []),
        run: s.run || 'auto',
        eligible: false,
        initiative_id: s.initiative_fk != null ? s.initiative_fk : null,
        dep_ids: depsByStep.get(s.id) || [],
        out_of_scope_dep_ids: [],
        req_ids: linksByStep.get(s.id) || [],
        tracking_req_ids: [],
        unresolved_req_ids: [],
        launch_req_ids: [],
        launch_excluded: [],
        launch_block: 'no-links',
        swarm_start_command: null,
        no_launch_reason: 'no linked requirements — nothing to launch',
        launch_suppressed: false,
        suppressed_by: [],
    }));

    return {
        pipeline: {
            id, title, description: '', pipeline_status: pipelineStatus,
            execution_mode: 'parallel', machine_fk: null,
            started_at: null, completed_at: null, step_count: rows.length,
        },
        initiatives: asArray(initiatives),
        steps: asArray(steps),
        step_requirements: asArray(stepRequirements),
        step_deps: asArray(stepDeps),
        requirements: asArray(requirements),
        derived: {
            now: '2026-01-01T00:00:00Z',
            initiative_order: [...new Set(rows.map((r) => r.initiative_id).filter((v) => v != null))],
            display_order: rows.map((r) => r.id),
            rows,
            pause: {
                pipeline_status: pipelineStatus,
                pipeline_paused: pipelineStatus === 'paused',
                paused_initiative_ids: [],
                suppressed_step_ids: [],
            },
            serial: {
                execution_mode: 'parallel', serial: false, initiative_order: [],
                closed_initiative_ids: [], live_initiative_id: null,
                waiting_initiative_ids: [], held_step_ids: [],
            },
            eligible_step_ids: [],
            violations: [],
            cycle_detected: false,
            cycle_step_ids: [],
            duplicate_step_ids: [],
            unresolved_req_ids: [],
            out_of_scope_dep_ids: [],
            requirement_counts: { overall: { met: 0, total: 0 }, by_initiative: [] },
        },
    };
}
