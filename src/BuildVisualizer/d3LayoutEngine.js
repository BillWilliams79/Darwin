// req #2694 — Build Visualizer D3 — strata + interval-scheduling layout engine.
//
// The Y arrangement is governed by two ideas:
//
// 1. **Strata** (the domain model). Each branch type lives in its own
//    horizontal band, in this order top-to-bottom:
//      • Stratum 1: Hot Fix
//      • Stratum 2: Bootleg
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

export const REGISTRY = {
    main:             { label: 'Main',                 dotRadius: 5.5, defaultSide: 'center' },
    release:          { label: 'Release',              dotRadius: 6.0, defaultSide: 'above' },
    'sample-release': { label: 'Sprint Release',        dotRadius: 5.5, defaultSide: 'above' },
    hotfix:           { label: 'Hot Fix',              dotRadius: 5.5, defaultSide: 'above' },
    bootleg:          { label: 'Bootleg',              dotRadius: 5.5, defaultSide: 'above' },
    csr:              { label: 'CSR',                  dotRadius: 5.5, defaultSide: 'above' },
    development:      { label: 'Dev Branch',           dotRadius: 5.5, defaultSide: 'below' },
};

// Strata are ordered top-to-bottom in SVG. Position 0 = top of canvas;
// position N-1 = bottom. `position` of 'main' is the trunk anchor. Strata
// above main render in increasing distance from main as position drops
// (Sample is closest to main; Hot Fix is farthest above).
const STRATA = [
    { id: 'hotfix',  label: 'Hot Fix',         types: ['hotfix'],         side: 'above', bandFill: 'rgba(229, 57, 53, 0.04)' },
    { id: 'bootleg', label: 'Bootleg',         types: ['bootleg'],        side: 'above', bandFill: 'rgba(253, 216, 53, 0.04)' },
    { id: 'csr',     label: 'CSR',             types: ['csr'],            side: 'above', bandFill: 'rgba(0, 0, 0, 0.025)' },
    { id: 'release', label: 'Release',         types: ['release'],        side: 'above', bandFill: 'rgba(34, 197, 94, 0.04)', gapAfter: 90 },
    { id: 'sample',  label: 'Sprint Release',  types: ['sample-release'], side: 'above', bandFill: 'rgba(59, 130, 246, 0.04)' },
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
    // Length of the tail line past the last build dot, in colW units.
    // Halved from the iframe's 0.7 (req #2694 follow-up) so dev branches
    // with many builds don't bleed visual weight into the column to their
    // right. Tighter tail = more breathing room without losing the arrow.
    arrowExtColumns: 0.35,
    versionCloseOffset: 12,
    versionLaneGap: 12,
    versionLanes: true,
    hiddenBranchIds: null,
    canvasPadTop: 40,
    canvasPadBottom: 70,
};

function cfgFor(type) {
    return REGISTRY[type] || REGISTRY.development;
}

function dotRadiusFor(type) {
    return cfgFor(type).dotRadius;
}

