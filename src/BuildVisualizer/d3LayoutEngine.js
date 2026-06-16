// req #2694 — Build Visualizer D3 — strata + interval-scheduling layout engine.
//
// The Y arrangement is governed by two ideas:
//
// 1. **Strata** (the domain model). Each branch type lives in its own
//    horizontal band, in this order top-to-bottom:
//      • Stratum 1: Bootleg
//      • Stratum 2: Hot Fix
//      • Stratum 3: CSR
//      • Stratum 4: Release
//      • Stratum 5: Sample Release
//      • Stratum 6: Main (the trunk)
//      • Stratum 7: Development
//    Cross-stratum hierarchy (a hotfix off a release) is reflected in the
//    CONNECTOR (the curve still originates at the parent build) but not
//    in the Y arrangement of the child — children live in their own
//    stratum, period.
//
// 2. **Interval scheduling within each stratum** (the geometry algorithm).
//    Each branch occupies a horizontal interval [parentX, lastBuildX + arrow]
//    on the SVG x-axis. A stratum's lane count is the chromatic number of
//    the interval graph — i.e., the minimum number of horizontal rows
//    needed so no two overlapping intervals share a row. The greedy
//    algorithm (sort by xMin; assign each interval to the lowest lane whose
//    last interval ended before the new one starts) is O(n log n) and
//    optimal — same algorithm used by Chrome DevTools waterfall, Gantt
//    charts, IGV genome browser, every DAW timeline.
//
// The result honors the "minimal whitespace" rule: a stratum needing only
// one lane takes only one rowGap of vertical space, regardless of how many
// branches are in it. A stratum needing five lanes (because its intervals
// genuinely overlap) takes five rowGaps — no more, no less.
//
// d3-hierarchy is still used in one place: `hierarchy().eachBefore()` for
// topological traversal of the parent→child branch tree, so each branch's
// parent build X is placed before the child needs to read it. Beyond that,
// no d3 layout machinery — Reingold-Tilford was the wrong tool for the
// strata problem.

import { hierarchy } from 'd3-hierarchy';
import { formatVersion, fromModelBuild } from './versionEngine';
import { isGapId } from './semanticModel';

export const REGISTRY = {
    main:             { label: 'Main',                 dotRadius: 5.5, defaultSide: 'center' },
    release:          { label: 'Release',              dotRadius: 6.0, defaultSide: 'above' },
    'sample-release': { label: 'Sprint/Sample',         dotRadius: 5.5, defaultSide: 'above' },
    hotfix:           { label: 'Hot Fix',              dotRadius: 5.5, defaultSide: 'above' },
    bootleg:          { label: 'Bootleg',              dotRadius: 5.5, defaultSide: 'above' },
    csr:              { label: 'CSR',                  dotRadius: 5.5, defaultSide: 'above' },
    development:      { label: 'Dev Branch',           dotRadius: 5.5, defaultSide: 'below' },
};

// Strata are ordered top-to-bottom in SVG. Position 0 = top of canvas;
// position N-1 = bottom. `position` of 'main' is the trunk anchor. Strata
// above main render in increasing distance from main as position drops
// (Sample is closest to main; Bootleg is farthest above, then Hot Fix, CSR).
const STRATA = [
    { id: 'bootleg', label: 'Bootleg',         types: ['bootleg'],        side: 'above', bandFill: 'rgba(253, 216, 53, 0.04)' },
    { id: 'hotfix',  label: 'Hot Fix',         types: ['hotfix'],         side: 'above', bandFill: 'rgba(229, 57, 53, 0.04)' },
    { id: 'csr',     label: 'CSR',             types: ['csr'],            side: 'above', bandFill: 'rgba(0, 0, 0, 0.025)' },
    { id: 'release', label: 'Release',         types: ['release'],        side: 'above', bandFill: 'rgba(34, 197, 94, 0.04)', gapAfter: 90 },
    { id: 'sample',  label: 'Sprint/Sample',    types: ['sample-release'], side: 'above', bandFill: 'rgba(59, 130, 246, 0.04)' },
    { id: 'main',    label: 'Main',            types: ['main'],           side: 'center', bandFill: 'transparent' },
    { id: 'dev',     label: 'Development',     types: ['development'],    side: 'below', bandFill: 'rgba(0, 0, 0, 0.02)' },
];
export const STRATA_ORDER = STRATA;

const STRATUM_BY_TYPE = (() => {
    const m = new Map();
    for (const s of STRATA) for (const t of s.types) m.set(t, s.id);
    return m;
})();

