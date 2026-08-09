import { test, expect } from '@playwright/test';

import {
    devRead, devTool, devToolExpectError, ensureDevMcp, stopDevMcp,
} from '../helpers/darwinDevMcp';

// Pipeline 2.0 — the MUTATION-CASE REPLAY, PORTED (req #3377 ports req #3118's
// `pipeline-mutations.spec.ts`, which stands BESIDE this file, byte-identical,
// throughout the parallel era — memory/pipeline-2-first-principles.md §10).
//
// ── What this replays ───────────────────────────────────────────────────────
// memory/pipeline-2-verification.md §7: the acceptance battery already exists
// and this is PORT AND EXTEND, not invent — a second battery beside the 1.0 one
// would be the duplication this whole programme exists to remove. This spec
// executes twelve canonical mutation classes through the SHIPPED 2.0 MCP tools
// — via `scripts/mcp/darwin-tool.sh`, the always-via-wrapper path (req #2365)
// — against a dedicated throwaway plan in darwin_dev, and after EACH one
// asserts three things:
//
//   1. THE ECHO. Every pipeline2 tool returns the full affected state read
//      back from the database (req #3348 / #2828 discipline) — `{step, epic,
//      requirement_ids, deps}` for a step mutation. `devTool` throws on the
//      `{error: ...}` shape refusals answer with, so an unverified call cannot
//      pass for a successful one.
//   2. THE DERIVED STATE. Step state is computed from the linked requirements
//      and is never stored (design rule 1), so the assertion is always about
//      what the SERVER derives (`darwin://pipeline2/{id}`'s own `derived`
//      block — remediation B moved the join-and-derive step into Lambda-Rest,
//      req #3367, so there is no client-side model to build here the way 1.0's
//      `pipelineViewModel.js` is built; the composed read's `derived` object
//      IS the answer).
//   3. A CLEAN ORDER. `derived.violations` must be empty, re-derived over a
//      fresh single read after every edit — design rule 3's self-check.
//
// ── No browser ──────────────────────────────────────────────────────────────
// Deliberately, exactly as 1.0's spec: these are MCP-layer mutations and their
// consequences for the server-side derivation. It lives in the Playwright
// suite because that is the standard invocation the requirement names.
//
// ── Isolation ───────────────────────────────────────────────────────────────
// TWO throwaway plans, each found-or-created by a fixed title, each
// hard-deleted via `delete_pipeline2` (MCP-032/033) in `afterAll`. The second
// plan exists ONLY because MUT-09's cross-PLAN refusal needs a foreign plan to
// cross INTO — a boundary that cannot be demonstrated with one plan. The
// find-or-wipe path in `beforeAll` is the recovery case for a run killed
// before `afterAll` could run.
//
// ── The twelve classes ──────────────────────────────────────────────────────
// MUT-01..08 port UNCHANGED (memory/pipeline-2-verification.md §7), except
// MUT-06, which is RE-EXPRESSED — see its own comment. MUT-09..12 are new: the
// four classes containment creates.
//
// ── The absent thirteenth class ─────────────────────────────────────────────
// THERE IS NO BATCH CASE, AND ITS ABSENCE IS THE ASSERTION (req #3377 item 3).
// 1.0's battery has no batch case either — a batch was always an ENGINE-side
// launch-grouping decision, never a plan mutation the MCP tools express. In
// 2.0 there is additionally no BATCH DATA to construct: `derived` carries no
// `batches` key (DRV-021), `launch_batches`/`_batch_letter`/`_launch_key` and
// the batch-contiguity display rule are deleted, and `BATCH-SPANS-SCOPE`
// (DRV-022) is structurally impossible once a step sits in exactly one epic.
// A step is the whole launch unit now (memory/pipeline-2-first-principles.md
// §8: "one step, N requirements, one announcement"). There is no tool call
// that assembles several steps into one launch to replay, and no field on the
// composed read a test could assert is empty that would prove more than
// `derived`'s own key set already does — so this comment is the proof rather
// than a test with nothing to call.

const PLAN_TITLE = 'e2e-3377 mutation replay (throwaway)';
const PLAN2_TITLE = 'e2e-3377 mutation replay — cross-plan probe (throwaway)';
const REQ_PREFIX = 'e2e-3377-mutation';
// Wall-clock gates, fixed so eligibility is deterministic against a real
// clock. The future one is 2037, not 2099: a step's `not_before` is stored as
// a MySQL TIMESTAMP (1970-01-01..2038-01-19) and `update_pipeline2_step`/
// `create_pipeline2_step` REFUSE anything outside that range, because RDS's
// non-strict sql_mode would otherwise store the zero date — a gate that reads
// as already satisfied.
const PAST_GATE = '2020-01-01T00:00:00Z';
const FUTURE_GATE = '2037-01-01T00:00:00Z';

type Step2 = {
    id: number; title: string; run: string; notes: string | null;
    not_before: string | null; completed_at: string | null; epic_fk: number;
};
type Epic2 = {
    id: number; title: string; description: string | null; epic_status: string;
    sort_order: number | null; category_fk: number; closed: number; pipeline_fk: number;
};
type StepEcho2 = {
    step: Step2; epic: Epic2; requirement_ids: number[];
    deps: Array<{ id: number; step_fk: number; dep_step_fk: number }>;
};
type DerivedRow2 = {
    id: number; state: string; run: string; eligible: boolean; epic_id: number;
    dep_ids: number[]; req_ids: number[]; tracking_req_ids: number[];
    unresolved_req_ids: number[]; launch_req_ids: number[]; launch_excluded: string[];
    launch_block: string; swarm_start_command: string | null;
    no_launch_reason: string | null; launch_suppressed: boolean; suppressed_by: string[];
};
type Composed2 = {
    pipeline: Record<string, unknown>;
    epics: Epic2[];
    steps: Step2[];
    step_requirements: Array<{ step_fk: number; requirement_fk: number }>;
    step_deps: Array<{ step_fk: number; dep_step_fk: number }>;
    requirements: Array<Record<string, unknown>>;
    // Present ONLY when the read was truncated — 2.0 hoists this marker to
    // the TOP LEVEL (mcp-surface record §4.5), unlike 1.0, which appends it
    // as an element inside the truncated list itself.
    _truncated?: unknown;
    derived: {
        epic_order: number[]; display_order: number[]; rows: DerivedRow2[];
        eligible_step_ids: number[]; violations: unknown[]; cycle_detected: boolean;
        cycle_step_ids: number[]; duplicate_step_ids: number[];
        unresolved_req_ids: number[]; out_of_scope_dep_ids: number[];
    };
};

