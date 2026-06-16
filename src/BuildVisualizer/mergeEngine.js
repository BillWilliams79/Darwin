// req #2603 — Build Visualizer Merge Engine.
//
// A SINGLE pure function that DERIVES every merge arrow the visualizer should
// depict from the branch tree + the computed layout. Nothing is stored: the
// merge scheme is a deterministic classification of branch type + tree
// position, recomputed each render (data-architect rule — derive, don't
// persist). A merge here is purely a depiction of the required/expected merge
// scheme; it carries no claim that a merge actually happened.
//
// Two kinds of input drive the output:
//
//   1. STANDARD merges — read straight off `MERGE_RULES[branch.type]`:
//        • main           → (none)
//        • sample-release → main                              (required, solid)
//        • release        → main                              (required, solid)
//                         → hotfix/CSR children of a RELEASED build that has a
//                           later build beyond it on the branch (evaluate, dashed)
//        • development    → its origin (parent) branch        (required, solid)
//        • csr / hotfix / bootleg (the "release scheme"):
//                         → main                              (required, solid)
//                         → its origin release branch         (evaluate, dashed)
//                         → every CSR on that release branch  (evaluate, dashed)
//      The origin release branch is the nearest release ancestor; a branch with
//      no release ancestor (e.g. a hotfix off main) gets only the required→main.
//      Required merges are mandatory (solid line); evaluate merges require
//      consideration before deciding (dashed line).
//
//   2. DAY-ZERO merges — user declares a build a "day zero" (a critical issue,
//      e.g. a zero-day security bug, found on an already-shipped build). The
//      engine then fans a RED merge requirement out from that build to EVERY
//      production release / hot fix / CSR branch in the tree, backward AND
//      forward. Day-zero arrows render even when the Merges toggle is OFF.
//
// Geometry: an arrow from the TIP of the origin branch (its last build) to a
// point JUST PAST the last build of the merge destination, landing on the
// destination branch's horizontal line. Day-zero arrows originate at the
// declared build itself.
//
// The engine consumes the OUTPUT of `computeLayout` (so it sees only VISIBLE
// branches/builds — type-filtered branches are absent from `layout` and thus
// never participate in a merge) plus the source `model` (for branch type +
// parent links, which the layout records don't carry).

// ── Merge kinds ──────────────────────────────────────────────────────────
export const MERGE_REQUIRED = 'required';
export const MERGE_EVALUATE = 'evaluate';
export const MERGE_DAYZERO  = 'dayzero';

// Branch types that a day-zero requirement fans out to: shipped production
// releases, hot fixes, and CSRs (the surfaces a zero-day must be patched on).
export const DAYZERO_TARGET_TYPES = new Set(['release', 'hotfix', 'csr']);

// Pixels past the destination's last build where the arrow lands — "just past
// the last build in the merge destination" (req #2603). ~0.6 × colW (52).
const DEST_PAST_PX = 30;

// Per-branch-type merge rule table. Each rule names a TARGET TOKEN resolved by
// `resolveTargets` into concrete destination branch ids, plus the merge kind.
// CSR, hotfix, and bootleg share ONE rule set (req #2603 follow-up): a required
// merge to main + evaluate merges to their ORIGIN RELEASE branch and every CSR
// on that release. `release-csrs` returns all CSRs on the origin release; a CSR
// source's own id is dropped by the self-merge guard in `push`.
const RELEASE_SCHEME = [
    { target: 'main',         kind: MERGE_REQUIRED },
    { target: 'release',      kind: MERGE_EVALUATE },   // origin release branch
    { target: 'release-csrs', kind: MERGE_EVALUATE },   // every CSR on that release
];
export const MERGE_RULES = {
    main:             [],
    'sample-release': [{ target: 'main',   kind: MERGE_REQUIRED }],
    // Release: required→main, plus the "re-spin" caveat (req #2603 follow-up) —
    // when a RELEASED build on the branch has a later build beyond it AND has
    // hotfix/CSR children, evaluate-merge to those children (the release moved on
    // past the point they branched from). See `respin-hotfix-csr`.
    release:          [
        { target: 'main',              kind: MERGE_REQUIRED },
        { target: 'respin-hotfix-csr', kind: MERGE_EVALUATE },
    ],
    development:      [{ target: 'origin', kind: MERGE_REQUIRED }],
    csr:              RELEASE_SCHEME,
    hotfix:           RELEASE_SCHEME,
    bootleg:          RELEASE_SCHEME,
};

// Whether a branch type has any standard merge rules — i.e. whether a
// per-branch "show merges" affordance is meaningful for it. `main` (no rules)
// returns false so the toggle is hidden on the trunk.
export function hasMergeRules(type) {
    return (MERGE_RULES[type] || []).length > 0;
}

