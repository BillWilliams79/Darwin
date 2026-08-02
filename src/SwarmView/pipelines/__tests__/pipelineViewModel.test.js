// Tests for the req #3114 adapter between the bounded list reads and the req
// #3112 engine. The engine's own algorithms are covered by pipelineModel.test.js;
// what is exercised here is everything the ADAPTER is responsible for — scoping
// whole-table reads to one pipeline, assembling the render list, and the
// production directives the table must not violate.

import { describe, it, expect } from 'vitest';

import {
    buildCostIndex,
    buildPipelineModel,
    orderedPlan,
    planRenderRows,
    pipelineSummary,
    pipelineSummaries,
    pipelineRequirementCounts,
    hiddenPipelineStatusCounts,
    pipelinesEmptyMessage,
    machineTitle,
    rowMachineLabel,
    batchMachineLabel,
    stepProse,
    stepName,
    stepDescription,
    formatTimeGate,
    formatTimeGates,
    PLAN_REQUIREMENT_FIELDS,
} from '../pipelineViewModel';
import { STEP_DONE, STEP_RUNNING, STEP_PENDING, requirementCounts } from '../pipelineModel';
import {
    STEPS,
    STEP_REQUIREMENTS,
    STEP_DEPS,
    REQUIREMENTS,
    FEATURES,
    EPICS,
    MACHINES,
} from './substrateRebuildFixture';

// The fixture models ONE pipeline, so its steps carry no pipeline_fk. The REST
// rows do, and the adapter's first job is scoping by it — give them one.
const PIPELINE = {
    id: 1, title: 'Substrate Rebuild Pipeline', description: 'goal',
    pipeline_status: 'active', machine_fk: 2,
};
const OTHER_PIPELINE = { id: 2, title: 'Other', pipeline_status: 'draft', machine_fk: null };

const withPipelineFk = (steps, fk) => steps.map((s) => ({ ...s, pipeline_fk: fk }));

const READS = {
    steps: withPipelineFk(STEPS, 1),
    stepRequirements: STEP_REQUIREMENTS,
    stepDeps: STEP_DEPS,
    requirements: REQUIREMENTS,
    features: FEATURES,
    epics: EPICS,
    machines: MACHINES,
};

const model = () => buildPipelineModel({ pipeline: PIPELINE, ...READS });

describe('buildPipelineModel — scoping whole-table reads to one pipeline', () => {
    it('keeps only the steps belonging to the given pipeline', () => {
        const foreign = [{ id: 9999, pipeline_fk: 2, title: 'not ours', run: 'auto' }];
        const m = buildPipelineModel({
            ...READS, pipeline: PIPELINE,
            steps: [...withPipelineFk(STEPS, 1), ...foreign],
        });
        expect(m.steps).toHaveLength(STEPS.length);
        expect(m.steps.some((s) => s.id === 9999)).toBe(false);
    });

    it('drops junction and dep rows owned by another pipeline’s steps', () => {
        const m = buildPipelineModel({
            ...READS, pipeline: PIPELINE,
            stepRequirements: [...STEP_REQUIREMENTS, { step_fk: 9999, requirement_fk: 3050 }],
            stepDeps: [...STEP_DEPS, { id: 998, step_fk: 9999, dep_step_fk: 1, time_at: null }],
        });
        expect(m.stepRequirements).toHaveLength(STEP_REQUIREMENTS.length);
        expect(m.stepDeps).toHaveLength(STEP_DEPS.length);
    });

    it('narrows requirements to the linked set — label derivation is per-step', () => {
        const m = buildPipelineModel({
            ...READS, pipeline: PIPELINE,
            requirements: [...REQUIREMENTS, { id: 1, requirement_status: 'met' }],
        });
        expect(m.requirements.some((r) => r.id === 1)).toBe(false);
        const linked = new Set(STEP_REQUIREMENTS.map((j) => j.requirement_fk));
        expect(m.requirements).toHaveLength(linked.size);
    });

    it('returns an empty model rather than throwing when the pipeline is missing', () => {
        const m = buildPipelineModel({ ...READS, pipeline: null });
        expect(m.steps).toEqual([]);
        expect(m.stepRequirements).toEqual([]);
        expect(m.requirements).toEqual([]);
    });

    it('tolerates entirely absent inputs', () => {
        const m = buildPipelineModel();
        expect(m.pipeline).toBeNull();
        expect(m.steps).toEqual([]);
    });
});