export const DEFAULT_OPTS = {
    colW: 52,
    leftPad: 240,
    rightPad: 90,
    // Distance from the trunk to the first lane on each side.
    sideGap: 70,
    // Gap between adjacent lanes within a stratum.
    laneGap: 70,
    // Extra vertical room reserved ABOVE any row (lane / main / dev lane) whose
    // builds carry a customer release event. Such a row renders a star glyph
    // row at dot.y − 22 and raises its name label to dot.y − 34 (vs the normal
    // dot.y − 16) — both extend higher than a release-free row, so without this
    // reservation the version labels of the row directly above collide with the
    // stars + raised label (req #2772). Sized as the star-row height (~14) plus
    // the label-raise delta (34 − 16 = 18) ≈ 30 px; applied only to the gap
    // directly above a release-bearing row, so release-free layouts are
    // unchanged and no global whitespace is added.
    releaseClearance: 30,
    // req #2633 — Build AT renders a per-build self-loop + "Build AT" caption
    // ABOVE every build (and ABOVE the release stars when a build also bears a
    // release event). When `showBuildAt` is on, every row reserves this extra
    // room above it so the loops/captions don't collide with the row above or,
    // on release-bearing builds, with the star row. Sized as loop (~12) + cap
    // text (~10) + gap.
    buildAtClearance: 26,
    showBuildAt: true,
    // Master switch for ALL acceptance-test visuals (branch glyphs + names +
    // Build AT). When false, no AT element renders and no AT clearance is
    // reserved. `showBuildAt` is a SUB-toggle — Build AT only shows when both
    // are on (req #2633 review round).
    showAcceptanceTests: true,
    // Gap between adjacent strata (e.g. between Hot Fix's farthest lane and
    // Bootleg's closest-to-main lane). Bumped to 70 (= laneGap) so the
    // staggered far-lane version labels of an upper stratum's bottom lane
    // never overlap the text label of the stratum just below it. The far
    // lane sits ~30 px below its dot; combined with yBottom's laneGap/2
    // overhang the labels can otherwise crowd the next stratum's text.
    stratumGap: 70,
    // Width of the bow on a sub-branch curve, in colW units.
    subBranchBowColumns: 1.0,
    // Pixel gutter for the lane-assignment overlap check. Two intervals are
    // treated as overlapping when within this many px of each other so an
    // arrow tip doesn't touch the next branch's curve landing.
    collisionGutter: 4,
    // Length of the tail line + arrow past the last build dot, in colW units.
    // UNIFORM across every branch — main, sub-branches, and empty branches all
    // use this one value so the follow-on piece is identical everywhere (req
    // #2603 follow-up). Shortened to 0.6 (req #2877) so the tail chunk + arrow
    // consume ~60% of a column instead of nearly a full one — at 0.9 it read as
    // a continuation into the next build slot. The main trunk path reads the
    // same constant, so the trunk shortens in lockstep.
    arrowExtColumns: 0.6,
    versionCloseOffset: 12,
    versionLaneGap: 12,
    versionLanes: true,
    hiddenBranchIds: null,
    canvasPadTop: 40,
    canvasPadBottom: 70,
};

// req #2633 — branch-level AT name labels stack BELOW a branch's latest build,
// starting below the version far-lane so they never collide with build numbers.
// Each name's row is ATNAME_LINE_H tall; the first name sits ATNAME_TOP_OFFSET
// below the dot center (clears r + the two version lanes ≈ r + 24).
const ATNAME_TOP_OFFSET = 36;
const ATNAME_LINE_H = 12;

function cfgFor(type) {
    return REGISTRY[type] || REGISTRY.development;
}

function dotRadiusFor(type) {
    return cfgFor(type).dotRadius;
}

function horizontalExtentFor(branch, parentX, opts) {
    const colW = opts.colW;
    const nBuilds = (branch.buildIds || []).length;
    // Empty branches extend to the first-build slot (parentX + colW) so the
    // arrow sits where the first build would land — matching the exemplar.
    const lastBuildX = nBuilds > 0 ? parentX + nBuilds * colW : parentX + colW;
    // Every branch always reserves room for its follow-on tail arrow (req #2603
    // follow-up) — see the connector step for why the arrow is unconditional.
    const arrowExt = colW * opts.arrowExtColumns;
    return { xMin: parentX, xMax: Math.max(parentX, lastBuildX) + arrowExt };
}

// Greedy interval scheduling — the textbook minimum-track-allocation
// algorithm. Sort by xMin ascending; for each interval, assign it to the
// first lane whose previous interval ended before this one starts (with
// gutter). If no lane is free, open a new lane. Returns:
//   {laneByBranchId: Map<id, laneIndex>, laneCount}
// laneCount is the chromatic number of the interval graph — minimum lanes
// needed to color without conflict.
function assignLanes(intervals, gutter) {
    if (!intervals.length) return { laneByBranchId: new Map(), laneCount: 0 };
    const sorted = intervals.slice().sort((a, b) => {
        if (a.xMin !== b.xMin) return a.xMin - b.xMin;
        // Tiebreak by xMax desc so longer intervals get lanes first — they're
        // harder to fit later. Then by model order for determinism.
        if (a.xMax !== b.xMax) return b.xMax - a.xMax;
        return a.order - b.order;
    });
    const laneEnd = []; // index → last xMax assigned to that lane
    const laneByBranchId = new Map();
    for (const iv of sorted) {
        let lane = -1;
        for (let i = 0; i < laneEnd.length; i++) {
            if (laneEnd[i] + gutter <= iv.xMin) { lane = i; break; }
        }
        if (lane === -1) {
            laneEnd.push(iv.xMax);
            lane = laneEnd.length - 1;
        } else {
            laneEnd[lane] = iv.xMax;
        }
        laneByBranchId.set(iv.branchId, lane);
    }
    return { laneByBranchId, laneCount: laneEnd.length };
}

