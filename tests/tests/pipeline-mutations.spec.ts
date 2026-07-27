import { test, expect } from '@playwright/test';

import {
    devRead, devTool, devToolExpectError, ensureDevMcp, stopDevMcp,
} from '../helpers/darwinDevMcp';
import {
    buildPipelineModel, orderedPlan,
} from '../../src/SwarmView/pipelines/pipelineViewModel.js';

// Swarm Orchestration — the MUTATION-CASE REPLAY (req #3118), the acceptance
// core. The browser half is pipelines.spec.ts.
//
// ── What this replays ───────────────────────────────────────────────────────
// req #3080 records eight mutation classes that ACTUALLY HAPPENED to the
// Substrate Rebuild plan while it ran, and states that the schema must be able
// to record all of them. This spec executes every one through the shipped MCP
// tools — via `scripts/mcp/darwin-tool.sh`, the always-via-wrapper path (req
// #2365) — against a dedicated throwaway plan in darwin_dev, and after EACH one
// asserts three things:
//
//   1. THE ECHO. Every pipeline tool returns the full affected state read back
//      from the database (req #3113 / #2828 discipline). `devTool` throws on the
//      `{error: ...}` shape the tools answer refusals with, so an unverified
//      call cannot pass for a successful one.
//   2. THE DERIVED STATE. Step state is computed from the linked requirements
//      and is never stored (design rule 1), so the assertion is always about
//      what the engine derives, never about a column.
//   3. A CLEAN ORDER. `orderedPlan()` is re-run over a fresh single read of
//      `darwin://pipeline/{id}` and `violations` must be empty — design rule 3's
//      self-check, evaluated after every edit rather than once at the end.
//
// ── No browser ──────────────────────────────────────────────────────────────
// Deliberately: these are MCP-layer mutations and their consequences for the
// engine. It lives in the Playwright suite because that is the standard
// invocation the requirement names, and because it shares the engine import with
// the browser half — one definition of "what the plan means", exercised twice.
//
// ── Isolation ───────────────────────────────────────────────────────────────
// One throwaway pipeline, found-or-created by a fixed title so darwin_dev never
// accumulates more than one, wiped clean at the start of every run.

const PLAN_TITLE = 'e2e-3118 mutation replay (throwaway)';
const REQ_PREFIX = 'e2e-3118-mutation';
// Wall-clock gates, fixed so eligibility is deterministic against a real clock.
// The future one is 2037, not 2099: `pipeline_step_deps.time_at` is a MySQL
// TIMESTAMP (1970-01-01..2038-01-19) and `set_step_deps` REFUSES anything
// outside that range, because RDS's non-strict sql_mode would otherwise store
// the zero date — a gate that reads as already satisfied.
const PAST_GATE = '2020-01-01T00:00:00Z';
const FUTURE_GATE = '2037-01-01T00:00:00Z';

type Step = {
    id: number; title: string; run: string;
    notes: string | null; completed_at: string | null; pipeline_fk: number;
};
type StepEcho = { step: Step; requirement_ids: number[]; deps: Array<Record<string, unknown>> };
type Composed = {
    pipeline: Record<string, unknown>;
    steps: Step[];
    step_requirements: Array<{ step_fk: number; requirement_fk: number }>;
    step_deps: Array<{ step_fk: number; dep_step_fk: number | null; time_at: string | null }>;
    requirements: Array<Record<string, unknown>>;
    features: Array<Record<string, unknown>>;
    epics: Array<Record<string, unknown>>;
};

test.describe.configure({ mode: 'serial' });

