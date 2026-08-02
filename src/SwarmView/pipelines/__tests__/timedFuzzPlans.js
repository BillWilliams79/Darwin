// timedFuzzPlans.js — a DETERMINISTIC fuzz corpus of timed plans (req #3229).
//
// WHY A CORPUS AND NOT ANOTHER HAND-BUILT FIXTURE. The layout module's oldest
// invariant — never two beads on one `(band, column, lane)` cell — has an
// assertion in the layout suite, holds on every fixture that suite owns, and was
// still violated in the field. It takes a plan carrying a launch batch whose
// mates sit at SEVERAL dependency depths alongside a second batch in the same
// band, which is a graph nobody hand-writes: the Substrate fixture (34 real
// rows, timestamps synthesized) demonstrably does not reach it. This corpus
// reaches it in 3 plans out of 400 and carries the hazard shape in 37.
//
// DETERMINISTIC BY CONSTRUCTION. A 32-bit LCG seeded from the plan index, no
// clock, no `Math.random`. Plan N is the same plan on every machine and in every
// run, so a failure names a seed and that seed is a permanent repro —
// `makeTimedPlan(<seed>)` is the entire reproducer. `FUZZ_NOW` is a fixed
// literal for the same reason.
//
// THE SHAPE IS THE LIVE SHAPE, not arbitrary noise:
//   - epics/features/requirements wired through the design-rule-10 chain
//     (requirement -> feature_fk -> epic_fk), because a step's BAND comes from
//     its dominant epic and lanes are assigned per band;
//   - dep edges only ever point at a LOWER step id, so no cycles — a cycle
//     collapses columns toward 0 and would fuzz a different function;
//   - a mix of `met` with a `completed_at` and NO `started_at` (820 of 960 live
//     `met` rows look like that), `development` with a `started_at`, and
//     unstamped `authoring`/`approved`/`swarm_ready`, so `planTimeAxis` produces
//     all three of DATED / FUTURE / UNKNOWN;
//   - branch-heavy graphs (a step gates 0–2 earlier steps, drawn from a WINDOW
//     of its predecessors rather than uniformly), because a uniform draw makes
//     one wide fan out of step 1 that never branches deep enough to open a lane;
//   - three completion profiles, rotated by seed — see `terminalOdds`.

const LCG = (seed) => {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
};

export const FUZZ_NOW = '2026-07-30T12:00:00Z';

// EVERY PLAN GETS A COMPLETION PROFILE, and the corpus carries all three rather
// than picking one. This is a coverage decision, measured, not a guess at the
// live distribution. A launch BATCH is a set of steps sharing one REMAINING
// gate, so a batch needs finished work UPSTREAM and unfinished work at the
// frontier, and the shape that reaches this module's cell defect is a
// MULTI-COLUMN batch sharing a band with a second batch. Every single-profile
// corpus tried during tuning covered that shape from one side only:
//
//   - `uniform` (status drawn evenly): 114 batches / 150 plans, and it is the
//     profile that produced the original repro, seed 115.
//   - `advanced` (terminal probability falling with depth — a plan completing
//     left to right): 264 batches / 400 plans and 153 multi-column batches, far
//     the richest in batches, but its frontier bunches into one column, so it
//     found a DIFFERENT seed and missed 115's shape entirely.
//   - `early` (barely started): few batches, but the widest lane sprawl, which
//     is what the dep-adjacent insertion path runs on.
//
// Rotating the profile by seed keeps all three, and costs nothing.
const TERMINAL_STATUSES = ['met', 'met', 'met', 'met', 'wontfix', 'deferred'];
const OPEN_STATUSES = [
    'development', 'development', 'authoring', 'approved', 'swarm_ready',
];
const PROFILES = ['uniform', 'advanced', 'early'];

// The probability that the requirement on step `i` of `n` is TERMINAL.
const terminalOdds = (profile, i, n) => {
    const progress = (i - 1) / Math.max(1, n - 1);
    if (profile === 'advanced') return 0.92 - 0.85 * progress;
    if (profile === 'early') return 0.35 - 0.30 * progress;
    return 0.55;
};