// Bezier control points for the tight exemplar curve.
function connectorControlPoints(p0, p3, bow) {
    return {
        p1: { x: p0.x - bow, y: p0.y },
        p2: { x: p0.x - bow, y: p3.y },
    };
}

// Curve-fan rank — siblings sharing parentBuildId and same side. Inner = 1.
function bowRankFor(branch, branchY, branchById, branchYs, mainY) {
    const sideAbove = branchY < mainY;
    const cohort = [{ branch, y: branchY }];
    for (const other of branchById.values()) {
        if (other === branch) continue;
        if (other.type === 'main') continue;
        if (other.parentBuildId !== branch.parentBuildId) continue;
        const y = branchYs.has(other.id) ? branchYs.get(other.id) : null;
        if (y == null) continue;
        if ((sideAbove && y < mainY) || (!sideAbove && y > mainY)) {
            cohort.push({ branch: other, y });
        }
    }
    cohort.sort((a, b) => Math.abs(a.y - mainY) - Math.abs(b.y - mainY));
    return cohort.findIndex(x => x.branch === branch) + 1;
}

/**
 * @param {object} model — {branches, builds, releaseEvents}
 * @param {object} [opts] — overrides DEFAULT_OPTS
 */
export function computeLayout(model, opts = {}) {
    const o = { ...DEFAULT_OPTS, ...opts };
    const branches = model?.branches || [];
    const buildsMap = model?.builds || {};
    const releaseEvents = model?.releaseEvents || {};
    const releaseEventDetails = model?.releaseEventDetails || {};

    if (!branches.length) {
        return {
            branches: [], builds: [], connectors: [],
            mainPath: null, mainEndpointLabels: null,
            strata: [], emptyAnchors: [], collapseTokens: [],
            atBranchGlyphs: [], atBuildLoops: [],
            width: 800, height: 200, mainY: 0,
        };
    }

    const branchById = new Map(branches.map(b => [b.id, b]));
    const main = branches.find(b => b.type === 'main') || branches[0];
    const hidden = o.hiddenBranchIds instanceof Set ? o.hiddenBranchIds : new Set();
    const isHidden = (id) => hidden.has(id);

    // ─── Step 1. X for every build via topological walk ────────────────
    // Main builds drive the timeline. Non-main builds inherit X from their
    // parent build (parent.x + (i+1) * colW). d3.hierarchy().eachBefore()
    // guarantees parents are visited first.
    const positions = {};
    const mainBuildIds = main.buildIds || [];
    mainBuildIds.forEach((bid, i) => {
        positions[bid] = { x: o.leftPad + i * o.colW, y: 0 /* placeholder */ };
    });

    const visible = branches.filter(b => b.type !== 'main' && !isHidden(b.id));
    const childrenByParent = new Map();
    for (const b of visible) {
        const pid = b.parentBranchId || main.id;
        if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
        childrenByParent.get(pid).push(b);
    }
    function buildTreeData(parentId) {
        return (childrenByParent.get(parentId) || []).map(b => ({
            id: b.id, ref: b, children: buildTreeData(b.id),
        }));
    }
    const fullTree = { id: main.id, ref: main, children: buildTreeData(main.id) };
    const fullRoot = hierarchy(fullTree);

    fullRoot.eachBefore(node => {
        if (node === fullRoot) return;
        const branch = node.data.ref;
        const parentBuildId = branch.parentBuildId;
        const parentPos = parentBuildId != null ? positions[parentBuildId] : null;
        if (!parentPos) return;
        const parentX = parentPos.x;
        (branch.buildIds || []).forEach((bid, i) => {
            positions[bid] = { x: parentX + (i + 1) * o.colW, y: 0 /* placeholder */ };
        });
    });

    // ─── Step 2. Compute horizontal extents per branch ─────────────────
    const branchExtent = new Map();
    for (const b of visible) {
        const parentBuildId = b.parentBuildId;
        const parentPos = parentBuildId != null ? positions[parentBuildId] : null;
        const parentX = parentPos ? parentPos.x : o.leftPad;
        branchExtent.set(b.id, horizontalExtentFor(b, parentX, o));
    }

    // ─── Step 3. Group by stratum + run interval scheduling per ────────
    const branchesByStratum = new Map();
    for (const b of visible) {
        const stratumId = STRATUM_BY_TYPE.get(b.type) || 'sample'; // fallback to Sample band
        if (!branchesByStratum.has(stratumId)) branchesByStratum.set(stratumId, []);
        branchesByStratum.get(stratumId).push(b);
    }

    const laneByBranch = new Map();
    const laneCountByStratum = new Map();
    visible.forEach((b, idx) => { b._modelOrder = idx; });
    for (const stratum of STRATA) {
        const branchesIn = branchesByStratum.get(stratum.id) || [];
        const intervals = branchesIn.map(b => {
            const ext = branchExtent.get(b.id);
            return {
                branchId: b.id,
                xMin: ext.xMin,
                xMax: ext.xMax,
                order: b._modelOrder,
            };
        });
        const { laneByBranchId, laneCount } = assignLanes(intervals, o.collisionGutter);
        for (const [id, lane] of laneByBranchId) laneByBranch.set(id, lane);
        laneCountByStratum.set(stratum.id, laneCount);
    }

    // ─── Step 4. Assign Y per stratum from cumulative heights ──────────
    // Above strata are stacked top-to-bottom: Bootleg at top, Sample just
    // above main. Each stratum gets `laneCount * laneGap` of vertical
    // room plus a `stratumGap` separator from the next.
    //
    // Within an above stratum, lane 0 is INNERMOST (closest to main),
    // lane N-1 is OUTERMOST. So lane 0's Y is at the BOTTOM of the band
    // (closest to mainY), lane N-1's Y is at the TOP of the band.
    //
    // Within the Dev stratum (below main), lane 0 is INNERMOST = TOP of
    // band; lane N-1 is OUTERMOST = BOTTOM.

    const ABOVE_STRATA = STRATA.filter(s => s.side === 'above');
    const DEV_STRATA = STRATA.filter(s => s.side === 'below');

    // A branch "bears a release" when any of its builds carries a customer
    // release event. Such a branch renders a star row ABOVE its dots and a
    // raised name label, so the row directly above it must reserve extra
    // clearance (req #2772 — see DEFAULT_OPTS.releaseClearance).
    const branchBearsRelease = (b) =>
        (b.buildIds || []).some(bid => (releaseEvents[bid]?.length || 0) > 0);
    const laneBearsRelease = (stratumId, lane) =>
        (branchesByStratum.get(stratumId) || []).some(
            b => (laneByBranch.get(b.id) || 0) === lane && branchBearsRelease(b)
        );
    const mainBearsRelease = branchBearsRelease(main);

    // req #2633 — AT visibility (master + Build AT sub-toggle).
    const showATs = o.showAcceptanceTests !== false;
    const showBuildAtEff = showATs && o.showBuildAt !== false;
    const buildAtRoom = showBuildAtEff ? o.buildAtClearance : 0;

    // Branch-level AT NAME labels stack DOWNWARD below a branch's latest build,
    // so a row carrying them must reserve extra room BELOW it (= above the next
    // row in the top-to-bottom walk), proportional to the deepest name stack in
    // the row. Only counts branches that actually render names (have builds +
    // branch-level ATs) and only when the master AT toggle is on.
    const branchAtNameCount = (b) =>
        (showATs && (b.buildIds || []).length > 0 && Array.isArray(b.acceptanceTests))
            ? b.acceptanceTests.length : 0;
    const laneMaxAtNames = (stratumId, lane) =>
        (branchesByStratum.get(stratumId) || []).reduce(
            (max, b) => ((laneByBranch.get(b.id) || 0) === lane
                ? Math.max(max, branchAtNameCount(b)) : max), 0);
    const mainAtNames = branchAtNameCount(main);
    // Extra vertical room a name-bearing row pushes onto the row below it.
    const atNamesExtent = (n) => (n > 0 ? n * ATNAME_LINE_H : 0);

    // Build the ordered list of horizontal rows, top-to-bottom, then walk it
    // ONCE accumulating Y. Each row carries the base gap that precedes it and a
    // flag for whether it needs release clearance ABOVE it. This replaces the
    // prior uniform `lane * laneGap` spacing so a release-bearing row ANYWHERE
    // (any above stratum/lane, main, or a dev lane) widens only the single gap
    // directly above it — release-free layouts are byte-for-byte unchanged.
    const keyOf = (sid, lane) => `${sid}:${lane}`;
    const aboveNonEmpty = ABOVE_STRATA.filter(s => (laneCountByStratum.get(s.id) || 0) > 0);
    const devNonEmpty = DEV_STRATA.filter(s => (laneCountByStratum.get(s.id) || 0) > 0);
    const gapFor = (stratum, fallback) => (stratum.gapAfter != null ? stratum.gapAfter : fallback);
    const rows = [];
    // Above strata top-to-bottom: farthest stratum first; within a stratum the
    // OUTERMOST lane (highest index) is highest on canvas, lane 0 nearest main.
    aboveNonEmpty.forEach((s, si) => {
        const lanes = laneCountByStratum.get(s.id);
        for (let lane = lanes - 1; lane >= 0; lane--) {
            // The very first (topmost) row sits a full laneGap below canvasPadTop
            // — the prior engine bottom-aligned the topmost stratum's band there,
            // so this reproduces the old absolute Y exactly for release-free
            // layouts (and leaves headroom for that lane's label/stars).
            const gapAbove = lane === lanes - 1
                ? (si === 0 ? o.laneGap : gapFor(aboveNonEmpty[si - 1], o.stratumGap))
                : o.laneGap;
            rows.push({ key: keyOf(s.id, lane), gapAbove,
                bearsRelease: laneBearsRelease(s.id, lane),
                atNames: laneMaxAtNames(s.id, lane) });
        }
    });
    // Main — a sideGap below the closest above stratum (and a sideGap below
    // canvasPadTop when there are no above strata, matching the prior layout).
    rows.push({ main: true, gapAbove: o.sideGap, bearsRelease: mainBearsRelease, atNames: mainAtNames });
    // Dev strata top-to-bottom: lane 0 (nearest main) first, growing downward.
    devNonEmpty.forEach((s, di) => {
        const lanes = laneCountByStratum.get(s.id);
        for (let lane = 0; lane < lanes; lane++) {
            const gapAbove = lane === 0
                ? (di === 0 ? o.sideGap : gapFor(devNonEmpty[di - 1], o.stratumGap))
                : o.laneGap;
            rows.push({ key: keyOf(s.id, lane), gapAbove,
                bearsRelease: laneBearsRelease(s.id, lane),
                atNames: laneMaxAtNames(s.id, lane) });
        }
    });

    // Single top-to-bottom walk assigning Y to every row. The release clearance
    // is added to the gap ABOVE each release-bearing row (including the very
    // first row, so its stars/label don't clip the top of the canvas).
    // req #2633 — when Build AT is shown it sits ABOVE every build (and above
    // the release stars on release-bearing builds), so every row reserves an
    // extra `buildAtClearance` (buildAtRoom, computed above) above it. This
    // stacks ON TOP of releaseClearance for release-bearing rows. Additionally,
    // a row carrying AT name labels pushes its name-stack DOWN into the gap
    // above the NEXT row, so the previous row's `atNamesExtent` is added too.
    const laneY = new Map();
    let mainY = o.canvasPadTop;
    let lastNamesExtent = 0; // names on the bottom-most row extend into the pad
    {
        let cursor = o.canvasPadTop;
        let prevNamesExtent = 0;
        for (const row of rows) {
            cursor += row.gapAbove + (row.bearsRelease ? o.releaseClearance : 0)
                + buildAtRoom + prevNamesExtent;
            if (row.main) mainY = cursor;
            else laneY.set(row.key, cursor);
            prevNamesExtent = atNamesExtent(row.atNames || 0);
        }
        lastNamesExtent = prevNamesExtent;
    }

    // Map each branch to its row Y.
    const branchY = new Map([[main.id, mainY]]);
    for (const b of visible) {
        const stratumId = STRATUM_BY_TYPE.get(b.type) || 'sample';
        const lane = laneByBranch.get(b.id) || 0;
        const y = laneY.get(keyOf(stratumId, lane));
        if (y == null) continue;
        branchY.set(b.id, y);
    }

    // Update build Y values now that branch Y is known.
    for (const b of branches) {
        const y = branchY.get(b.id);
        if (y == null) continue;
        for (const bid of (b.buildIds || [])) {
            if (positions[bid]) positions[bid].y = y;
        }
    }

    // ─── Step 5. Connectors ────────────────────────────────────────────
    // A connector is `whispy` (lighter + dashed) when its curve OR horizontal
    // line passes through another branch's row, so the underlying label /
    // version text stays readable. Two trigger conditions:
    //
    //   • crossesTrunk — parent and child sit on opposite sides of main, so
    //     the curve cuts through the main trunk line. (Existing behavior.)
    //
    //   • crossesOtherBranch (new) — another branch on the SAME side sits
    //     strictly between this branch and main, AND that other branch's
    //     horizontal line STRICTLY overlaps this curve's bow strip.
    //
    // Geometry of THIS curve: a cubic bezier from (parent.x, parent.y) to
    // (parent.x, branch.y) with control points at (parent.x − bow, …). The
    // curve's X strip at any Y in between is [parent.x − bow, parent.x].
    //
    // For another branch's horizontal line at otherY to lie inside that
    // strip we need TWO STRICT conditions:
    //   (a) other.xMin < parent.x  — the other line must extend to the LEFT
    //       of parent.x (otherwise it's at/right of where my curve lands).
    //   (b) other.xMax > parent.x − thisBow — the other line must reach
    //       INTO the strip (otherwise the curve flies past on the left).
    //
    // Strictly less-than on (a) is load-bearing: same-parent siblings have
    // `other.xMin == this.parent.x` exactly. Their horizontal lines start
    // AT parent.x and extend rightward; my curve flies LEFT of parent.x.
    // Loose <= would whispy every same-parent sibling-fan curve — the bug
    // that hid the "Sprint Cycle" hotfixes/bootlegs/CSRs entirely.
    //
    // The parent BRANCH (the branch on which this branch's parent build
    // sits) is also excluded — the curve originates at that branch's
    // horizontal line, so calling it a "crossing" double-counts the start
    // point. Example: a hotfix off release-1's build #2 starts at
    // release-1's line; release-1 is not a crossing.
    function crossesOtherBranch(branch, parentX, y, thisBow) {
        const sideAbove = y < mainY;
        for (const other of branchById.values()) {
            if (other === branch) continue;
            if (other.type === 'main') continue;
            if (other.id === branch.parentBranchId) continue;
            if (isHidden(other.id)) continue;
            const otherY = branchY.get(other.id);
            if (otherY == null) continue;
            const otherSideAbove = otherY < mainY;
            if (otherSideAbove !== sideAbove) continue;
            // `other` must sit strictly between this branch and the trunk.
            if (sideAbove) {
                if (!(y < otherY && otherY < mainY)) continue;
            } else {
                if (!(mainY < otherY && otherY < y)) continue;
            }
            const ext = branchExtent.get(other.id);
            if (!ext) continue;
            if (ext.xMin < parentX && ext.xMax > parentX - thisBow) return true;
        }
        return false;
    }

    const connectors = [];
    fullRoot.eachBefore(node => {
        if (node === fullRoot) return;
        const branch = node.data.ref;
        if (!branch || branch.type === 'main') return;
        if (isHidden(branch.id)) return;

        const parentBuildId = branch.parentBuildId;
        const parentPos = parentBuildId != null ? positions[parentBuildId] : null;
        const y = branchY.get(branch.id);
        if (!parentPos || y == null) return;

        const bowRank = bowRankFor(branch, y, branchById, branchY, mainY);
        const baseBow = o.colW * o.subBranchBowColumns;
        const bubbleWidth = 2 * dotRadiusFor(branch.type);
        const bow = baseBow + (bowRank - 1) * bubbleWidth;
        const p0 = { x: parentPos.x, y: parentPos.y };
        const p3 = { x: parentPos.x, y };
        const { p1, p2 } = connectorControlPoints(p0, p3, bow);

        const buildIds = branch.buildIds || [];
        // The follow-on tail arrow is UNCONDITIONAL (req #2603 follow-up): a
        // branch keeps its arrow even when a child branch (release/sample/any)
        // sprouts from its last build, because more builds can always be added to
        // it — the arrow is the "more builds possible here" affordance. The child
        // curve leaves the build dot up/down/left while this arrow extends right,
        // so the two never collide.
        const hasArrow = true;
        const lastId = buildIds.length ? buildIds[buildIds.length - 1] : null;
        const lastPos = lastId != null ? positions[lastId] : null;
        const arrowExt = o.colW * o.arrowExtColumns;
        // Empty branches extend to the first-build slot (p3.x + colW) so the
        // arrow sits where the first build would land.
        const emptySlotX = !buildIds.length ? p3.x + o.colW : null;
        const horizontalEndX = (lastPos ? Math.max(p3.x, lastPos.x) : (emptySlotX || p3.x)) + arrowExt;

        // Split into TWO paths:
        //   • curveD — the connector arrow from the parent build to the branch
        //     start. May go whispy when crossing another display item.
        //   • lineD — the branch's own horizontal data line (with the tail
        //     arrow). ALWAYS solid; this line carries the branch's identity
        //     and its build dots, so dashing it would dim real data.
        // Two SVG <path> elements per connector — the canvas renders them
        // separately so whispy-ness only applies to the arrow.
        const curveD = `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
        const lineD = `M ${p3.x} ${p3.y} L ${horizontalEndX} ${y}`;

        const crossesTrunk =
            (parentPos.y < mainY && y > mainY)
            || (parentPos.y > mainY && y < mainY);
        const crossesAnother = crossesOtherBranch(branch, parentPos.x, y, bow);

        connectors.push({
            branchId: branch.id,
            curveD,
            lineD,
            hasArrow,
            curveWhispy: crossesTrunk || crossesAnother,
        });
    });

    // ─── Step 6. Main trunk path ───────────────────────────────────────
    let mainPath = null;
    if (mainBuildIds.length > 0) {
        const first = positions[mainBuildIds[0]];
        const last = positions[mainBuildIds[mainBuildIds.length - 1]];
        mainPath = {
            d: `M ${first.x - 30} ${first.y} L ${last.x + o.colW * o.arrowExtColumns} ${first.y}`,
            firstBuildX: first.x,
            firstBuildY: first.y,
            hasArrow: true,
        };
    }

    // ─── Step 7. Build records ─────────────────────────────────────────
    // A `__gap__:…` sentinel id in a branch's buildIds is a semantic-zoom
    // collapse token (req #2864): it consumes one column like a real build (so
    // remaining builds pack tighter) but renders as a clickable "…" instead of a
    // dot. It has a position (set in Steps 1/4) but no buildsMap entry, so it is
    // captured into `collapseTokens` here and skipped for build records. When no
    // sentinels are present this branch is never taken and the output is
    // byte-identical to the pre-#2864 engine.
    const buildRecords = [];
    const collapseTokens = [];
    for (const b of branches) {
        if (isHidden(b.id)) continue;
        const r = dotRadiusFor(b.type);
        (b.buildIds || []).forEach((bid, i) => {
            const pos = positions[bid];
            if (isGapId(bid)) {
                if (pos) collapseTokens.push({ id: bid, branchId: b.id, x: pos.x, y: pos.y });
                return;
            }
            const data = buildsMap[bid];
            if (!pos || !data) return;
            const laneOffset = (o.versionLanes && i % 2 === 1) ? o.versionLaneGap : 0;
            buildRecords.push({
                id: bid,
                branchId: b.id,
                branchType: b.type,
                x: pos.x,
                y: pos.y,
                radius: r,
                dotColor: data.dotColor || null,
                approvedForRelease: !!data.approvedForRelease,
                version: formatVersion(fromModelBuild(data)),
                versionX: pos.x,
                versionY: pos.y + r + o.versionCloseOffset + laneOffset,
                releaseCustomers: releaseEvents[bid] || [],
                releaseDetails: releaseEventDetails[bid] || [],
            });
        });
    }

    // ─── Step 8. Branch labels ─────────────────────────────────────────
    const branchRecords = branches.filter(b => !isHidden(b.id)).map(b => {
        const y = branchY.get(b.id);
        const buildIds = b.buildIds || [];
        const isMain = b.type === 'main';
        if (isMain) {
            return {
                id: b.id, type: b.type, name: b.name || '', side: 'center',
                y, isMain: true,
                labelX: null, labelY: null,
            };
        }
        const parentBuildId = b.parentBuildId;
        const parentPos = parentBuildId != null ? positions[parentBuildId] : null;
        const stratumId = STRATUM_BY_TYPE.get(b.type) || 'sample';
        const stratumDef = STRATA.find(s => s.id === stratumId);
        if (!parentPos || !b.name) {
            return {
                id: b.id, type: b.type, name: b.name || '', side: stratumDef.side,
                y, isMain: false,
                labelX: null, labelY: null,
            };
        }
        // When a branch has release events, the release glyphs sit ABOVE the
        // dots (req #2741). Give the branch NAME its own higher "top track" so
        // it clears that glyph row; branches without releases keep the normal
        // -16 track (req #2741 — name = top track, releases = next track down).
        const hasRelease = (b.buildIds || []).some(bid => releaseEvents[bid]?.length > 0);
        return {
            id: b.id,
            type: b.type,
            name: b.name || '',
            side: stratumDef.side,
            y,
            isMain: false,
            labelX: parentPos.x + 10,
            labelY: y - (hasRelease ? 34 : 16),
        };
    });

    // ─── Step 8b. Acceptance Tests (req #2633) ─────────────────────────
    // Two kinds (see acceptanceTestConfig.js):
    //   • Branch-level ATs → stacked name labels below the branch's LATEST
    //     build + a single pass/fail glyph (green ✓ / red ✗) from the branch's
    //     acceptanceStatus.
    //   • Build AT → an automatic per-build self-loop glyph (always pass) on
    //     every build of a buildAT branch type.
    const atBranchGlyphs = [];
    const atBuildLoops = [];
    for (const b of branches) {
        if (isHidden(b.id)) continue;
        // Real builds only — semantic-zoom collapse (req #2864) inserts
        // `__gap__` sentinels into buildIds; an AT glyph/loop on a sentinel would
        // paint on top of the "…" collapse token. Skip them everywhere here.
        const buildIds = (b.buildIds || []).filter(id => !isGapId(id));
        const r = dotRadiusFor(b.type);
        // Branch-level AT glyph sits MID-SEGMENT on the branch line, between the
        // last build and the penultimate build (req #2633 review round). Names
        // stay anchored below the LATEST build. With a single build there is no
        // penultimate, so the glyph sits half a column back toward the branch
        // shoulder.
        const names = (showATs && Array.isArray(b.acceptanceTests)) ? b.acceptanceTests : [];
        if (names.length && buildIds.length) {
            const lastPos = positions[buildIds[buildIds.length - 1]];
            const prevPos = buildIds.length >= 2 ? positions[buildIds[buildIds.length - 2]] : null;
            if (lastPos) {
                const midX = prevPos
                    ? (lastPos.x + prevPos.x) / 2
                    : lastPos.x - o.colW * 0.5;
                atBranchGlyphs.push({
                    branchId: b.id,
                    x: midX,             // glyph: mid-segment, on the line
                    y: lastPos.y,
                    namesX: lastPos.x,   // name labels: below the latest build
                    namesY: lastPos.y,
                    // Names start below the version far-lane (no build-number
                    // conflict) and step by nameLineH; the lane spacing reserves
                    // room for the full stack (req #2633 review round).
                    namesStartY: lastPos.y + r + ATNAME_TOP_OFFSET,
                    nameLineH: ATNAME_LINE_H,
                    radius: r,
                    status: b.acceptanceStatus === 'fail' ? 'fail' : 'pass',
                    names,
                });
            }
        }
        // Build AT — per-build loop glyph on EVERY build (req #2633 review
        // round), gated by the effective Build AT toggle (master ATs AND the
        // Build AT sub-toggle). Each loop knows whether its build also bears a
        // release event.
        if (showBuildAtEff && b.buildAT) {
            buildIds.forEach(bid => {
                const pos = positions[bid];
                if (pos) {
                    atBuildLoops.push({
                        buildId: bid, branchId: b.id,
                        x: pos.x, y: pos.y, radius: r,
                        hasRelease: (releaseEvents[bid]?.length || 0) > 0,
                    });
                }
            });
        }
    }

    // ─── Step 9. Main endpoint labels ──────────────────────────────────
    let mainEndpointLabels = null;
    if (mainBuildIds.length > 0) {
        const first = positions[mainBuildIds[0]];
        const last = positions[mainBuildIds[mainBuildIds.length - 1]];
        mainEndpointLabels = {
            leftX: first.x - 60,
            leftY: first.y + 5,
            leftText: main.name || 'Main',
            rightX: main.labelEnd ? last.x + 50 : null,
            rightY: main.labelEnd ? last.y + 22 : null,
            rightText: main.labelEnd || null,
        };
    }

    // ─── Step 10. Stratum bands (rendered behind everything by canvas) ─
    const strataBands = ABOVE_STRATA.concat(DEV_STRATA).map(s => {
        const lanes = laneCountByStratum.get(s.id) || 0;
        if (lanes === 0) return null;
        // Read each lane's actual Y (lane spacing is no longer uniform once a
        // release-bearing lane has reserved extra clearance — req #2772).
        const laneYs = [];
        for (let lane = 0; lane < lanes; lane++) {
            const y = laneY.get(keyOf(s.id, lane));
            if (y != null) laneYs.push(y);
        }
        if (!laneYs.length) return null;
        const yTop = Math.min(...laneYs) - o.laneGap * 0.5;
        const yBottom = Math.max(...laneYs) + o.laneGap * 0.5;
        return {
            id: s.id,
            label: s.label,
            side: s.side,
            laneCount: lanes,
            yTop,
            yBottom,
            bandFill: s.bandFill || 'transparent',
        };
    }).filter(Boolean);

    // ─── Step 10b. Empty-branch anchors ─────────────────────────────────
    // One per visible non-main branch with zero builds — the hover target
    // position where the first build would sit. Used by the canvas to render
    // an Execute-Build-only hover anchor at the arrow tip.
    const emptyAnchors = [];
    for (const b of visible) {
        if ((b.buildIds || []).length > 0) continue;
        const parentBuildId = b.parentBuildId;
        const parentPos = parentBuildId != null ? positions[parentBuildId] : null;
        if (!parentPos) continue;
        const y = branchY.get(b.id);
        if (y == null) continue;
        emptyAnchors.push({
            branchId: b.id,
            x: parentPos.x + o.colW,   // first-build slot
            y,
            radius: dotRadiusFor(b.type),
        });
    }

    // ─── Step 11. Canvas size ──────────────────────────────────────────
    const yValues = Array.from(branchY.values());
    const lowestY = yValues.length ? Math.max(...yValues) : mainY;
    // Width must span the RIGHTMOST visible build, not just main's last build:
    // a sub-branch off a late main build (e.g. a dev branch with several builds)
    // can extend past main's tail, and the <svg> viewport clips anything beyond
    // `width` (req #2741 — fixed a cut-off where added builds weren't shown).
    // Also include empty-anchor x values so the arrow isn't clipped.
    const allXValues = [
        ...buildRecords.map(r => r.x),
        ...emptyAnchors.map(a => a.x),
    ];
    const maxBuildX = allXValues.length
        ? Math.max(...allXValues)
        : o.leftPad + Math.max(0, mainBuildIds.length - 1) * o.colW;
    const arrowTail = o.colW * o.arrowExtColumns;
    const totalWidth = maxBuildX + arrowTail + o.rightPad + 160;
    // Include the bottom-most row's AT-name stack so it isn't clipped (req #2633).
    const totalHeight = Math.ceil(lowestY + o.canvasPadBottom + lastNamesExtent);

    // Cleanup transient markers.
    for (const b of branches) { delete b._modelOrder; }

    return {
        branches: branchRecords,
        builds: buildRecords,
        connectors,
        mainPath,
        mainEndpointLabels,
        strata: strataBands,
        emptyAnchors,
        collapseTokens,   // req #2864 — semantic-zoom "…" collapse tokens
        atBranchGlyphs,   // req #2633 — branch-level AT glyph + name labels
        atBuildLoops,     // req #2633 — per-build Build AT loops
        width: totalWidth,
        height: totalHeight,
        mainY,
    };
}

export default computeLayout;
