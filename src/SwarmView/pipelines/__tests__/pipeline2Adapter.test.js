// pipeline2Adapter.test.js — req #3381. This module does not derive anything
// (the header says so); these tests hold it to that: every field a fixture
// hands in comes back reshaped, never recomputed.

import { describe, it, expect } from 'vitest';

import {
    deriveDiagnostic,
    rowsComplete,
    buildPlan2Rows,
    adaptComposedPipeline2,
    buildPlan2Model,
    WITHHELD_DERIVATION_FAILED,
    WITHHELD_BUDGET_DERIVED_ONLY,
    WITHHELD_BUDGET_ROWS_TRUNCATED,
    WITHHELD_ABSENT,
    WITHHELD_UNSPECIFIED,
} from '../pipeline2Adapter';
import { buildCostIndex } from '../pipelineViewModel';
import { composedFixture } from './pipeline2ComposedFixture';

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
            rows_complete: false, reason: 'steps truncated',
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

describe('buildPlan2Rows — joining derived.rows[] back onto steps[]/epics[]/requirements[]', () => {
    const payload = composedFixture({
        id: 6,
        steps: [
            { id: 71, epic_fk: 5, title: 'Mirror Layer', run: 'auto',
                notes: 'evidence', completed_at: null, not_before: '2026-08-01 00:00:00' },
            { id: 72, epic_fk: 5, title: 'Clone Core', run: 'manual',
                notes: null, completed_at: '2026-08-02 00:00:00', not_before: null },
        ],
        epics: [{ id: 5, title: 'Swarm Cloned Git', sort_order: 3 }],
        requirements: [
            { id: 3001, requirement_status: 'swarm_ready', machine_fk: 2, tracking: 0 },
            { id: 3002, requirement_status: 'met', machine_fk: null, tracking: 1 },
        ],
        stepRequirements: [
            { step_fk: 71, requirement_fk: 3001 },
            { step_fk: 71, requirement_fk: 3002 },
        ],
        stepDeps: [{ id: 1, step_fk: 72, dep_step_fk: 71 }],
    });
    // Overwrite the fixture's own generic `derived.rows` with ones that carry
    // realistic per-row fields, matching what `pipeline2_derive.py` actually
    // emits (snake_case, compact — module header).
    payload.derived.rows = [
        {
            id: 71, state: 'pending', run: 'auto', eligible: true, epic_id: 5,
            dep_ids: [], out_of_scope_dep_ids: [], req_ids: [3001, 3002],
            tracking_req_ids: [3002], unresolved_req_ids: [], launch_req_ids: [3001],
            launch_excluded: ['3002 tracking container'], launch_block: null,
            swarm_start_command: '/swarm-start 3001', no_launch_reason: null,
            launch_suppressed: false, suppressed_by: [],
        },
        {
            id: 72, state: 'pending', run: 'manual', eligible: false, epic_id: 5,
            dep_ids: [71], out_of_scope_dep_ids: [], req_ids: [], tracking_req_ids: [],
            unresolved_req_ids: [], launch_req_ids: [], launch_excluded: [],
            launch_block: 'no-links', swarm_start_command: null,
            no_launch_reason: 'no linked requirements — nothing to launch',
            launch_suppressed: true, suppressed_by: ['pipeline'],
        },
    ];
    const machines = [{ id: 2, title: 'Mac mini' }];
    const rows = buildPlan2Rows(payload, machines);

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
    });

    it('joins the step dictionary for title/notes/completedAt', () => {
        const r71 = rows.find((x) => x.id === 71);
        expect(r71.title).toBe('Mirror Layer');
        expect(r71.notes).toBe('evidence');
        expect(r71.completedAt).toBeNull();
        const r72 = rows.find((x) => x.id === 72);
        expect(r72.title).toBe('Clone Core');
        expect(r72.completedAt).toBe('2026-08-02 00:00:00');
    });

    it('folds a step\'s not_before into a single-entry timeDeps array', () => {
        expect(rows.find((x) => x.id === 71).timeDeps).toEqual(['2026-08-01 00:00:00']);
        expect(rows.find((x) => x.id === 72).timeDeps).toEqual([]);
    });

    it('joins the epic dictionary — exactly ONE epic per step, no dominant-label tally', () => {
        const r = rows.find((x) => x.id === 71);
        expect(r.epicId).toBe(5);
        expect(r.epic).toBe('Swarm Cloned Git');
        expect(r.epicSortOrder).toBe(3);
        expect(r.epicLabels).toEqual([{ id: 5, title: 'Swarm Cloned Git' }]);
    });

    it('never synthesizes a Feature — 2.0 has none', () => {
        for (const r of rows) {
            expect(r.featureId).toBeNull();
            expect(r.feature).toBeNull();
            expect(r.featureLabels).toEqual([]);
        }
    });

    it('never marks a row label-inherited — 2.0 containment gives every step its own epic', () => {
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
            steps: [{ id: 1, epic_fk: null, title: 'S', run: 'auto', notes: null,
                completed_at: null, not_before: null }],
            requirements: [{ id: 1, requirement_status: 'swarm_ready', machine_fk: 999 }],
            stepRequirements: [{ step_fk: 1, requirement_fk: 1 }],
        });
        payload2.derived.rows = [{
            id: 1, state: 'pending', run: 'auto', eligible: false, epic_id: null,
            dep_ids: [], out_of_scope_dep_ids: [], req_ids: [1], tracking_req_ids: [],
            unresolved_req_ids: [], launch_req_ids: [], launch_excluded: [],
            launch_block: 'not-ready', swarm_start_command: null, no_launch_reason: 'x',
            launch_suppressed: false, suppressed_by: [],
        }];
        const r = buildPlan2Rows(payload2, [])[0];
        expect(r.machineLabels).toEqual(['#999']);
    });

    it('a NULL machine_fk labels Any', () => {
        const payload2 = composedFixture({
            steps: [{ id: 1, epic_fk: null, title: 'S', run: 'auto', notes: null,
                completed_at: null, not_before: null }],
            requirements: [{ id: 1, requirement_status: 'swarm_ready', machine_fk: null }],
            stepRequirements: [{ step_fk: 1, requirement_fk: 1 }],
        });
        payload2.derived.rows = [{
            id: 1, state: 'pending', run: 'auto', eligible: false, epic_id: null,
            dep_ids: [], out_of_scope_dep_ids: [], req_ids: [1], tracking_req_ids: [],
            unresolved_req_ids: [], launch_req_ids: [], launch_excluded: [],
            launch_block: 'not-ready', swarm_start_command: null, no_launch_reason: 'x',
            launch_suppressed: false, suppressed_by: [],
        }];
        const r = buildPlan2Rows(payload2, [])[0];
        expect(r.machineLabels).toEqual(['Any']);
    });

    it('preserves derived.rows[] array order — already display order, never re-sorted', () => {
        const reversedPayload = composedFixture();
        reversedPayload.derived.rows = [
            { id: 2, state: 'pending', run: 'auto', eligible: false, epic_id: null,
                dep_ids: [], out_of_scope_dep_ids: [], req_ids: [], tracking_req_ids: [],
                unresolved_req_ids: [], launch_req_ids: [], launch_excluded: [],
                launch_block: 'no-links', swarm_start_command: null, no_launch_reason: 'x',
                launch_suppressed: false, suppressed_by: [] },
            { id: 1, state: 'pending', run: 'auto', eligible: false, epic_id: null,
                dep_ids: [], out_of_scope_dep_ids: [], req_ids: [], tracking_req_ids: [],
                unresolved_req_ids: [], launch_req_ids: [], launch_excluded: [],
                launch_block: 'no-links', swarm_start_command: null, no_launch_reason: 'x',
                launch_suppressed: false, suppressed_by: [] },
        ];
        const r = buildPlan2Rows(reversedPayload, []);
        expect(r.map((x) => x.id)).toEqual([2, 1]);
    });
});

