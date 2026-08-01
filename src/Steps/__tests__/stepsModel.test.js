// Req #3140 — the Steps editor's page model.
//
// What is pinned here is everything the browser has to enforce that the MCP
// service enforces in Python, plus the one property that makes this page
// trustworthy at all: it AGREES with the plan pages about step state, because it
// runs the same engine rather than a copy of it.
//
// The fixture is deliberately shaped like the live plan: a requirement-backed
// step, a link-less manual step, a step whose only link is a TRACKING container
// (req #3123), a step with an unresolved requirement id, a gate chain, and two
// pipelines — so cross-plan leakage would show up as a wrong count rather than
// as nothing.

import { describe, it, expect } from 'vitest';

import {
    STEP_DONE,
    STEP_PENDING,
    STEP_RUNNING,
    buildStepEditorRows,
    completionGuard,
    dropBlockers,
    filterStepRows,
    gatingRequirementIds,
    stepsAccounting,
} from '../stepsModel';

const PIPELINES = [
    { id: 1, title: 'Darwin', pipeline_status: 'active' },
    { id: 2, title: 'Substrate', pipeline_status: 'draft' },
];

const STEPS = [
    { id: 10, pipeline_fk: 1, title: 'Session Drain', run: 'auto', notes: 'Close every open session.', completed_at: null },
    { id: 11, pipeline_fk: 1, title: 'Green Baseline', run: 'manual', notes: null, completed_at: '2026-07-28 06:00:00' },
    { id: 12, pipeline_fk: 1, title: 'Container Only', run: 'auto', notes: null, completed_at: null },
    { id: 13, pipeline_fk: 1, title: 'Unresolved Link', run: 'auto', notes: null, completed_at: null },
    { id: 20, pipeline_fk: 2, title: 'Other Plan', run: 'auto', notes: null, completed_at: null },
];

const STEP_REQUIREMENTS = [
    { step_fk: 10, requirement_fk: 3050 },   // development -> Running
    { step_fk: 12, requirement_fk: 3083 },   // tracking container -> falls through to completed_at
    { step_fk: 13, requirement_fk: 9999 },   // not in the requirements read
    { step_fk: 20, requirement_fk: 3111 },   // met -> Complete
];

// step 11 gates step 10; step 10 gates nothing. Step 11 also carries a wall-clock
// row, which is a SECOND condition on one step (migration 076 leaves `time_at`
// rows out of the UNIQUE key precisely so it can).
const STEP_DEPS = [
    { id: 1, step_fk: 10, dep_step_fk: 11, time_at: null },
    { id: 2, step_fk: 11, dep_step_fk: null, time_at: '2026-07-28 05:00:00' },
];

const REQUIREMENTS = [
    { id: 3050, title: 'Gateway', requirement_status: 'development', feature_fk: 100, tracking: 0 },
    { id: 3083, title: 'Plan tracker', requirement_status: 'development', feature_fk: 100, tracking: 1 },
    { id: 3111, title: 'Schema', requirement_status: 'met', feature_fk: 101, tracking: 0 },
];

const FEATURES = [
    { id: 100, title: 'Substrate', epic_fk: 900 },
    { id: 101, title: 'Tables', epic_fk: 901 },
];

const EPICS = [
    { id: 900, title: 'Swarm Substrate' },
    { id: 901, title: 'Orchestration' },
];

const build = (overrides = {}) => buildStepEditorRows({
    pipelines: PIPELINES,
    steps: STEPS,
    stepRequirements: STEP_REQUIREMENTS,
    stepDeps: STEP_DEPS,
    requirements: REQUIREMENTS,
    features: FEATURES,
    epics: EPICS,
    ...overrides,
});

const byId = (rows) => Object.fromEntries(rows.map(r => [r.id, r]));

describe('buildStepEditorRows — state comes from the engine', () => {
    it('derives every step in every plan', () => {
        const { rows } = build();
        expect(rows.map(r => r.id).sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 20]);
    });

    it('a gating requirement in development derives Running', () => {
        expect(byId(build().rows)[10].state).toBe(STEP_RUNNING);
    });

    it('a link-less step derives from its OWN completed_at stamp', () => {
        // The only place that column means anything (design rule 1).
        expect(byId(build().rows)[11].state).toBe(STEP_DONE);
    });

    it('a step whose only link is a TRACKING container falls through to its stamp', () => {
        // req #3123. Counting the container would pin this step Running forever:
        // the container never leaves `development` because the plan it holds is
        // still running, and the step waits on the plan that waits on the step.
        const row = byId(build().rows)[12];
        expect(row.state).toBe(STEP_PENDING);
        expect(row.trackingReqIds).toEqual([3083]);
        expect(row.gatingReqIds).toEqual([]);
    });

    it('an unresolved requirement id GATES — nothing was read that said otherwise', () => {
        const row = byId(build().rows)[13];
        expect(row.unresolvedReqIds).toEqual([9999]);
        expect(row.gatingReqIds).toEqual([9999]);
        expect(row.trackingReqIds).toEqual([]);
    });

    it('all-terminal requirements derive Complete', () => {
        expect(byId(build().rows)[20].state).toBe(STEP_DONE);
    });

    it('derives the epic label through requirement -> feature -> epic (rule 10)', () => {
        const rows = byId(build().rows);
        expect(rows[10].epic).toBe('Swarm Substrate');
        expect(rows[20].epic).toBe('Orchestration');
    });
});

