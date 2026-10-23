// pipelineAdapter.test.js — req #3381. This module does not derive anything
// (the header says so); these tests hold it to that: every field a fixture
// hands in comes back reshaped, never recomputed.

import { describe, it, expect } from 'vitest';

import {
    deriveDiagnostic,
    rowsComplete,
    buildPlanRows,
    adaptComposedPipeline,
    buildPlanModel,
    visualizerColourInput,
    WITHHELD_DERIVATION_FAILED,
    WITHHELD_BUDGET_DERIVED_ONLY,
    WITHHELD_BUDGET_ROWS_TRUNCATED,
    WITHHELD_ABSENT,
    WITHHELD_UNSPECIFIED,
} from '../pipelineAdapter';
import { buildCostIndex, buildSessionStatusIndex } from '../pipelineViewModel';
import { composedFixture } from './pipelineComposedFixture';

describe('deriveDiagnostic — the four regimes (req #3345 § 4.5 / #3367 deliverable 3)', () => {
    it('is null when derived is present and not withheld (regime A)', () => {
        expect(deriveDiagnostic(composedFixture())).toBeNull();
    });

    it('reads withheld_reason and rows_complete verbatim for a derivation failure', () => {
        const payload = composedFixture();
        payload.derived = {
            withheld: true, withheld_reason: WITHHELD_DERIVATION_FAILED,
            rows_complete: true, reason: 'boom',
        };
        const d = deriveDiagnostic(payload);
        expect(d).toEqual({
            regime: WITHHELD_DERIVATION_FAILED, rowsComplete: true, message: 'boom',
        });
    });

    it('regime B — budget_derived_only, rows complete', () => {
        const payload = composedFixture();
        payload.derived = {
            withheld: true, withheld_reason: WITHHELD_BUDGET_DERIVED_ONLY,
            rows_complete: true, reason: 'no room for derived',
        };
        expect(deriveDiagnostic(payload)).toEqual({
            regime: WITHHELD_BUDGET_DERIVED_ONLY, rowsComplete: true,
            message: 'no room for derived',
        });
    });

    it('regime C — budget_rows_truncated, rows INCOMPLETE', () => {
        const payload = composedFixture();
        payload.derived = {
            withheld: true, withheld_reason: WITHHELD_BUDGET_ROWS_TRUNCATED,
            rows_complete: false, reason: 'epics truncated',
        };
        const d = deriveDiagnostic(payload);
        expect(d.rowsComplete).toBe(false);
        expect(rowsComplete(payload.derived)).toBe(false);
    });

    it('regime 4 — derived wholly ABSENT, treated as incomplete by construction', () => {
        const payload = composedFixture();
        delete payload.derived;
        const d = deriveDiagnostic(payload);
        expect(d.regime).toBe(WITHHELD_ABSENT);
        expect(d.rowsComplete).toBe(false);
    });

    it('a null/undefined payload (still loading) also reads as absent', () => {
        expect(deriveDiagnostic(null).regime).toBe(WITHHELD_ABSENT);
        expect(deriveDiagnostic(undefined).regime).toBe(WITHHELD_ABSENT);
    });

    it('withheld with no reason code reads as UNSPECIFIED, never as ABSENT (code review 2026-08-09)', () => {
        // The block IS present and IS withheld — a producer bug (missing
        // reason code), not the fourth regime (key wholly absent). Reporting
        // WITHHELD_ABSENT here would send a reader looking for a missing key
        // that is right there.
        const payload = composedFixture();
        payload.derived = { withheld: true, rows_complete: false, reason: 'no code given' };
        const d = deriveDiagnostic(payload);
        expect(d.regime).toBe(WITHHELD_UNSPECIFIED);
        expect(d.regime).not.toBe(WITHHELD_ABSENT);
    });

    it('rowsComplete closes over a derived block that is not even an object', () => {
        expect(rowsComplete(null)).toBe(false);
        expect(rowsComplete(undefined)).toBe(false);
        expect(rowsComplete('nonsense')).toBe(false);
    });
});

