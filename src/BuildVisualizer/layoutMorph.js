// layoutMorph.js — smooth "general update" tween between two Build Visualizer
// layouts (req #2895).
//
// When a same-project data change reflows the diagram (add a customer release →
// a branch reserves a star-clearance band and its rows shift; toggle Build AT;
// hide a branch type; add a build that grows a lane), the engine emits a brand
// new `layout` with different Y positions. Re-rendering it directly makes the
// changed region JUMP. This module interpolates every glyph from its previous
// position to its new one so unchanged content sits still and changed content
// glides — the "leave everything in place that doesn't change" ask.
//
// ── Coordinate frame ────────────────────────────────────────────────────────
// The morph runs in mainY-RELATIVE space, paired with the canvas's instant
// trunk-pin (which shifts the d3-zoom transform so the new mainY renders where
// the old one was). Callers pass `dyPrev = nextMainY - prevMainY`; every PREV
// Y coordinate is shifted by `dyPrev` before the lerp. Net effect: at p=0 every
// glyph sits exactly where it was on screen a moment ago; at p=1 it sits at its
// final position; the trunk (whose relative Y is ~0 in both) never moves. X is
// never pinned (the layout is left-anchored and X is stable across reflows), so
// X interpolates plainly.
//
// Nodes are matched by stable id. A node only in `next` (e.g. a freshly added
// release star's owning build already existed, but a brand-new build/glyph) is
// rendered at its FINAL position. A node only in `prev` (removed) is dropped.
// Path strings (`d`) are interpolated component-wise when the two commands
// sequences match; on any structural mismatch that element snaps to `next` — a
// safe, jump-free-enough fallback.

// Cubic ease-out — fast start, gentle settle. Exposed for the driver + tests.
export function easeCubicOut(t) {
    const x = t < 0 ? 0 : t > 1 ? 1 : t;
    const u = 1 - x;
    return 1 - u * u * u;
}

export function lerp(a, b, p) {
    return a + (b - a) * p;
}

// A stable string capturing EVERY coordinate the morph would interpolate. Two
// layouts with the same signature are geometrically identical — morphing between
// them is a visual no-op. The Build Visualizer's mutations invalidate several
// TanStack queries (branches + builds + customer_releases) that resolve at
// different times; each resolution rebuilds `model` → `layout` as a NEW object,
// so several geometrically-identical layouts can arrive back-to-back. Keying the
// morph driver off this signature (instead of layout object identity) collapses
// that cascade into a single tween — no redundant second animation (req #2895).
// computeLayout is deterministic, so identical geometry yields byte-identical
// numbers → an exact string match (no float-noise rounding needed).
export function layoutSignature(layout) {
    if (!layout) return '';
    const parts = [layout.mainY ?? '', layout.width ?? ''];
    for (const b of layout.builds || []) parts.push('b', b.id, b.x, b.y, b.radius);
    for (const br of layout.branches || []) parts.push('r', br.id, br.labelX, br.labelY);
    for (const s of layout.strata || []) parts.push('s', s.id, s.yTop, s.yBottom);
    for (const c of layout.connectors || []) parts.push('c', c.branchId, c.curveD, c.lineD);
    for (const a of layout.emptyAnchors || []) parts.push('e', a.branchId, a.x, a.y);
    for (const t of layout.collapseTokens || []) parts.push('t', t.id, t.x, t.y);
    for (const l of layout.atBuildLoops || []) parts.push('l', l.buildId, l.x, l.y);
    for (const g of layout.atBranchGlyphs || []) parts.push('g', g.branchId, g.x, g.y, g.namesY);
    if (layout.mainPath) parts.push('mp', layout.mainPath.d);
    return parts.join('|');
}

// Interpolate a numeric field present on both nodes; if either is missing fall
// back to whichever is defined (keeps optional fields from throwing).
function lerpField(prevNode, nextNode, key, p, dy = 0) {
    const a = prevNode?.[key];
    const b = nextNode?.[key];
    if (typeof a !== 'number' || typeof b !== 'number') {
        return typeof b === 'number' ? b : a;
    }
    return lerp(a + dy, b, p);
}

// Split an SVG path `d` (only M / L / C / Z — the shapes the engine emits) into
// a sequence of { cmd, nums:[...] }. Returns null if an unexpected command is
// seen so the caller can snap.
function parsePath(d) {
    if (typeof d !== 'string') return null;
    const tokens = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/gi);
    if (!tokens) return null;
    const out = [];
    let i = 0;
    while (i < tokens.length) {
        const cmd = tokens[i];
        if (!/[MLCZ]/i.test(cmd)) return null;
        i += 1;
        const nums = [];
        while (i < tokens.length && !/[MLCZ]/i.test(tokens[i])) {
            nums.push(Number(tokens[i]));
            i += 1;
        }
        out.push({ cmd, nums });
    }
    return out;
}

function sameStructure(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let k = 0; k < a.length; k++) {
        if (a[k].cmd.toUpperCase() !== b[k].cmd.toUpperCase()) return false;
        if (a[k].nums.length !== b[k].nums.length) return false;
    }
    return true;
}

