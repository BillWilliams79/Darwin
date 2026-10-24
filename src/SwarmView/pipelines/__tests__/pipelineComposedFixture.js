// pipelineComposedFixture.js — a minimal, valid `pipeline_compose` payload
// for PipelineDetail's component tests (req #3381). NOT imported by
// `pipelineAdapter.test.js` — that file builds its own payloads inline to
// exercise specific shapes; this one exists purely so the component tests
// that mount `PipelineDetail` (which need SOME composed read to get past
// `isLoading` and the not-found branch) do not each hand-roll the same
// `{pipeline, initiatives, epics, ..., derived}` skeleton.
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
 * @param {Object[]} [options.epics]  `{id, initiative_fk, title, run, notes, not_before}`
 * @param {Object[]} [options.initiatives]
 * @param {Object[]} [options.requirements]
 * @param {Object[]} [options.epicRequirements]  `{epic_fk, requirement_fk}`
 * @param {Object[]} [options.epicDeps]          `{id, epic_fk, dep_epic_fk}`
 * @returns {Object} a composed `pipeline_compose` payload, `derived` present
 */
export function composedFixture({
    id = 2,
    title = 'Darwin',
    pipelineStatus = 'active',
    epics = [{
        id: 47, initiative_fk: null, title: 'Session Drain', run: 'auto',
        notes: null, not_before: null,
    }],
    initiatives = [],
    requirements = [],
    epicRequirements = [],
    epicDeps = [],
} = {}) {
    const linksByEpic = new Map();
    for (const link of asArray(epicRequirements)) {
        if (!linksByEpic.has(link.epic_fk)) linksByEpic.set(link.epic_fk, []);
        linksByEpic.get(link.epic_fk).push(link.requirement_fk);
    }
    const depsByEpic = new Map();
    for (const dep of asArray(epicDeps)) {
        if (dep.dep_epic_fk == null) continue;
        if (!depsByEpic.has(dep.epic_fk)) depsByEpic.set(dep.epic_fk, []);
        depsByEpic.get(dep.epic_fk).push(dep.dep_epic_fk);
    }

    // req #3750 — an epic has no state; the server sends each row's OPEN WORK
    // (gating requirements not met/deferred/wontfix; an unresolved id is open).
    const TERMINAL = ['met', 'deferred', 'wontfix'];
    const statusById = new Map(asArray(requirements).map((r) => [r.id, r.requirement_status]));
    const openOf = (ids) => ids.filter((rid) => !TERMINAL.includes(statusById.get(rid)));
    const rows = asArray(epics).map((s) => ({
        id: s.id,
        open_req_ids: openOf(linksByEpic.get(s.id) || []),
        run: s.run || 'auto',
        eligible: false,
        initiative_id: s.initiative_fk != null ? s.initiative_fk : null,
        dep_ids: depsByEpic.get(s.id) || [],
        out_of_scope_dep_ids: [],
        req_ids: linksByEpic.get(s.id) || [],
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
            machine_fk: null,
            started_at: null, completed_at: null, epic_count: rows.length,
        },
        initiatives: asArray(initiatives),
        epics: asArray(epics),
        epic_requirements: asArray(epicRequirements),
        epic_deps: asArray(epicDeps),
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
                suppressed_epic_ids: [],
            },
            eligible_epic_ids: [],
            violations: [],
            cycle_detected: false,
            cycle_epic_ids: [],
            duplicate_epic_ids: [],
            unresolved_req_ids: [],
            out_of_scope_dep_ids: [],
            requirement_counts: { overall: { met: 0, total: 0 }, by_initiative: [] },
        },
    };
}
