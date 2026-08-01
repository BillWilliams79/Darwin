// pipelineFixture.ts — seeds the Substrate Rebuild plan into darwin_dev for the
// E2E user, so the browser suite has a real plan to render (req #3118).
//
// ── Why the suite seeds its own copy ────────────────────────────────────────
// req #3111 already seeded this exact plan into darwin_dev (pipeline 9001), and
// req #3112 already froze it as a STATIC module —
// src/SwarmView/pipelines/__tests__/substrateRebuildFixture.js — which is this
// file's source of truth. But every Darwin read is creator-scoped server-side
// (req #3050): pipeline 9001 belongs to the user's own Cognito sub, and the E2E
// user cannot see one row of it. So the browser suite re-seeds the same plan
// under its OWN identity.
//
// It seeds through Lambda-Rest, not SQL. The requirement permits direct SQL for
// fixtures (Single DB Gateway exception 2), but nothing here needs it: every
// table involved is reachable through the gateway the app itself uses, which
// also means the fixture cannot drift from what the API will actually serve.
//
// ── What must be preserved from the static fixture ──────────────────────────
// Ids are NOT preserved — they are AUTO_INCREMENT and forcing them would collide
// with req #3111's rows. Two properties are preserved instead, and both are
// load-bearing for the display-order assertion:
//
//   1. STEPS ARE INSERTED SEQUENTIALLY, in the static array's order. `pipeline_steps`
//      is read `sort=id:asc` (devopsQueries.js calls that sort load-bearing), and
//      displayOrder() uses input-array position as its deterministic FINAL
//      tie-break. Sequential inserts make id order == array order, so the seeded
//      plan's canonical stored order matches the fixture's. Parallel inserts
//      could interleave AUTO_INCREMENT and silently reshuffle the tie-break.
//   2. STEP TITLES ARE VERBATIM. They are the plan's own prose — including the
//      literal "#3077 R13" in step 22 — which the no-'#' directive deliberately
//      does NOT govern (pipelineViewModel.js § The no-'#' directive). Rewriting
//      them here would make the audit test pass by falsifying its input.
//
// Epic/feature/machine/requirement TITLES are stamped with an `e2e-` prefix so a
// crashed run leaves identifiable rows; none of them feed ordering (epic
// first-appearance order is collected from the STEP rows, not from epic ids).

import {
    EPICS,
    FEATURES,
    MACHINES,
    REQUIREMENTS,
    STEPS,
    STEP_DEPS,
    STEP_REQUIREMENTS,
} from '../../src/SwarmView/pipelines/__tests__/substrateRebuildFixture.js';
import { apiCall, uniqueName, E2E_NAME_PREFIX } from './api';

// ── Types ───────────────────────────────────────────────────────────────────

/** A row as the plan engine's PipelineModel expects it, with REAL seeded ids. */
export interface SeededModel {
    pipeline: Record<string, unknown>;
    steps: Array<Record<string, unknown>>;
    stepRequirements: Array<{ step_fk: number; requirement_fk: number }>;
    stepDeps: Array<{ step_fk: number; dep_step_fk: number | null; time_at: string | null }>;
    requirements: Array<Record<string, unknown>>;
    features: Array<Record<string, unknown>>;
    epics: Array<Record<string, unknown>>;
    machines: Array<Record<string, unknown>>;
}

export interface SeededPipelines {
    /**
     * The full 34-step Substrate Rebuild plan.
     *
     * It is ALSO the no-batch case: run the engine over it and `batches` is
     * empty, because every co-gated pending step differs in run mode or machine
     * (39/40/41/42 are a straight chain; 43 shares 41's gate but is manual; 17
     * and 18 differ in machine). Specs assert that emptiness as an explicit
     * precondition rather than assuming it, so a future fixture edit that grows a
     * batch fails loudly instead of quietly voiding the negative test.
     */
    mainPipelineId: number;
    /** A gate step plus three co-gated pending steps — exactly one launch batch. */
    batchPipelineId: number;
    /** The three requirement ids the batch's /swarm-start command must carry. */
    batchRequirementIds: number[];
    /** Two steps that depend on each other — design rule 3's loud-failure path. */
    cyclePipelineId: number;
    /** fixture step id -> seeded step id (main plan only). */
    stepIdOf: Map<number, number>;
    /** fixture requirement id -> seeded requirement id. */
    reqIdOf: Map<number, number>;
    /** fixture epic id -> seeded epic id. */
    epicIdOf: Map<number, number>;
    /**
     * Each seeded plan as a PipelineModel over the REAL ids, so a spec can run
     * the engine over exactly the rows the page will fetch and compare the two.
     */
    models: { main: SeededModel; batch: SeededModel; cycle: SeededModel };
    /** Everything created, in the order it must be deleted. */
    teardown: () => Promise<void>;
}

