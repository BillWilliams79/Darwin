// semanticModel.js — pure level-of-detail (semantic zoom) transform for the
// Konva Build Visualizer (req #2864).
//
// The Konva migration mirrors the Swarm Visualizer (req #2841): continuous
// d3-zoom selects one of three semantic levels (L1 out / L2 mid / L3 in). This
// module is the pure substrate that, given the data `model` and a level, returns
// a NEW model whose branches have had collapsed build-runs replaced by a single
// `__gap__:…` SENTINEL id, plus the set of branches to hide and per-token
// metadata (which real builds each "…" hides, which branches it reveals on
// expand). The render layer feeds the transformed model straight into
// `computeLayout`, which is collapse-aware: a sentinel id consumes one column
// like a real build — so the remaining builds pack tighter (automatic
// compaction) — but is emitted as a clickable `collapseTokens` entry instead of
// a build dot.
//
// Why sentinels-in-buildIds rather than a separate "hidden builds" mask: the
// layout engine positions main builds by their INDEX in `main.buildIds` and
// branch builds by `parentX + (i+1)*colW`. Removing a build and inserting a
// one-column sentinel therefore compacts the timeline for free, with zero new
// positioning math and a byte-identical layout when no collapse is requested.
//
// Everything here is pure + exported so it is unit-testable in isolation.

export const GAP_PREFIX = '__gap__';

// ── Semantic-level auto-selection (zoom ratio = k / kBase) ───────────────────
// The Konva canvas captures `kBase` as the fit-to-width scale at framing; the
// continuous d3-zoom ratio auto-selects a level (unless the toolbar pins one).
// ratio < OUT → L1 (out, compact); ratio >= IN → L3 (full detail); else L2. At
// the initial framed view (ratio ≈ 1) the diagram opens at L2 ("default detail").
export const LEVEL_OUT_MAX = 0.62;
export const LEVEL_IN_MIN  = 1.4;
export function autoLevel(ratio) {
    if (!Number.isFinite(ratio) || ratio < LEVEL_OUT_MAX) return 1;
    if (ratio >= LEVEL_IN_MIN) return 3;
    return 2;
}

// A `buildIds` entry is a collapse-token sentinel (not a real build extId).
export function isGapId(id) {
    return typeof id === 'string' && id.startsWith(`${GAP_PREFIX}:`);
}

// Stable, deterministic token ids so a sticky expand survives a re-layout WITHIN
// a level (the run's endpoints don't move unless the data changes). Token ids
// differ across levels by construction (different runs), so expansions reset on a
// level switch — assumption #3 in the requirement.
export const mainGapId = (firstHiddenBid, lastHiddenBid) =>
    `${GAP_PREFIX}:main:${firstHiddenBid}:${lastHiddenBid}`;
// Endpoint-keyed like mainGapId (req #2892): a per-branch collapse can now emit
// more than one run (released builds split the branch), so the run's endpoints
// make each token id unique + stable within a level.
export const branchGapId = (branchId, firstHiddenBid, lastHiddenBid) =>
    `${GAP_PREFIX}:branch:${branchId}:${firstHiddenBid}:${lastHiddenBid}`;

/**
 * Transform a build-visualizer model for a semantic level.
 *
 * @param {object} model — {branches, builds, releaseEvents, …}
 * @param {object} opts
 * @param {1|2|3} opts.level — L1 (out, most compact) … L3 (full detail).
 * @param {Set<string>} [opts.expandedTokens] — token ids the user has clicked to
 *   expand (sticky per-token); an expanded run/branch renders in full.
 * @param {Set<string>} [opts.baseHiddenBranchIds] — branches already hidden by
 *   the toolbar type filter (computeHiddenBranchIds). Semantic hides are unioned
 *   on top, and the union is returned as `hiddenBranchIds`.
 * @returns {{model: object, hiddenBranchIds: Set<string>, tokenMeta: Map}}
 */
