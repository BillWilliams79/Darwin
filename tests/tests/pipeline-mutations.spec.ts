import { test, expect } from '@playwright/test';

import {
    devRead, devTool, devToolExpectError, ensureDevMcp, stopDevMcp,
} from '../helpers/darwinDevMcp';

// The MUTATION-CASE REPLAY — the acceptance core for Swarm Orchestration
// plans (req #3377, which ported and extended the original battery of req
// #3118).
//
// ── What this replays ───────────────────────────────────────────────────────
// memory/pipeline-2-verification.md §7: the acceptance battery was PORTED AND
// EXTENDED, never re-invented — a second battery standing beside the original
// would have been exactly the duplication that programme existed to remove.
// This spec executes twelve canonical mutation classes through the shipped
// plan-layer MCP tools — via `scripts/mcp/darwin-tool.sh`, the
// always-via-wrapper path (req #2365) — against a dedicated throwaway plan in
// darwin_dev, and after EACH one asserts three things:
//
//   1. THE ECHO. Every plan tool returns the full affected state read back
//      from the database (req #3348 / #2828 discipline) — `{epic, initiative,
//      requirement_ids, deps}` for an epic mutation. `devTool` throws on the
//      `{error: ...}` shape refusals answer with, so an unverified call cannot
//      pass for a successful one.
//   2. THE DERIVED FACTS. A EPIC HAS NO STATE (req #3750, user ruling
//      2026-10-21): it holds requirements, is never completed and never
//      reopened, and every orchestration question is asked of the work it
//      holds through `derived.rows[].open_req_ids` — its gating requirements
//      not yet met/deferred/wontfix. So the assertion is always about what the
//      SERVER derives: `darwin://pipeline/{id}`'s own `derived` block
//      (`open_req_ids`, `gate_open`, `eligible`). Remediation B moved the
//      join-and-derive epic into Lambda-Rest (req #3367), so there is no
//      client-side model for this spec to build — the composed read's
//      `derived` object IS the answer.
//   3. A CLEAN ORDER. `derived.violations` must be empty, re-derived over a
//      fresh single read after every edit — design rule 3's self-check.
//
// ── No browser ──────────────────────────────────────────────────────────────
// Deliberately: these are MCP-layer mutations and their consequences for the
// server-side derivation. It lives in the Playwright suite because that is the
// standard invocation the requirement names.
//
// ── Isolation ───────────────────────────────────────────────────────────────
// TWO throwaway plans, each found-or-created by a fixed title, each
// hard-deleted via `delete_pipeline` (MCP-032/033) in `afterAll`. The second
// plan exists ONLY because MUT-09's cross-PLAN refusal needs a foreign plan to
// cross INTO — a boundary that cannot be demonstrated with one plan. The
// find-or-wipe path in `beforeAll` is the recovery case for a run killed
// before `afterAll` could run.
//
// ── The twelve classes ──────────────────────────────────────────────────────
// MUT-01..08 are the original eight (memory/pipeline-2-verification.md §7),
// except MUT-06, which is RE-EXPRESSED — see its own comment. MUT-09..12 are
// the four classes initiative containment creates. Req #3750 restated MUT-05,
// MUT-06, MUT-07 and MUT-09: there is no `complete_epic` /
// `reopen_epic` to call (MCP-020, MCP-035), no `state` on a derived
// row and no `completed_at` on an epic, so each now asserts the open work and
// the gate the server derives from the requirements an epic holds.
//
// ── This spec runs against the live MCP daemon ─────────────────────────────
// It drives darwin_dev through `scripts/mcp/darwin-tool.sh`, so it needs a
// running daemon and real credentials; it is not part of the unit suite.
//
// ── The absent thirteenth class ─────────────────────────────────────────────
// THERE IS NO BATCH CASE, AND ITS ABSENCE IS THE ASSERTION (req #3377 item 3).
// A batch was always an ENGINE-side launch-grouping decision, never a plan
// mutation the MCP tools express, and there is no BATCH DATA left to
// construct: `derived` carries no `batches` key (DRV-021),
// `launch_batches`/`_batch_letter`/`_launch_key` and the batch-contiguity
// display rule are deleted, and `BATCH-SPANS-SCOPE` (DRV-022) is structurally
// impossible once an epic sits in exactly one initiative.
// An epic is the whole launch unit (memory/pipeline-2-first-principles.md
// §8: "one epic, N requirements, one announcement"). There is no tool call
// that assembles several epics into one launch to replay, and no field on the
// composed read a test could assert is empty that would prove more than
// `derived`'s own key set already does — so this comment is the proof rather
// than a test with nothing to call.

const PLAN_TITLE = 'e2e-3377 mutation replay (throwaway)';
const FOREIGN_PLAN_TITLE = 'e2e-3377 mutation replay — cross-plan probe (throwaway)';
const REQ_PREFIX = 'e2e-3377-mutation';
// Wall-clock gates, fixed so eligibility is deterministic against a real
// clock. The future one is 2037, not 2099: an epic's `not_before` is stored as
// a MySQL TIMESTAMP (1970-01-01..2038-01-19) and `update_epic`/
// `create_epic` REFUSE anything outside that range, because RDS's
// non-strict sql_mode would otherwise store the zero date — a gate that reads
// as already satisfied.
const PAST_GATE = '2020-01-01T00:00:00Z';
const FUTURE_GATE = '2037-01-01T00:00:00Z';