test.describe('Swarm Orchestration — 8-case mutation replay via MCP', () => {
    let pipelineId: number;
    let machines: Array<Record<string, unknown>> = [];
    let categoryFk: number;

    // Steps and requirements the cases build on, named as they are created.
    const step: Record<string, number> = {};
    const req: Record<string, number> = {};
    const createdRequirementIds: number[] = [];

    /**
     * Re-read the whole plan in ONE call and run the engine over it — the same
     * `darwin://pipeline/{id}` payload the Primary AI sequences from (design
     * rule 5: a fixed number of gateway reads, never a per-step fan-out).
     */
    async function readPlan() {
        const composed = await devRead<Composed>(`darwin://pipeline/${pipelineId}`);
        expect(composed, 'the composed read must return a payload').toBeTruthy();

        // A truncation marker is appended AS AN ELEMENT of the truncated list
        // (services/common.py's truncate_to_budget), never as a top-level key —
        // so checking `composed._truncated` would be a guard that can never
        // fire, while a marker object sitting in `steps` would reach
        // buildPipelineModel as a row with `id: undefined`. Check where it can
        // actually appear.
        for (const [name, rows] of Object.entries({
            steps: composed.steps,
            step_requirements: composed.step_requirements,
            step_deps: composed.step_deps,
            requirements: composed.requirements,
        })) {
            const marker = (rows as Array<Record<string, unknown>>)
                .find((r) => r && r._truncated !== undefined);
            expect(marker, `a truncated ${name} read is a hard stop, never a partial render`)
                .toBeUndefined();
        }
        // NOT compared against `pipeline.step_count` — the service assigns that
        // from `len(steps)` four lines before it returns, so the comparison would
        // be a value against itself.
        expect(composed.steps.every((s) => Number.isFinite(Number(s.id))),
            'every returned step must carry a usable id').toBe(true);

        const plan = orderedPlan(buildPipelineModel({
            pipeline: composed.pipeline,
            steps: composed.steps,
            stepRequirements: composed.step_requirements,
            stepDeps: composed.step_deps,
            requirements: composed.requirements,
            features: composed.features,
            epics: composed.epics,
            machines,
        }), { now: new Date() });
        return { composed, plan };
    }

    /** The engine's self-check after a mutation — the only green light is []. */
    async function expectCleanPlan() {
        const { plan } = await readPlan();
        expect(plan.violations, 'verifyOrder after the mutation').toEqual([]);
        expect(plan.cycleDetected).toBe(false);
        expect(plan.duplicateStepIds).toEqual([]);
        expect(plan.unresolvedReqIds).toEqual([]);
        return plan;
    }

    const stateOf = (plan: Awaited<ReturnType<typeof expectCleanPlan>>, id: number) =>
        plan.rows.find((r) => r.id === id)?.state;

    /** Create a throwaway requirement and remember it for teardown. */
    async function newRequirement(label: string, status: string,
                                  coordination = 'implemented'): Promise<number> {
        const row = await devTool<{ id: number }>('create_requirement', {
            title: `${REQ_PREFIX} ${label}`,
            category_fk: categoryFk,
            requirement_status: status,
            coordination_type: coordination,
            description: `Throwaway requirement for the req #3118 mutation replay (${label}).`,
        });
        expect(row.id, `create_requirement(${label}) echo`).toBeTruthy();
        createdRequirementIds.push(row.id);
        return row.id;
    }

    /**
     * Reset the throwaway plan to empty, and reclaim every requirement this spec
     * has EVER created.
     *
     * The requirement sweep is by TITLE PREFIX, not by the in-process
     * `createdRequirementIds`: a run killed between `newRequirement()` and
     * `afterAll` would otherwise orphan up to nine rows permanently. Nothing else
     * reclaims them — `sweepStaleFixtures` in pipelineFixture.ts is scoped to the
     * E2E user's sub, and these belong to the MCP daemon's identity.
     *
     * Order matters: deps, then links, then steps, then requirements — every one
     * of those FKs is ON DELETE RESTRICT.
     */
    async function wipePlan(): Promise<void> {
        const composed = await devRead<Composed>(`darwin://pipeline/${pipelineId}`);
        for (const s of composed.steps) {
            try { await devTool('set_step_deps', { step_id: s.id }); } catch { /* ignore */ }
            const links = composed.step_requirements.filter((l) => l.step_fk === s.id);
            for (const l of links) {
                try {
                    await devTool('unlink_step_requirement',
                        { step_id: s.id, requirement_id: l.requirement_fk });
                } catch { /* ignore */ }
            }
        }
        for (const s of composed.steps) {
            try { await devTool('drop_pipeline_step', { id: s.id }); } catch { /* ignore */ }
        }

        try {
            const all = await devRead<Array<{ id: number; title: string }>>('darwin://requirements');
            const mine = (Array.isArray(all) ? all : [])
                .filter((r) => String(r.title || '').startsWith(REQ_PREFIX));
            for (const r of mine) {
                try { await devTool('delete_requirement', { id: r.id }); } catch { /* ignore */ }
            }
        } catch { /* best-effort */ }
    }

    test.beforeAll(async () => {
        test.setTimeout(600_000);
        await ensureDevMcp();

        machines = await devRead<Array<Record<string, unknown>>>('darwin://machines');

        // A category is mandatory on a requirement. Resolve one rather than
        // inventing an id — there is no create_category tool, and a wrong FK
        // would fail as an opaque 1452 in the middle of the replay.
        const categories = await devRead<Array<Record<string, unknown>>>('darwin://categories');
        expect(Array.isArray(categories) && categories.length,
            'darwin_dev must expose at least one category to attach requirements to')
            .toBeTruthy();
        const preferred = categories.find(
            (c) => String(c.category_name || '') === 'Swarm Orchestration Fixture');
        categoryFk = Number((preferred || categories[0]).id);

        // Find-or-create by a FIXED title: at most one throwaway plan ever
        // exists in darwin_dev, however many times this suite runs.
        const pipelines = await devRead<Array<{ id: number; title: string }>>('darwin://pipelines');
        const existing = (Array.isArray(pipelines) ? pipelines : [])
            .find((p) => p.title === PLAN_TITLE);
        if (existing) {
            pipelineId = existing.id;
        } else {
            const created = await devTool<{ id: number; title: string }>('create_pipeline', {
                title: PLAN_TITLE,
                description: 'Throwaway plan for the req #3118 mutation-case replay. '
                    + 'Wiped at the start of every run; never a real plan.',
                pipeline_status: 'draft',
            });
            expect(created.title, 'create_pipeline echo').toBe(PLAN_TITLE);
            pipelineId = created.id;
        }
        await wipePlan();

        // ── The base plan the eight cases mutate ────────────────────────────
        req.drain = await newRequirement('drain', 'met');
        req.safety = await newRequirement('substrate safety', 'development', 'planned');

        const s1 = await devTool<StepEcho>('create_pipeline_step', {
            pipeline_fk: pipelineId,
            title: 'Drain: close every open swarm session',
            requirement_ids: [req.drain],
        });
        expect(s1.requirement_ids).toEqual([req.drain]);
        step.drain = s1.step.id;

        const s2 = await devTool<StepEcho>('create_pipeline_step', {
            pipeline_fk: pipelineId,
            title: 'Substrate safety: eliminate dual-path git access',
            requirement_ids: [req.safety],
            dep_step_ids: [step.drain],
        });
        expect(s2.deps.map((d) => d.dep_step_fk)).toEqual([step.drain]);
        step.safety = s2.step.id;

        const plan = await expectCleanPlan();
        expect(stateOf(plan, step.drain)).toBe('done');
        expect(stateOf(plan, step.safety)).toBe('running');
    });

    test.afterAll(async () => {
        test.setTimeout(600_000);
        try {
            await wipePlan();
            for (const id of createdRequirementIds) {
                try { await devTool('delete_requirement', { id }); } catch { /* best-effort */ }
            }
            // There is no delete_pipeline tool — the row itself survives by
            // design. Park it as `aborted` so it can never be mistaken for live
            // work, and reuse it next run.
            await devTool('update_pipeline', { id: pipelineId, pipeline_status: 'aborted' });
        } finally {
            await stopDevMcp();
        }
    });

    // ── CASE 1 ──────────────────────────────────────────────────────────────

    test('MUT-01: insert a step mid-pipeline and re-gate around it', async () => {
        // The real case: #3078 was filed and inserted as the opener of a stage
        // that was already planned, and everything downstream re-gated onto it.
        req.bounded = await newRequirement('bounded list reads', 'met');

        const inserted = await devTool<StepEcho>('create_pipeline_step', {
            pipeline_fk: pipelineId,
            title: 'INSERTED mid-pipeline: bound every MCP list read under the 6 MB ceiling',
            requirement_ids: [req.bounded],
            dep_step_ids: [step.drain],
        });
        expect(inserted.step.title).toContain('INSERTED mid-pipeline');
        expect(inserted.requirement_ids).toEqual([req.bounded]);
        expect(inserted.deps.map((d) => d.dep_step_fk)).toEqual([step.drain]);
        step.inserted = inserted.step.id;

        // The insertion is only half of it — the step it displaces must re-gate
        // onto it, and set_step_deps REPLACES rather than merges.
        const regated = await devTool<StepEcho>('set_step_deps', {
            step_id: step.safety, dep_step_ids: [step.inserted],
        });
        expect(regated.deps.map((d) => d.dep_step_fk)).toEqual([step.inserted]);

        const plan = await expectCleanPlan();
        const at = (id: number) => plan.rows.findIndex((r) => r.id === id);
        expect(at(step.drain)).toBeLessThan(at(step.inserted));
        expect(at(step.inserted)).toBeLessThan(at(step.safety));
        expect(stateOf(plan, step.inserted)).toBe('done');
    });

    // ── CASE 2 ──────────────────────────────────────────────────────────────

    test('MUT-02: wontfix a linked requirement, fold its scope, leave no residue',
        async () => {
            // The real case: #3041 was dispositioned wontfix and its live scope
            // folded into #3072 (W7) and #3077 (C1/C2).
            req.wontfixed = await newRequirement('dual-path audit', 'approved');
            const folded = await devTool<StepEcho>('create_pipeline_step', {
                pipeline_fk: pipelineId,
                title: 'Dual-path git audit (later folded elsewhere)',
                requirement_ids: [req.wontfixed],
                dep_step_ids: [step.inserted],
            });
            step.folded = folded.step.id;

            let plan = await expectCleanPlan();
            expect(stateOf(plan, step.folded), 'approved → the step is Scheduled')
                .toBe('pending');

            // (a) the disposition itself — wontfix is TERMINAL, so the step derives done.
            const wontfixEcho = await devTool<{ requirement_status: string }>(
                'update_requirement', { id: req.wontfixed, requirement_status: 'wontfix' });
            expect(wontfixEcho.requirement_status).toBe('wontfix');

            plan = await expectCleanPlan();
            expect(stateOf(plan, step.folded), 'wontfix is terminal → Complete').toBe('done');

            // (b) the fold — the note lands in the RECEIVING requirement, which is
            // where the surviving scope actually went. Read it back; an
            // update_requirement that silently no-ops is invisible otherwise.
            const foldNote = `FOLDED from requirement ${req.wontfixed} (dispositioned wontfix): `
                + 'the live scope moves here — clean gate + origin fingerprint.';
            await devTool('update_requirement', {
                id: req.safety,
                description: `Throwaway requirement for the req #3118 mutation replay `
                    + `(substrate safety).\n\n${foldNote}`,
            });
            const receiver = await devRead<{ description: string }>(
                `darwin://requirements/${req.safety}`);
            expect(receiver.description).toContain(foldNote);
            expect(receiver.description).toContain(String(req.wontfixed));

            // (c) NO RESIDUE — the folded step leaves the plan entirely, and
            // nothing is left pointing at it. Its dependent re-gates FIRST:
            // dep_step_fk is ON DELETE RESTRICT, and the point of the drop guard
            // is that you find that out before anything is deleted.
            await devTool('unlink_step_requirement',
                { step_id: step.folded, requirement_id: req.wontfixed });
            // The real echo shape (services/pipelines.py drop_pipeline_step):
            // {deleted, id, pipeline_fk, title, requirement_links_removed,
            //  dep_rows_removed}. Asserted field by field — a whole-payload
            // substring match would also be satisfied by `pipeline_fk`.
            const dropped = await devTool<{
                deleted: boolean; id: number; pipeline_fk: number;
                requirement_links_removed: number; dep_rows_removed: number;
            }>('drop_pipeline_step', { id: step.folded });
            expect(dropped.deleted).toBe(true);
            expect(dropped.id).toBe(step.folded);
            expect(dropped.pipeline_fk).toBe(pipelineId);
            expect(dropped.requirement_links_removed, 'already unlinked above').toBe(0);
            expect(dropped.dep_rows_removed, 'its one gate on the inserted step').toBe(1);

            const { composed } = await readPlan();
            expect(composed.steps.map((s) => s.id)).not.toContain(step.folded);
            expect(composed.step_requirements.some((l) => l.step_fk === step.folded)).toBe(false);
            expect(composed.step_deps.some(
                (d) => d.step_fk === step.folded || d.dep_step_fk === step.folded)).toBe(false);
            await expectCleanPlan();
        });

    // ── CASE 3 ──────────────────────────────────────────────────────────────

    test('MUT-03: flip coordination type with an autonomy-grant note', async () => {
        // The real case: #3075 was flipped planned → deployed mid-flight, with the
        // grant of autonomy recorded on the requirement.
        const grant = 'AUTONOMY GRANT 2026-07-25: user flipped planned → deployed; '
            + 'the worker may deploy and merge without a plan-approval stop.';
        const echo = await devTool<{ coordination_type: string; description: string }>(
            'update_requirement', {
                id: req.safety,
                coordination_type: 'deployed',
                description: `Throwaway requirement for the req #3118 mutation replay `
                    + `(substrate safety).\n\n${grant}`,
            });
        expect(echo.coordination_type, 'the flip, from the echo').toBe('deployed');
        expect(echo.description).toContain('AUTONOMY GRANT');

        // Coordination is NOT a state input: the step must be exactly as running
        // as it was, and the order must be untouched.
        const plan = await expectCleanPlan();
        expect(stateOf(plan, step.safety)).toBe('running');
        const linked = plan.rows.find((r) => r.id === step.safety)!;
        expect(linked.reqIds).toContain(req.safety);
    });

    // ── CASE 4 ──────────────────────────────────────────────────────────────

    test('MUT-04: re-scope a step after filing — notes REPLACE, never append',
        async () => {
            // The real case: the B5 step was split after it was written, with
            // B5b (the Primary relocation) deferred past the end of the plan.
            const firstNotes = 'RE-SCOPED 2026-07-25: B5a only.';
            const first = await devTool<StepEcho>('update_pipeline_step', {
                id: step.safety,
                title: 'Substrate safety: B5a flag flip only (B5b DEFERRED post-pipeline)',
                notes: firstNotes,
            });
            expect(first.step.title).toContain('B5b DEFERRED post-pipeline');
            expect(first.step.notes).toBe(firstNotes);

            // REPLACE semantics, stated in the tool's own contract and asserted
            // here because an appending implementation would still look correct
            // on the first write and only corrupt the second.
            const secondNotes = 'RE-SCOPED AGAIN 2026-07-26: B5b moves to its own requirement; '
                + 'this step carries the flag flip and nothing else.';
            const second = await devTool<StepEcho>('update_pipeline_step', {
                id: step.safety, notes: secondNotes,
            });
            expect(second.step.notes).toBe(secondNotes);
            expect(second.step.notes).not.toContain(firstNotes);
            expect(second.step.title, 'an unset field is left alone')
                .toContain('B5b DEFERRED post-pipeline');

            const plan = await expectCleanPlan();
            expect(plan.rows.find((r) => r.id === step.safety)!.notes).toBe(secondNotes);
        });

    // ── CASE 5 ──────────────────────────────────────────────────────────────

    test('MUT-05: a gate passed WITH EXCEPTIONS, dispositioned into the step notes',
        async () => {
            // The real case: the skill harness gate read 3709/3713 — four
            // pre-existing failures, dispositioned into #3061's scope rather than
            // fixed. The gate passed; the exceptions had to stay recorded.
            //
            // The gated WORK closes first, and that ordering is not decoration.
            // A gate stamped complete while its dependency is still running is a
            // genuine plan-data anomaly — state banding and topology become
            // jointly unsatisfiable and verifyOrder says so, exactly as it
            // should. This spec is replaying legitimate mutations, so it must not
            // manufacture that state; PIPE-12 covers the loud-failure path.
            const closed = await devTool<{ requirement_status: string }>(
                'update_requirement', { id: req.safety, requirement_status: 'met' });
            expect(closed.requirement_status).toBe('met');
            expect(stateOf(await expectCleanPlan(), step.safety),
                'the gated work is Complete before its gate runs').toBe('done');

            const gate = await devTool<StepEcho>('create_pipeline_step', {
                pipeline_fk: pipelineId,
                title: 'Gate: full skill-harness run before the substrate cutover',
                dep_step_ids: [step.safety],
            });
            step.gate = gate.step.id;
            expect(gate.requirement_ids, 'a gate step links no requirements').toEqual([]);

            const disposition = 'GATE PASSED WITH EXCEPTIONS: 3709/3713. Four pre-existing '
                + 'failures dispositioned into requirement 3061 scope, not fixed here.';
            const completed = await devTool<StepEcho>('complete_pipeline_step', {
                id: step.gate, notes: disposition,
            });
            expect(completed.step.notes).toBe(disposition);
            expect(completed.step.completed_at,
                'a req-less step is the ONLY place completed_at means anything').toBeTruthy();

            const plan = await expectCleanPlan();
            expect(stateOf(plan, step.gate)).toBe('done');
            expect(plan.rows.find((r) => r.id === step.gate)!.notes).toContain('WITH EXCEPTIONS');

            // The rule is guarded from BOTH sides: a stamped step must refuse a
            // requirement link, or the same illegal row walks in the other door.
            const refusal = await devToolExpectError('link_step_requirement',
                { step_id: step.gate, requirement_id: req.drain });
            expect(refusal.toLowerCase()).toContain('complet');
        });

    // ── CASE 6 ──────────────────────────────────────────────────────────────

    test('MUT-06: a dual-condition gate flips eligible only when BOTH conditions hold',
        async () => {
            // The real case: s0.4 waited on requirement #3050's session completing
            // AND on a two-hour wall clock — two independent wait mechanisms on
            // one step, which is two dep ROWS in this schema.
            req.dual = await newRequirement('dual-gated work', 'approved');
            const blocker = await devTool<StepEcho>('create_pipeline_step', {
                pipeline_fk: pipelineId, title: 'Blocking gate for the dual-condition case',
                dep_step_ids: [step.gate],
            });
            step.blocker = blocker.step.id;

            const dual = await devTool<StepEcho>('create_pipeline_step', {
                pipeline_fk: pipelineId,
                title: 'Dual-gated: waits on a step AND on a wall clock',
                requirement_ids: [req.dual],
                dep_step_ids: [step.blocker],
                dep_times: [PAST_GATE],
            });
            step.dual = dual.step.id;
            expect(dual.deps).toHaveLength(2);
            expect(dual.deps.filter((d) => d.dep_step_fk != null)).toHaveLength(1);
            expect(dual.deps.filter((d) => d.time_at != null)).toHaveLength(1);

            // (a) time gate passed, step gate NOT met → not eligible. The step's
            // own state is asserted first at every stage: `eligibility()` returns
            // false for ANY non-pending row, so "not eligible" is only evidence
            // about the gate while the step is genuinely still pending.
            let plan = await expectCleanPlan();
            expect(stateOf(plan, step.dual)).toBe('pending');
            expect(stateOf(plan, step.blocker)).toBe('pending');
            expect(plan.eligibleStepIds.has(step.dual),
                'a passed clock cannot carry an unmet step gate').toBe(false);

            // (b) step gate met, time gate in the FUTURE → still not eligible.
            await devTool('complete_pipeline_step', { id: step.blocker });
            const future = await devTool<StepEcho>('set_step_deps', {
                step_id: step.dual, dep_step_ids: [step.blocker], dep_times: [FUTURE_GATE],
            });
            expect(future.deps, 'still a dual-condition gate').toHaveLength(2);
            plan = await expectCleanPlan();
            expect(stateOf(plan, step.dual),
                'the step must still be pending — otherwise "not eligible" proves nothing')
                .toBe('pending');
            expect(stateOf(plan, step.blocker)).toBe('done');
            expect(plan.eligibleStepIds.has(step.dual),
                'a met step gate cannot carry an unreached clock').toBe(false);

            // (c) BOTH satisfied → eligible. Only now.
            const both = await devTool<StepEcho>('set_step_deps', {
                step_id: step.dual, dep_step_ids: [step.blocker], dep_times: [PAST_GATE],
            });
            expect(both.deps).toHaveLength(2);
            plan = await expectCleanPlan();
            expect(plan.eligibleStepIds.has(step.dual),
                'both conditions satisfied → eligible').toBe(true);
        });

    // ── CASE 7 ──────────────────────────────────────────────────────────────

    test('MUT-07: two requirements on one step derive Running, then Scheduled, then Complete',
        async () => {
            // The real case: s0.5 closed #3063 and #3068 in ONE session — one
            // step, two requirements, and its state is a function of both.
            req.pairA = await newRequirement('paired work A', 'development');
            req.pairB = await newRequirement('paired work B', 'approved');

            const paired = await devTool<StepEcho>('create_pipeline_step', {
                pipeline_fk: pipelineId,
                title: 'TWO REQUIREMENTS, ONE SWARM-START: both close in one session',
                requirement_ids: [req.pairA, req.pairB],
                dep_step_ids: [step.gate],
            });
            step.paired = paired.step.id;
            expect(paired.requirement_ids).toEqual([req.pairA, req.pairB]);

            // ANY requirement in development → Running.
            let plan = await expectCleanPlan();
            expect(stateOf(plan, step.paired)).toBe('running');

            // The development one closes, the other is still open → NOT done and
            // no longer running. The honest middle state, and the one a stored
            // status field would have been hand-set through.
            await devTool('update_requirement', { id: req.pairA, requirement_status: 'met' });
            plan = await expectCleanPlan();
            expect(stateOf(plan, step.paired)).toBe('pending');

            // ALL terminal → Complete. `deferred` counts, exactly like `met`.
            await devTool('update_requirement', { id: req.pairB, requirement_status: 'deferred' });
            plan = await expectCleanPlan();
            expect(stateOf(plan, step.paired)).toBe('done');
            expect(plan.rows.find((r) => r.id === step.paired)!.reqIds)
                .toEqual([req.pairA, req.pairB]);
        });

    // ── CASE 8 ──────────────────────────────────────────────────────────────

    test('MUT-08: dropping a step is refused while gated on, then leaves no residue',
        async () => {
            // The real case: items were pulled out of the plan entirely and had to
            // leave nothing behind (#3065 / #3074). Design rule 4 is the other
            // half: a step another step references cannot be deleted, and the
            // refusal must name the gate BEFORE anything is deleted.
            req.dropped = await newRequirement('droppable work', 'approved');
            const doomed = await devTool<StepEcho>('create_pipeline_step', {
                pipeline_fk: pipelineId, title: 'Droppable step (abort point)',
                requirement_ids: [req.dropped], dep_step_ids: [step.gate],
            });
            step.doomed = doomed.step.id;

            const dependent = await devTool<StepEcho>('create_pipeline_step', {
                pipeline_fk: pipelineId, title: 'Gated on the droppable step',
                dep_step_ids: [step.doomed],
            });
            step.dependent = dependent.step.id;

            // REFUSED, and the message names the step that gates on it.
            const refusal = await devToolExpectError('drop_pipeline_step', { id: step.doomed });
            expect(refusal).toContain(String(step.dependent));

            // Nothing was deleted on the way to that refusal.
            let { composed } = await readPlan();
            expect(composed.steps.map((s) => s.id)).toContain(step.doomed);
            expect(composed.step_requirements.some(
                (l) => l.step_fk === step.doomed && l.requirement_fk === req.dropped)).toBe(true);
            await expectCleanPlan();

            // Clear the reference, then drop for real.
            await devTool('drop_pipeline_step', { id: step.dependent });
            await devTool('unlink_step_requirement',
                { step_id: step.doomed, requirement_id: req.dropped });
            await devTool('drop_pipeline_step', { id: step.doomed });

            // NO RESIDUE: no step row, no link row, no dep row on either side.
            ({ composed } = await readPlan());
            expect(composed.steps.map((s) => s.id)).not.toContain(step.doomed);
            expect(composed.steps.map((s) => s.id)).not.toContain(step.dependent);
            expect(composed.step_requirements.some((l) => l.step_fk === step.doomed)).toBe(false);
            expect(composed.step_deps.some(
                (d) => d.step_fk === step.doomed || d.dep_step_fk === step.doomed)).toBe(false);

            // And the surviving plan is still invariant-clean — a drop that left
            // a dangling dep would surface here, loudly, rather than as a blank row.
            const plan = await expectCleanPlan();
            expect(plan.rows.length).toBe(composed.steps.length);
        });
});