// Vertical offset of the merge's horizontal run BELOW the source branch line.
// Sized to clear the source's build-version labels (dot radius + close offset +
// stagger lane + text height ≈ 38px) so the run never overwrites the branch line
// or its build numbers (req #2603 follow-up).
const MERGE_LANE_DROP = 42;

// A merge arrow in three moves (req #2603 follow-up):
//   1. leave the source tip and DROP DOWN into a horizontal LANE offset below the
//      source line — clear of the branch line and its build-version labels;
//   2. run horizontally in that lane toward the destination;
//   3. climb STEEPLY (near-vertical) out of the lane INTO the destination, so the
//      arrowhead intersects the merge branch vertically rather than gliding in
//      almost horizontally.
// The first and last segments are cubics with a HORIZONTAL tangent at the lane
// end and a VERTICAL tangent at the destination end (cp2.x === x1) — that
// vertical arrival is what makes the arrowhead point into the branch. Works for
// forward (x1 > x0) and backward (x1 < x0) merges; `dirX` orients the corners.
export function mergePath(x0, y0, x1, y1) {
    const dirX = x1 >= x0 ? 1 : -1;
    const span = Math.abs(x1 - x0);
    // Drop into the lane below the source. When the destination is itself below
    // (a downward merge), clamp so the lane doesn't overshoot past it.
    const drop = (y1 > y0) ? Math.min(MERGE_LANE_DROP, (y1 - y0) * 0.6) : MERGE_LANE_DROP;
    const yLane = y0 + drop;
    // Corner widths: ease into the lane near the source; climb out near the dest.
    // Clamped so the two corners don't overlap on short merges.
    const cornerW = Math.min(30, span * 0.4);
    const approachW = Math.min(26, span * 0.35);
    const xLaneStart = x0 + dirX * cornerW;
    const xTurn = x1 - dirX * approachW;
    const dirApproach = y1 >= yLane ? 1 : -1;
    const vc = Math.abs(y1 - yLane) * 0.5;   // vertical control → steep arrival
    return `M ${x0} ${y0} `
        + `C ${x0 + dirX * cornerW * 0.6} ${y0}, ${xLaneStart - dirX * cornerW * 0.6} ${yLane}, ${xLaneStart} ${yLane} `
        + `L ${xTurn} ${yLane} `
        + `C ${xTurn + dirX * approachW * 0.6} ${yLane}, ${x1} ${y1 - dirApproach * vc}, ${x1} ${y1}`;
}

// Walk the parentBranchId chain to the first ancestor branch of `type`.
// Returns the ancestor branch id, or null. Guards against cycles via a seen
// set (defensive — the tree should be acyclic).
function ancestorOfType(branchId, type, branchById) {
    const seen = new Set();
    let cur = branchById.get(branchId);
    while (cur && cur.parentBranchId && !seen.has(cur.parentBranchId)) {
        seen.add(cur.parentBranchId);
        const parent = branchById.get(cur.parentBranchId);
        if (!parent) break;
        if (parent.type === type) return parent.id;
        cur = parent;
    }
    return null;
}

/**
 * Compute the merge arrows to depict.
 *
 * @param {object}  args
 * @param {object}  args.model            — {branches, builds, ...} from useBuildVisualizerData
 * @param {object}  args.layout           — output of computeLayout (visible branches/builds only)
 * @param {Set<string>} [args.dayZeroBuildIds] — build extIds declared day-zero
 * @returns {Array<{id,kind,source,dest,sourceX,sourceY,destX,destY,d}>}
 */