test.describe.configure({ mode: 'serial' });

test.describe('Pipeline 2.0 — 12-case mutation replay via MCP (req #3377)', () => {
    let pipelineId: number;
    let pipeline2Id: number;
    let categoryFk: number;

    const epic: Record<string, number> = {};
    const step: Record<string, number> = {};
    const req: Record<string, number> = {};
    const createdRequirementIds: number[] = [];

    /**
     * Re-read a whole plan in ONE call — the same `darwin://pipeline2/{id}`
     * payload the Primary AI sequences from (mcp-surface record §3: a fixed
     * number of gateway reads, never a per-step fan-out — six, behind ONE
     * Lambda-Rest round trip since req #3367).
     */
    async function readPlan2(id: number): Promise<Composed2> {
        const composed = await devRead<Composed2>(`darwin://pipeline2/${id}`);
        expect(composed, 'the composed read must return a payload').toBeTruthy();

        // A truncation marker is a TOP-LEVEL key on a 2.0 composed read
        // (mcp-surface record §4.5: "`_truncated` at the top level, carrying
        // returned / total / omitted and a hint") — NOT an element appended
        // inside a truncated list the way 1.0's equivalent marker is. A
        // per-list check here would be a guard that can never fire.
        expect(composed._truncated, 'a truncated read is a hard stop, never a partial render')
            .toBeUndefined();
        expect(composed.derived, 'the composed read must carry a derived block').toBeTruthy();
        expect(composed.steps.every((s) => Number.isFinite(Number(s.id))),
            'every returned step must carry a usable id').toBe(true);
        return composed;
    }

    /** The server's self-check after a mutation — the only green light is []. */
    async function expectCleanPlan(id: number = pipelineId): Promise<Composed2> {
        const composed = await readPlan2(id);
        expect(composed.derived.violations, 'clean order after the mutation').toEqual([]);
        expect(composed.derived.cycle_detected).toBe(false);
        expect(composed.derived.duplicate_step_ids).toEqual([]);
        expect(composed.derived.unresolved_req_ids).toEqual([]);
        return composed;
    }

    const rowOf = (composed: Composed2, id: number) =>
        composed.derived.rows.find((r) => r.id === id);

    /** Create a throwaway requirement and remember it for teardown. */
    async function newRequirement(label: string, status: string,
                                  coordination = 'implemented'): Promise<number> {
        const row = await devTool<{ id: number }>('create_requirement', {
            title: `${REQ_PREFIX} ${label}`,
            category_fk: categoryFk,
            requirement_status: status,
            coordination_type: coordination,
            description: `Throwaway requirement for the req #3377 mutation replay (${label}).`,
        });
        expect(row.id, `create_requirement(${label}) echo`).toBeTruthy();
        createdRequirementIds.push(row.id);
        return row.id;
    }

    /**
     * Reset a throwaway plan to empty: clear every step's own deps, unlink its
     * requirements, drop the step, then delete the (now-childless) epics.
     * Order matters, exactly as 1.0's `wipePlan` — every FK below is ON DELETE
     * RESTRICT.
     */
    async function wipePlan2(id: number): Promise<void> {
        const composed = await devRead<Composed2>(`darwin://pipeline2/${id}`);
        for (const s of composed.steps) {
            try { await devTool('set_pipeline2_step_deps', { step_id: s.id }); } catch { /* ignore */ }
            const links = composed.step_requirements.filter((l) => l.step_fk === s.id);
            for (const l of links) {
                try {
                    await devTool('unlink_pipeline2_step_requirement',
                        { step_id: s.id, requirement_id: l.requirement_fk });
                } catch { /* ignore */ }
            }
        }
        for (const s of composed.steps) {
            try { await devTool('drop_pipeline2_step', { id: s.id }); } catch { /* ignore */ }
        }
        for (const e of composed.epics) {
            try { await devTool('delete_pipeline2_epic', { id: e.id }); } catch { /* ignore */ }
        }
    }

    test.beforeAll(async () => {
        test.setTimeout(600_000);
        await ensureDevMcp();

        // A category is mandatory on both a requirement and an epic. Resolve
        // one rather than inventing an id, exactly as 1.0's spec.
        const categories = await devRead<Array<Record<string, unknown>>>('darwin://categories');
        expect(Array.isArray(categories) && categories.length,
            'darwin_dev must expose at least one category to attach requirements to')
            .toBeTruthy();
        const preferred = categories.find(
            (c) => String(c.category_name || '') === 'Swarm Orchestration Fixture');
        categoryFk = Number((preferred || categories[0]).id);

        // Find-or-create BOTH throwaway plans by a FIXED title: at most one of
        // each ever exists in darwin_dev, however many times this suite runs.
        const pipelines = await devRead<Array<
            { id: number; title: string; pipeline_status: string }>>('darwin://pipeline2');
        const list = Array.isArray(pipelines) ? pipelines : [];

        const existing = list.find((p) => p.title === PLAN_TITLE);
        if (existing) {
            pipelineId = existing.id;
            // A run interrupted mid-flight could have left the plan off
            // `draft` (nothing in this suite changes `pipeline_status`
            // today, but `delete_pipeline2` REFUSES anything else, and an
            // adopted plan stuck non-draft would orphan itself permanently).
            if (existing.pipeline_status !== 'draft') {
                await devTool('update_pipeline2', { id: pipelineId, pipeline_status: 'draft' });
            }
        } else {
            const created = await devTool<{ id: number; title: string }>('create_pipeline2', {
                title: PLAN_TITLE,
                description: 'Throwaway plan for the req #3377 mutation-case replay. '
                    + 'Wiped at the start of every run; never a real plan.',
                pipeline_status: 'draft',
            });
            expect(created.title, 'create_pipeline2 echo').toBe(PLAN_TITLE);
            pipelineId = created.id;
        }
        await wipePlan2(pipelineId);

        const existing2 = list.find((p) => p.title === PLAN2_TITLE);
        if (existing2) {
            pipeline2Id = existing2.id;
            if (existing2.pipeline_status !== 'draft') {
                await devTool('update_pipeline2', { id: pipeline2Id, pipeline_status: 'draft' });
            }
        } else {
            const created2 = await devTool<{ id: number; title: string }>('create_pipeline2', {
                title: PLAN2_TITLE,
                description: 'Throwaway SECOND plan for the req #3377 cross-plan re-parent '
                    + 'refusal (MUT-09) — a re-parent needs a foreign plan to cross INTO. '
                    + 'Wiped at the start of every run and hard-deleted in afterAll; never a '
                    + 'real plan.',
                pipeline_status: 'draft',
            });
            expect(created2.title, 'create_pipeline2 (second plan) echo').toBe(PLAN2_TITLE);
            pipeline2Id = created2.id;
        }
        await wipePlan2(pipeline2Id);

        // Reclaim every requirement this spec has EVER created, by TITLE
        // PREFIX rather than by an in-process id list — a run killed mid-flight
        // would otherwise orphan rows permanently, exactly as 1.0's spec.
        try {
            const all = await devRead<Array<{ id: number; title: string }>>('darwin://requirements');
            const mine = (Array.isArray(all) ? all : [])
                .filter((r) => String(r.title || '').startsWith(REQ_PREFIX));
            for (const r of mine) {
                try { await devTool('delete_requirement', { id: r.id }); } catch { /* ignore */ }
            }
        } catch { /* best-effort */ }

        // ── The base epic + steps the twelve cases mutate ───────────────────
        const foundation = await devTool<Epic2>('create_pipeline2_epic', {
            pipeline_fk: pipelineId, title: 'Foundation', category_fk: categoryFk,
        });
        epic.foundation = foundation.id;

        req.drain = await newRequirement('drain', 'met');
        req.safety = await newRequirement('substrate safety', 'development', 'planned');

        const s1 = await devTool<StepEcho2>('create_pipeline2_step', {
            epic_fk: epic.foundation,
            title: 'Drain: close every open swarm session',
            requirement_ids: [req.drain],
        });
        expect(s1.requirement_ids).toEqual([req.drain]);
        step.drain = s1.step.id;

        const s2 = await devTool<StepEcho2>('create_pipeline2_step', {
            epic_fk: epic.foundation,
            title: 'Substrate safety: eliminate dual-path git access',
            requirement_ids: [req.safety],
            dep_step_ids: [step.drain],
        });
        expect(s2.deps.map((d) => d.dep_step_fk)).toEqual([step.drain]);
        step.safety = s2.step.id;

        const composed = await expectCleanPlan();
        expect(rowOf(composed, step.drain)?.state).toBe('done');
        expect(rowOf(composed, step.safety)?.state).toBe('running');
    });

    test.afterAll(async () => {
        test.setTimeout(600_000);
        try {
            // `delete_pipeline2` (MCP-032/033) hard-deletes a plan in one call
            // — no `wipePlan2()` first. Both plans still carry whatever
            // steps/links/deps the last mutation case left wired, so this IS
            // the acceptance case for the two-phase delete path: it must
            // succeed on a plan with internal step-to-step dependencies rather
            // than surfacing a raw 1451. Neither plan ever leaves `draft`
            // anywhere in this suite, so the delete is legal on both.
            try {
                const deleted = await devTool<{ deleted: boolean; id: number }>(
                    'delete_pipeline2', { id: pipelineId });
                expect(deleted.deleted, 'delete_pipeline2 echo').toBe(true);
                expect(deleted.id).toBe(pipelineId);
            } finally {
                try {
                    const deleted2 = await devTool<{ deleted: boolean; id: number }>(
                        'delete_pipeline2', { id: pipeline2Id });
                    expect(deleted2.deleted, 'delete_pipeline2 (second plan) echo').toBe(true);
                    expect(deleted2.id).toBe(pipeline2Id);
                } finally {
                    // The requirement sweep must run regardless of the deletes
                    // above, but a delete FAILURE must still fail this test —
                    // deliberately not wrapped in its own try/catch, exactly as
                    // 1.0's spec.
                    for (const id of createdRequirementIds) {
                        try { await devTool('delete_requirement', { id }); } catch { /* best-effort */ }
                    }
                }
            }
        } finally {
            await stopDevMcp();
        }
    });

    // ── CASE 1 — unchanged from 1.0 ─────────────────────────────────────────

    test('MUT-01: insert a step mid-plan and re-gate around it', async () => {
        // COVERS: MCP-016, MCP-023, DRV-009
        req.bounded = await newRequirement('bounded list reads', 'met');

        const inserted = await devTool<StepEcho2>('create_pipeline2_step', {
            epic_fk: epic.foundation,
            title: 'INSERTED mid-plan: bound every MCP list read under the 6 MB ceiling',
            requirement_ids: [req.bounded],
            dep_step_ids: [step.drain],
        });
        expect(inserted.step.title).toContain('INSERTED mid-plan');
        expect(inserted.requirement_ids).toEqual([req.bounded]);
        expect(inserted.deps.map((d) => d.dep_step_fk)).toEqual([step.drain]);
        step.inserted = inserted.step.id;

        // The insertion is only half of it — the step it displaces must
        // re-gate onto it, and set_pipeline2_step_deps REPLACES rather than
        // merges (MCP-023).
        const regated = await devTool<StepEcho2>('set_pipeline2_step_deps', {
            step_id: step.safety, dep_step_ids: [step.inserted],
        });
        expect(regated.deps.map((d) => d.dep_step_fk)).toEqual([step.inserted]);

        const composed = await expectCleanPlan();
        // `indexOf` returns -1 for a MISSING id, and -1 is "less than" every
        // real position — so a step silently dropped from `display_order`
        // would still pass a bare `toBeLessThan`. Assert presence first.
        for (const id of [step.drain, step.inserted, step.safety]) {
            expect(composed.derived.display_order, `step ${id} must appear in display order`)
                .toContain(id);
        }
        const at = (id: number) => composed.derived.display_order.indexOf(id);
        expect(at(step.drain)).toBeLessThan(at(step.inserted));
        expect(at(step.inserted)).toBeLessThan(at(step.safety));
        expect(rowOf(composed, step.inserted)?.state).toBe('done');
    });

    // ── CASE 2 — unchanged from 1.0 ─────────────────────────────────────────

    test('MUT-02: wontfix a linked requirement, fold its scope, leave no residue',
        async () => {
            // COVERS: DRV-009
            req.wontfixed = await newRequirement('dual-path audit', 'approved');
            const folded = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.foundation,
                title: 'Dual-path git audit (later folded elsewhere)',
                requirement_ids: [req.wontfixed],
                dep_step_ids: [step.inserted],
            });
            step.folded = folded.step.id;

            let composed = await expectCleanPlan();
            expect(rowOf(composed, step.folded)?.state, 'approved → the step is Scheduled')
                .toBe('pending');

            // (a) the disposition itself — wontfix is TERMINAL, so the step
            // derives done.
            const wontfixEcho = await devTool<{ requirement_status: string }>(
                'update_requirement', { id: req.wontfixed, requirement_status: 'wontfix' });
            expect(wontfixEcho.requirement_status).toBe('wontfix');

            composed = await expectCleanPlan();
            expect(rowOf(composed, step.folded)?.state, 'wontfix is terminal → Complete')
                .toBe('done');

            // (b) the fold — the note lands in the RECEIVING requirement.
            const foldNote = `FOLDED from requirement ${req.wontfixed} (dispositioned wontfix): `
                + 'the live scope moves here — clean gate + origin fingerprint.';
            await devTool('update_requirement', {
                id: req.safety,
                description: `Throwaway requirement for the req #3377 mutation replay `
                    + `(substrate safety).\n\n${foldNote}`,
            });
            const receiver = await devRead<{ description: string }>(
                `darwin://requirements/${req.safety}`);
            expect(receiver.description).toContain(foldNote);
            expect(receiver.description).toContain(String(req.wontfixed));

            // (c) NO RESIDUE — the folded step leaves the plan entirely. Its
            // dependent re-gates FIRST: `dep_step_fk` is ON DELETE RESTRICT.
            await devTool('unlink_pipeline2_step_requirement',
                { step_id: step.folded, requirement_id: req.wontfixed });
            const dropped = await devTool<{
                deleted: boolean; id: number; epic_fk: number;
                requirement_links_removed: number; dep_rows_removed: number;
            }>('drop_pipeline2_step', { id: step.folded });
            expect(dropped.deleted).toBe(true);
            expect(dropped.id).toBe(step.folded);
            expect(dropped.epic_fk).toBe(epic.foundation);
            expect(dropped.requirement_links_removed, 'already unlinked above').toBe(0);
            expect(dropped.dep_rows_removed, 'its one gate on the inserted step').toBe(1);

            const composed2 = await readPlan2(pipelineId);
            expect(composed2.steps.map((s) => s.id)).not.toContain(step.folded);
            expect(composed2.step_requirements.some((l) => l.step_fk === step.folded)).toBe(false);
            expect(composed2.step_deps.some(
                (d) => d.step_fk === step.folded || d.dep_step_fk === step.folded)).toBe(false);
            await expectCleanPlan();
        });

    // ── CASE 3 — unchanged from 1.0 ─────────────────────────────────────────

    test('MUT-03: flip coordination type with an autonomy-grant note', async () => {
        // COVERS: DRV-009
        const grant = 'AUTONOMY GRANT 2026-08-09: user flipped planned → deployed; '
            + 'the worker may deploy and merge without a plan-approval stop.';
        const echo = await devTool<{ coordination_type: string; description: string }>(
            'update_requirement', {
                id: req.safety,
                coordination_type: 'deployed',
                description: `Throwaway requirement for the req #3377 mutation replay `
                    + `(substrate safety).\n\n${grant}`,
            });
        expect(echo.coordination_type, 'the flip, from the echo').toBe('deployed');
        expect(echo.description).toContain('AUTONOMY GRANT');

        // Coordination is NOT a state input: the step must be exactly as
        // running as it was, and the order must be untouched.
        const composed = await expectCleanPlan();
        expect(rowOf(composed, step.safety)?.state).toBe('running');
        expect(rowOf(composed, step.safety)?.req_ids).toContain(req.safety);
    });

    // ── CASE 4 — unchanged from 1.0 ─────────────────────────────────────────

    test('MUT-04: re-scope a step after filing — notes REPLACE, never append',
        async () => {
            // COVERS: MCP-019
            const firstNotes = 'RE-SCOPED 2026-08-09: B5a only.';
            const first = await devTool<StepEcho2>('update_pipeline2_step', {
                id: step.safety,
                title: 'Substrate safety: B5a flag flip only (B5b DEFERRED post-pipeline)',
                notes: firstNotes,
            });
            expect(first.step.title).toContain('B5b DEFERRED post-pipeline');
            expect(first.step.notes).toBe(firstNotes);

            // REPLACE semantics, stated in the tool's own contract and
            // asserted here because an appending implementation would still
            // look correct on the first write and only corrupt the second.
            const secondNotes = 'RE-SCOPED AGAIN 2026-08-09: B5b moves to its own requirement; '
                + 'this step carries the flag flip and nothing else.';
            const second = await devTool<StepEcho2>('update_pipeline2_step', {
                id: step.safety, notes: secondNotes,
            });
            expect(second.step.notes).toBe(secondNotes);
            expect(second.step.notes).not.toContain(firstNotes);
            expect(second.step.title, 'an unset field is left alone')
                .toContain('B5b DEFERRED post-pipeline');

            const composed = await expectCleanPlan();
            expect(composed.steps.find((s) => s.id === step.safety)?.notes).toBe(secondNotes);
        });

    // ── CASE 5 — unchanged from 1.0 ─────────────────────────────────────────

    test('MUT-05: a gate passed WITH EXCEPTIONS, dispositioned into the step notes',
        async () => {
            // COVERS: MCP-021, DRV-011
            const closed = await devTool<{ requirement_status: string }>(
                'update_requirement', { id: req.safety, requirement_status: 'met' });
            expect(closed.requirement_status).toBe('met');
            expect(rowOf(await expectCleanPlan(), step.safety)?.state,
                'the gated work is Complete before its gate runs').toBe('done');

            const gate = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.foundation,
                title: 'Gate: full skill-harness run before the substrate cutover',
                dep_step_ids: [step.safety],
            });
            step.gate = gate.step.id;
            expect(gate.requirement_ids, 'a gate step links no requirements').toEqual([]);

            const disposition = 'GATE PASSED WITH EXCEPTIONS: 3709/3713. Four pre-existing '
                + 'failures dispositioned into requirement 3061 scope, not fixed here.';
            const completed = await devTool<StepEcho2>('complete_pipeline2_step', {
                id: step.gate, notes: disposition,
            });
            expect(completed.step.notes).toBe(disposition);
            expect(completed.step.completed_at,
                'a req-less step is the ONLY place completed_at means anything').toBeTruthy();

            const composed = await expectCleanPlan();
            expect(rowOf(composed, step.gate)?.state).toBe('done');
            expect(composed.steps.find((s) => s.id === step.gate)?.notes)
                .toContain('WITH EXCEPTIONS');

            // The rule is guarded from BOTH sides: a stamped step must refuse
            // a requirement link, or the same illegal row walks in the other
            // door. A FRESH, unlinked requirement — reusing req.drain would
            // hit the one-step-per-requirement refusal first (it is already
            // linked to step.drain), which is a different guard (DRV-023)
            // than the one this assertion targets.
            req.gateRefusalProbe = await newRequirement('gate refusal probe', 'approved');
            const refusal = await devToolExpectError('link_pipeline2_step_requirement',
                { step_id: step.gate, requirement_id: req.gateRefusalProbe });
            expect(refusal.toLowerCase()).toContain('complet');
        });

    // ── CASE 6 — RE-EXPRESSED (req #3377 item 1) ────────────────────────────

    test('MUT-06: a dual-condition gate flips eligible only when BOTH conditions hold',
        async () => {
            // COVERS: DRV-004, DRV-005
            //
            // RE-EXPRESSED FROM 1.0. 1.0's schema keeps one condition per dep
            // row, so a step waiting on a step AND on a wall clock carried TWO
            // dep rows (one `dep_step_fk`, one `time_at`). 2.0 moves the time
            // gate OFF the dep table entirely and onto the step itself as
            // `not_before` — a column, not a row (mcp-surface record §5.2:
            // "dep_times leaves the tool entirely"; first-principles record
            // §4 item 3: several time gates on one step was never a real
            // capability, because the latest instant always wins). So the
            // SAME real-world case — s0.4 waiting on a session AND a two-hour
            // wall clock — is now expressed as ONE dep row (the step
            // dependency) plus ONE column (the step's own `not_before`),
            // never two dep rows.
            //
            // Each stage below isolates ONE condition at a time — exactly
            // 1.0's shape (stage (a) starts with the CLOCK already satisfied,
            // stage (b) flips only the clock) — so that "not eligible" is
            // evidence about a SPECIFIC condition rather than about both at
            // once, which would prove nothing about dependency gating at all.
            req.dual = await newRequirement('dual-gated work', 'approved');
            const blocker = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.foundation, title: 'Blocking gate for the dual-condition case',
                dep_step_ids: [step.gate],
            });
            step.blocker = blocker.step.id;

            const dual = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.foundation,
                title: 'Dual-gated: waits on a step AND on a wall clock',
                requirement_ids: [req.dual],
                dep_step_ids: [step.blocker],
                not_before: PAST_GATE,
            });
            step.dual = dual.step.id;
            expect(dual.deps, 'one dep ROW now — the time gate left the table').toHaveLength(1);
            expect(dual.deps.map((d) => d.dep_step_fk)).toEqual([step.blocker]);
            expect(dual.step.not_before).toContain('2020');

            // (a) time gate ALREADY passed, step gate NOT met → not eligible.
            // Isolates the STEP DEPENDENCY: a passed clock cannot carry an
            // unmet step gate.
            let composed = await expectCleanPlan();
            expect(rowOf(composed, step.dual)?.state).toBe('pending');
            expect(rowOf(composed, step.blocker)?.state).toBe('pending');
            expect(rowOf(composed, step.dual)?.eligible,
                'a passed clock cannot carry an unmet step gate').toBe(false);

            // (b) step gate met, time gate now moved to the FUTURE → still
            // not eligible. Isolates the CLOCK: a met step gate cannot carry
            // an unreached clock. The step's own state is asserted first at
            // every stage: eligibility is only evidence about the gate while
            // the step is genuinely still pending.
            await devTool('complete_pipeline2_step', { id: step.blocker });
            const future = await devTool<StepEcho2>('update_pipeline2_step', {
                id: step.dual, not_before: FUTURE_GATE,
            });
            expect(future.step.not_before).toContain('2037');
            composed = await expectCleanPlan();
            expect(rowOf(composed, step.dual)?.state,
                'the step must still be pending — otherwise "not eligible" proves nothing')
                .toBe('pending');
            expect(rowOf(composed, step.blocker)?.state).toBe('done');
            expect(rowOf(composed, step.dual)?.eligible,
                'a met step gate cannot carry an unreached clock').toBe(false);

            // (c) BOTH satisfied → eligible. Only now.
            const both = await devTool<StepEcho2>('update_pipeline2_step', {
                id: step.dual, not_before: PAST_GATE,
            });
            expect(both.step.not_before).toContain('2020');
            composed = await expectCleanPlan();
            expect(rowOf(composed, step.dual)?.eligible,
                'both conditions satisfied → eligible').toBe(true);
        });

    // ── CASE 7 — unchanged from 1.0, but no longer the interesting case ────

    test('MUT-07: two requirements on one step derive Running, then Scheduled, then Complete',
        async () => {
            // COVERS: DRV-009
            //
            // In 1.0 this was the interesting case. Under containment it is
            // the ORDINARY one — multi-requirement is the first choice at any
            // width, since a step is the whole launch unit now (2.0's `run` /
            // launch-unit doctrine, first-principles record §6/§8) — kept
            // here unchanged and widened only in spirit: the assertions below
            // are identical to 1.0's.
            req.pairA = await newRequirement('paired work A', 'development');
            req.pairB = await newRequirement('paired work B', 'approved');

            const paired = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.foundation,
                title: 'TWO REQUIREMENTS, ONE SWARM-START: both close in one session',
                requirement_ids: [req.pairA, req.pairB],
                dep_step_ids: [step.gate],
            });
            step.paired = paired.step.id;
            expect(paired.requirement_ids).toEqual([req.pairA, req.pairB]);

            // ANY requirement in development → Running.
            let composed = await expectCleanPlan();
            expect(rowOf(composed, step.paired)?.state).toBe('running');

            // The development one closes, the other is still open → NOT done
            // and no longer running.
            await devTool('update_requirement', { id: req.pairA, requirement_status: 'met' });
            composed = await expectCleanPlan();
            expect(rowOf(composed, step.paired)?.state).toBe('pending');

            // ALL terminal → Complete. `deferred` counts, exactly like `met`.
            await devTool('update_requirement', { id: req.pairB, requirement_status: 'deferred' });
            composed = await expectCleanPlan();
            expect(rowOf(composed, step.paired)?.state).toBe('done');
            expect(rowOf(composed, step.paired)?.req_ids).toEqual([req.pairA, req.pairB]);
        });

    // ── CASE 8 — unchanged from 1.0 ─────────────────────────────────────────

    test('MUT-08: dropping a step is refused while gated on, then leaves no residue', async () => {
        // COVERS: MCP-022
        req.dropped = await newRequirement('droppable work', 'approved');
        const doomed = await devTool<StepEcho2>('create_pipeline2_step', {
            epic_fk: epic.foundation, title: 'Droppable step (abort point)',
            requirement_ids: [req.dropped], dep_step_ids: [step.gate],
        });
        step.doomed = doomed.step.id;

        const dependent = await devTool<StepEcho2>('create_pipeline2_step', {
            epic_fk: epic.foundation, title: 'Gated on the droppable step',
            dep_step_ids: [step.doomed],
        });
        step.dependent = dependent.step.id;

        // REFUSED, and the message names the step that gates on it. The
        // blockers are rendered as a Python list (`[443]`), so anchor on the
        // bracketed form rather than a bare digit substring — ids are
        // sequential in darwin_dev and a bare digit can appear inside another
        // id.
        const refusal = await devToolExpectError('drop_pipeline2_step', { id: step.doomed });
        expect(refusal).toContain(`[${step.dependent}]`);

        // Nothing was deleted on the way to that refusal.
        let composed = await readPlan2(pipelineId);
        expect(composed.steps.map((s) => s.id)).toContain(step.doomed);
        expect(composed.step_requirements.some(
            (l) => l.step_fk === step.doomed && l.requirement_fk === req.dropped)).toBe(true);
        await expectCleanPlan();

        // Clear the reference, then drop for real.
        await devTool('drop_pipeline2_step', { id: step.dependent });
        await devTool('unlink_pipeline2_step_requirement',
            { step_id: step.doomed, requirement_id: req.dropped });
        await devTool('drop_pipeline2_step', { id: step.doomed });

        // NO RESIDUE: no step row, no link row, no dep row on either side.
        composed = await readPlan2(pipelineId);
        expect(composed.steps.map((s) => s.id)).not.toContain(step.doomed);
        expect(composed.steps.map((s) => s.id)).not.toContain(step.dependent);
        expect(composed.step_requirements.some((l) => l.step_fk === step.doomed)).toBe(false);
        expect(composed.step_deps.some(
            (d) => d.step_fk === step.doomed || d.dep_step_fk === step.doomed)).toBe(false);

        // And the surviving plan is still invariant-clean.
        const clean = await expectCleanPlan();
        expect(clean.derived.rows.length).toBe(clean.steps.length);
    });

    // ── CASE 9 — NEW: containment's re-parent ───────────────────────────────

    test('MUT-09: re-parent a step across epics — legal within a plan, refused across plans',
        async () => {
            // COVERS: MCP-029, MCP-030, MCP-031, MCP-046
            //
            // Gate ruling 2026-08-08 (req #3336 §9, mcp-surface record's GATE
            // DELTA): a re-parent KEEPS its edges — cross-epic dependency
            // edges are legal, so an ordinary cross-epic move needs no
            // refusal, no pause, and no two-call dance. What is STILL
            // refused, naming every crossing edge in BOTH directions, is a
            // move that would cross a PLAN.
            epic.reparentSource = (await devTool<Epic2>('create_pipeline2_epic', {
                pipeline_fk: pipelineId, title: 'Reparent source', category_fk: categoryFk,
            })).id;
            epic.reparentTarget = (await devTool<Epic2>('create_pipeline2_epic', {
                pipeline_fk: pipelineId, title: 'Reparent target', category_fk: categoryFk,
            })).id;

            const base = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.reparentSource, title: 'Reparent base (stays put)',
            });
            step.reparentBase = base.step.id;

            const mover = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.reparentSource, title: 'Reparent mover',
                dep_step_ids: [step.reparentBase],
            });
            step.reparentMover = mover.step.id;

            const watcher = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.reparentSource, title: 'Reparent watcher (gated on the mover)',
                dep_step_ids: [step.reparentMover],
            });
            step.reparentWatcher = watcher.step.id;

            // Complete the base FIRST — the mover depends on it, and stamping
            // the mover done while its own dependency is still pending would
            // manufacture the exact plan-data anomaly MUT-05's comment warns
            // against replaying (a done step pinned behind a pending one it
            // depends on). This spec replays legitimate mutations only.
            await devTool('complete_pipeline2_step', { id: step.reparentBase });

            // The mover carries a notes disposition and a completion stamp —
            // both must ride along free (MCP-031), since a move is one
            // `epic_fk` write and both are ordinary columns on the row.
            const disposition = 'Req-less step, completed before the move on purpose: '
                + 'proves the stamp rides along.';
            await devTool('complete_pipeline2_step', { id: step.reparentMover, notes: disposition });

            // (a) LEGAL: cross-epic, same plan. No refusal, no pause.
            const moved = await devTool<StepEcho2>('move_pipeline2_step', {
                step_id: step.reparentMover, epic_fk: epic.reparentTarget,
            });
            expect(moved.step.epic_fk, 'landed in its new epic').toBe(epic.reparentTarget);
            expect(moved.epic.id, 'the echo\'s epic row agrees').toBe(epic.reparentTarget);
            expect(moved.step.notes, 'notes ride along free').toBe(disposition);
            expect(moved.step.completed_at, 'the completion stamp rides along free').toBeTruthy();
            expect(moved.deps.map((d) => d.dep_step_fk),
                'its own edge (to the base) survives the move UNCHANGED')
                .toEqual([step.reparentBase]);

            let composed = await expectCleanPlan();
            expect(composed.steps.find((s) => s.id === step.reparentMover)?.epic_fk)
                .toBe(epic.reparentTarget);
            expect(composed.step_deps.some(
                (d) => d.step_fk === step.reparentWatcher && d.dep_step_fk === step.reparentMover),
                'the watcher\'s cross-epic edge onto the (now-moved) mover survives too').toBe(true);

            // (b) REFUSED: crossing a PLAN. Move the SAME step again, this
            // time into an epic that belongs to the SECOND throwaway plan —
            // both the mover's own outgoing edge (to base, staying in plan 1)
            // and the watcher's incoming edge (onto the mover) would cross,
            // and the refusal must name BOTH, in both directions.
            epic.foreign = (await devTool<Epic2>('create_pipeline2_epic', {
                pipeline_fk: pipeline2Id, title: 'Foreign target', category_fk: categoryFk,
            })).id;

            const refusal = await devToolExpectError('move_pipeline2_step',
                { step_id: step.reparentMover, epic_fk: epic.foreign });
            expect(refusal, 'the mover\'s own OUTGOING edge, named')
                .toContain(`${step.reparentMover} -> ${step.reparentBase}`);
            expect(refusal, 'the watcher\'s INCOMING edge onto the mover, named the other way')
                .toContain(`${step.reparentWatcher} -> ${step.reparentMover}`);
            expect(refusal, 'the safe order is printed IN the refusal itself')
                .toContain('/pipeline-pause');
            expect(refusal).toContain('/pipeline-unpause');
            expect(refusal.toLowerCase()).toContain('safe order');

            // Nothing moved on the way to that refusal.
            composed = await expectCleanPlan();
            expect(composed.steps.find((s) => s.id === step.reparentMover)?.epic_fk)
                .toBe(epic.reparentTarget);
        });

    // ── CASE 10 — NEW: containment's epic lifecycle ─────────────────────────

    test('MUT-10: create and delete an epic, refused while a surviving step is gated from outside',
        async () => {
            // COVERS: MCP-034, MCP-047
            const created = await devTool<Epic2>('create_pipeline2_epic', {
                pipeline_fk: pipelineId, title: 'Temporary epic (abort point)',
                category_fk: categoryFk,
            });
            epic.temporary = created.id;
            expect(created.pipeline_fk).toBe(pipelineId);

            let composed = await readPlan2(pipelineId);
            expect(composed.epics.map((e) => e.id)).toContain(epic.temporary);
            expect(composed.derived.epic_order).toContain(epic.temporary);

            const inner = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.temporary, title: 'Inside the temporary epic',
            });
            step.temporaryInner = inner.step.id;

            // An OUTSIDE step gates on it — cross-epic edges are legal, so
            // this is a REAL refusal (design rule 4, applied one level up),
            // not one containment makes impossible.
            const outer = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.foundation, title: 'Outside, gated on the temporary epic',
                dep_step_ids: [step.temporaryInner],
            });
            step.temporaryOuter = outer.step.id;

            const refusal = await devToolExpectError(
                'delete_pipeline2_epic', { id: epic.temporary });
            // Anchor on the bracketed list form the service renders blockers
            // as, not a bare digit substring — see MUT-08's identical note.
            expect(refusal).toContain(`[${step.temporaryOuter}]`);

            // Nothing was deleted on the way to that refusal.
            composed = await readPlan2(pipelineId);
            expect(composed.epics.map((e) => e.id)).toContain(epic.temporary);
            expect(composed.steps.map((s) => s.id)).toContain(step.temporaryInner);
            await expectCleanPlan();

            // Clear the outside gate — then the delete succeeds and leaves no
            // residue.
            await devTool('set_pipeline2_step_deps', { step_id: step.temporaryOuter });
            const deleted = await devTool<{
                deleted: boolean; id: number; step_count: number;
                requirement_links_removed: number; dep_rows_removed: number;
            }>('delete_pipeline2_epic', { id: epic.temporary });
            expect(deleted.deleted).toBe(true);
            expect(deleted.id).toBe(epic.temporary);
            expect(deleted.step_count).toBe(1);
            expect(deleted.dep_rows_removed, 'the inner step carried no dep rows of its own')
                .toBe(0);

            composed = await readPlan2(pipelineId);
            expect(composed.epics.map((e) => e.id)).not.toContain(epic.temporary);
            expect(composed.steps.map((s) => s.id)).not.toContain(step.temporaryInner);
            await expectCleanPlan();

            // Tidy the now req-less, dep-less outer step out of the plan too
            // — it was scaffolding for this case only.
            await devTool('drop_pipeline2_step', { id: step.temporaryOuter });
            await expectCleanPlan();
        });

    // ── CASE 11 — NEW: containment's cross-epic sequencing mechanism ───────

    test('MUT-11: re-order epics — display order moves with sort_order', async () => {
        // COVERS: MCP-048
        //
        // Epic order is the DEFAULT cross-epic sequencing mechanism now
        // (schema record §5.4 / SCH-008, gate ruling 2026-08-08 — NOT the
        // ONLY one, since a cross-epic dependency edge is legal too, but it
        // is the one this case exercises), and display order is a tree walk
        // over it (DRV-007): epic order first, then the dependency graph
        // within each epic.
        epic.reorderA = (await devTool<Epic2>('create_pipeline2_epic', {
            pipeline_fk: pipelineId, title: 'Reorder A', category_fk: categoryFk,
        })).id;
        epic.reorderB = (await devTool<Epic2>('create_pipeline2_epic', {
            pipeline_fk: pipelineId, title: 'Reorder B', category_fk: categoryFk,
        })).id;

        const stepA = await devTool<StepEcho2>('create_pipeline2_step', {
            epic_fk: epic.reorderA, title: 'Lives in Reorder A',
        });
        step.reorderA = stepA.step.id;
        const stepB = await devTool<StepEcho2>('create_pipeline2_step', {
            epic_fk: epic.reorderB, title: 'Lives in Reorder B',
        });
        step.reorderB = stepB.step.id;

        let composed = await readPlan2(pipelineId);
        // `indexOf` returns -1 for a MISSING id, and -1 sorts before every
        // real position — so an epic/step silently dropped from the derived
        // order would still pass a bare `toBeLessThan`. Assert presence
        // first, exactly as MUT-01 does.
        for (const id of [epic.reorderA, epic.reorderB]) {
            expect(composed.derived.epic_order, `epic ${id} must appear in epic order`)
                .toContain(id);
        }
        for (const id of [step.reorderA, step.reorderB]) {
            expect(composed.derived.display_order, `step ${id} must appear in display order`)
                .toContain(id);
        }
        expect(composed.derived.epic_order.indexOf(epic.reorderA),
            'A was created before B, so with no sort_order A orders first by default')
            .toBeLessThan(composed.derived.epic_order.indexOf(epic.reorderB));
        expect(composed.derived.display_order.indexOf(step.reorderA))
            .toBeLessThan(composed.derived.display_order.indexOf(step.reorderB));

        // Give B an explicit sort_order ahead of A's — B must now lead, in
        // BOTH the epic order and the step display order the tree walk
        // derives from it. Verify the ECHO, not just the downstream effect —
        // a silently-ignored `sort_order` write would otherwise be masked by
        // the same ordering assertions this replaces.
        const echoB = await devTool<Epic2>('update_pipeline2_epic',
            { id: epic.reorderB, sort_order: 1 });
        expect(echoB.sort_order).toBe(1);
        const echoA = await devTool<Epic2>('update_pipeline2_epic',
            { id: epic.reorderA, sort_order: 2 });
        expect(echoA.sort_order).toBe(2);

        composed = await expectCleanPlan();
        for (const id of [epic.reorderA, epic.reorderB]) {
            expect(composed.derived.epic_order, `epic ${id} must still appear after reorder`)
                .toContain(id);
        }
        for (const id of [step.reorderA, step.reorderB]) {
            expect(composed.derived.display_order, `step ${id} must still appear after reorder`)
                .toContain(id);
        }
        expect(composed.derived.epic_order.indexOf(epic.reorderB), 'B now orders before A')
            .toBeLessThan(composed.derived.epic_order.indexOf(epic.reorderA));
        expect(composed.derived.display_order.indexOf(step.reorderB),
            'step display order followed the epic reorder')
            .toBeLessThan(composed.derived.display_order.indexOf(step.reorderA));
    });

    // ── CASE 12 — NEW: containment makes the edge case routine ─────────────

    test('MUT-12: widen a step by linking a requirement to it while it is ALREADY eligible',
        async () => {
            // COVERS: MCP-049
            //
            // This produces NO eligibility edge at all — `eligible` is
            // already true and stays true, a true→true transition rather
            // than the false→true one an engine polling cycle would notice.
            // That is exactly the case commanded-requirement tracking (req
            // #3195, ENG-007) exists to handle, and containment makes it the
            // ROUTINE case rather than an edge one: multi-requirement is the
            // first choice at any width (first-principles record §8;
            // verification record §7 MUT-12).
            req.widenA = await newRequirement('widen A', 'swarm_ready');
            const widenStep = await devTool<StepEcho2>('create_pipeline2_step', {
                epic_fk: epic.foundation, title: 'Widen target: already eligible on creation',
                requirement_ids: [req.widenA],
            });
            step.widen = widenStep.step.id;

            let composed = await expectCleanPlan();
            let row = rowOf(composed, step.widen)!;
            expect(row.eligible, 'no unmet deps, no time gate → already eligible').toBe(true);
            expect(row.launch_req_ids).toEqual([req.widenA]);

            req.widenB = await newRequirement('widen B', 'swarm_ready');
            const widened = await devTool<StepEcho2>('link_pipeline2_step_requirement',
                { step_id: step.widen, requirement_id: req.widenB });
            expect(widened.requirement_ids).toEqual([req.widenA, req.widenB]);

            composed = await expectCleanPlan();
            row = rowOf(composed, step.widen)!;
            expect(row.eligible, 'no false→true transition: it was already eligible').toBe(true);
            expect(row.launch_req_ids, 'the launch set widened even though eligible never edged')
                .toEqual([req.widenA, req.widenB]);
        });
});