describe('buildPlanRows — joining derived.rows[] back onto epics[]/initiatives[]/requirements[]', () => {
    const payload = composedFixture({
        id: 6,
        epics: [
            { id: 71, initiative_fk: 5, title: 'Mirror Layer', run: 'auto',
                notes: 'evidence', not_before: '2026-08-01 00:00:00' },
            { id: 72, initiative_fk: 5, title: 'Clone Core', run: 'manual',
                notes: null, not_before: null },
            // The epic with work IN FLIGHT, joined to real epic/requirement
            // rows like its neighbours. A derived row with no entry in
            // `payload.epics` and requirement ids absent from
            // `payload.requirements` is a shape a composed read cannot
            // produce, and it would silently weaken the "both survive the
            // reshape" claim for every JOINED field (title, machineLabels).
            { id: 73, initiative_fk: 5, title: 'Topped Up', run: 'auto',
                notes: null, not_before: null },
        ],
        initiatives: [{ id: 5, title: 'Swarm Cloned Git', sort_order: 3 }],
        requirements: [
            { id: 3001, requirement_status: 'swarm_ready', machine_fk: 2, tracking: 0 },
            { id: 3002, requirement_status: 'met', machine_fk: null, tracking: 1 },
            { id: 3003, requirement_status: 'development', machine_fk: 2, tracking: 0 },
            { id: 3004, requirement_status: 'swarm_ready', machine_fk: 2, tracking: 0 },
        ],
        epicRequirements: [
            { epic_fk: 71, requirement_fk: 3001 },
            { epic_fk: 71, requirement_fk: 3002 },
            { epic_fk: 73, requirement_fk: 3003 },
            { epic_fk: 73, requirement_fk: 3004 },
        ],
        epicDeps: [{ id: 1, epic_fk: 72, dep_epic_fk: 71 }],
    });
    // Overwrite the fixture's own generic `derived.rows` with ones that carry
    // realistic per-row fields, matching what `pipeline2_derive.py` actually
    // emits (snake_case, compact — module header).
    payload.derived.rows = [
        {
            id: 71, open_req_ids: [3001], run: 'auto', eligible: true, initiative_id: 5,
            dep_ids: [], out_of_scope_dep_ids: [], req_ids: [3001, 3002],
            tracking_req_ids: [3002], unresolved_req_ids: [], launch_req_ids: [3001],
            launch_excluded: ['3002 tracking container'], launch_block: null,
            swarm_start_command: '/swarm-start 3001', no_launch_reason: null,
            launch_suppressed: false, suppressed_by: [],
        },
        {
            id: 72, open_req_ids: [], run: 'manual', eligible: false, initiative_id: 5,
            dep_ids: [71], out_of_scope_dep_ids: [], req_ids: [], tracking_req_ids: [],
            unresolved_req_ids: [], launch_req_ids: [], launch_excluded: [],
            launch_block: 'no-links', swarm_start_command: null,
            no_launch_reason: 'no linked requirements — nothing to launch',
            launch_suppressed: true, suppressed_by: ['pipeline'],
        },
        // An epic with work IN FLIGHT (3003, development) that still carries
        // launch-ready work (3004). Since req #3750 `eligible` covers it — a
        // epic has no state, so "already begun" no longer withholds the ring
        // (the retired `top_up_eligible` answered that separately).
        {
            id: 73, open_req_ids: [3003, 3004], run: 'auto', eligible: true,
            gate_open: true, launch_candidate: true,
            checkpoint_blocked_by: [70], initiative_id: 5,
            dep_ids: [], out_of_scope_dep_ids: [], req_ids: [3003, 3004],
            tracking_req_ids: [], unresolved_req_ids: [], launch_req_ids: [3004],
            launch_excluded: [], launch_block: null,
            swarm_start_command: '/swarm-start 3004', no_launch_reason: null,
            launch_suppressed: false, suppressed_by: [],
        },
    ];
    const machines = [{ id: 2, title: 'Mac mini' }];
    const rows = buildPlanRows(payload, machines);

    it('carries every derived.rows[] field through under its camelCase name', () => {
        const r = rows.find((x) => x.id === 71);
        expect(r.state).toBe('pending');
        expect(r.run).toBe('auto');
        expect(r.eligible).toBe(true);
        expect(r.reqIds).toEqual([3001, 3002]);
        expect(r.trackingReqIds).toEqual([3002]);
        expect(r.launchReqIds).toEqual([3001]);
        expect(r.launchExcluded).toEqual(['3002 tracking container']);
        expect(r.swarmStartCommand).toBe('/swarm-start 3001');
        expect(r.depIds).toEqual([]);
        expect(r.openReqIds).toEqual([3001]);
        expect(r).not.toHaveProperty('topUpEligible');
        expect(r).not.toHaveProperty('completedAt');
    });

    // req #3750 — `eligible` is the one launch-now answer; an epic whose work
    // is already in flight still reads eligible when it carries ready work.
    it('carries eligible for an epic with work in flight, with no top-up field', () => {
        const running = rows.find((x) => x.id === 73);
        expect(running.state).toBe('running');
        expect(running.eligible).toBe(true);
        expect(running).not.toHaveProperty('topUpEligible');
        expect(running.launchReqIds).toEqual([3004]);
        expect(running.swarmStartCommand).toBe('/swarm-start 3004');
        // The JOINED fields resolve too, which is what makes "both survive the
        // reshape" a real claim rather than one about two booleans.
        expect(running.title).toBe('Topped Up');
        expect(running.initiative).toBe('Swarm Cloned Git');
        expect(running.machineLabels).toEqual(['Mac mini']);
    });

    // req #3597 — the gate is REPORTED and candidacy is carried beside it; a
    // payload without the fields reads as gate closed / not a candidate.
    it('carries gate_open and launch_candidate, defaulting to false when absent', () => {
        const running = rows.find((x) => x.id === 73);
        expect(running.gateOpen).toBe(true);
        expect(running.launchCandidate).toBe(true);
        const legacy = rows.find((x) => x.id === 71);
        expect(legacy.gateOpen).toBe(false);
        expect(legacy.launchCandidate).toBe(false);
        expect(running.checkpointBlockedBy).toEqual([70]);
        expect(legacy.checkpointBlockedBy).toEqual([]);
    });

    it('joins the epic dictionary for title/notes', () => {
        const r71 = rows.find((x) => x.id === 71);
        expect(r71.title).toBe('Mirror Layer');
        expect(r71.notes).toBe('evidence');
        const r72 = rows.find((x) => x.id === 72);
        expect(r72.title).toBe('Clone Core');
        expect(r72.notes).toBeNull();
    });

    it('folds an epic\'s not_before into a single-entry timeDeps array', () => {
        expect(rows.find((x) => x.id === 71).timeDeps).toEqual(['2026-08-01 00:00:00']);
        expect(rows.find((x) => x.id === 72).timeDeps).toEqual([]);
    });

    it('joins the initiative dictionary — exactly ONE initiative per epic, no dominant-label tally', () => {
        const r = rows.find((x) => x.id === 71);
        expect(r.initiativeId).toBe(5);
        expect(r.initiative).toBe('Swarm Cloned Git');
        expect(r.initiativeSortOrder).toBe(3);
        expect(r.initiativeLabels).toEqual([{ id: 5, title: 'Swarm Cloned Git' }]);
    });

    it('never marks a row label-inherited — 2.0 containment gives every epic its own initiative', () => {
        expect(rows.every((r) => r.labelInherited === false)).toBe(true);
    });

    it('derives machine labels from requirements[].machine_fk minus tracking containers', () => {
        const r71 = rows.find((x) => x.id === 71);
        // 3001 (Mac mini) counts; 3002 is a tracking container and is excluded —
        // matching pipelineModel.js's machineLabels() exclusion (rule 10 sibling).
        expect(r71.machineLabels).toEqual(['Mac mini']);
        expect(r71.machineLabel).toBe('Mac mini');
    });

    it('degrades an unresolvable machine id to the POC #<id> form', () => {
        const payload2 = composedFixture({
            epics: [{ id: 1, initiative_fk: null, title: 'S', run: 'auto', notes: null,
                not_before: null }],
            requirements: [{ id: 1, requirement_status: 'swarm_ready', machine_fk: 999 }],
            epicRequirements: [{ epic_fk: 1, requirement_fk: 1 }],
        });
        payload2.derived.rows = [{
            id: 1, open_req_ids: [1], run: 'auto', eligible: false, initiative_id: null,
            dep_ids: [], out_of_scope_dep_ids: [], req_ids: [1], tracking_req_ids: [],
            unresolved_req_ids: [], launch_req_ids: [], launch_excluded: [],
            launch_block: 'not-ready', swarm_start_command: null, no_launch_reason: 'x',
            launch_suppressed: false, suppressed_by: [],
        }];
        const r = buildPlanRows(payload2, [])[0];
        expect(r.machineLabels).toEqual(['#999']);
    });

    it('a NULL machine_fk labels Any', () => {
        const payload2 = composedFixture({
            epics: [{ id: 1, initiative_fk: null, title: 'S', run: 'auto', notes: null,
                not_before: null }],
            requirements: [{ id: 1, requirement_status: 'swarm_ready', machine_fk: null }],
            epicRequirements: [{ epic_fk: 1, requirement_fk: 1 }],
        });
        payload2.derived.rows = [{
            id: 1, open_req_ids: [1], run: 'auto', eligible: false, initiative_id: null,
            dep_ids: [], out_of_scope_dep_ids: [], req_ids: [1], tracking_req_ids: [],
            unresolved_req_ids: [], launch_req_ids: [], launch_excluded: [],
            launch_block: 'not-ready', swarm_start_command: null, no_launch_reason: 'x',
            launch_suppressed: false, suppressed_by: [],
        }];
        const r = buildPlanRows(payload2, [])[0];
        expect(r.machineLabels).toEqual(['Any']);
    });

    it('preserves derived.rows[] array order — already display order, never re-sorted', () => {
        const reversedPayload = composedFixture();
        reversedPayload.derived.rows = [
            { id: 2, open_req_ids: [], run: 'auto', eligible: false, initiative_id: null,
                dep_ids: [], out_of_scope_dep_ids: [], req_ids: [], tracking_req_ids: [],
                unresolved_req_ids: [], launch_req_ids: [], launch_excluded: [],
                launch_block: 'no-links', swarm_start_command: null, no_launch_reason: 'x',
                launch_suppressed: false, suppressed_by: [] },
            { id: 1, open_req_ids: [], run: 'auto', eligible: false, initiative_id: null,
                dep_ids: [], out_of_scope_dep_ids: [], req_ids: [], tracking_req_ids: [],
                unresolved_req_ids: [], launch_req_ids: [], launch_excluded: [],
                launch_block: 'no-links', swarm_start_command: null, no_launch_reason: 'x',
                launch_suppressed: false, suppressed_by: [] },
        ];
        const r = buildPlanRows(reversedPayload, []);
        expect(r.map((x) => x.id)).toEqual([2, 1]);
    });
});