describe('buildStepEditorRows — plan scoping', () => {
    it('decorates every row with its plan title and status', () => {
        const rows = byId(build().rows);
        expect(rows[10].pipelineId).toBe(1);
        expect(rows[10].pipelineTitle).toBe('Darwin');
        expect(rows[10].pipelineStatus).toBe('active');
        expect(rows[20].pipelineTitle).toBe('Substrate');
    });

    it('never leaks one plan\'s dependency rows into another\'s step', () => {
        // buildPipelineModel scopes deps by the OWNING step, so a step in plan 2
        // must come back ungated even though plan 1 is full of dep rows.
        const rows = byId(build().rows);
        expect(rows[20].depIds).toEqual([]);
        expect(rows[10].depIds).toEqual([11]);
        expect(rows[11].timeDeps).toEqual(['2026-07-28 05:00:00']);
    });

    it('still derives a step whose pipeline row is missing from the read', () => {
        // A truncated or failed pipelines read must not make steps disappear from
        // the one page that could fix them.
        const { rows, unrenderedStepIds } = build({ pipelines: [] });
        expect(rows.map(r => r.id).sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 20]);
        expect(byId(rows)[10].pipelineTitle).toBeNull();
        expect(byId(rows)[10].state).toBe(STEP_RUNNING);
        expect(unrenderedStepIds).toEqual([]);
    });

    it('REPORTS a step it cannot place instead of dropping it', () => {
        const { rows, unrenderedStepIds } = build({
            steps: [...STEPS, { id: 99, pipeline_fk: null, title: 'Orphan', run: 'auto' }],
        });
        expect(unrenderedStepIds).toEqual([99]);
        expect(rows.some(r => r.id === 99)).toBe(false);
    });

    it('survives empty and missing inputs', () => {
        expect(buildStepEditorRows()).toEqual({ rows: [], unrenderedStepIds: [] });
        expect(buildStepEditorRows({ steps: [] })).toEqual({ rows: [], unrenderedStepIds: [] });
    });
});

describe('dropBlockers — design rule 4, refuse FIRST', () => {
    it('names the steps whose dependency row references this one', () => {
        expect(dropBlockers(11, STEP_DEPS)).toEqual([10]);
    });

    it('is empty for a step nothing gates on', () => {
        expect(dropBlockers(10, STEP_DEPS)).toEqual([]);
        expect(dropBlockers(20, STEP_DEPS)).toEqual([]);
    });

    it('de-duplicates and sorts, so a refusal never names a step twice', () => {
        const deps = [
            { id: 1, step_fk: 30, dep_step_fk: 11, time_at: null },
            { id: 2, step_fk: 30, dep_step_fk: 11, time_at: null },
            { id: 3, step_fk: 12, dep_step_fk: 11, time_at: null },
        ];
        expect(dropBlockers(11, deps)).toEqual([12, 30]);
    });

    it('ignores wall-clock rows, which reference no step', () => {
        expect(dropBlockers(null, STEP_DEPS)).toEqual([]);
    });

    it('counts a self-dependency, because InnoDB does', () => {
        // The check PREVIEWS the database's answer rather than enforcing anything
        // (deleteStep is one statement and dep_step_fk RESTRICTs). InnoDB evaluates
        // that RESTRICT even against a dep row inside the same cascade, so this
        // delete really would refuse — excluding the row would produce a bare 409
        // where a named refusal was available.
        expect(dropBlockers(5, [{ id: 1, step_fk: 5, dep_step_fk: 5, time_at: null }]))
            .toEqual([5]);
    });

    it('is attached to every row by buildStepEditorRows', () => {
        const rows = byId(build().rows);
        expect(rows[11].blockerStepIds).toEqual([10]);
        expect(rows[10].blockerStepIds).toEqual([]);
    });

    it('survives a missing deps list', () => {
        expect(dropBlockers(11, undefined)).toEqual([]);
    });
});