// The projection is a STRING handed to a fetch layer that puts it in its cache
// key, so a column dropped from it fails as an undefined on a hover card and
// nowhere else — there is no type to catch it. Assert the columns each consumer
// depends on, by the fact each one answers.
describe('PLAN_REQUIREMENT_FIELDS — the one shared projection', () => {
    const fields = () => PLAN_REQUIREMENT_FIELDS.split(',');

    it('carries the execution settings the hover card renders (req #3213 D5)', () => {
        expect(fields()).toEqual(expect.arrayContaining(
            ['coordination_type', 'ai_model', 'effort']));
    });

    it('still carries what the plan surface already derived from it', () => {
        // Identity + the title the card now leads with (D4), status for the
        // colour scales, the two FKs label derivation walks, `tracking` for the
        // container rule (req #3123) and the two stamps the time axis is built
        // from (req #3201).
        expect(fields()).toEqual(expect.arrayContaining([
            'id', 'title', 'requirement_status', 'machine_fk', 'feature_fk',
            'tracking', 'started_at', 'completed_at',
        ]));
    });

    it('names no column twice and carries no blob column (req #3078)', () => {
        const f = fields();
        expect(new Set(f).size).toBe(f.length);
        expect(f).not.toContain('description');
        // A projection is one comma-joined list; whitespace would travel into
        // the query string and the cache key alike.
        for (const name of f) expect(name).toBe(name.trim());
    });
});

describe('orderedPlan — engine run + self-check', () => {
    const plan = orderedPlan(model(), { now: '2026-07-27T03:00:00Z' });

    it('renders every step of the pipeline exactly once', () => {
        expect(plan.rows).toHaveLength(STEPS.length);
        expect(new Set(plan.rows.map((r) => r.id)).size).toBe(STEPS.length);
    });

    it('ships a clean order for the acceptance fixture', () => {
        // Design rule 3: an empty violation list is the ONLY green light, and the
        // Substrate Rebuild plan is THE acceptance fixture (req #3083).
        expect(plan.violations).toEqual([]);
        expect(plan.cycleDetected).toBe(false);
        expect(plan.duplicateStepIds).toEqual([]);
    });

    it('reports no unresolved requirement links when the read is complete', () => {
        expect(plan.unresolvedReqIds).toEqual([]);
    });

    it('surfaces unresolved requirement links when the read is truncated', () => {
        const truncated = orderedPlan(buildPipelineModel({
            ...READS, pipeline: PIPELINE,
            requirements: REQUIREMENTS.filter((r) => r.id !== 3050),
        }));
        expect(truncated.unresolvedReqIds).toContain(3050);
    });

    it('marks pending rows whose every dependency is complete as eligible', () => {
        for (const id of plan.eligibleStepIds) {
            const row = plan.rows.find((r) => r.id === id);
            expect(row.state).toBe(STEP_PENDING);
            for (const dep of row.depIds) {
                expect(plan.rows.find((r) => r.id === dep).state).toBe(STEP_DONE);
            }
        }
    });

    // RECORDED PROPERTY OF THE ACCEPTANCE FIXTURE, not a placeholder: the live
    // Substrate Rebuild plan produces ZERO launch batches. Its nearest pair is
    // steps 41 and 43, which share the gate (step 40) and the machine but differ
    // in run mode — an auto step and a manual step do not go out in one
    // /swarm-start, so they are correctly not a batch. The batch machinery is
    // therefore exercised against the synthetic model below rather than pretended
    // into this one.
    it('finds no launch batch in the Substrate Rebuild plan', () => {
        expect(plan.batches).toEqual([]);
        expect(plan.batchLetterByStepId.size).toBe(0);
    });

    it('carries requirementCounts straight from the engine (req #3225)', () => {
        // No second derivation here — `orderedPlan` must hand back exactly
        // what `requirementCounts(model)` computes, so the plan header and
        // the plan visualizer print the same number from the same call.
        expect(plan.requirementCounts).toEqual(requirementCounts(model()));
        expect(plan.requirementCounts.overall.total).toBeGreaterThan(0);
    });
});