describe('adaptComposedPipeline — the plan object', () => {
    const payload = composedFixture({
        epics: [{ id: 1, initiative_fk: 9, title: 'S', run: 'auto', notes: null,
            not_before: null }],
        initiatives: [{ id: 9, title: 'E', sort_order: 1 }],
        requirements: [{ id: 100, requirement_status: 'swarm_ready', machine_fk: null }],
        epicRequirements: [{ epic_fk: 1, requirement_fk: 100 }],
    });
    payload.derived = {
        now: '2026-08-09T00:00:00Z',
        initiative_order: [9],
        display_order: [1],
        rows: [{
            id: 1, open_req_ids: [100], run: 'auto', eligible: true, initiative_id: 9,
            dep_ids: [], out_of_scope_dep_ids: [], req_ids: [100], tracking_req_ids: [],
            unresolved_req_ids: [], launch_req_ids: [100], launch_excluded: [],
            launch_block: null, swarm_start_command: '/swarm-start 100',
            no_launch_reason: null, launch_suppressed: false, suppressed_by: [],
        }],
        pause: {
            pipeline_status: 'active', pipeline_paused: false,
            paused_initiative_ids: [], suppressed_epic_ids: [],
        },
        serial: {
            execution_mode: 'serial', serial: true, initiative_order: [9],
            closed_initiative_ids: [], live_initiative_id: 9, waiting_initiative_ids: [], held_epic_ids: [],
        },
        eligible_epic_ids: [1],
        violations: [{ invariant: 'topology', message: 'x renders before y', epic_ids: [1, 2] }],
        cycle_detected: false,
        cycle_epic_ids: [],
        duplicate_epic_ids: [],
        unresolved_req_ids: [],
        out_of_scope_dep_ids: [],
        requirement_counts: {
            overall: { met: 0, total: 1 },
            by_initiative: [{ initiative_id: 9, met: 0, total: 1 }],
        },
    };

    it('never derives batches — 2.0 has none, drawn or otherwise', () => {
        const plan = adaptComposedPipeline(payload);
        expect(plan.batches).toEqual([]);
        expect(plan.batchLetterByEpicId.size).toBe(0);
    });

    it('reshapes eligible_epic_ids into a Set', () => {
        const plan = adaptComposedPipeline(payload);
        expect(plan.eligibleEpicIds).toBeInstanceOf(Set);
        expect(plan.eligibleEpicIds.has(1)).toBe(true);
    });

    // req #3750 — `top_up_epic_ids` is retired; `eligible_epic_ids` covers it.
    // A stale key from an older Lambda is ignored, never folded into the set
    // the eligible-now ring reads.
    it('carries no top-up set, and ignores a stale top_up_epic_ids', () => {
        const stale = {
            ...payload,
            derived: { ...payload.derived, top_up_epic_ids: [2] },
        };
        const plan = adaptComposedPipeline(stale);
        expect(plan).not.toHaveProperty('topUpEpicIds');
        expect(plan.eligibleEpicIds).toEqual(new Set([1]));
    });

    // req #3597 — PRIORITY order is the fact, so it stays an ordered array.
    it('carries launch_candidate_epic_ids in its own order, defaulting to empty', () => {
        expect(adaptComposedPipeline(payload).launchCandidateEpicIds).toEqual([]);
        const withCandidates = {
            ...payload,
            derived: { ...payload.derived, launch_candidate_epic_ids: [2, 1] },
        };
        expect(adaptComposedPipeline(withCandidates).launchCandidateEpicIds)
            .toEqual([2, 1]);
    });

    it('reshapes violations — invariant/message kept, epic_ids -> epicIds', () => {
        const plan = adaptComposedPipeline(payload);
        expect(plan.violations).toEqual([
            { invariant: 'topology', message: 'x renders before y', epicIds: [1, 2] },
        ]);
    });

    it('reshapes requirement_counts -> requirementCounts, by_initiative -> byInitiative/initiativeId', () => {
        const plan = adaptComposedPipeline(payload);
        expect(plan.requirementCounts).toEqual({
            overall: { met: 0, total: 1 },
            byInitiative: [{ initiativeId: 9, met: 0, total: 1 }],
        });
    });

    it('reshapes pause verbatim under the camelCase field names the layout reads', () => {
        const plan = adaptComposedPipeline(payload);
        expect(plan.pause).toEqual({
            pipelineStatus: 'active', pipelinePaused: false,
            pausedInitiativeIds: [], suppressedEpicIds: [],
        });
    });

    it('reshapes serial verbatim', () => {
        const plan = adaptComposedPipeline(payload);
        expect(plan.serial).toEqual({
            executionMode: 'serial', serial: true, initiativeOrder: [9],
            closedInitiativeIds: [], liveInitiativeId: 9, waitingInitiativeIds: [], heldEpicIds: [],
        });
    });

    it('attaches cost from the SAME buildCostIndex two-read mechanism as before', () => {
        const costIndex = buildCostIndex({
            requirementSessions: [{ requirement_fk: 100, session_fk: 1 }],
            sessionCosts: [{ id: 1, wall_secs_total: 600, output_tokens_total: 1000 }],
        });
        const plan = adaptComposedPipeline(payload, { costIndex });
        expect(plan.rows[0].cost).toEqual({ wallSecs: 600, tokens: 1000 });
    });

    it('every row carries a cost object even with no cost data at all', () => {
        const plan = adaptComposedPipeline(payload);
        expect(plan.rows[0].cost).toEqual({ wallSecs: 0, tokens: 0 });
    });

    it('still computes a client-side time axis — the payload carries no time_axis key', () => {
        const plan = adaptComposedPipeline(payload);
        expect(plan.timeAxis).toBeDefined();
        expect(plan.timeAxis.epicStarts).toBeDefined();
    });
});