type Row = { id: number };

/** The wall-clock condition every launch-batch member carries (see below). */
export const BATCH_TIME_GATE = '2020-01-01 00:00:00';

// ── Small helpers ───────────────────────────────────────────────────────────

/** POST one row and return its id. Throws LOUDLY — a half-seeded plan is worse
 *  than no plan, because the assertions would compare two different fixtures. */
async function insert(table: string, body: Record<string, unknown>,
                      idToken: string): Promise<number> {
    const res = await apiCall(table, 'POST', body, idToken) as Row[] | string;
    if (!Array.isArray(res) || !res.length || res[0].id == null) {
        throw new Error(`seed: ${table} insert returned no id — got ${JSON.stringify(res)}`);
    }
    return Number(res[0].id);
}

/**
 * POST a junction row.
 *
 * Lambda-Rest skips the read-back on composite-PK tables (req #3057) and answers
 * 201 with an empty body, so there is no id to check — and `apiCall` only throws
 * on a NETWORK failure, returning a 4xx/5xx body as ordinary data. A failed
 * junction insert is therefore invisible at this call site, which is why
 * `verifySeededJunctions` below re-reads both tables after the layer completes.
 * A missing dep row would otherwise surface much later as two 34-element id
 * arrays that differ, with nothing pointing at the real cause.
 */
async function insertJunction(table: string, body: Record<string, unknown>,
                              idToken: string): Promise<void> {
    await apiCall(table, 'POST', body, idToken);
}

/**
 * Confirm every seeded link and dep row actually landed — TWO reads total, the
 * same whole-table reads the plan page itself uses (the junction tables carry no
 * pipeline_fk, so there is nothing narrower to ask for).
 */
async function verifySeededJunctions(
    links: Array<{ step_fk: number; requirement_fk: number }>,
    deps: Array<{ step_fk: number; dep_step_fk: number | null; time_at: string | null }>,
    idToken: string): Promise<void> {
    const read = async (table: string, fields: string) => {
        const rows = await apiCall(`${table}?fields=${fields}`, 'GET', '', idToken);
        return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
    };

    const gotLinks = new Set((await read('pipeline_step_requirements', 'step_fk,requirement_fk'))
        .map((r) => `${r.step_fk}:${r.requirement_fk}`));
    const missingLinks = links.filter((l) => !gotLinks.has(`${l.step_fk}:${l.requirement_fk}`));
    if (missingLinks.length) {
        throw new Error(`seed: ${missingLinks.length} of ${links.length} `
            + `pipeline_step_requirements rows did not land, e.g. `
            + `${JSON.stringify(missingLinks[0])}`);
    }

    // `time_at` comes back as a MySQL DATETIME(6) string, so deps are matched on
    // the pair that identifies them structurally rather than on the raw value.
    const gotDeps = (await read('pipeline_step_deps', 'id,step_fk,dep_step_fk,time_at'));
    const stepDepKeys = new Set(gotDeps.filter((d) => d.dep_step_fk != null)
        .map((d) => `${d.step_fk}:${d.dep_step_fk}`));
    const timeDepCounts = new Map<number, number>();
    for (const d of gotDeps.filter((x) => x.dep_step_fk == null && x.time_at != null)) {
        const k = Number(d.step_fk);
        timeDepCounts.set(k, (timeDepCounts.get(k) || 0) + 1);
    }
    const wantTimeCounts = new Map<number, number>();
    for (const d of deps.filter((x) => x.dep_step_fk == null && x.time_at != null)) {
        wantTimeCounts.set(d.step_fk, (wantTimeCounts.get(d.step_fk) || 0) + 1);
    }

    const missingDeps = deps.filter((d) => (d.dep_step_fk != null
        ? !stepDepKeys.has(`${d.step_fk}:${d.dep_step_fk}`)
        : (timeDepCounts.get(d.step_fk) || 0) < (wantTimeCounts.get(d.step_fk) || 0)));
    if (missingDeps.length) {
        throw new Error(`seed: ${missingDeps.length} of ${deps.length} `
            + `pipeline_step_deps rows did not land, e.g. ${JSON.stringify(missingDeps[0])}`);
    }
}