// No `completed_at`: an epic has no state (req #3750), and req #3752 dropped the column.
type Epic = {
    id: number; title: string; run: string; notes: string | null;
    not_before: string | null; initiative_fk: number;
};
type Initiative = {
    id: number; title: string; description: string | null; initiative_status: string;
    sort_order: number | null; category_fk: number; closed: number; pipeline_fk: number;
};
type EpicEcho = {
    epic: Epic; initiative: Initiative; requirement_ids: number[];
    deps: Array<{ id: number; epic_fk: number; dep_epic_fk: number }>;
};
// No `state`: an epic has none (req #3750). `open_req_ids` is the one fact —
// the epic's gating requirements whose status is not terminal.
type DerivedRow = {
    id: number; run: string; eligible: boolean; initiative_id: number;
    open_req_ids: number[]; gate_open: boolean; launch_candidate: boolean;
    checkpoint: boolean; checkpoint_blocked_by: number[];
    dep_ids: number[]; req_ids: number[]; tracking_req_ids: number[];
    unresolved_req_ids: number[]; launch_req_ids: number[]; launch_excluded: string[];
    launch_block: string; swarm_start_command: string | null;
    no_launch_reason: string | null; launch_suppressed: boolean; suppressed_by: string[];
};
type Composed = {
    pipeline: Record<string, unknown>;
    initiatives: Initiative[];
    epics: Epic[];
    epic_requirements: Array<{ epic_fk: number; requirement_fk: number }>;
    epic_deps: Array<{ epic_fk: number; dep_epic_fk: number }>;
    requirements: Array<Record<string, unknown>>;
    // Present ONLY when the read was truncated. The marker is hoisted to the
    // TOP LEVEL (mcp-surface record §4.5) rather than appended as an element
    // inside the truncated list itself.
    _truncated?: unknown;
    derived: {
        initiative_order: number[]; display_order: number[]; rows: DerivedRow[];
        eligible_epic_ids: number[]; violations: unknown[]; cycle_detected: boolean;
        cycle_epic_ids: number[]; duplicate_epic_ids: number[];
        unresolved_req_ids: number[]; out_of_scope_dep_ids: number[];
    };
};

test.describe.configure({ mode: 'serial' });