describe('adaptComposedPipeline2 — the plan object', () => {
    const payload = composedFixture({
        steps: [{ id: 1, epic_fk: 9, title: 'S', run: 'auto', notes: null,
            completed_at: null, not_before: null }],
        epics: [{ id: 9, title: 'E', sort_order: 1 }],
        requirements: [{ id: 100, requirement_status: 'swarm_ready', machine_fk: null }],
        stepRequirements: [{ step_fk: 1, requirement_fk: 100 }],
    });
    payload.derived = {
        now: '2026-08-09T00:00:00Z',
        epic_order: [9],
        display_order: [1],
        rows: [{
            id: 1, state: 'pending', run: 'auto', eligible: true, epic_id: 9,
            dep_ids: [], out_of_scope_dep_ids: [], req_ids: [100], tracking_req_ids: [],
            unresolved_req_ids: [], launch_req_ids: [100], launch_excluded: [],
            launch_block: null, swarm_start_command: '/swarm-start 100',
            no_launch_reason: null, launch_suppressed: false, suppressed_by: [],
        }],
        pause: {
            pipeline_status: 'active', pipeline_paused: false,
            paused_epic_ids: [], suppressed_step_ids: [],
        },
        serial: {
            execution_mode: 'serial', serial: true, epic_order: [9],
            closed_epic_ids: [], live_epic_id: 9, waiting_epic_ids: [], held_step_ids: [],
        },
        eligible_step_ids: [1],
        violations: [{ invariant: 'topology', message: 'x renders before y', step_ids: [1, 2] }],
        cycle_detected: false,
        cycle_step_ids: [],
        duplicate_step_ids: [],
        unresolved_req_ids: [],
        out_of_scope_dep_ids: [],
        requirement_counts: {
            overall: { met: 0, total: 1 },
            by_epic: [{ epic_id: 9, met: 0, total: 1 }],
        },
    };

    it('never derives batches — 2.0 has none, drawn or otherwise', () => {
        const plan = adaptComposedPipeline2(payload);
        expect(plan.batches).toEqual([]);
        expect(plan.batchLetterByStepId.size).toBe(0);
    });

    it('reshapes eligible_step_ids into a Set', () => {
        const plan = adaptComposedPipeline2(payload);
        expect(plan.eligibleStepIds).toBeInstanceOf(Set);
        expect(plan.eligibleStepIds.has(1)).toBe(true);
    });

    it('reshapes violations — invariant/message kept, step_ids -> stepIds', () => {
        const plan = adaptComposedPipeline2(payload);
        expect(plan.violations).toEqual([
            { invariant: 'topology', message: 'x renders before y', stepIds: [1, 2] },
        ]);
    });

    it('reshapes requirement_counts -> requirementCounts, by_epic -> byEpic/epicId', () => {
        const plan = adaptComposedPipeline2(payload);
        expect(plan.requirementCounts).toEqual({
            overall: { met: 0, total: 1 },
            byEpic: [{ epicId: 9, met: 0, total: 1 }],
        });
    });

    it('reshapes pause verbatim under the camelCase field names the layout reads', () => {
        const plan = adaptComposedPipeline2(payload);
        expect(plan.pause).toEqual({
            pipelineStatus: 'active', pipelinePaused: false,
            pausedEpicIds: [], suppressedStepIds: [],
        });
    });

    it('reshapes serial verbatim', () => {
        const plan = adaptComposedPipeline2(payload);
        expect(plan.serial).toEqual({
            executionMode: 'serial', serial: true, epicOrder: [9],
            closedEpicIds: [], liveEpicId: 9, waitingEpicIds: [], heldStepIds: [],
        });
    });

    it('attaches cost from the SAME buildCostIndex two-read mechanism as before', () => {
        const costIndex = buildCostIndex({
            requirementSessions: [{ requirement_fk: 100, session_fk: 1 }],
            sessionCosts: [{ id: 1, wall_secs_total: 600, output_tokens_total: 1000 }],
        });
        const plan = adaptComposedPipeline2(payload, { costIndex });
        expect(plan.rows[0].cost).toEqual({ wallSecs: 600, tokens: 1000 });
    });

    it('every row carries a cost object even with no cost data at all', () => {
        const plan = adaptComposedPipeline2(payload);
        expect(plan.rows[0].cost).toEqual({ wallSecs: 0, tokens: 0 });
    });

    it('still computes a client-side time axis — the payload carries no time_axis key', () => {
        const plan = adaptComposedPipeline2(payload);
        expect(plan.timeAxis).toBeDefined();
        expect(plan.timeAxis.stepStarts).toBeDefined();
    });
});

describe('buildPlan2Model — the narrow model PipelinePlanVisualizer.jsx still reads', () => {
    it('carries pipeline/requirements/machines and nothing 2.0 does not have', () => {
        const payload = composedFixture({
            requirements: [{ id: 1, requirement_status: 'met' }],
        });
        const machines = [{ id: 1, title: 'Mac mini' }];
        const model = buildPlan2Model(payload, machines);
        expect(model.pipeline).toBe(payload.pipeline);
        expect(model.requirements).toEqual(payload.requirements);
        expect(model.machines).toBe(machines);
        expect(model.features).toBeUndefined();
    });

    it('tolerates a null payload', () => {
        expect(buildPlan2Model(null)).toEqual({ pipeline: null, requirements: [], machines: [] });
    });
});