// Interpolate two path strings. `dy` is added to every PREV y-coordinate (odd
// indices within each command's number list — the engine only emits absolute
// M/L/C, so numbers are x,y pairs) before the lerp. Structural mismatch → next.
export function lerpPath(dPrev, dNext, p, dy = 0) {
    if (dNext == null) return dPrev;
    if (dPrev == null) return dNext;
    const a = parsePath(dPrev);
    const b = parsePath(dNext);
    if (!sameStructure(a, b)) return dNext;
    const parts = [];
    for (let k = 0; k < a.length; k++) {
        const nums = [];
        for (let n = 0; n < a[k].nums.length; n++) {
            const isY = n % 2 === 1;
            const av = a[k].nums[n] + (isY ? dy : 0);
            nums.push(lerp(av, b[k].nums[n], p));
        }
        parts.push(nums.length ? `${a[k].cmd} ${nums.map(fmt).join(' ')}` : a[k].cmd);
    }
    return parts.join(' ');
}

function fmt(n) {
    // Trim to 3 decimals to keep path strings compact without visible snapping.
    return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

// Build a Map keyed by `keyFn` over an array (missing array → empty Map).
function indexBy(arr, keyFn) {
    const m = new Map();
    for (const el of arr || []) m.set(keyFn(el), el);
    return m;
}

// Interpolate an array of nodes. Output follows `nextArr` (so new nodes appear
// and removed ones drop); matched nodes get `mutate(prevNode, nextNode)`.
function morphArray(prevArr, nextArr, keyFn, mutate) {
    if (!nextArr) return nextArr;
    const prevMap = indexBy(prevArr, keyFn);
    return nextArr.map((nextNode) => {
        const prevNode = prevMap.get(keyFn(nextNode));
        return prevNode ? mutate(prevNode, nextNode) : nextNode;
    });
}

// Interpolate a whole layout at eased progress `p` (0 → 1). `dyPrev` aligns the
// prev frame to the pinned trunk. Non-geometry fields (colors, version text,
// names, flags, width/height/mainY) are taken from `next`.
export function interpolateLayout(prev, next, p, dyPrev = 0) {
    if (!prev) return next;
    if (p >= 1) return next;
    const dy = dyPrev;

    const build = (prevN, nextN) => ({
        ...nextN,
        x: lerpField(prevN, nextN, 'x', p),
        y: lerpField(prevN, nextN, 'y', p, dy),
        versionX: lerpField(prevN, nextN, 'versionX', p),
        versionY: lerpField(prevN, nextN, 'versionY', p, dy),
        radius: lerpField(prevN, nextN, 'radius', p),
    });

    return {
        ...next,
        strata: morphArray(prev.strata, next.strata, s => s.id, (a, b) => ({
            ...b,
            yTop: lerpField(a, b, 'yTop', p, dy),
            yBottom: lerpField(a, b, 'yBottom', p, dy),
        })),
        mainPath: next.mainPath && prev.mainPath
            ? { ...next.mainPath, d: lerpPath(prev.mainPath.d, next.mainPath.d, p, dy) }
            : next.mainPath,
        connectors: morphArray(prev.connectors, next.connectors, c => c.branchId, (a, b) => ({
            ...b,
            curveD: lerpPath(a.curveD, b.curveD, p, dy),
            lineD: lerpPath(a.lineD, b.lineD, p, dy),
        })),
        branches: morphArray(prev.branches, next.branches, br => br.id, (a, b) => ({
            ...b,
            labelX: lerpField(a, b, 'labelX', p),
            labelY: lerpField(a, b, 'labelY', p, dy),
        })),
        mainEndpointLabels: next.mainEndpointLabels && prev.mainEndpointLabels
            ? {
                ...next.mainEndpointLabels,
                leftX: lerpField(prev.mainEndpointLabels, next.mainEndpointLabels, 'leftX', p),
                leftY: lerpField(prev.mainEndpointLabels, next.mainEndpointLabels, 'leftY', p, dy),
                rightX: lerpField(prev.mainEndpointLabels, next.mainEndpointLabels, 'rightX', p),
                rightY: lerpField(prev.mainEndpointLabels, next.mainEndpointLabels, 'rightY', p, dy),
            }
            : next.mainEndpointLabels,
        builds: morphArray(prev.builds, next.builds, b => b.id, build),
        emptyAnchors: morphArray(prev.emptyAnchors, next.emptyAnchors, a => a.branchId, (a, b) => ({
            ...b,
            x: lerpField(a, b, 'x', p),
            y: lerpField(a, b, 'y', p, dy),
            radius: lerpField(a, b, 'radius', p),
        })),
        collapseTokens: morphArray(prev.collapseTokens, next.collapseTokens, t => t.id, (a, b) => ({
            ...b,
            x: lerpField(a, b, 'x', p),
            y: lerpField(a, b, 'y', p, dy),
        })),
        atBuildLoops: morphArray(prev.atBuildLoops, next.atBuildLoops, l => l.buildId, (a, b) => ({
            ...b,
            x: lerpField(a, b, 'x', p),
            y: lerpField(a, b, 'y', p, dy),
            radius: lerpField(a, b, 'radius', p),
        })),
        atBranchGlyphs: morphArray(prev.atBranchGlyphs, next.atBranchGlyphs, g => g.branchId, (a, b) => ({
            ...b,
            x: lerpField(a, b, 'x', p),
            y: lerpField(a, b, 'y', p, dy),
            namesX: lerpField(a, b, 'namesX', p),
            namesY: lerpField(a, b, 'namesY', p, dy),
            namesStartY: lerpField(a, b, 'namesStartY', p, dy),
        })),
    };
}

export default interpolateLayout;