function horizontalExtentFor(branch, parentX, opts) {
    const colW = opts.colW;
    const nBuilds = (branch.buildIds || []).length;
    const lastBuildX = nBuilds > 0 ? parentX + nBuilds * colW : parentX;
    const hasArrow = !branch._hasChildAtLastBuild;
    const arrowExt = hasArrow ? colW * opts.arrowExtColumns : 0;
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

    if (!branches.length) {
        return {
            branches: [], builds: [], connectors: [],
            mainPath: null, mainEndpointLabels: null,
            strata: [],
            width: 800, height: 200, mainY: 0,
        };
    }

    const branchById = new Map(branches.map(b => [b.id, b]));
    const main = branches.find(b => b.type === 'main') || branches[0];
    const hidden = o.hiddenBranchIds instanceof Set ? o.hiddenBranchIds : new Set();
    const isHidden = (id) => hidden.has(id);

    // Pre-compute "has a child branch off my last build?".
    for (const b of branches) {
        const buildIds = b.buildIds || [];
        if (!buildIds.length) { b._hasChildAtLastBuild = false; continue; }
        const lastId = buildIds[buildIds.length - 1];
        b._hasChildAtLastBuild = branches.some(other => other.parentBuildId === lastId);
    }

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
    // Above strata are stacked top-to-bottom: Hot Fix at top, Sample just
    // above main. Each stratum gets `laneCount * laneGap` of vertical
    // room plus a `stratumGap` separator from the next.
    //
    // Within an above stratum, lane 0 is INNERMOST (closest to main),
    // lane N-1 is OUTERMOST. So lane 0's Y is at the BOTTOM of the band
    // (closest to mainY), lane N-1's Y is at the TOP of the band.
    //
    // Within the Dev stratum (below main), lane 0 is INNERMOST = TOP of
    // band; lane N-1 is OUTERMOST = BOTTOM.

    // Compute Y of the bottom of each above stratum (i.e. lane 0).
    const ABOVE_STRATA = STRATA.filter(s => s.side === 'above');
    const DEV_STRATA = STRATA.filter(s => s.side === 'below');

    let mainY = o.canvasPadTop;
    // Cumulative height of all above strata + stratum gaps + sideGap from
    // the topmost above stratum to mainY.
    for (let i = 0; i < ABOVE_STRATA.length; i++) {
        const stratum = ABOVE_STRATA[i];
        const lanes = laneCountByStratum.get(stratum.id) || 0;
        if (lanes > 0) {
            mainY += lanes * o.laneGap;
            // Stratum-gap between adjacent non-empty above strata.
            // Use per-stratum gapAfter when defined (e.g. release→sample
            // gets a larger gap for visual differentiation).
            const nextNonEmpty = ABOVE_STRATA
                .slice(i + 1)
                .find(s => (laneCountByStratum.get(s.id) || 0) > 0);
            if (nextNonEmpty) {
                mainY += (stratum.gapAfter != null ? stratum.gapAfter : o.stratumGap);
            }
        }
    }
    // Add sideGap between the closest above stratum (Sample) and main.
    mainY += o.sideGap;

    // Re-walk to assign each above stratum's lane-0 Y (innermost, near main).
    // Outermost lanes (higher index) sit FURTHER from main = HIGHER in SVG.
    const stratumLane0Y = new Map();
    {
        let cursor = mainY - o.sideGap; // sample lane 0 sits here
        for (let i = ABOVE_STRATA.length - 1; i >= 0; i--) {
            const stratum = ABOVE_STRATA[i];
            const lanes = laneCountByStratum.get(stratum.id) || 0;
            if (lanes === 0) { stratumLane0Y.set(stratum.id, cursor); continue; }
            stratumLane0Y.set(stratum.id, cursor);
            // Reserve room for this stratum's lanes; cursor moves UP by
            // (lanes-1) × laneGap (lanes occupy from cursor up to
            // cursor - (lanes-1)*laneGap), then gap to the next stratum.
            cursor -= (lanes - 1) * o.laneGap;
            // If there's a non-empty stratum above this one, apply the
            // per-stratum gapAfter from that stratum (it sits above us, so
            // its gapAfter is the gap between IT and us). Walk upward to
            // find it, then read its gapAfter.
            const nextAbove = ABOVE_STRATA
                .slice(0, i)
                .reverse()
                .find(s => (laneCountByStratum.get(s.id) || 0) > 0);
            if (nextAbove) {
                cursor -= (nextAbove.gapAfter != null ? nextAbove.gapAfter : o.stratumGap);
            }
        }
    }
    // Dev: lane 0 sits at mainY + sideGap, growing DOWN by laneGap per lane.
    if (DEV_STRATA.length) {
        stratumLane0Y.set(DEV_STRATA[0].id, mainY + o.sideGap);
    }

    // Map each branch to its Y.
    const branchY = new Map([[main.id, mainY]]);
    for (const b of visible) {
        const stratumId = STRATUM_BY_TYPE.get(b.type) || 'sample';
        const stratumDef = STRATA.find(s => s.id === stratumId);
        const lane = laneByBranch.get(b.id) || 0;
        const lane0Y = stratumLane0Y.get(stratumId);
        if (lane0Y == null) continue;
        const direction = stratumDef.side === 'above' ? -1 : 1;
        branchY.set(b.id, lane0Y + lane * o.laneGap * direction);
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
        const hasArrow = !branch._hasChildAtLastBuild;
        const lastId = buildIds.length ? buildIds[buildIds.length - 1] : null;
        const lastPos = lastId != null ? positions[lastId] : null;
        const arrowExt = hasArrow ? o.colW * o.arrowExtColumns : 0;
        const horizontalEndX = (lastPos ? Math.max(p3.x, lastPos.x) : p3.x) + arrowExt;

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
            d: `M ${first.x - 30} ${first.y} L ${last.x + o.colW * 0.9} ${first.y}`,
            firstBuildX: first.x,
            firstBuildY: first.y,
            hasArrow: true,
        };
    }

    // ─── Step 7. Build records ─────────────────────────────────────────
    const buildRecords = [];
    for (const b of branches) {
        if (isHidden(b.id)) continue;
        const r = dotRadiusFor(b.type);
        (b.buildIds || []).forEach((bid, i) => {
            const pos = positions[bid];
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
                version: `${data.major}.${data.minor}.${data.build}.${data.branchNum}`,
                versionX: pos.x,
                versionY: pos.y + r + o.versionCloseOffset + laneOffset,
                releaseCustomers: releaseEvents[bid] || [],
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
        if (!parentPos || buildIds.length === 0 || !b.name) {
            return {
                id: b.id, type: b.type, name: b.name || '', side: stratumDef.side,
                y, isMain: false,
                labelX: null, labelY: null,
            };
        }
        return {
            id: b.id,
            type: b.type,
            name: b.name || '',
            side: stratumDef.side,
            y,
            isMain: false,
            labelX: parentPos.x + 10,
            labelY: y - 16,
        };
    });

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
        const lane0Y = stratumLane0Y.get(s.id);
        const direction = s.side === 'above' ? -1 : 1;
        const lastLaneY = lane0Y + (lanes - 1) * o.laneGap * direction;
        const yTop = Math.min(lane0Y, lastLaneY) - o.laneGap * 0.5;
        const yBottom = Math.max(lane0Y, lastLaneY) + o.laneGap * 0.5;
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

    // ─── Step 11. Canvas size ──────────────────────────────────────────
    const yValues = Array.from(branchY.values());
    const lowestY = yValues.length ? Math.max(...yValues) : mainY;
    const totalWidth = o.leftPad + Math.max(0, mainBuildIds.length - 1) * o.colW + o.rightPad + 160;
    const totalHeight = Math.ceil(lowestY + o.canvasPadBottom);

    // Cleanup transient markers.
    for (const b of branches) { delete b._hasChildAtLastBuild; delete b._modelOrder; }

    return {
        branches: branchRecords,
        builds: buildRecords,
        connectors,
        mainPath,
        mainEndpointLabels,
        strata: strataBands,
        width: totalWidth,
        height: totalHeight,
        mainY,
    };
}

export default computeLayout;