test.describe('Swarm Orchestration — 12-case mutation replay via MCP (req #3377)', () => {
    let pipelineId: number;
    let foreignPlanId: number;
    let categoryFk: number;

    const initiative: Record<string, number> = {};
    const epic: Record<string, number> = {};
    const req: Record<string, number> = {};
    const createdRequirementIds: number[] = [];

    /**
     * Re-read a whole plan in ONE call — the same `darwin://pipeline/{id}`
     * payload the Primary AI sequences from (mcp-surface record §3: a fixed
     * number of gateway reads, never a per-epic fan-out — six, behind ONE
     * Lambda-Rest round trip since req #3367).
     */
    async function readPlan(id: number): Promise<Composed> {
        const composed = await devRead<Composed>(`darwin://pipeline/${id}`);
        expect(composed, 'the composed read must return a payload').toBeTruthy();

        // A truncation marker is a TOP-LEVEL key on a composed read
        // (mcp-surface record §4.5: "`_truncated` at the top level, carrying
        // returned / total / omitted and a hint") — NOT an element appended
        // inside a truncated list. A per-list check here would be a guard that
        // can never fire.
        expect(composed._truncated, 'a truncated read is a hard stop, never a partial render')
            .toBeUndefined();
        expect(composed.derived, 'the composed read must carry a derived block').toBeTruthy();
        expect(composed.epics.every((s) => Number.isFinite(Number(s.id))),
            'every returned epic must carry a usable id').toBe(true);
        return composed;
    }

    /** The server's self-check after a mutation — the only green light is []. */
    async function expectCleanPlan(id: number = pipelineId): Promise<Composed> {
        const composed = await readPlan(id);
        expect(composed.derived.violations, 'clean order after the mutation').toEqual([]);
        expect(composed.derived.cycle_detected).toBe(false);
        expect(composed.derived.duplicate_epic_ids).toEqual([]);
        expect(composed.derived.unresolved_req_ids).toEqual([]);
        return composed;
    }

    const rowOf = (composed: Composed, id: number) =>
        composed.derived.rows.find((r) => r.id === id);

    /** Create a throwaway requirement and remember it for teardown. */
    async function newRequirement(label: string, status: string,
                                  coordination = 'implemented', tracking = 0): Promise<number> {
        const row = await devTool<{ id: number }>('create_requirement', {
            title: `${REQ_PREFIX} ${label}`,
            category_fk: categoryFk,
            requirement_status: status,
            coordination_type: coordination,
            tracking,
            description: `Throwaway requirement for the req #3377 mutation replay (${label}).`,
        });
        expect(row.id, `create_requirement(${label}) echo`).toBeTruthy();
        createdRequirementIds.push(row.id);
        return row.id;
    }

    /**
     * Reset a throwaway plan to empty: clear every epic's own deps, unlink its
     * requirements, drop the epic, then delete the (now-childless) initiatives.
     * Order matters — every FK below is ON DELETE RESTRICT.
     */
    async function wipePlan(id: number): Promise<void> {
        const composed = await devRead<Composed>(`darwin://pipeline/${id}`);
        for (const s of composed.epics) {
            try { await devTool('set_epic_deps', { epic_id: s.id }); } catch { /* ignore */ }
            const links = composed.epic_requirements.filter((l) => l.epic_fk === s.id);
            for (const l of links) {
                try {
                    await devTool('unlink_epic_requirement',
                        { epic_id: s.id, requirement_id: l.requirement_fk });
                } catch { /* ignore */ }
            }
        }
        for (const s of composed.epics) {
            try { await devTool('drop_epic', { id: s.id }); } catch { /* ignore */ }
        }
        for (const e of composed.initiatives) {
            try { await devTool('delete_initiative', { id: e.id }); } catch { /* ignore */ }
        }
    }

    test.beforeAll(async () => {
        test.setTimeout(600_000);
        await ensureDevMcp();

        // A category is mandatory on both a requirement and an initiative. Resolve
        // one rather than inventing an id.
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
            { id: number; title: string; pipeline_status: string }>>('darwin://pipelines');
        const list = Array.isArray(pipelines) ? pipelines : [];

        const existing = list.find((p) => p.title === PLAN_TITLE);
        if (existing) {
            pipelineId = existing.id;
            // A run interrupted mid-flight could have left the plan off
            // `draft` (nothing in this suite changes `pipeline_status`
            // today, but `delete_pipeline` REFUSES anything else, and an
            // adopted plan stuck non-draft would orphan itself permanently).
            if (existing.pipeline_status !== 'draft') {
                await devTool('update_pipeline', { id: pipelineId, pipeline_status: 'draft' });
            }
        } else {
            const created = await devTool<{ id: number; title: string }>('create_pipeline', {
                title: PLAN_TITLE,
                description: 'Throwaway plan for the req #3377 mutation-case replay. '
                    + 'Wiped at the start of every run; never a real plan.',
                pipeline_status: 'draft',
            });
            expect(created.title, 'create_pipeline echo').toBe(PLAN_TITLE);
            pipelineId = created.id;
        }
        await wipePlan(pipelineId);

        const existing2 = list.find((p) => p.title === FOREIGN_PLAN_TITLE);
        if (existing2) {
            foreignPlanId = existing2.id;
            if (existing2.pipeline_status !== 'draft') {
                await devTool('update_pipeline', { id: foreignPlanId, pipeline_status: 'draft' });
            }
        } else {
            const created2 = await devTool<{ id: number; title: string }>('create_pipeline', {
                title: FOREIGN_PLAN_TITLE,
                description: 'Throwaway SECOND plan for the req #3377 cross-plan re-parent '
                    + 'refusal (MUT-09) — a re-parent needs a foreign plan to cross INTO. '
                    + 'Wiped at the start of every run and hard-deleted in afterAll; never a '
                    + 'real plan.',
                pipeline_status: 'draft',
            });
            expect(created2.title, 'create_pipeline (second plan) echo').toBe(FOREIGN_PLAN_TITLE);
            foreignPlanId = created2.id;
        }
        await wipePlan(foreignPlanId);

        // Reclaim every requirement this spec has EVER created, by TITLE
        // PREFIX rather than by an in-process id list — a run killed mid-flight
        // would otherwise orphan rows permanently.
        try {
            const all = await devRead<Array<{ id: number; title: string }>>('darwin://requirements');
            const mine = (Array.isArray(all) ? all : [])
                .filter((r) => String(r.title || '').startsWith(REQ_PREFIX));
            for (const r of mine) {
                try { await devTool('delete_requirement', { id: r.id }); } catch { /* ignore */ }
            }
        } catch { /* best-effort */ }

        // ── The base initiative + epics the twelve cases mutate ───────────────────
        const foundation = await devTool<Initiative>('create_initiative', {
            pipeline_fk: pipelineId, title: 'Foundation', category_fk: categoryFk,
        });
        initiative.foundation = foundation.id;

        req.drain = await newRequirement('drain', 'met');
        req.safety = await newRequirement('substrate safety', 'development', 'planned');

        const s1 = await devTool<EpicEcho>('create_epic', {
            initiative_fk: initiative.foundation,
            title: 'Drain: close every open swarm session',
            requirement_ids: [req.drain],
        });
        expect(s1.requirement_ids).toEqual([req.drain]);
        epic.drain = s1.epic.id;

        const s2 = await devTool<EpicEcho>('create_epic', {
            initiative_fk: initiative.foundation,
            title: 'Substrate safety: eliminate dual-path git access',
            requirement_ids: [req.safety],
            dep_epic_ids: [epic.drain],
        });
        expect(s2.deps.map((d) => d.dep_epic_fk)).toEqual([epic.drain]);
        epic.safety = s2.epic.id;

        const composed = await expectCleanPlan();
        expect(rowOf(composed, epic.drain)?.open_req_ids, 'met work is not open').toEqual([]);
        expect(rowOf(composed, epic.safety)?.open_req_ids, 'development work is open')
            .toEqual([req.safety]);
    });

    test.afterAll(async () => {
        test.setTimeout(600_000);
        try {
            // `delete_pipeline` (MCP-032/033) hard-deletes a plan in one call
            // — no `wipePlan()` first. Both plans still carry whatever
            // epics/links/deps the last mutation case left wired, so this IS
            // the acceptance case for the two-phase delete path: it must
            // succeed on a plan with internal epic-to-epic dependencies rather
            // than surfacing a raw 1451. Neither plan ever leaves `draft`
            // anywhere in this suite, so the delete is legal on both.
            try {
                const deleted = await devTool<{ deleted: boolean; id: number }>(
                    'delete_pipeline', { id: pipelineId });
                expect(deleted.deleted, 'delete_pipeline echo').toBe(true);
                expect(deleted.id).toBe(pipelineId);
            } finally {
                try {
                    const deleted2 = await devTool<{ deleted: boolean; id: number }>(
                        'delete_pipeline', { id: foreignPlanId });
                    expect(deleted2.deleted, 'delete_pipeline (second plan) echo').toBe(true);
                    expect(deleted2.id).toBe(foreignPlanId);
                } finally {
                    // The requirement sweep must run regardless of the deletes
                    // above, but a delete FAILURE must still fail this test —
                    // so the deletes are deliberately not wrapped in their own
                    // try/catch.
                    for (const id of createdRequirementIds) {
                        try { await devTool('delete_requirement', { id }); } catch { /* best-effort */ }
                    }
                }
            }
        } finally {
            await stopDevMcp();
        }
    });

    // ── CASE 1 — one of the original eight ──────────────────────────────────

    test('MUT-01: insert an epic mid-plan and re-gate around it', async () => {
        // COVERS: MCP-016, MCP-023, DRV-009
        req.bounded = await newRequirement('bounded list reads', 'met');

        const inserted = await devTool<EpicEcho>('create_epic', {
            initiative_fk: initiative.foundation,
            title: 'INSERTED mid-plan: bound every MCP list read under the 6 MB ceiling',
            requirement_ids: [req.bounded],
            dep_epic_ids: [epic.drain],
        });
        expect(inserted.epic.title).toContain('INSERTED mid-plan');
        expect(inserted.requirement_ids).toEqual([req.bounded]);
        expect(inserted.deps.map((d) => d.dep_epic_fk)).toEqual([epic.drain]);
        epic.inserted = inserted.epic.id;

        // The insertion is only half of it — the epic it displaces must
        // re-gate onto it, and set_epic_deps REPLACES rather than
        // merges (MCP-023).
        const regated = await devTool<EpicEcho>('set_epic_deps', {
            epic_id: epic.safety, dep_epic_ids: [epic.inserted],
        });
        expect(regated.deps.map((d) => d.dep_epic_fk)).toEqual([epic.inserted]);

        const composed = await expectCleanPlan();
        // `indexOf` returns -1 for a MISSING id, and -1 is "less than" every
        // real position — so an epic silently dropped from `display_order`
        // would still pass a bare `toBeLessThan`. Assert presence first.
        for (const id of [epic.drain, epic.inserted, epic.safety]) {
            expect(composed.derived.display_order, `epic ${id} must appear in display order`)
                .toContain(id);
        }
        const at = (id: number) => composed.derived.display_order.indexOf(id);
        expect(at(epic.drain)).toBeLessThan(at(epic.inserted));
        expect(at(epic.inserted)).toBeLessThan(at(epic.safety));
        expect(rowOf(composed, epic.inserted)?.open_req_ids).toEqual([]);
    });

    // ── CASE 2 — one of the original eight ──────────────────────────────────

    test('MUT-02: wontfix a linked requirement, fold its scope, leave no residue',
        async () => {
            // COVERS: DRV-009
            req.wontfixed = await newRequirement('dual-path audit', 'approved');
            const folded = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.foundation,
                title: 'Dual-path git audit (later folded elsewhere)',
                requirement_ids: [req.wontfixed],
                dep_epic_ids: [epic.inserted],
            });
            epic.folded = folded.epic.id;

            let composed = await expectCleanPlan();
            expect(rowOf(composed, epic.folded)?.open_req_ids, 'approved work is open')
                .toEqual([req.wontfixed]);

            // (a) the disposition itself — wontfix is TERMINAL, so the epic
            // holds no open work.
            const wontfixEcho = await devTool<{ requirement_status: string }>(
                'update_requirement', { id: req.wontfixed, requirement_status: 'wontfix' });
            expect(wontfixEcho.requirement_status).toBe('wontfix');

            composed = await expectCleanPlan();
            expect(rowOf(composed, epic.folded)?.open_req_ids, 'wontfix is terminal → not open')
                .toEqual([]);

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

            // (c) NO RESIDUE — the folded epic leaves the plan entirely. Its
            // dependent re-gates FIRST: `dep_epic_fk` is ON DELETE RESTRICT.
            await devTool('unlink_epic_requirement',
                { epic_id: epic.folded, requirement_id: req.wontfixed });
            const dropped = await devTool<{
                deleted: boolean; id: number; initiative_fk: number;
                requirement_links_removed: number; dep_rows_removed: number;
            }>('drop_epic', { id: epic.folded });
            expect(dropped.deleted).toBe(true);
            expect(dropped.id).toBe(epic.folded);
            expect(dropped.initiative_fk).toBe(initiative.foundation);
            expect(dropped.requirement_links_removed, 'already unlinked above').toBe(0);
            expect(dropped.dep_rows_removed, 'its one gate on the inserted epic').toBe(1);

            const composed2 = await readPlan(pipelineId);
            expect(composed2.epics.map((s) => s.id)).not.toContain(epic.folded);
            expect(composed2.epic_requirements.some((l) => l.epic_fk === epic.folded)).toBe(false);
            expect(composed2.epic_deps.some(
                (d) => d.epic_fk === epic.folded || d.dep_epic_fk === epic.folded)).toBe(false);
            await expectCleanPlan();
        });

    // ── CASE 3 — one of the original eight ──────────────────────────────────

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

        // Coordination is NOT an input to open work: the epic holds exactly
        // the open work it held, and the order must be untouched.
        const composed = await expectCleanPlan();
        expect(rowOf(composed, epic.safety)?.open_req_ids).toEqual([req.safety]);
        expect(rowOf(composed, epic.safety)?.req_ids).toContain(req.safety);
    });

    // ── CASE 4 — one of the original eight ──────────────────────────────────

    test('MUT-04: re-scope an epic after filing — notes REPLACE, never append',
        async () => {
            // COVERS: MCP-019
            const firstNotes = 'RE-SCOPED 2026-08-09: B5a only.';
            const first = await devTool<EpicEcho>('update_epic', {
                id: epic.safety,
                title: 'Substrate safety: B5a flag flip only (B5b DEFERRED post-pipeline)',
                notes: firstNotes,
            });
            expect(first.epic.title).toContain('B5b DEFERRED post-pipeline');
            expect(first.epic.notes).toBe(firstNotes);

            // REPLACE semantics, stated in the tool's own contract and
            // asserted here because an appending implementation would still
            // look correct on the first write and only corrupt the second.
            const secondNotes = 'RE-SCOPED AGAIN 2026-08-09: B5b moves to its own requirement; '
                + 'this epic carries the flag flip and nothing else.';
            const second = await devTool<EpicEcho>('update_epic', {
                id: epic.safety, notes: secondNotes,
            });
            expect(second.epic.notes).toBe(secondNotes);
            expect(second.epic.notes).not.toContain(firstNotes);
            expect(second.epic.title, 'an unset field is left alone')
                .toContain('B5b DEFERRED post-pipeline');

            const composed = await expectCleanPlan();
            expect(composed.epics.find((s) => s.id === epic.safety)?.notes).toBe(secondNotes);
        });

    // ── CASE 5 — one of the original eight ──────────────────────────────────

    test('MUT-05: a gate passed WITH EXCEPTIONS, dispositioned into the epic notes',
        async () => {
            // COVERS: MCP-021, DRV-011
            //
            // Req #3750 restated this case. A gate epic is a req-less HOLDER:
            // it is never completed (there is no completion tool — MCP-020), so
            // the disposition is simply its notes, and it holds no open work,
            // so it never holds its dependents (DRV-011). And because an epic
            // has no state, finished work never closes it: any requirement —
            // work or container — links onto any unlocked epic (MCP-021).
            const closed = await devTool<{ requirement_status: string }>(
                'update_requirement', { id: req.safety, requirement_status: 'met' });
            expect(closed.requirement_status).toBe('met');
            expect(rowOf(await expectCleanPlan(), epic.safety)?.open_req_ids,
                'the gated work holds nothing open before its gate runs').toEqual([]);

            const gate = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.foundation,
                title: 'Gate: full skill-harness run before the substrate cutover',
                dep_epic_ids: [epic.safety],
            });
            epic.gate = gate.epic.id;
            expect(gate.requirement_ids, 'a gate epic links no requirements').toEqual([]);

            const disposition = 'GATE PASSED WITH EXCEPTIONS: 3709/3713. Four pre-existing '
                + 'failures dispositioned into requirement 3061 scope, not fixed here.';
            const noted = await devTool<EpicEcho>('update_epic', {
                id: epic.gate, notes: disposition,
            });
            expect(noted.epic.notes).toBe(disposition);
            // req #3752 dropped the column: an epic has no completion stamp.
            expect(noted.epic).not.toHaveProperty('completed_at');

            // DRV-011 — an epic with no requirement holds no open work, so a
            // epic gated on it sees a CLEAR dependency.
            const probe = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.foundation, title: 'Probe: gated on the req-less gate',
                dep_epic_ids: [epic.gate],
            });
            let composed = await expectCleanPlan();
            expect(rowOf(composed, epic.gate)?.open_req_ids, 'a req-less epic holds no open work')
                .toEqual([]);
            expect(rowOf(composed, probe.epic.id)?.gate_open,
                'a dependency holding no open work is clear').toBe(true);
            expect(rowOf(composed, probe.epic.id)?.checkpoint_blocked_by,
                'a barrier holding no work holds nothing').toEqual([]);
            expect(rowOf(composed, epic.gate)?.launch_req_ids, '...and announces nothing')
                .toEqual([]);
            expect(rowOf(composed, epic.gate)?.launch_candidate).toBe(false);
            expect(composed.derived.eligible_epic_ids).not.toContain(epic.gate);
            expect(composed.epics.find((s) => s.id === epic.gate)?.notes)
                .toContain('WITH EXCEPTIONS');
            await devTool('drop_epic', { id: probe.epic.id });

            // MCP-021 — a WORK requirement and a CONTAINER both link onto the
            // gate, an epic whose dependencies are all finished. No stamp
            // guard exists to refuse them.
            req.gateWork = await newRequirement('gate link probe (work)', 'approved');
            const linkedWork = await devTool<EpicEcho>('link_epic_requirement',
                { epic_id: epic.gate, requirement_id: req.gateWork });
            expect(linkedWork.requirement_ids).toEqual([req.gateWork]);

            req.gateContainer = await newRequirement(
                'gate link probe (container)', 'development', 'implemented', 1);
            const linkedContainer = await devTool<EpicEcho>('link_epic_requirement',
                { epic_id: epic.gate, requirement_id: req.gateContainer });
            expect(linkedContainer.requirement_ids).toEqual([req.gateWork, req.gateContainer]);

            composed = await expectCleanPlan();
            expect(rowOf(composed, epic.gate)?.open_req_ids,
                'the linked work is open; the container is subtracted (DRV-009)')
                .toEqual([req.gateWork]);
            expect(rowOf(composed, epic.gate)?.tracking_req_ids).toEqual([req.gateContainer]);

            // Put the gate back to a req-less holder — later cases gate on it.
            for (const rid of [req.gateWork, req.gateContainer]) {
                await devTool('unlink_epic_requirement', { epic_id: epic.gate, requirement_id: rid });
            }
            composed = await expectCleanPlan();
            expect(rowOf(composed, epic.gate)?.req_ids).toEqual([]);
            expect(rowOf(composed, epic.gate)?.open_req_ids).toEqual([]);
        });

    // ── CASE 6 — RE-EXPRESSED (req #3377 item 1) ────────────────────────────

    test('MUT-06: a dual-condition gate flips eligible only when BOTH conditions hold',
        async () => {
            // COVERS: DRV-004, DRV-005
            //
            // RE-EXPRESSED. The original schema kept one condition per dep
            // row, so an epic waiting on an epic AND on a wall clock carried TWO
            // dep rows (one `dep_epic_fk`, one `time_at`). The time gate now
            // lives OFF the dep table entirely, on the epic itself as
            // `not_before` — a column, not a row (mcp-surface record §5.2:
            // "dep_times leaves the tool entirely"; first-principles record
            // §4 item 3: several time gates on one epic was never a real
            // capability, because the latest instant always wins). So the
            // SAME real-world case — s0.4 waiting on a session AND a two-hour
            // wall clock — is expressed as ONE dep row (the epic dependency)
            // plus ONE column (the epic's own `not_before`), never two dep
            // rows.
            //
            // Each stage below isolates ONE condition at a time (stage (a)
            // starts with the CLOCK already satisfied, stage (b) flips only
            // the clock) — so that "not eligible" is evidence about a SPECIFIC
            // condition rather than about both at once, which would prove
            // nothing about dependency gating at all.
            //
            // Req #3750: a dependency is CLEAR when that epic holds no open
            // work, so the blocker holds a requirement of its own (a req-less
            // epic never gates — MUT-05), and the epic gate is met by closing
            // that requirement rather than by completing the epic. The dual
            // epic's own work is `swarm_ready`, because `eligible` now means
            // "carries launch-ready work AND its gate is open" — an epic with
            // nothing launchable is never eligible, which would make the
            // "not eligible" stages below prove nothing.
            req.dual = await newRequirement('dual-gated work', 'swarm_ready');
            req.blockerWork = await newRequirement('blocking work', 'approved');
            const blocker = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.foundation, title: 'Blocking gate for the dual-condition case',
                requirement_ids: [req.blockerWork],
                dep_epic_ids: [epic.gate],
            });
            epic.blocker = blocker.epic.id;

            const dual = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.foundation,
                title: 'Dual-gated: waits on an epic AND on a wall clock',
                requirement_ids: [req.dual],
                dep_epic_ids: [epic.blocker],
                not_before: PAST_GATE,
            });
            epic.dual = dual.epic.id;
            expect(dual.deps, 'one dep ROW now — the time gate left the table').toHaveLength(1);
            expect(dual.deps.map((d) => d.dep_epic_fk)).toEqual([epic.blocker]);
            expect(dual.epic.not_before).toContain('2020');

            // (a) time gate ALREADY passed, epic gate NOT met → not eligible.
            // Isolates the EPIC DEPENDENCY: a passed clock cannot carry an
            // unmet epic gate.
            let composed = await expectCleanPlan();
            expect(rowOf(composed, epic.dual)?.launch_req_ids,
                'the epic carries launch-ready work — "not eligible" is about its gate')
                .toEqual([req.dual]);
            expect(rowOf(composed, epic.blocker)?.open_req_ids).toEqual([req.blockerWork]);
            expect(rowOf(composed, epic.dual)?.gate_open).toBe(false);
            expect(rowOf(composed, epic.dual)?.eligible,
                'a passed clock cannot carry an unmet epic gate').toBe(false);

            // (b) epic gate met, time gate now moved to the FUTURE → still
            // not eligible. Isolates the CLOCK: a met epic gate cannot carry
            // an unreached clock. The epic's launch-ready work is asserted at
            // every stage: eligibility is only evidence about the gate while
            // the epic genuinely has something to launch.
            const blockerClosed = await devTool<{ requirement_status: string }>(
                'update_requirement', { id: req.blockerWork, requirement_status: 'met' });
            expect(blockerClosed.requirement_status).toBe('met');
            const future = await devTool<EpicEcho>('update_epic', {
                id: epic.dual, not_before: FUTURE_GATE,
            });
            expect(future.epic.not_before).toContain('2037');
            composed = await expectCleanPlan();
            expect(rowOf(composed, epic.dual)?.launch_req_ids,
                'still launch-ready — otherwise "not eligible" proves nothing')
                .toEqual([req.dual]);
            expect(rowOf(composed, epic.blocker)?.open_req_ids, 'the epic gate is now met')
                .toEqual([]);
            expect(rowOf(composed, epic.dual)?.gate_open).toBe(false);
            expect(rowOf(composed, epic.dual)?.eligible,
                'a met epic gate cannot carry an unreached clock').toBe(false);

            // (c) BOTH satisfied → eligible. Only now.
            const both = await devTool<EpicEcho>('update_epic', {
                id: epic.dual, not_before: PAST_GATE,
            });
            expect(both.epic.not_before).toContain('2020');
            composed = await expectCleanPlan();
            expect(rowOf(composed, epic.dual)?.gate_open).toBe(true);
            expect(rowOf(composed, epic.dual)?.eligible,
                'both conditions satisfied → eligible').toBe(true);
        });

    // ── CASE 7 — one of the original eight ──────────────────────────────────

    test('MUT-07: two requirements on one epic — the open work shrinks as each closes',
        async () => {
            // COVERS: DRV-009
            //
            // This used to be the interesting case. Under initiative containment it
            // is the ORDINARY one — multi-requirement is the first choice at
            // any width, since an epic is the whole launch unit (the `run` /
            // launch-unit doctrine, first-principles record §6/§8). Req #3750
            // replaced the Running/Scheduled/Complete epic states with the
            // one fact an epic has: which of its requirements are still open.
            req.pairA = await newRequirement('paired work A', 'development');
            req.pairB = await newRequirement('paired work B', 'approved');

            const paired = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.foundation,
                title: 'TWO REQUIREMENTS, ONE SWARM-START: both close in one session',
                requirement_ids: [req.pairA, req.pairB],
                dep_epic_ids: [epic.gate],
            });
            epic.paired = paired.epic.id;
            expect(paired.requirement_ids).toEqual([req.pairA, req.pairB]);

            // Both open — `development` and `approved` are both non-terminal.
            let composed = await expectCleanPlan();
            expect(rowOf(composed, epic.paired)?.open_req_ids).toEqual([req.pairA, req.pairB]);

            // The development one closes → only the other is open.
            await devTool('update_requirement', { id: req.pairA, requirement_status: 'met' });
            composed = await expectCleanPlan();
            expect(rowOf(composed, epic.paired)?.open_req_ids).toEqual([req.pairB]);

            // ALL terminal → nothing open. `deferred` counts, exactly like `met`.
            await devTool('update_requirement', { id: req.pairB, requirement_status: 'deferred' });
            composed = await expectCleanPlan();
            expect(rowOf(composed, epic.paired)?.open_req_ids).toEqual([]);
            expect(rowOf(composed, epic.paired)?.req_ids).toEqual([req.pairA, req.pairB]);
        });

    // ── CASE 8 — one of the original eight ──────────────────────────────────

    test('MUT-08: dropping an epic is refused while gated on, then leaves no residue', async () => {
        // COVERS: MCP-022
        req.dropped = await newRequirement('droppable work', 'approved');
        const doomed = await devTool<EpicEcho>('create_epic', {
            initiative_fk: initiative.foundation, title: 'Droppable epic (abort point)',
            requirement_ids: [req.dropped], dep_epic_ids: [epic.gate],
        });
        epic.doomed = doomed.epic.id;

        const dependent = await devTool<EpicEcho>('create_epic', {
            initiative_fk: initiative.foundation, title: 'Gated on the droppable epic',
            dep_epic_ids: [epic.doomed],
        });
        epic.dependent = dependent.epic.id;

        // REFUSED, and the message names the epic that gates on it. The
        // blockers are rendered as a Python list (`[443]`), so anchor on the
        // bracketed form rather than a bare digit substring — ids are
        // sequential in darwin_dev and a bare digit can appear inside another
        // id.
        const refusal = await devToolExpectError('drop_epic', { id: epic.doomed });
        expect(refusal).toContain(`[${epic.dependent}]`);

        // Nothing was deleted on the way to that refusal.
        let composed = await readPlan(pipelineId);
        expect(composed.epics.map((s) => s.id)).toContain(epic.doomed);
        expect(composed.epic_requirements.some(
            (l) => l.epic_fk === epic.doomed && l.requirement_fk === req.dropped)).toBe(true);
        await expectCleanPlan();

        // Clear the reference, then drop for real.
        await devTool('drop_epic', { id: epic.dependent });
        await devTool('unlink_epic_requirement',
            { epic_id: epic.doomed, requirement_id: req.dropped });
        await devTool('drop_epic', { id: epic.doomed });

        // NO RESIDUE: no epic row, no link row, no dep row on either side.
        composed = await readPlan(pipelineId);
        expect(composed.epics.map((s) => s.id)).not.toContain(epic.doomed);
        expect(composed.epics.map((s) => s.id)).not.toContain(epic.dependent);
        expect(composed.epic_requirements.some((l) => l.epic_fk === epic.doomed)).toBe(false);
        expect(composed.epic_deps.some(
            (d) => d.epic_fk === epic.doomed || d.dep_epic_fk === epic.doomed)).toBe(false);

        // And the surviving plan is still invariant-clean.
        const clean = await expectCleanPlan();
        expect(clean.derived.rows.length).toBe(clean.epics.length);
    });

    // ── CASE 9 — NEW: containment's re-parent ───────────────────────────────

    test('MUT-09: re-parent an epic across initiatives — legal within a plan, refused across plans',
        async () => {
            // COVERS: MCP-029, MCP-030, MCP-031, MCP-046
            //
            // Gate ruling 2026-08-08 (req #3336 §9, mcp-surface record's GATE
            // DELTA): a re-parent KEEPS its edges — cross-initiative dependency
            // edges are legal, so an ordinary cross-initiative move needs no
            // refusal, no pause, and no two-call dance. What is STILL
            // refused, naming every crossing edge in BOTH directions, is a
            // move that would cross a PLAN.
            initiative.reparentSource = (await devTool<Initiative>('create_initiative', {
                pipeline_fk: pipelineId, title: 'Reparent source', category_fk: categoryFk,
            })).id;
            initiative.reparentTarget = (await devTool<Initiative>('create_initiative', {
                pipeline_fk: pipelineId, title: 'Reparent target', category_fk: categoryFk,
            })).id;

            const base = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.reparentSource, title: 'Reparent base (stays put)',
            });
            epic.reparentBase = base.epic.id;

            const mover = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.reparentSource, title: 'Reparent mover',
                dep_epic_ids: [epic.reparentBase],
            });
            epic.reparentMover = mover.epic.id;

            const watcher = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.reparentSource, title: 'Reparent watcher (gated on the mover)',
                dep_epic_ids: [epic.reparentMover],
            });
            epic.reparentWatcher = watcher.epic.id;

            // The mover carries a notes disposition — it must ride along free
            // (MCP-031), since a move is one `initiative_fk` write and notes is an
            // ordinary column on the row. (There is no completion stamp to
            // carry any more: an epic has no state — req #3750.)
            const disposition = 'Notes written before the move on purpose: '
                + 'proves they ride along.';
            const noted = await devTool<EpicEcho>('update_epic',
                { id: epic.reparentMover, notes: disposition });
            expect(noted.epic.notes).toBe(disposition);

            // (a) LEGAL: cross-initiative, same plan. No refusal, no pause.
            const moved = await devTool<EpicEcho>('move_epic', {
                epic_id: epic.reparentMover, initiative_fk: initiative.reparentTarget,
            });
            expect(moved.epic.initiative_fk, 'landed in its new initiative').toBe(initiative.reparentTarget);
            expect(moved.initiative.id, 'the echo\'s initiative row agrees').toBe(initiative.reparentTarget);
            expect(moved.epic.notes, 'notes ride along free').toBe(disposition);
            expect(moved.deps.map((d) => d.dep_epic_fk),
                'its own edge (to the base) survives the move UNCHANGED')
                .toEqual([epic.reparentBase]);

            let composed = await expectCleanPlan();
            expect(composed.epics.find((s) => s.id === epic.reparentMover)?.initiative_fk)
                .toBe(initiative.reparentTarget);
            expect(composed.epic_deps.some(
                (d) => d.epic_fk === epic.reparentWatcher && d.dep_epic_fk === epic.reparentMover),
                'the watcher\'s cross-initiative edge onto the (now-moved) mover survives too').toBe(true);

            // (b) REFUSED: crossing a PLAN. Move the SAME epic again, this
            // time into an initiative that belongs to the SECOND throwaway plan —
            // both the mover's own outgoing edge (to base, staying in plan 1)
            // and the watcher's incoming edge (onto the mover) would cross,
            // and the refusal must name BOTH, in both directions.
            initiative.foreign = (await devTool<Initiative>('create_initiative', {
                pipeline_fk: foreignPlanId, title: 'Foreign target', category_fk: categoryFk,
            })).id;

            const refusal = await devToolExpectError('move_epic',
                { epic_id: epic.reparentMover, initiative_fk: initiative.foreign });
            expect(refusal, 'the mover\'s own OUTGOING edge, named')
                .toContain(`${epic.reparentMover} -> ${epic.reparentBase}`);
            expect(refusal, 'the watcher\'s INCOMING edge onto the mover, named the other way')
                .toContain(`${epic.reparentWatcher} -> ${epic.reparentMover}`);
            expect(refusal, 'the safe order is printed IN the refusal itself')
                .toContain('/pipeline-pause');
            expect(refusal).toContain('/pipeline-unpause');
            expect(refusal.toLowerCase()).toContain('safe order');

            // Nothing moved on the way to that refusal.
            composed = await expectCleanPlan();
            expect(composed.epics.find((s) => s.id === epic.reparentMover)?.initiative_fk)
                .toBe(initiative.reparentTarget);
        });

    // ── CASE 10 — NEW: containment's initiative lifecycle ─────────────────────────

    test('MUT-10: create and delete an initiative, refused while a surviving epic is gated from outside',
        async () => {
            // COVERS: MCP-034, MCP-047
            const created = await devTool<Initiative>('create_initiative', {
                pipeline_fk: pipelineId, title: 'Temporary initiative (abort point)',
                category_fk: categoryFk,
            });
            initiative.temporary = created.id;
            expect(created.pipeline_fk).toBe(pipelineId);

            let composed = await readPlan(pipelineId);
            expect(composed.initiatives.map((e) => e.id)).toContain(initiative.temporary);
            expect(composed.derived.initiative_order).toContain(initiative.temporary);

            const inner = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.temporary, title: 'Inside the temporary initiative',
            });
            epic.temporaryInner = inner.epic.id;

            // An OUTSIDE epic gates on it — cross-initiative edges are legal, so
            // this is a REAL refusal (design rule 4, applied one level up),
            // not one containment makes impossible.
            const outer = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.foundation, title: 'Outside, gated on the temporary initiative',
                dep_epic_ids: [epic.temporaryInner],
            });
            epic.temporaryOuter = outer.epic.id;

            const refusal = await devToolExpectError(
                'delete_initiative', { id: initiative.temporary });
            // Anchor on the bracketed list form the service renders blockers
            // as, not a bare digit substring — see MUT-08's identical note.
            expect(refusal).toContain(`[${epic.temporaryOuter}]`);

            // Nothing was deleted on the way to that refusal.
            composed = await readPlan(pipelineId);
            expect(composed.initiatives.map((e) => e.id)).toContain(initiative.temporary);
            expect(composed.epics.map((s) => s.id)).toContain(epic.temporaryInner);
            await expectCleanPlan();

            // Clear the outside gate — then the delete succeeds and leaves no
            // residue.
            await devTool('set_epic_deps', { epic_id: epic.temporaryOuter });
            const deleted = await devTool<{
                deleted: boolean; id: number; epic_count: number;
                requirement_links_removed: number; dep_rows_removed: number;
            }>('delete_initiative', { id: initiative.temporary });
            expect(deleted.deleted).toBe(true);
            expect(deleted.id).toBe(initiative.temporary);
            expect(deleted.epic_count).toBe(1);
            expect(deleted.dep_rows_removed, 'the inner epic carried no dep rows of its own')
                .toBe(0);

            composed = await readPlan(pipelineId);
            expect(composed.initiatives.map((e) => e.id)).not.toContain(initiative.temporary);
            expect(composed.epics.map((s) => s.id)).not.toContain(epic.temporaryInner);
            await expectCleanPlan();

            // Tidy the now req-less, dep-less outer epic out of the plan too
            // — it was scaffolding for this case only.
            await devTool('drop_epic', { id: epic.temporaryOuter });
            await expectCleanPlan();
        });

    // ── CASE 11 — NEW: containment's cross-initiative sequencing mechanism ───────

    test('MUT-11: re-order initiatives — display order moves with sort_order', async () => {
        // COVERS: MCP-048
        //
        // Initiative order is the DEFAULT cross-initiative sequencing mechanism now
        // (schema record §5.4 / SCH-008, gate ruling 2026-08-08 — NOT the
        // ONLY one, since a cross-initiative dependency edge is legal too, but it
        // is the one this case exercises), and display order is a tree walk
        // over it (DRV-007): initiative order first, then the dependency graph
        // within each initiative.
        initiative.reorderA = (await devTool<Initiative>('create_initiative', {
            pipeline_fk: pipelineId, title: 'Reorder A', category_fk: categoryFk,
        })).id;
        initiative.reorderB = (await devTool<Initiative>('create_initiative', {
            pipeline_fk: pipelineId, title: 'Reorder B', category_fk: categoryFk,
        })).id;

        const epicA = await devTool<EpicEcho>('create_epic', {
            initiative_fk: initiative.reorderA, title: 'Lives in Reorder A',
        });
        epic.reorderA = epicA.epic.id;
        const epicB = await devTool<EpicEcho>('create_epic', {
            initiative_fk: initiative.reorderB, title: 'Lives in Reorder B',
        });
        epic.reorderB = epicB.epic.id;

        let composed = await readPlan(pipelineId);
        // `indexOf` returns -1 for a MISSING id, and -1 sorts before every
        // real position — so an initiative/epic silently dropped from the derived
        // order would still pass a bare `toBeLessThan`. Assert presence
        // first, exactly as MUT-01 does.
        for (const id of [initiative.reorderA, initiative.reorderB]) {
            expect(composed.derived.initiative_order, `initiative ${id} must appear in initiative order`)
                .toContain(id);
        }
        for (const id of [epic.reorderA, epic.reorderB]) {
            expect(composed.derived.display_order, `epic ${id} must appear in display order`)
                .toContain(id);
        }
        expect(composed.derived.initiative_order.indexOf(initiative.reorderA),
            'A was created before B, so with no sort_order A orders first by default')
            .toBeLessThan(composed.derived.initiative_order.indexOf(initiative.reorderB));
        expect(composed.derived.display_order.indexOf(epic.reorderA))
            .toBeLessThan(composed.derived.display_order.indexOf(epic.reorderB));

        // Give B an explicit sort_order ahead of A's — B must now lead, in
        // BOTH the initiative order and the epic display order the tree walk
        // derives from it. Verify the ECHO, not just the downstream effect —
        // a silently-ignored `sort_order` write would otherwise be masked by
        // the same ordering assertions this replaces.
        const echoB = await devTool<Initiative>('update_initiative',
            { id: initiative.reorderB, sort_order: 1 });
        expect(echoB.sort_order).toBe(1);
        const echoA = await devTool<Initiative>('update_initiative',
            { id: initiative.reorderA, sort_order: 2 });
        expect(echoA.sort_order).toBe(2);

        composed = await expectCleanPlan();
        for (const id of [initiative.reorderA, initiative.reorderB]) {
            expect(composed.derived.initiative_order, `initiative ${id} must still appear after reorder`)
                .toContain(id);
        }
        for (const id of [epic.reorderA, epic.reorderB]) {
            expect(composed.derived.display_order, `epic ${id} must still appear after reorder`)
                .toContain(id);
        }
        expect(composed.derived.initiative_order.indexOf(initiative.reorderB), 'B now orders before A')
            .toBeLessThan(composed.derived.initiative_order.indexOf(initiative.reorderA));
        expect(composed.derived.display_order.indexOf(epic.reorderB),
            'epic display order followed the initiative reorder')
            .toBeLessThan(composed.derived.display_order.indexOf(epic.reorderA));
    });

    // ── CASE 12 — NEW: containment makes the edge case routine ─────────────

    test('MUT-12: widen an epic by linking a requirement to it while it is ALREADY eligible',
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
            const widenEpic = await devTool<EpicEcho>('create_epic', {
                initiative_fk: initiative.foundation, title: 'Widen target: already eligible on creation',
                requirement_ids: [req.widenA],
            });
            epic.widen = widenEpic.epic.id;

            let composed = await expectCleanPlan();
            let row = rowOf(composed, epic.widen)!;
            expect(row.eligible, 'no unmet deps, no time gate → already eligible').toBe(true);
            expect(row.launch_req_ids).toEqual([req.widenA]);

            req.widenB = await newRequirement('widen B', 'swarm_ready');
            const widened = await devTool<EpicEcho>('link_epic_requirement',
                { epic_id: epic.widen, requirement_id: req.widenB });
            expect(widened.requirement_ids).toEqual([req.widenA, req.widenB]);

            composed = await expectCleanPlan();
            row = rowOf(composed, epic.widen)!;
            expect(row.eligible, 'no false→true transition: it was already eligible').toBe(true);
            expect(row.launch_req_ids, 'the launch set widened even though eligible never edged')
                .toEqual([req.widenA, req.widenB]);
        });
});