/** Run `work` over `items` at bounded concurrency, preserving result order.
 *  Order-independent layers only — steps are deliberately NOT run through this. */
async function mapLimit<T, R>(items: T[], limit: number,
                              work: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            out[i] = await work(items[i], i);
        }
    });
    await Promise.all(runners);
    return out;
}

/** DELETE rows matching an arbitrary column set (Lambda-Rest accepts any
 *  where-columns in the body — the same shape cleanupStaleData uses for
 *  requirement_sessions). Best-effort: teardown must never mask a test failure. */
async function remove(table: string, where: Record<string, unknown>,
                      idToken: string): Promise<void> {
    try {
        await apiCall(table, 'DELETE', where, idToken);
    } catch { /* best-effort */ }
}

// ── Stale-fixture sweep ─────────────────────────────────────────────────────

/**
 * Delete every `e2e-` plan this helper has ever left behind in darwin_dev.
 *
 * `cleanupStaleData` (auth.setup.ts) cannot do it: it knows nothing about
 * pipelines, and its requirement sweep actually FAILS against a leaked plan —
 * `pipeline_step_requirements.requirement_fk` is ON DELETE RESTRICT, so a
 * requirement still linked to a step survives a delete that reports success.
 * Without this, one timed-out teardown leaves a plan in darwin_dev permanently
 * and every later run adds another.
 *
 * Best-effort throughout: a sweep failure must not stop the suite from seeding.
 */
async function sweepStaleFixtures(idToken: string, creatorFk: string): Promise<void> {
    const list = async (table: string, query: string) => {
        try {
            const rows = await apiCall(`${table}?${query}`, 'GET', '', idToken);
            return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
        } catch { return []; }
    };

    const stale = (await list('pipelines', `creator_fk=${creatorFk}&fields=id,title`))
        .filter((p) => String(p.title || '').startsWith(E2E_NAME_PREFIX));

    for (const pipeline of stale) {
        const steps = await list('pipeline_steps',
            `pipeline_fk=${pipeline.id}&fields=id`);
        const ids = steps.map((s) => Number(s.id));
        await mapLimit(ids, 8, async (stepId) => {
            await remove('pipeline_step_deps', { step_fk: stepId }, idToken);
            await remove('pipeline_step_deps', { dep_step_fk: stepId }, idToken);
            await remove('pipeline_step_requirements', { step_fk: stepId }, idToken);
        });
        await mapLimit(ids, 8, (id) => remove('pipeline_steps', { id }, idToken));
        await remove('pipelines', { id: pipeline.id }, idToken);
    }

    // The dictionaries the plans hung off. Requirements go first — a leaked one
    // is only deletable now that its junction rows are gone — then features,
    // epics and machines, all matched by the same prefix.
    for (const [table, field] of [
        ['requirements', 'title'], ['features', 'title'],
        ['epics', 'title'], ['machines', 'title'],
    ] as const) {
        const rows = (await list(table, `creator_fk=${creatorFk}&fields=id,${field}`))
            .filter((r) => String(r[field] || '').startsWith(E2E_NAME_PREFIX));
        await mapLimit(rows.map((r) => Number(r.id)), 8,
            (id) => remove(table, { id }, idToken));
    }
}

// ── The seed ────────────────────────────────────────────────────────────────