export function computeMerges({ model, layout, dayZeroBuildIds } = {}) {
    const branches = model?.branches || [];
    const releaseEvents = model?.releaseEvents || {};
    const layoutBranches = layout?.branches || [];
    const layoutBuilds = layout?.builds || [];
    if (!branches.length || !layoutBranches.length) return [];

    const dayZero = dayZeroBuildIds instanceof Set ? dayZeroBuildIds : new Set();

    // Source-of-truth maps. Only branches PRESENT in the layout are visible
    // (type filtering removes hidden branches from `layout.branches`).
    const branchById = new Map(branches.map(b => [b.id, b]));
    const visibleBranchIds = new Set(layoutBranches.map(b => b.id));
    const branchYById = new Map(layoutBranches.map(b => [b.id, b.y]));
    const mainBranchId = (layoutBranches.find(b => b.isMain) || {}).id || null;

    // Per-branch tip (last build x) and per-build position, from the layout.
    const lastBuildXById = new Map();   // branchId → max build x
    const buildPosById = new Map();     // build extId → {x, y, branchId}
    for (const bld of layoutBuilds) {
        buildPosById.set(bld.id, { x: bld.x, y: bld.y, branchId: bld.branchId });
        const cur = lastBuildXById.get(bld.branchId);
        if (cur == null || bld.x > cur) lastBuildXById.set(bld.branchId, bld.x);
    }

    // A branch can be a merge ENDPOINT only when it is visible AND has at least
    // one build (an empty branch has no tip to leave from / land just past).
    const hasTip = (id) => visibleBranchIds.has(id) && lastBuildXById.has(id);

    // The ORIGIN RELEASE branch of a csr/hotfix/bootleg: the nearest release
    // ancestor via the parentBranchId chain. STRICT — no fallback. A branch with
    // no release ancestor (e.g. a hotfix created off main) simply has no origin
    // release, so it gets the required→main merge but no evaluate merges.
    const associatedReleaseFor = (branch) => {
        const anc = ancestorOfType(branch.id, 'release', branchById);
        return (anc && hasTip(anc)) ? anc : null;
    };

    const resolveTargets = (branch, token) => {
        switch (token) {
            case 'main':
                return mainBranchId ? [mainBranchId] : [];
            case 'origin':
                return branch.parentBranchId ? [branch.parentBranchId] : [];
            case 'release': {
                const rel = associatedReleaseFor(branch);
                return rel ? [rel] : [];
            }
            case 'release-csrs': {
                // Every CSR on this branch's origin release. A CSR source's own
                // id is dropped later by the self-merge guard in `push`.
                const rel = associatedReleaseFor(branch);
                if (!rel) return [];
                const out = [];
                for (const id of visibleBranchIds) {
                    const b = branchById.get(id);
                    if (!b || b.type !== 'csr') continue;
                    if (associatedReleaseFor(b) === rel) out.push(id);
                }
                return out;
            }
            case 'respin-hotfix-csr': {
                // Release re-spin caveat: for each RELEASED build on this release
                // branch (a build that carries a release event) that has at least
                // one build BEYOND it on the same branch, evaluate-merge to that
                // released build's hotfix/CSR children — the release has moved on
                // past the point those branches were taken.
                const buildIds = branch.buildIds || [];   // ordered by position
                const out = [];
                buildIds.forEach((bid, idx) => {
                    const released = (releaseEvents[bid]?.length || 0) > 0;
                    const hasBuildBeyond = idx < buildIds.length - 1;
                    if (!released || !hasBuildBeyond) return;
                    for (const id of visibleBranchIds) {
                        const b = branchById.get(id);
                        if (!b || (b.type !== 'hotfix' && b.type !== 'csr')) continue;
                        if (b.parentBuildId === bid) out.push(id);
                    }
                });
                return out;
            }
            default:
                return [];
        }
    };

    const merges = [];
    const seen = new Set();
    const push = (kind, sourceKey, sourceX, sourceY, destId) => {
        if (!hasTip(destId) || destId === sourceKey) return;
        const id = `${kind}:${sourceKey}->${destId}`;
        if (seen.has(id)) return;
        seen.add(id);
        const destX = lastBuildXById.get(destId) + DEST_PAST_PX;
        const destY = branchYById.get(destId);
        merges.push({
            id,
            kind,
            source: sourceKey,
            dest: destId,
            sourceX,
            sourceY,
            destX,
            destY,
            d: mergePath(sourceX, sourceY, destX, destY),
        });
    };

    // ── Standard merges — one source branch at a time ──────────────────────
    for (const branch of branches) {
        if (!hasTip(branch.id)) continue;                 // invisible or empty
        const rules = MERGE_RULES[branch.type];
        if (!rules || !rules.length) continue;            // main / unknown → none
        const sourceX = lastBuildXById.get(branch.id);    // origin branch tip
        const sourceY = branchYById.get(branch.id);
        for (const rule of rules) {
            for (const destId of resolveTargets(branch, rule.target)) {
                push(rule.kind, branch.id, sourceX, sourceY, destId);
            }
        }
    }

    // ── Day-zero merges — fan out from each declared build ─────────────────
    for (const buildId of dayZero) {
        const pos = buildPosById.get(buildId);            // visible builds only
        if (!pos) continue;
        for (const id of visibleBranchIds) {
            if (id === pos.branchId) continue;            // not its own branch
            const b = branchById.get(id);
            if (!b || !DAYZERO_TARGET_TYPES.has(b.type)) continue;
            push(MERGE_DAYZERO, buildId, pos.x, pos.y, id);
        }
    }

    return merges;
}

export default computeMerges;