const IS_TERMINAL = new Set(['met', 'wontfix', 'deferred']);

/**
 * One pseudo-random timed plan, as the RAW READ payload `buildPipelineModel`
 * consumes (not a model — that distinction is what made 16 plan-scale tests
 * vacuous before req #3207).
 *
 * @param {number} seed  any integer; the same seed always yields the same plan.
 *                        Its residue mod 3 also selects the completion profile.
 * @returns {Object} `{pipeline, steps, stepDeps, stepRequirements, requirements,
 *                     features, epics, machines}`
 */
export function makeTimedPlan(seed) {
    const rnd = LCG(seed * 2654435761 + 12345);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
    const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

    const profile = PROFILES[seed % PROFILES.length];
    const nSteps = int(8, 24);
    const nEpics = int(1, 3);
    const nFeatures = nEpics * int(1, 2);

    const epics = [];
    for (let e = 1; e <= nEpics; e++) epics.push({ id: e, title: `Epic ${e}` });
    const features = [];
    for (let f = 1; f <= nFeatures; f++) {
        features.push({ id: 10 + f, title: `F${f}`, epic_fk: 1 + (f % nEpics) });
    }

    const steps = [];
    const stepDeps = [];
    const stepRequirements = [];
    const requirements = [];
    let depId = 1;
    let reqId = 1000;

    for (let i = 1; i <= nSteps; i++) {
        steps.push({
            id: i,
            pipeline_fk: 1,
            title: `Step ${i}`,
            run: rnd() < 0.8 ? 'auto' : 'manual',
            completed_at: null,
            notes: null,
        });

        // 0–2 gates, drawn from a WINDOW of the preceding steps rather than
        // uniformly: a uniform draw over all predecessors makes a plan that is
        // mostly one wide fan out of step 1, which never branches deep enough
        // to exercise lane insertion.
        if (i > 1) {
            const nDeps = rnd() < 0.18 ? 0 : (rnd() < 0.62 ? 1 : 2);
            const chosen = new Set();
            for (let k = 0; k < nDeps; k++) {
                const lo = Math.max(1, i - int(1, 6));
                const d = int(lo, i - 1);
                if (d >= i || chosen.has(d)) continue;
                chosen.add(d);
                stepDeps.push({ id: depId++, step_fk: i, dep_step_fk: d, time_at: null });
            }
        }

        const nReqs = rnd() < 0.75 ? 1 : 2;
        for (let k = 0; k < nReqs; k++) {
            const id = ++reqId;
            const status = rnd() < terminalOdds(profile, i, nSteps)
                ? pick(TERMINAL_STATUSES) : pick(OPEN_STATUSES);
            const day = `2026-07-${String(20 + (id % 9)).padStart(2, '0')}`;
            requirements.push({
                id,
                title: `r${id}`,
                requirement_status: status,
                feature_fk: features[int(0, features.length - 1)].id,
                machine_fk: null,
                coordination_type: 'implemented',
                tracking: 0,
                started_at: status === 'development' ? `${day}T08:00:00` : null,
                completed_at: IS_TERMINAL.has(status) && rnd() < 0.85
                    ? `${day}T08:00:00` : null,
            });
            stepRequirements.push({ step_fk: i, requirement_fk: id });
        }
    }

    return {
        pipeline: { id: 1, title: `fuzz-${seed}`, pipeline_status: 'active', machine_fk: null },
        steps,
        stepDeps,
        stepRequirements,
        requirements,
        features,
        epics,
        machines: [{ id: 2, title: 'Mac mini' }],
    };
}

/**
 * The corpus itself: `count` plans, seeds 1..count. 400 is the shipped size —
 * measured at 268 launch batches, 171 of them spanning more than one column,
 * and 37 plans carrying a multi-column batch alongside a second batch, which is
 * the hazard shape. It lays out in well under a second.
 */
export function timedFuzzCorpus(count = 400) {
    const out = [];
    for (let seed = 1; seed <= count; seed++) out.push({ seed, reads: makeTimedPlan(seed) });
    return out;
}