export async function seedPipelineFixture(idToken: string,
                                          creatorFk: string): Promise<SeededPipelines> {
    await sweepStaleFixtures(idToken, creatorFk);

    const stamp = uniqueName('plan');           // e2e-<ms>-plan
    const created = {
        projects: [] as number[],
        categories: [] as number[],
        machines: [] as number[],
        epics: [] as number[],
        features: [] as number[],
        requirements: [] as number[],
        pipelines: [] as number[],
        steps: [] as number[],
    };

    // Reverse FK order between LAYERS, bounded-parallel within each — a strictly
    // sequential sweep of ~200 rows outruns any sane hook timeout.
    const teardown = async () => {
        // Every dep and link a step OWNS (step_fk) or is POINTED AT BY
        // (dep_step_fk). Both FKs are ON DELETE RESTRICT, so a step cannot go
        // until both directions are clear.
        await mapLimit(created.steps, 8, async (stepId) => {
            await remove('pipeline_step_deps', { step_fk: stepId }, idToken);
            await remove('pipeline_step_deps', { dep_step_fk: stepId }, idToken);
            await remove('pipeline_step_requirements', { step_fk: stepId }, idToken);
        });
        await mapLimit(created.steps, 8, (id) => remove('pipeline_steps', { id }, idToken));
        await mapLimit(created.pipelines, 4, (id) => remove('pipelines', { id }, idToken));
        await mapLimit(created.requirements, 8, (id) => remove('requirements', { id }, idToken));
        await mapLimit(created.features, 8, (id) => remove('features', { id }, idToken));
        await mapLimit(created.epics, 4, (id) => remove('epics', { id }, idToken));
        await mapLimit(created.machines, 4, (id) => remove('machines', { id }, idToken));
        await mapLimit(created.categories, 4, (id) => remove('categories', { id }, idToken));
        await mapLimit(created.projects, 4, (id) => remove('projects', { id }, idToken));
    };

    try {
        // ── Tier 0: project + category (requirements.category_fk is NOT NULL) ──
        const projectId = await insert('projects', {
            creator_fk: creatorFk, project_name: `${stamp}-proj`, closed: 0, sort_order: 0,
        }, idToken);
        created.projects.push(projectId);

        const categoryId = await insert('categories', {
            creator_fk: creatorFk, category_name: `${stamp}-cat`, project_fk: projectId,
            closed: 0, sort_order: 0,
        }, idToken);
        created.categories.push(categoryId);

        // ── Tier 1: the label dictionaries ──────────────────────────────────
        const machineIdOf = new Map<number, number>();
        await mapLimit(MACHINES, 4, async (m: { id: number; title: string }, i) => {
            const id = await insert('machines', {
                creator_fk: creatorFk, title: `${stamp}-${m.title}`,
                // `machines` carries UNIQUE(hostname) — two rows defaulting to
                // the empty string collide on the second insert, which is a 1062
                // in the middle of a seed rather than anything about the plan.
                hostname: `${stamp}-host-${i}`,
                closed: 0, sort_order: i,
            }, idToken);
            created.machines.push(id);
            machineIdOf.set(m.id, id);
        });

        const epicIdOf = new Map<number, number>();
        await mapLimit(EPICS, 4, async (e: { id: number; title: string }, i) => {
            const id = await insert('epics', {
                creator_fk: creatorFk, title: `${stamp}-${e.title}`,
                category_fk: categoryId, closed: 0, sort_order: i,
            }, idToken);
            created.epics.push(id);
            epicIdOf.set(e.id, id);
        });

        const featureIdOf = new Map<number, number>();
        await mapLimit(FEATURES, 6,
            async (f: { id: number; title: string; epic_fk: number }, i) => {
                const id = await insert('features', {
                    creator_fk: creatorFk, title: `${stamp}-${f.title}`,
                    epic_fk: epicIdOf.get(f.epic_fk), category_fk: categoryId,
                    feature_status: 'planned', closed: 0, sort_order: i,
                }, idToken);
                created.features.push(id);
                featureIdOf.set(f.id, id);
            });

        // ── Tier 2: requirements (statuses ARE the derived step states) ──────
        const reqIdOf = new Map<number, number>();
        type FixtureReq = {
            id: number; requirement_status: string; machine_fk: number | null;
            feature_fk: number; coordination_type: string;
        };
        await mapLimit(REQUIREMENTS as FixtureReq[], 8, async (r) => {
            const id = await insert('requirements', {
                creator_fk: creatorFk,
                title: `${stamp}-req-${r.id}`,
                category_fk: categoryId,
                project_fk: projectId,
                requirement_status: r.requirement_status,
                coordination_type: r.coordination_type,
                machine_fk: r.machine_fk == null ? null : machineIdOf.get(r.machine_fk),
                feature_fk: featureIdOf.get(r.feature_fk),
            }, idToken);
            created.requirements.push(id);
            reqIdOf.set(r.id, id);
        });

        // ── Tier 3: the main plan ───────────────────────────────────────────
        const mainPipelineId = await insert('pipelines', {
            creator_fk: creatorFk,
            title: `${stamp} Substrate Rebuild Pipeline`,
            description: 'Recover from the .git/index corruption incident, eliminate the '
                + 'shared-clone corruption class, rebuild provisioning on per-session clones, '
                + 'then run the max-parallel feature DAG.',
            pipeline_status: 'active',
            machine_fk: machineIdOf.get(2),
            started_at: '2026-07-24 00:00:00',
        }, idToken);
        created.pipelines.push(mainPipelineId);

        // SEQUENTIAL — see the header. Array order must become id order.
        type FixtureStep = {
            id: number; title: string; run: string;
            notes: string | null; completed_at: string | null;
        };
        const stepIdOf = new Map<number, number>();
        const seededSteps: Array<Record<string, unknown>> = [];
        for (const s of STEPS as FixtureStep[]) {
            const id = await insert('pipeline_steps', {
                creator_fk: creatorFk,
                pipeline_fk: mainPipelineId,
                title: s.title,
                run: s.run,
                notes: s.notes,
                completed_at: s.completed_at
                    ? s.completed_at.replace('T', ' ') : null,
            }, idToken);
            created.steps.push(id);
            stepIdOf.set(s.id, id);
            seededSteps.push({
                id, pipeline_fk: mainPipelineId, title: s.title, run: s.run,
                notes: s.notes,
                completed_at: s.completed_at ? s.completed_at.replace('T', ' ') : null,
            });
        }

        const seededStepRequirements = (STEP_REQUIREMENTS as Array<
            { step_fk: number; requirement_fk: number }>).map((j) => ({
                step_fk: stepIdOf.get(j.step_fk)!,
                requirement_fk: reqIdOf.get(j.requirement_fk)!,
            }));
        await mapLimit(seededStepRequirements, 8,
            (j) => insertJunction('pipeline_step_requirements', j, idToken));

        const seededStepDeps = (STEP_DEPS as Array<
            { step_fk: number; dep_step_fk: number | null; time_at: string | null }>).map((d) => ({
                step_fk: stepIdOf.get(d.step_fk)!,
                dep_step_fk: d.dep_step_fk == null ? null : stepIdOf.get(d.dep_step_fk)!,
                time_at: d.time_at,
            }));
        await mapLimit(seededStepDeps, 8,
            (d) => insertJunction('pipeline_step_deps', d, idToken));

        // ── Tier 4: the LAUNCH-BATCH variant ────────────────────────────────
        // Design rules 2 and 8 need a plan where several PENDING STEPS share an
        // identical (gate, run, machine) tuple — that is the launch unit, and the
        // banner must print the exact one-line /swarm-start for it. The Substrate
        // fixture no longer contains one (its co-gated pending steps differ in
        // run mode or machine), so the case is seeded explicitly: one req-less
        // gate step that is already complete, then three co-gated pending steps
        // pinned to the SAME machine and run mode.
        const batchPipelineId = await insert('pipelines', {
            creator_fk: creatorFk, title: `${stamp} Launch Batch Plan`,
            description: 'One gate, three co-gated steps — a single launch batch.',
            pipeline_status: 'active', machine_fk: machineIdOf.get(2),
        }, idToken);
        created.pipelines.push(batchPipelineId);

        // Req-less and stamped: a step with zero linked requirements is the ONLY
        // place `completed_at` means anything (design rule 1's other half).
        const gateStepId = await insert('pipeline_steps', {
            creator_fk: creatorFk, pipeline_fk: batchPipelineId,
            title: 'Gate: regression baseline recorded across every suite',
            run: 'auto', notes: null, completed_at: '2026-07-26 01:30:00',
        }, idToken);
        created.steps.push(gateStepId);

        const batchSteps: Array<Record<string, unknown>> = [{
            id: gateStepId, pipeline_fk: batchPipelineId, run: 'auto', notes: null,
            title: 'Gate: regression baseline recorded across every suite',
            completed_at: '2026-07-26 01:30:00',
        }];
        const batchLinks: Array<{ step_fk: number; requirement_fk: number }> = [];
        const batchDeps: Array<{
            step_fk: number; dep_step_fk: number | null; time_at: string | null }> = [];
        const batchRequirements: Array<Record<string, unknown>> = [];
        const batchRequirementIds: number[] = [];

        for (const label of ['alpha', 'beta', 'gamma']) {
            const reqId = await insert('requirements', {
                creator_fk: creatorFk, title: `${stamp}-batch-${label}`,
                category_fk: categoryId, project_fk: projectId,
                requirement_status: 'swarm_ready', coordination_type: 'deployed',
                machine_fk: machineIdOf.get(2), feature_fk: featureIdOf.get(112),
                // EXPLICIT, and deliberately NOT the schema defaults (req #3213).
                // An insert that omits these lands '' through the gateway, not
                // 'opus'/'high' — measured — so a card asserted against the
                // defaults would be asserting the renderer's fallback rather
                // than a value that travelled. 'sonnet'/'xhigh' can only appear
                // on PIPE-19's card if the widened projection carried them.
                ai_model: 'sonnet', effort: 'xhigh',
            }, idToken);
            created.requirements.push(reqId);
            batchRequirementIds.push(reqId);
            batchRequirements.push({
                // `title` carries because the hover card RENDERS it (req #3213
                // D4 — the requirement name is the card's heading). The engine
                // ignores it, so it was omitted while nothing read it; a model
                // that silently disagrees with the row it seeded is a test that
                // asserts `undefined` and calls it a pass.
                id: reqId, title: `${stamp}-batch-${label}`,
                requirement_status: 'swarm_ready',
                machine_fk: machineIdOf.get(2)!, feature_fk: featureIdOf.get(112)!,
                coordination_type: 'deployed',
                ai_model: 'sonnet', effort: 'xhigh',
            });

            const stepId = await insert('pipeline_steps', {
                creator_fk: creatorFk, pipeline_fk: batchPipelineId,
                title: `Co-gated wave member ${label}`,
                run: 'auto', notes: null, completed_at: null,
            }, idToken);
            created.steps.push(stepId);
            batchSteps.push({
                id: stepId, pipeline_fk: batchPipelineId,
                title: `Co-gated wave member ${label}`, run: 'auto',
                notes: null, completed_at: null,
            });

            await insertJunction('pipeline_step_requirements',
                { step_fk: stepId, requirement_fk: reqId }, idToken);
            batchLinks.push({ step_fk: stepId, requirement_fk: reqId });
            await insertJunction('pipeline_step_deps',
                { step_fk: stepId, dep_step_fk: gateStepId, time_at: null }, idToken);
            batchDeps.push({ step_fk: stepId, dep_step_fk: gateStepId, time_at: null });

            // A wall-clock condition alongside the step gate — one row per
            // condition, which is how migration 076 represents a dual-condition
            // gate. IDENTICAL on all three members on purpose: the launch key
            // includes the time gates, so a gate that differed per step would
            // dissolve the batch this plan exists to produce. Past, so the steps
            // stay eligible; the future half of that behaviour is MUT-06's.
            await insertJunction('pipeline_step_deps',
                { step_fk: stepId, dep_step_fk: null, time_at: BATCH_TIME_GATE }, idToken);
            batchDeps.push({ step_fk: stepId, dep_step_fk: null, time_at: BATCH_TIME_GATE });
        }

        // ── Tier 5: the CYCLE variant (loud-failure path) ────────────────────
        // Deliberately corrupt: A waits for B and B waits for A. `set_step_deps`
        // rejects this loudly and the UI cannot create it — which is exactly why
        // it is seeded through the gateway instead. displayOrder() must fall back
        // to stored order and verifyOrder() must raise, so the plan page renders
        // its invariant banner rather than shipping a bad sequence in silence.
        const cyclePipelineId = await insert('pipelines', {
            creator_fk: creatorFk, title: `${stamp} Corrupted Plan`,
            description: 'Deliberately corrupted: a two-step dependency cycle.',
            pipeline_status: 'draft', machine_fk: machineIdOf.get(2),
        }, idToken);
        created.pipelines.push(cyclePipelineId);

        const cycStepIds: number[] = [];
        const cycleSteps: Array<Record<string, unknown>> = [];
        for (const title of ['Cycle step alpha', 'Cycle step beta']) {
            const id = await insert('pipeline_steps', {
                creator_fk: creatorFk, pipeline_fk: cyclePipelineId, title,
                run: 'auto', notes: null, completed_at: null,
            }, idToken);
            created.steps.push(id);
            cycStepIds.push(id);
            cycleSteps.push({
                id, pipeline_fk: cyclePipelineId, title, run: 'auto',
                notes: null, completed_at: null,
            });
        }
        await insertJunction('pipeline_step_deps',
            { step_fk: cycStepIds[0], dep_step_fk: cycStepIds[1], time_at: null }, idToken);
        await insertJunction('pipeline_step_deps',
            { step_fk: cycStepIds[1], dep_step_fk: cycStepIds[0], time_at: null }, idToken);

        // Every junction row this fixture believes in, confirmed present. The
        // models below assert what the DATABASE holds, not what was sent.
        await verifySeededJunctions(
            [...seededStepRequirements, ...batchLinks],
            [
                ...seededStepDeps, ...batchDeps,
                { step_fk: cycStepIds[0], dep_step_fk: cycStepIds[1], time_at: null },
                { step_fk: cycStepIds[1], dep_step_fk: cycStepIds[0], time_at: null },
            ],
            idToken);

        // ── The models the engine will be run over ──────────────────────────
        // The three dictionaries are shared: they are what the page fetches too
        // (whole-table reads, narrowed per pipeline by buildPipelineModel).
        const features = (FEATURES as Array<{ id: number; title: string; epic_fk: number }>)
            .map((f) => ({
                id: featureIdOf.get(f.id)!, title: `${stamp}-${f.title}`,
                epic_fk: epicIdOf.get(f.epic_fk)!,
            }));
        const epics = (EPICS as Array<{ id: number; title: string }>).map((e) => ({
            id: epicIdOf.get(e.id)!, title: `${stamp}-${e.title}`,
        }));
        const machines = (MACHINES as Array<{ id: number; title: string }>).map((m) => ({
            id: machineIdOf.get(m.id)!, title: `${stamp}-${m.title}`,
        }));

        const models = {
            main: {
                pipeline: { id: mainPipelineId, pipeline_status: 'active' },
                steps: seededSteps,
                stepRequirements: seededStepRequirements,
                stepDeps: seededStepDeps,
                requirements: (REQUIREMENTS as FixtureReq[]).map((r) => ({
                    id: reqIdOf.get(r.id)!,
                    requirement_status: r.requirement_status,
                    machine_fk: r.machine_fk == null ? null : machineIdOf.get(r.machine_fk)!,
                    feature_fk: featureIdOf.get(r.feature_fk)!,
                    coordination_type: r.coordination_type,
                })),
                features, epics, machines,
            },
            batch: {
                pipeline: { id: batchPipelineId, pipeline_status: 'active' },
                steps: batchSteps,
                stepRequirements: batchLinks,
                stepDeps: batchDeps,
                requirements: batchRequirements,
                features, epics, machines,
            },
            cycle: {
                pipeline: { id: cyclePipelineId, pipeline_status: 'draft' },
                steps: cycleSteps,
                stepRequirements: [],
                stepDeps: [
                    { step_fk: cycStepIds[0], dep_step_fk: cycStepIds[1], time_at: null },
                    { step_fk: cycStepIds[1], dep_step_fk: cycStepIds[0], time_at: null },
                ],
                requirements: [],
                features, epics, machines,
            },
        };

        return {
            mainPipelineId, batchPipelineId, batchRequirementIds, cyclePipelineId,
            stepIdOf, reqIdOf, epicIdOf, models, teardown,
        };
    } catch (err) {
        // Never leave a half-seeded plan behind: the next run would find rows it
        // did not create and the display-order assertion would compare the page
        // against a model that is missing them.
        await teardown();
        throw err;
    }
}