describe('buildPlanModel — the narrow model PipelinePlanVisualizer.jsx still reads', () => {
    it('carries pipeline/requirements/machines and nothing 2.0 does not have', () => {
        const payload = composedFixture({
            requirements: [{ id: 1, requirement_status: 'met' }],
        });
        const machines = [{ id: 1, title: 'Mac mini' }];
        const model = buildPlanModel(payload, machines);
        expect(model.pipeline).toBe(payload.pipeline);
        expect(model.requirements).toEqual(payload.requirements);
        expect(model.machines).toBe(machines);
        expect(model.features).toBeUndefined();
        // req #3586 — the add-epic dialog's initiative picker.
        expect(model.initiatives).toEqual(payload.initiatives);
    });

    it('tolerates a null payload', () => {
        expect(buildPlanModel(null)).toEqual({ pipeline: null, requirements: [], machines: [], initiatives: [] });
    });

    it('attaches session_status from the index, no_session for a requirement it does not name (req #3584)', () => {
        const payload = composedFixture({
            requirements: [{ id: 1, requirement_status: 'met' },
                { id: 2, requirement_status: 'swarm_ready' }],
        });
        const model = buildPlanModel(payload, [], new Map([[1, 'review']]));
        expect(model.requirements.map((r) => r.session_status)).toEqual(['review', 'no_session']);
        // The payload's own rows are not mutated.
        expect(payload.requirements[0].session_status).toBeUndefined();
    });

    it('leaves rows untouched when there is no index — unknown, never "no session"', () => {
        const payload = composedFixture({ requirements: [{ id: 1 }] });
        expect(buildPlanModel(payload, [], null).requirements).toEqual(payload.requirements);
    });
});