// A minimal plan with a genuine batch: two pending steps sharing an identical
// (gate, run, machine) tuple, plus a third that differs only in run mode and
// must NOT join them.
const BATCH_READS = {
    steps: [
        { id: 1, pipeline_fk: 1, title: 'gate', run: 'auto', notes: null,
            completed_at: '2026-07-01T00:00:00' },
        { id: 2, pipeline_fk: 1, title: 'batch mate A', run: 'auto', notes: null,
            completed_at: null },
        { id: 3, pipeline_fk: 1, title: 'batch mate B', run: 'auto', notes: null,
            completed_at: null },
        { id: 4, pipeline_fk: 1, title: 'same gate, manual', run: 'manual', notes: null,
            completed_at: null },
    ],
    stepRequirements: [
        { step_fk: 2, requirement_fk: 900 },
        { step_fk: 3, requirement_fk: 901 },
        { step_fk: 4, requirement_fk: 902 },
    ],
    stepDeps: [
        { id: 1, step_fk: 2, dep_step_fk: 1, time_at: null },
        { id: 2, step_fk: 3, dep_step_fk: 1, time_at: null },
        { id: 3, step_fk: 4, dep_step_fk: 1, time_at: null },
    ],
    requirements: [
        { id: 900, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
        { id: 901, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
        { id: 902, requirement_status: 'approved', machine_fk: 2, feature_fk: 101 },
    ],
    features: [{ id: 101, title: 'Wave', epic_fk: 11 }],
    epics: [{ id: 11, title: 'Epic' }],
    machines: MACHINES,
};

describe('launch batches (design rule 8)', () => {
    const plan = orderedPlan(
        buildPipelineModel({ pipeline: PIPELINE, ...BATCH_READS }),
        { now: '2026-07-27T03:00:00Z' });

    it('groups only the steps that truly launch together', () => {
        expect(plan.batches).toHaveLength(1);
        expect(plan.batches[0].stepIds).toEqual([2, 3]);
    });

    it('carries the EXACT one-line /swarm-start argument list', () => {
        expect(plan.batches[0].swarmStartArgs).toEqual([900, 901]);
        expect(plan.batches[0].swarmStartCommand).toBe('/swarm-start 900 901');
    });

    it('names the gate and the run mode the banner prints', () => {
        // The REMAINING gate since req #3188, and step 1 carries a completed_at
        // stamp — so the honest banner text is "no step gate", not "steps 1".
        // The batch is eligible NOW; naming a dep that closed on 2026-07-01
        // read as something still holding it back.
        expect(plan.batches[0].gateStepIds).toEqual([]);
        expect(plan.batches[0].epicId).toBe(11);
        expect(plan.batches[0].run).toBe('auto');
        expect(plan.batches[0].machineLabels).toEqual(['Mac mini']);
    });

    it('gives every batch member the same letter, starting at A', () => {
        expect(plan.batchLetterByStepId.get(2)).toBe('A');
        expect(plan.batchLetterByStepId.get(3)).toBe('A');
        expect(plan.batchLetterByStepId.has(4)).toBe(false);
    });

    it('proposes the same group for condensation (design rule 2)', () => {
        expect(plan.proposals).toHaveLength(1);
        expect(plan.proposals[0].stepIds).toEqual([2, 3]);
        expect(plan.proposals[0].requirementIds).toEqual([900, 901]);
    });

    it('renders exactly one banner, immediately above the first member', () => {
        const rendered = planRenderRows(plan);
        const banners = rendered.filter((e) => e.kind === 'batch');
        expect(banners).toHaveLength(1);
        const at = rendered.findIndex((e) => e.kind === 'batch');
        expect(rendered[at + 1].row.id).toBe(2);
        expect(rendered[at + 2].row.id).toBe(3);
        expect(rendered[at + 1].batchLetter).toBe('A');
        expect(rendered[at + 2].batchLetter).toBe('A');
    });

    it('ships a clean order — batch contiguity included', () => {
        expect(plan.violations).toEqual([]);
    });

    it('emits a batch with no linked requirements as unlaunchable, not as a bare command', () => {
        const reqless = orderedPlan(buildPipelineModel({
            pipeline: PIPELINE,
            ...BATCH_READS,
            stepRequirements: [],
            requirements: [],
        }));
        const batch = reqless.batches.find((b) => b.stepIds.includes(2));
        expect(batch.swarmStartArgs).toEqual([]);
        expect(batch.swarmStartCommand).toBeNull();
    });
});

describe('planRenderRows — the flat render list', () => {
    const plan = orderedPlan(model(), { now: '2026-07-27T03:00:00Z' });
    const rendered = planRenderRows(plan);

    it('emits every step row in display order', () => {
        const stepEntries = rendered.filter((e) => e.kind === 'step');
        expect(stepEntries.map((e) => e.row.id)).toEqual(plan.rows.map((r) => r.id));
    });

    it('emits exactly one banner per batch, immediately above its first member', () => {
        const banners = rendered.filter((e) => e.kind === 'batch');
        expect(banners).toHaveLength(plan.batches.length);
        for (const [i, entry] of rendered.entries()) {
            if (entry.kind !== 'batch') continue;
            const next = rendered[i + 1];
            expect(next.kind).toBe('step');
            expect(entry.batch.stepIds).toContain(next.row.id);
        }
    });

    it('shows an Epic/Feature label once per contiguous group', () => {
        let prevEpic;
        let prevFeature;
        for (const entry of rendered) {
            if (entry.kind !== 'step') continue;   // a banner must not restart a group
            const epic = entry.row.epic != null ? entry.row.epic : null;
            const feature = entry.row.feature != null ? entry.row.feature : null;
            expect(entry.showEpic).toBe(epic !== prevEpic);
            expect(entry.showFeature).toBe(feature !== prevFeature);
            prevEpic = epic;
            prevFeature = feature;
        }
    });

    it('does not restart a group across an intervening batch banner', () => {
        // Concretely: for every banner, if the rows on either side share an epic,
        // the row below the banner must NOT re-print the label.
        for (const [i, entry] of rendered.entries()) {
            if (entry.kind !== 'batch') continue;
            const before = [...rendered.slice(0, i)].reverse().find((e) => e.kind === 'step');
            const after = rendered[i + 1];
            if (before && before.row.epic === after.row.epic) {
                expect(after.showEpic).toBe(false);
            }
        }
    });

    it('returns an empty list for an empty plan', () => {
        expect(planRenderRows(orderedPlan(buildPipelineModel()))).toEqual([]);
        expect(planRenderRows(null)).toEqual([]);
    });
});

describe('pipelineSummary / pipelineSummaries', () => {
    it('counts the three derived states and totals them', () => {
        const plan = orderedPlan(model());
        const s = pipelineSummary(plan.rows);
        expect(s.total).toBe(plan.rows.length);
        expect(s.done + s.running + s.pending).toBe(s.total);
        expect(s.done).toBe(plan.rows.filter((r) => r.state === STEP_DONE).length);
        expect(s.running).toBe(plan.rows.filter((r) => r.state === STEP_RUNNING).length);
    });

    it('treats an unknown state as scheduled rather than dropping the row', () => {
        expect(pipelineSummary([{ state: 'nonsense' }]))
            .toEqual({ total: 1, done: 0, running: 0, pending: 1 });
    });

    it('summarizes N pipelines from one pass over the shared reads', () => {
        const map = pipelineSummaries({
            pipelines: [PIPELINE, OTHER_PIPELINE],
            steps: READS.steps,
            stepRequirements: READS.stepRequirements,
            requirements: READS.requirements,
        });
        expect(map.get(1).total).toBe(STEPS.length);
        // A pipeline with no steps still gets an entry — a missing key would make
        // the card render blank instead of "0 steps".
        expect(map.get(2)).toEqual({ total: 0, done: 0, running: 0, pending: 0 });
    });

    it('handles no pipelines at all', () => {
        expect(pipelineSummaries().size).toBe(0);
    });
});

describe('pipelineRequirementCounts — the LIST page\'s per-plan met/total (req #3225)', () => {
    it('matches the whole-plan overall bucket requirementCounts(model) computes', () => {
        const map = pipelineRequirementCounts({
            pipelines: [PIPELINE, OTHER_PIPELINE],
            steps: READS.steps,
            stepRequirements: READS.stepRequirements,
            requirements: READS.requirements,
        });
        expect(map.get(1)).toEqual(requirementCounts(model()).overall);
    });

    it('gives a pipeline with no linked requirements an explicit zero, not a missing key', () => {
        const map = pipelineRequirementCounts({
            pipelines: [PIPELINE, OTHER_PIPELINE],
            steps: READS.steps,
            stepRequirements: READS.stepRequirements,
            requirements: READS.requirements,
        });
        expect(map.get(2)).toEqual({ met: 0, total: 0 });
    });

    it('handles no pipelines at all', () => {
        expect(pipelineRequirementCounts().size).toBe(0);
    });
});

describe('hiddenPipelineStatusCounts — req #3220 empty-state naming', () => {
    const PIPES = [
        { id: 1, pipeline_status: 'active' },
        { id: 2, pipeline_status: 'active' },
        { id: 3, pipeline_status: 'draft' },
        { id: 4, pipeline_status: 'paused' },
        { id: 5, pipeline_status: 'completed' },
        { id: 6, pipeline_status: 'completed' },
    ];

    it('names only hidden statuses that actually have matching pipelines', () => {
        expect(hiddenPipelineStatusCounts(PIPES, ['active', 'draft', 'paused']))
            .toEqual([{ status: 'completed', count: 2 }]);
    });

    it('returns nothing when every status is selected', () => {
        expect(hiddenPipelineStatusCounts(PIPES, [
            'draft', 'active', 'paused', 'completed', 'aborted',
        ])).toEqual([]);
    });

    it('omits a hidden status with zero matching pipelines — nothing to explain', () => {
        // 'aborted' is excluded from the filter but no pipeline is aborted, so
        // naming it would not answer "why is this empty".
        expect(hiddenPipelineStatusCounts(PIPES, ['active', 'draft', 'paused', 'completed']))
            .toEqual([]);
    });

    it('orders results by PIPELINE_STATUS_VALUES, not by filter or input order', () => {
        // completed sorts before aborted in the lifecycle order even though the
        // fixture lists an aborted-heavy set first.
        const pipes = [
            { id: 1, pipeline_status: 'aborted' },
            { id: 2, pipeline_status: 'completed' },
        ];
        expect(hiddenPipelineStatusCounts(pipes, []))
            .toEqual([{ status: 'completed', count: 1 }, { status: 'aborted', count: 1 }]);
    });

    it('handles no pipelines and no filter', () => {
        expect(hiddenPipelineStatusCounts(undefined, undefined)).toEqual([]);
    });
});

describe('pipelinesEmptyMessage — req #3220', () => {
    it('says "no pipelines yet" when nothing is hidden', () => {
        expect(pipelinesEmptyMessage([])).toBe('No pipelines yet.');
    });

    it('names hidden statuses and their counts', () => {
        expect(pipelinesEmptyMessage([
            { status: 'paused', count: 1 },
            { status: 'completed', count: 2 },
        ])).toBe('No pipelines match this filter — hidden: paused (1), completed (2).');
    });
});

describe('planRenderRows — grouping compares ids, not titles', () => {
    // Two DIFFERENT epics that share a title must not merge into one visual
    // group; the seeded plan already has the near-miss (epic 9003 and feature
    // 9012 are both titled "Swarm Orchestration Feature").
    const SAME_TITLE_READS = {
        steps: [
            { id: 1, pipeline_fk: 1, title: 'a', run: 'auto', completed_at: null },
            { id: 2, pipeline_fk: 1, title: 'b', run: 'auto', completed_at: null },
        ],
        stepRequirements: [
            { step_fk: 1, requirement_fk: 900 },
            { step_fk: 2, requirement_fk: 901 },
        ],
        stepDeps: [],
        requirements: [
            { id: 900, requirement_status: 'approved', machine_fk: null, feature_fk: 101 },
            { id: 901, requirement_status: 'approved', machine_fk: null, feature_fk: 102 },
        ],
        features: [
            { id: 101, title: 'Wave', epic_fk: 11 },
            { id: 102, title: 'Wave', epic_fk: 12 },   // same title, different epic
        ],
        epics: [{ id: 11, title: 'Orchestration' }, { id: 12, title: 'Orchestration' }],
        machines: MACHINES,
    };

    it('prints both labels when the ids differ despite identical titles', () => {
        const plan = orderedPlan(buildPipelineModel({ pipeline: PIPELINE, ...SAME_TITLE_READS }));
        const rows = planRenderRows(plan).filter((e) => e.kind === 'step');
        expect(rows).toHaveLength(2);
        expect(rows[0].showEpic).toBe(true);
        expect(rows[1].showEpic).toBe(true);
        expect(rows[1].showFeature).toBe(true);
    });
});

describe('formatTimeGate — one formatter for both surfaces', () => {
    // The seeded fixture's dual-condition gate (step 9003) carries this value,
    // and MySQL JSON_OBJECT puts it on the wire with a microsecond tail.
    const WIRE = '2026-07-24 06:31:38.000000';

    it('formats the MySQL space form as UTC, not as local time', () => {
        expect(formatTimeGate(WIRE, 'UTC')).toBe('Jul 24, 2026, 6:31 AM');
    });

    it('reads the naive T form as the SAME instant as the space form', () => {
        // dateFormat.formatDateTime alone does NOT: it parses a `T`-separated
        // datetime with no designator as LOCAL time, which would put the label an
        // offset out of step with the engine's own toEpochMs — eligibility and the
        // gate it is computed from disagreeing about what the value means.
        expect(formatTimeGate('2026-07-24T06:31:38', 'UTC'))
            .toBe(formatTimeGate('2026-07-24 06:31:38', 'UTC'));
    });

    it('leaves an explicit offset alone', () => {
        expect(formatTimeGate('2026-07-24T06:31:38Z', 'UTC')).toBe('Jul 24, 2026, 6:31 AM');
    });

    it('renders in the viewer’s timezone', () => {
        expect(formatTimeGate(WIRE, 'America/Los_Angeles')).toBe('Jul 23, 2026, 11:31 PM');
    });

    it('returns gates as separate strings — never pre-joined', () => {
        // A formatted datetime contains both spaces and commas, so no single
        // delimiter can separate two of them unambiguously. The caller gives each
        // its own line.
        const out = formatTimeGates([WIRE, '2026-07-25 12:00:00'], 'UTC');
        expect(out).toEqual(['Jul 24, 2026, 6:31 AM', 'Jul 25, 2026, 12:00 PM']);
    });

    it('tolerates absent or empty gate lists', () => {
        expect(formatTimeGate(null, 'UTC')).toBe('');
        expect(formatTimeGates(undefined, 'UTC')).toEqual([]);
        expect(formatTimeGates([], 'UTC')).toEqual([]);
    });
});

describe('stepProse — title vs notes', () => {
    it('shows both when notes add something', () => {
        expect(stepProse({ title: 'Do the thing', notes: 'gate passed WITH exceptions' }))
            .toEqual({ text: 'Do the thing', notes: 'gate passed WITH exceptions' });
    });

    it('shows the title alone when there are no notes', () => {
        expect(stepProse({ title: 'Do the thing', notes: null }))
            .toEqual({ text: 'Do the thing', notes: null });
        expect(stepProse({ title: 'Do the thing', notes: '   ' }))
            .toEqual({ text: 'Do the thing', notes: null });
    });

    it('never prints the same sentence twice', () => {
        expect(stepProse({ title: 'Same text', notes: 'Same text' }))
            .toEqual({ text: 'Same text', notes: null });
    });

    it('prefers the untruncated notes when the title is a VARCHAR(256) truncation', () => {
        // The seeded fixture writes the summary to BOTH columns; 12 of its 34
        // rows arrive with the title cut short and an ellipsis appended.
        const full = 'A very long step summary that overflows the title column entirely';
        expect(stepProse({ title: 'A very long step summary that…', notes: full }))
            .toEqual({ text: full, notes: null });
        expect(stepProse({ title: 'A very long step summary that...', notes: full }))
            .toEqual({ text: full, notes: null });
    });

    it('tolerates a row with neither field', () => {
        expect(stepProse({})).toEqual({ text: '', notes: null });
        expect(stepProse(null)).toEqual({ text: '', notes: null });
    });
});

describe('machine labels', () => {
    it('resolves a machine id to its title', () => {
        expect(machineTitle(2, MACHINES)).toBe('Mac mini');
    });

    it('reads a NULL pin as Any, matching the engine vocabulary', () => {
        expect(machineTitle(null, MACHINES)).toBe('Any');
    });

    it('degrades an unknown id to the bare id — never a blank, never a hash', () => {
        expect(machineTitle(4242, MACHINES)).toBe('4242');
    });
});

describe("the no-'#' production directive", () => {
    const plan = orderedPlan(model(), { now: '2026-07-27T03:00:00Z' });

    it('strips the hash the engine puts on an unresolvable machine id', () => {
        // machineLabels() degrades to the POC's `#<id>` form; the page must not.
        expect(rowMachineLabel({ machineLabels: ['#77', 'Mac mini'] }))
            .toBe('77 / Mac mini');
        expect(batchMachineLabel({ machineLabels: ['#77'] })).toBe('77');
    });

    it('renders an em-dash for a step or batch with no machine', () => {
        expect(rowMachineLabel({ machineLabels: [] })).toBe('—');
        expect(rowMachineLabel({})).toBe('—');
        expect(batchMachineLabel(null)).toBe('—');
    });

    it('generates no hash in any label the UI composes for the fixture plan', () => {
        // Requirement ids, machine labels, dep lists, gate text and the
        // /swarm-start command — every string the table BUILDS. Step titles and
        // notes are the plan's own prose and are deliberately excluded: they are
        // stored content, not labels, and rewriting them would falsify the record.
        const generated = [];
        for (const r of plan.rows) {
            generated.push(rowMachineLabel(r));
            generated.push(r.reqIds.join(' '));
            generated.push([...r.depIds, ...r.timeDeps].join(' '));
        }
        for (const b of plan.batches) {
            generated.push(b.swarmStartCommand || '');
            generated.push(batchMachineLabel(b));
            generated.push(b.stepIds.join(' '));
            generated.push(b.gateStepIds.join(' '));
        }
        expect(generated.join('|')).not.toContain('#');
    });
});

// ── Cost (req #3117) ────────────────────────────────────────────────────────
//
// The adapter's whole contribution to the Cost column: fold two bounded list
// reads into a per-requirement rollup map, and hand it to the engine so every
// PlanRow carries its own total. The named failure being prevented is the POC's
// ~86 per-requirement fetches (design rule 5), so the tests that matter are the
// ones about SHAPE — one pass, two lists — not just about arithmetic.

describe('buildCostIndex', () => {
    const SESSIONS = [
        { id: 501, wall_secs_total: 3600, output_tokens_total: 120_000 },
        { id: 502, wall_secs_total: 1800, output_tokens_total: 60_000 },
        { id: 503, wall_secs_total: null, output_tokens_total: null },
        { id: 504, wall_secs_total: 900, output_tokens_total: null },
    ];

    it('sums every session of a requirement', () => {
        const { byRequirement } = buildCostIndex({
            requirementSessions: [
                { requirement_fk: 3110, session_fk: 501 },
                { requirement_fk: 3110, session_fk: 502 },
            ],
            sessionCosts: SESSIONS,
        });
        expect(byRequirement[3110]).toEqual({ wallSecs: 5400, tokens: 180_000 });
    });

    it('credits a shared session to EVERY requirement it served', () => {
        // Per-requirement attribution is full: any apportionment rule would be an
        // invention, and the session genuinely did work for both. The STEP-level
        // union that stops this becoming a double count lives in sumReqCost.
        const { byRequirement, sessionIdsByRequirement } = buildCostIndex({
            requirementSessions: [
                { requirement_fk: 3110, session_fk: 501 },
                { requirement_fk: 3111, session_fk: 501 },
            ],
            sessionCosts: SESSIONS,
        });
        expect(byRequirement[3110]).toEqual(byRequirement[3111]);
        expect(byRequirement[3110]).toEqual({ wallSecs: 3600, tokens: 120_000 });
        // The session ids are what let a step count 501 once.
        expect(sessionIdsByRequirement[3110]).toEqual([501]);
        expect(sessionIdsByRequirement[3111]).toEqual([501]);
    });

    it('a session with both totals NULL leaves the requirement absent, not zero', () => {
        // Pre-backfill rows are UNKNOWN, not free. An entry of {0,0} would render
        // "0m" — a claim the data does not support. Absence renders as a dash.
        const { byRequirement, bySession } = buildCostIndex({
            requirementSessions: [{ requirement_fk: 3110, session_fk: 503 }],
            sessionCosts: SESSIONS,
        });
        expect(byRequirement[3110]).toBeUndefined();
        expect(bySession[503]).toBeUndefined();
    });

    it('a session with one known total contributes only that half', () => {
        const { byRequirement } = buildCostIndex({
            requirementSessions: [{ requirement_fk: 3110, session_fk: 504 }],
            sessionCosts: SESSIONS,
        });
        expect(byRequirement[3110]).toEqual({ wallSecs: 900, tokens: 0 });
    });

    it('ignores junction rows whose session is missing from the read', () => {
        const index = buildCostIndex({
            requirementSessions: [{ requirement_fk: 3110, session_fk: 99_999 }],
            sessionCosts: SESSIONS,
        });
        expect(index.byRequirement).toEqual({});
        expect(index.sessionIdsByRequirement).toEqual({});
    });

    it('a repeated junction pair does not double a requirement own total', () => {
        // (requirement_fk, session_fk) is the junction's PK so this cannot occur
        // in the table — but the read is data, not a proof.
        const { byRequirement, sessionIdsByRequirement } = buildCostIndex({
            requirementSessions: [
                { requirement_fk: 3110, session_fk: 501 },
                { requirement_fk: 3110, session_fk: 501 },
            ],
            sessionCosts: SESSIONS,
        });
        expect(byRequirement[3110]).toEqual({ wallSecs: 3600, tokens: 120_000 });
        expect(sessionIdsByRequirement[3110]).toEqual([501]);
    });

    it('normalizes session ids so the step-level de-dup cannot be defeated', () => {
        // The object-key lookups are type-tolerant (JS coerces a key to string)
        // but `includes`/`Set.has` use SameValueZero. A junction row carrying
        // '501' beside one carrying 501 would index fine and then de-dup as TWO
        // sessions — silently restoring the double count this index prevents.
        const { sessionIdsByRequirement, byRequirement } = buildCostIndex({
            requirementSessions: [
                { requirement_fk: 3110, session_fk: '501' },
                { requirement_fk: 3110, session_fk: 501 },
            ],
            sessionCosts: SESSIONS,
        });
        expect(sessionIdsByRequirement[3110]).toEqual([501]);
        expect(byRequirement[3110]).toEqual({ wallSecs: 3600, tokens: 120_000 });
    });

    it('is total on absent, null and malformed input', () => {
        expect(buildCostIndex().byRequirement).toEqual({});
        expect(buildCostIndex({}).byRequirement).toEqual({});
        expect(buildCostIndex({
            requirementSessions: [null, { requirement_fk: 1, session_fk: 501 }],
            sessionCosts: [null, { wall_secs_total: 5 }, ...SESSIONS],
        }).byRequirement[1]).toEqual({ wallSecs: 3600, tokens: 120_000 });
    });
});

describe('orderedPlan attaches cost to every row', () => {
    const NOW = '2026-07-27T03:00:00Z';

    // Step 38 links 3110, 3111 and 3112. Sessions 601/602 are private to 3110
    // and 3112; session 603 served 3111 AND 3112 — the shared-session case.
    const costIndex = buildCostIndex({
        requirementSessions: [
            { requirement_fk: 3110, session_fk: 601 },
            { requirement_fk: 3112, session_fk: 602 },
            { requirement_fk: 3111, session_fk: 603 },
            { requirement_fk: 3112, session_fk: 603 },
        ],
        sessionCosts: [
            { id: 601, wall_secs_total: 600, output_tokens_total: 40_000 },
            { id: 602, wall_secs_total: 300, output_tokens_total: 25_000 },
            { id: 603, wall_secs_total: 1200, output_tokens_total: 90_000 },
        ],
    });

    it('every row carries a cost object even with no cost data at all', () => {
        // The renderer reads row.cost unconditionally; an undefined here would be
        // a crash rather than a dash.
        for (const r of orderedPlan(model(), { now: NOW }).rows) {
            expect(r.cost).toEqual({ wallSecs: 0, tokens: 0 });
        }
    });

    it('a step total is the union over its requirements sessions, counted once', () => {
        const plan = orderedPlan(model(), { now: NOW, costIndex });
        const row38 = plan.rows.find((r) => r.id === 38);
        // 601 + 602 + 603, with 603 counted ONCE despite serving two of the
        // step's requirements. Summing byRequirement instead would give
        // 3300s / 245k — the double count design rule 2's condensation makes likely.
        expect(row38.cost).toEqual({ wallSecs: 2100, tokens: 155_000 });
        expect(costIndex.byRequirement[3111].wallSecs
               + costIndex.byRequirement[3112].wallSecs).toBe(2700);
    });

    it('cost never changes the row order', () => {
        // Cost is attached AFTER ordering and verification. If it could reach the
        // comparator, a plan would re-order itself as sessions accrued time —
        // silently, and against design rule 3's fixed banding.
        const bare = orderedPlan(model(), { now: NOW });
        const costed = orderedPlan(model(), { now: NOW, costIndex });
        expect(costed.rows.map((r) => r.id)).toEqual(bare.rows.map((r) => r.id));
        expect(costed.violations).toEqual([]);
    });
});

// ── Name vs description (req #3119) ─────────────────────────────────────────
// A title is a NAME. The darwin_dev seed used to load a truncated summary into
// pipeline_steps.title, so a "name" could be a paragraph; the generator now
// loads the plan's own short title. These two functions are what keeps the Name
// column from becoming a second copy of the description either way.

describe('stepName — the Name column', () => {
    it('returns a short title unchanged and unflagged', () => {
        expect(stepName({ title: 'Session Drain' }))
            .toEqual({ text: 'Session Drain', full: 'Session Drain', truncated: false });
    });

    it('em-dashes a missing, empty or whitespace-only title', () => {
        for (const row of [null, undefined, {}, { title: '' }, { title: '   ' }]) {
            expect(stepName(row)).toEqual({ text: '—', full: '', truncated: false });
        }
    });

    it('trims surrounding whitespace rather than counting it toward the cut', () => {
        expect(stepName({ title: '  Green Baseline  ' }).full).toBe('Green Baseline');
    });

    it('cuts a prose-length legacy title at a word boundary, keeping the full text', () => {
        const legacy = 'Seven parallel sessions on the proven substrate: house dialog '
            + 'pattern under /agents, IntegrityError-to-409 mapping';
        const out = stepName(legacy && { title: legacy });
        expect(out.truncated).toBe(true);
        expect(out.full).toBe(legacy);
        expect(out.text.endsWith('…')).toBe(true);
        expect(out.text.length).toBeLessThanOrEqual(48);
        // Word boundary: nothing but the ellipsis after the last space.
        expect(out.text.slice(0, -1).endsWith(' ')).toBe(false);
        expect(legacy.startsWith(out.text.slice(0, -1))).toBe(true);
    });

    it('falls back to a hard cut when the first 48 chars hold no space', () => {
        const out = stepName({ title: 'x'.repeat(80) });
        expect(out.truncated).toBe(true);
        expect(out.text).toBe(`${'x'.repeat(47)}…`);
    });

    it('honours an explicit max', () => {
        expect(stepName({ title: 'Session Drain' }, 8).text).toBe('Session…');
    });
});

describe('stepDescription — the "What this step does" column', () => {
    it('prints the notes, never the name repeated', () => {
        expect(stepDescription({ title: 'Session Drain', notes: 'Drain: close every session' }))
            .toBe('Drain: close every session');
    });

    it('prints a SHORT supplementary note alone — the Name column carries the title', () => {
        expect(stepDescription({ title: 'Green Baseline', notes: 'Blocked on the snapshot gate.' }))
            .toBe('Blocked on the snapshot gate.');
    });

    it('falls back to the title when there is no description at all', () => {
        expect(stepDescription({ title: 'Green Baseline', notes: null })).toBe('Green Baseline');
        expect(stepDescription({ title: 'Green Baseline', notes: '   ' })).toBe('Green Baseline');
    });

    it('is empty, never a crash, on a row with neither', () => {
        expect(stepDescription({})).toBe('');
        expect(stepDescription(null)).toBe('');
    });
});