export function computeSemanticModel(model, {
    level = 3,
    expandedTokens,
    baseHiddenBranchIds,
} = {}) {
    const expanded = expandedTokens instanceof Set ? expandedTokens : new Set();
    const baseHidden = baseHiddenBranchIds instanceof Set ? baseHiddenBranchIds : new Set();
    const branches = model?.branches || [];
    const builds = model?.builds || {};
    const releaseEvents = model?.releaseEvents || {};

    // L3 (full detail) and the empty model are pure pass-throughs.
    if (level >= 3 || !branches.length) {
        return { model, hiddenBranchIds: new Set(baseHidden), tokenMeta: new Map() };
    }

    const main = branches.find(b => b.type === 'main') || branches[0];
    const mainBuildIds = main?.buildIds || [];
    const mainIndexOf = new Map(mainBuildIds.map((bid, i) => [bid, i]));

    const branchBuildIds = (b) => b?.buildIds || [];
    // "Delivered to a customer" — any build on the branch has a release event.
    const branchDelivered = (b) =>
        branchBuildIds(b).some(bid => (releaseEvents[bid]?.length || 0) > 0);
    // Main index of the build a branch was made from (null when off-main).
    const branchPointMainIndex = (b) => {
        if (b.parentBuildId == null) return null;
        return mainIndexOf.has(b.parentBuildId) ? mainIndexOf.get(b.parentBuildId) : null;
    };

    const sampleBranches = branches.filter(b => b.type === 'sample-release');
    // Latest sample branch = the one whose branch-point build has the greatest
    // position along main (main has progressed past every other sample's point).
    let latestSample = null;
    let latestIdx = -Infinity;
    for (const b of sampleBranches) {
        const idx = branchPointMainIndex(b);
        if (idx != null && idx > latestIdx) { latestIdx = idx; latestSample = b; }
    }

    // ── Branch visibility (hiddenBranchIds) ─────────────────────────────────
    const hidden = new Set(baseHidden);
    if (level === 1) {
        for (const b of branches) {
            if (b.type === 'development') {
                hidden.add(b.id);                       // L1: hide ALL dev branches
            } else if (b.type === 'sample-release'
                       && b !== latestSample
                       && !branchDelivered(b)) {
                hidden.add(b.id);                       // L1: hide completed (not-latest) undelivered samples
            }
        }
    }
    const isShown = (b) => b && b.type !== 'main' && !hidden.has(b.id);

    const tokenMeta = new Map();
    const newBuildIdsByBranch = new Map();

    // ── Main-trunk collapse (L1 + L2) ───────────────────────────────────────
    // Keep the always-show milestones and collapse every un-anchored run between
    // them into one clickable "…".
    //
    // req #2892 — the milestones are: the FIRST main build ("where we came from")
    // and the LAST main build (the current tip) — BOTH levels; every SHOWN
    // branch's branch point (incl. development, so "branch points always show"
    // holds at L2 — at L1 dev branches are hidden, so isShown filters them out);
    // and, at L2, every RELEASED main build. There is deliberately NO "tip run"
    // (the old rule force-kept latest-sample-point → end fully expanded): with the
    // milestones above already pinning the tail (last build + Release branch point
    // + released builds), the span between the latest sample and a later Release
    // now collapses like any other un-anchored run.
    //
    // With no sample branches there are no anchors to window around — collapsing
    // the whole trunk would be useless, so main stays expanded.
    const shownSamples = sampleBranches.filter(isShown);
    if (shownSamples.length && mainBuildIds.length) {
        const kept = new Set();
        // First + last main build always survive (first = origin, last = tip).
        kept.add(0);
        kept.add(mainBuildIds.length - 1);
        if (level === 2) {
            // L2 also keeps every released main build.
            mainBuildIds.forEach((bid, i) => {
                if ((releaseEvents[bid]?.length || 0) > 0) kept.add(i);
            });
        }
        // Protect the branch-point build of every SHOWN branch (req #2892 — incl.
        // development at L2). At L1 dev branches are hidden, so isShown filters
        // them out; their parent build stays collapsible there.
        for (const b of branches) {
            if (!isShown(b)) continue;
            const bp = branchPointMainIndex(b);
            if (bp != null) kept.add(bp);
        }

        const out = [];
        let i = 0;
        while (i < mainBuildIds.length) {
            if (kept.has(i)) { out.push(mainBuildIds[i]); i++; continue; }
            let j = i;
            while (j < mainBuildIds.length && !kept.has(j)) j++;
            const runIds = mainBuildIds.slice(i, j);
            const tokenId = mainGapId(runIds[0], runIds[runIds.length - 1]);
            if (expanded.has(tokenId)) {
                out.push(...runIds);                    // expanded → reveal the run
            } else {
                out.push(tokenId);
                // Branches whose branch point sits inside this collapsed run are
                // hidden until it is expanded (req: dev branches inside a
                // collapsed main span). Record them so the click can reveal them.
                const revealBranchIds = [];
                for (const b of branches) {
                    if (b.type === 'main') continue;
                    const bp = branchPointMainIndex(b);
                    if (bp != null && bp >= i && bp < j && isShown(b)) {
                        hidden.add(b.id);
                        revealBranchIds.push(b.id);
                    }
                }
                tokenMeta.set(tokenId, {
                    kind: 'main', branchId: main.id, hiddenBuildIds: runIds, revealBranchIds,
                });
            }
            i = j;
        }
        if (out.length !== mainBuildIds.length || out.some(isGapId)) {
            newBuildIdsByBranch.set(main.id, out);
        }
    }

    // ── Per-branch build collapse — every non-main branch (L1 + L2) ──────────
    // A SHOWN non-main branch with > 3 of its OWN builds collapses its interior
    // into "…" tokens — development branches collapse just like sample/release
    // (req #2892 follow-up: "dev branches should collapse like any other branch").
    // The FIRST and LAST build always survive (req #2881/#2892 — first/last build
    // on any branch). At L2 every RELEASED build also survives (req #2892 —
    // released builds always show), which can split the branch into more than one
    // collapsed run — hence one token per run, endpoint-keyed. Any build that
    // anchors a SHOWN child branch is kept too so the connector never dangles.
    // < 4 builds: nothing to hide.
    for (const b of branches) {
        if (b.type === 'main') continue;
        if (!isShown(b)) continue;
        const ids = branchBuildIds(b);
        if (ids.length <= 3) continue;

        const lastIdx = ids.length - 1;
        const keptB = new Set([0, lastIdx]);           // first + last always
        if (level === 2) {
            ids.forEach((bid, i) => {
                if ((releaseEvents[bid]?.length || 0) > 0) keptB.add(i);
            });
        }
        // Protect any own build that anchors a SHOWN child branch.
        for (const c of branches) {
            if (!isShown(c) || c.parentBuildId == null) continue;
            const ci = ids.indexOf(c.parentBuildId);
            if (ci >= 0) keptB.add(ci);
        }

        const out = [];
        let changed = false;
        let i = 0;
        while (i < ids.length) {
            if (keptB.has(i)) { out.push(ids[i]); i++; continue; }
            let j = i;
            while (j < ids.length && !keptB.has(j)) j++;
            const runIds = ids.slice(i, j);
            const tokenId = branchGapId(b.id, runIds[0], runIds[runIds.length - 1]);
            if (expanded.has(tokenId)) {
                out.push(...runIds);                    // expanded → reveal the run
            } else {
                out.push(tokenId);
                tokenMeta.set(tokenId, {
                    kind: 'branch', branchId: b.id, hiddenBuildIds: runIds, revealBranchIds: [],
                });
                changed = true;
            }
            i = j;
        }
        if (changed) newBuildIdsByBranch.set(b.id, out);
    }

    if (newBuildIdsByBranch.size === 0) {
        return { model, hiddenBranchIds: hidden, tokenMeta };
    }
    const newBranches = branches.map(b =>
        newBuildIdsByBranch.has(b.id) ? { ...b, buildIds: newBuildIdsByBranch.get(b.id) } : b,
    );
    return { model: { ...model, branches: newBranches }, hiddenBranchIds: hidden, tokenMeta };
}

export default computeSemanticModel;