describe('buildSessionStatusIndex (req #3584)', () => {
    it('reports each requirement\'s LATEST session — the highest session id', () => {
        const index = buildSessionStatusIndex({
            requirementSessions: [
                { requirement_fk: 1, session_fk: 10 },
                { requirement_fk: 1, session_fk: 12 },
                { requirement_fk: 2, session_fk: '11' },
                // A link to a session the read did not return contributes nothing.
                { requirement_fk: 3, session_fk: 99 },
            ],
            sessions: [
                { id: 10, swarm_status: 'completed' },
                { id: 11, swarm_status: 'paused' },
                { id: 12, swarm_status: 'active' },
            ],
        });
        expect(index.get(1)).toBe('active');
        expect(index.get(2)).toBe('paused');
        expect(index.has(3)).toBe(false);
    });

    it('is null until both reads have settled', () => {
        expect(buildSessionStatusIndex({ ready: false })).toBeNull();
        expect(buildSessionStatusIndex({}).size).toBe(0);
    });
});

// req #3618 — the PRODUCTION path: the colour input `state` is rolled up from
// the requirements in the payload (req #3750 — the server sends no epic state),
// and `now` comes from the caller. An empty epic sits on TODAY when an epic is
// running, in the FUTURE when none is, and stays UNKNOWN with no clock.
describe('adaptComposedPipeline — empty epic placement (req #3618)', () => {
    const NOW = new Date('2026-10-18T07:30:00Z');
    const fixture = (status) => {
        const payload = composedFixture({
            epics: [
                { id: 1, initiative_fk: null, title: 'work', run: 'auto', notes: null, not_before: null },
                { id: 2, initiative_fk: null, title: 'empty', run: 'auto', notes: null, not_before: null },
            ],
            requirements: [{ id: 10, requirement_status: status,
                started_at: status === 'development' ? '2026-10-18T06:00:00' : null, completed_at: null }],
            epicRequirements: [{ epic_fk: 1, requirement_fk: 10 }],
        });
        return payload;
    };

    it('stamps the empty epic TODAY when an epic has work in development', () => {
        const plan = adaptComposedPipeline(fixture('development'), { now: NOW });
        expect(plan.timeAxis.epicStarts.get(2)).toEqual({ at: '2026-10-18T07:30:00', kind: 'dated' });
    });

    it('puts the empty epic in the FUTURE when nothing is running', () => {
        const plan = adaptComposedPipeline(fixture('swarm_ready'), { now: NOW });
        expect(plan.timeAxis.epicStarts.get(2).kind).toBe('future');
    });

    it('leaves the empty epic UNKNOWN when the caller supplies no clock', () => {
        const plan = adaptComposedPipeline(fixture('development'));
        expect(plan.timeAxis.epicStarts.get(2).kind).toBe('unknown');
    });
});