describe('gatingRequirementIds — one rule for the grid and the live re-check', () => {
    it('drops tracking containers and keeps real work', () => {
        expect(gatingRequirementIds([3050, 3083], REQUIREMENTS)).toEqual([3050]);
    });

    it('keeps an id the requirements read did not return', () => {
        // Nothing was read that said it is a container, and refusing a stamp is
        // the recoverable direction.
        expect(gatingRequirementIds([9999], REQUIREMENTS)).toEqual([9999]);
    });

    it('reads tracking numerically, so the string "0" is WORK', () => {
        // `Boolean("0")` is true, which would silently stop a real requirement
        // from gating its step — wrong in the dangerous direction.
        const reqs = [{ id: 1, tracking: '0' }, { id: 2, tracking: '1' }, { id: 3, tracking: 0 }];
        expect(gatingRequirementIds([1, 2, 3], reqs)).toEqual([1, 3]);
    });

    it('is what buildStepEditorRows put on every row', () => {
        const rows = byId(build().rows);
        expect(rows[10].gatingReqIds).toEqual(gatingRequirementIds([3050], REQUIREMENTS));
        expect(rows[12].gatingReqIds).toEqual(gatingRequirementIds([3083], REQUIREMENTS));
    });

    it('survives empty and missing inputs', () => {
        expect(gatingRequirementIds(undefined, undefined)).toEqual([]);
        expect(gatingRequirementIds([], REQUIREMENTS)).toEqual([]);
    });
});

describe('completionGuard — design rule 1, client-side', () => {
    it('allows a link-less step to be stamped by hand', () => {
        const guard = completionGuard(byId(build().rows)[11]);
        expect(guard.allowed).toBe(true);
        expect(guard.reason).toMatch(/reopen/i);
    });

    it('allows a container-only step — the exemption is what makes it completable', () => {
        const guard = completionGuard(byId(build().rows)[12]);
        expect(guard.allowed).toBe(true);
        expect(guard.reason).toMatch(/mark this step complete/i);
    });

    it('REFUSES a requirement-backed step and names the requirements', () => {
        const guard = completionGuard(byId(build().rows)[10]);
        expect(guard.allowed).toBe(false);
        expect(guard.reason).toContain('3050');
    });

    it('refuses on an unresolved link, and says which id', () => {
        const guard = completionGuard(byId(build().rows)[13]);
        expect(guard.allowed).toBe(false);
        expect(guard.reason).toContain('9999');
    });

    it('names the exempted containers on a MIXED step so the count is explicable', () => {
        const guard = completionGuard({
            id: 1, reqIds: [3050, 3083], trackingReqIds: [3083], gatingReqIds: [3050],
        });
        expect(guard.allowed).toBe(false);
        expect(guard.reason).toContain('3050');
        // Verbs agree with the noun — the singular is the common case here.
        expect(guard.reason).toContain('1 tracking container 3083 is exempt and was not counted');
    });

    it('pluralizes the exemption clause correctly for several containers', () => {
        const guard = completionGuard({
            id: 1, reqIds: [3050, 3083, 3090], trackingReqIds: [3083, 3090], gatingReqIds: [3050],
        });
        expect(guard.reason)
            .toContain('2 tracking containers 3083, 3090 are exempt and were not counted');
    });

    it('survives a row with no arrays at all', () => {
        expect(completionGuard({}).allowed).toBe(true);
        expect(completionGuard(null).allowed).toBe(true);
    });
});

describe('filterStepRows', () => {
    const rows = build().rows;

    it('null means every value — the ChipFilter contract', () => {
        expect(filterStepRows(rows, {}).length).toBe(rows.length);
        expect(filterStepRows(rows, { states: null, pipelineIds: null }).length).toBe(rows.length);
    });

    it('an EMPTY selection means show nothing, and is never corrected back to all', () => {
        expect(filterStepRows(rows, { states: [] })).toEqual([]);
        expect(filterStepRows(rows, { pipelineIds: [] })).toEqual([]);
    });

    it('narrows to one plan', () => {
        expect(filterStepRows(rows, { pipelineIds: [2] }).map(r => r.id)).toEqual([20]);
    });

    it('narrows by derived state', () => {
        expect(filterStepRows(rows, { states: [STEP_RUNNING] }).map(r => r.id)).toEqual([10]);
        expect(filterStepRows(rows, { states: [STEP_DONE] }).map(r => r.id).sort((a, b) => a - b))
            .toEqual([11, 20]);
    });

    it('ANDs the two dimensions', () => {
        expect(filterStepRows(rows, { pipelineIds: [1], states: [STEP_DONE] }).map(r => r.id))
            .toEqual([11]);
    });
});

describe('stepsAccounting', () => {
    it('counts the three derived states', () => {
        expect(stepsAccounting(build().rows))
            .toEqual({ total: 5, done: 2, running: 1, pending: 2 });
    });

    it('is zeroed rather than undefined for no rows', () => {
        expect(stepsAccounting([]))
            .toEqual({ total: 0, done: 0, running: 0, pending: 0 });
        expect(stepsAccounting(undefined).total).toBe(0);
    });
});