// req #3750 — A EPIC HAS NO STATE. `row.state` is the visualizer's COLOUR INPUT,
// rolled up once in `visualizerColourInput` from the epic's requirements; the
// server sends none, and a stale `state` on the wire is never read.
describe('visualizerColourInput — the canvas colour input, not an epic state (req #3750)', () => {
    const reqs = new Map([
        [1, { id: 1, requirement_status: 'development' }],
        [2, { id: 2, requirement_status: 'met' }],
        [3, { id: 3, requirement_status: 'swarm_ready' }],
        [4, { id: 4, requirement_status: 'wontfix' }],
    ]);

    it('reads running when any gating requirement is in development', () => {
        expect(visualizerColourInput([1, 2], [1], reqs)).toBe('running');
    });

    it('reads done when the epic holds gating work and none of it is open', () => {
        expect(visualizerColourInput([2, 4], [], reqs)).toBe('done');
    });

    it('reads pending when gating work is open and none of it is in flight', () => {
        expect(visualizerColourInput([2, 3], [3], reqs)).toBe('pending');
    });

    it('reads pending for an EMPTY epic — no gating work is not finished work', () => {
        expect(visualizerColourInput([], [], reqs)).toBe('pending');
    });
});

describe('buildPlanRows — the colour rollup at the join (req #3750)', () => {
    const payloadFor = (requirements, derivedRow) => {
        const p = composedFixture({
            epics: [{ id: 1, initiative_fk: null, title: 'S', run: 'auto', notes: null, not_before: null }],
            requirements,
            epicRequirements: requirements.map((r) => ({ epic_fk: 1, requirement_fk: r.id })),
        });
        p.derived.rows = [{ ...p.derived.rows[0], ...derivedRow }];
        return p;
    };

    it('ignores a stale `state` from the wire and rolls up from open_req_ids', () => {
        const p = payloadFor([{ id: 7, requirement_status: 'met' }],
            { state: 'pending', req_ids: [7], open_req_ids: [] });
        expect(buildPlanRows(p)[0].state).toBe('done');
    });

    it('a tracking container in development does not paint the epic running', () => {
        const p = payloadFor([{ id: 7, requirement_status: 'development', tracking: 1 },
            { id: 8, requirement_status: 'met' }],
        { req_ids: [7, 8], tracking_req_ids: [7], open_req_ids: [] });
        const [row] = buildPlanRows(p);
        expect(row.state).toBe('done');
        expect(row.openReqIds).toEqual([]);
    });

    it('an epic holding only containers reads pending — it holds no gating work', () => {
        const p = payloadFor([{ id: 7, requirement_status: 'met', tracking: 1 }],
            { req_ids: [7], tracking_req_ids: [7], open_req_ids: [] });
        expect(buildPlanRows(p)[0].state).toBe('pending');
    });

    // req #3752 — `open_req_ids` is the server's fact. The browser never
    // recomputes it from the payload's requirement rows, so the wire value wins
    // even where those rows would say otherwise, and an absent key is not
    // rebuilt from them — it reads every gating requirement as open.
    it('reads open_req_ids as sent — never recomputed from requirement statuses', () => {
        const open = payloadFor([{ id: 7, requirement_status: 'met' }],
            { req_ids: [7], open_req_ids: [7] });
        expect(buildPlanRows(open)[0].openReqIds).toEqual([7]);
        expect(buildPlanRows(open)[0].state).toBe('pending');
        const absent = payloadFor([{ id: 7, requirement_status: 'met' }], { req_ids: [7] });
        delete absent.derived.rows[0].open_req_ids;
        expect(buildPlanRows(absent)[0].openReqIds).toEqual([7]);
        expect(buildPlanRows(absent)[0].state).toBe('pending');
    });
});
