// Build Visualizer — VersionEngine (req #2737).
//
// THE single source of truth for version numbers (M.m.B.b). Authoritative rules
// live in memory/build-visualizer-design.md §4; this module is their executable
// form. Every place that creates a build or a branch — and every place that
// renders a version string — MUST route through here. No inline version
// arithmetic anywhere else (that scattering is exactly why prior version fixes
// never stuck).
//
// Canonical version object: { major, minor, build, branchNumber }
//   major (M), minor (m) — declared by management, stamped per-build (§4.2).
//                          A build never looks back to derive its M.m.
//   build (B)            — monotonic on main; FROZEN to the parent build's B on
//                          every sub-branch (§4.3).
//   branchNumber (b)     — 0 on main; reserved-range walk on subs (§4.4).
//
// Naming bridges (two pre-existing conventions this module reconciles):
//   • in-memory model build → { build, branchNum, major, minor }  (useBuildVisualizerData)
//   • SQL `builds` row       → { build_number, branch_number, major, minor }
// Use fromModelBuild() / toBuildRow() at the boundaries; the engine itself only
// ever speaks the canonical shape above.

export const MAIN_BRANCH_NUMBER = 0;

// §4.2 — a branch is "open" when it has no valid current M.m. Only `main`
// becomes open, and only when a `release` branch carries main's M.m away. The
// open state is persisted with an out-of-range sentinel (any major/minor < 0)
// so it needs no schema change (the INT columns already accept it) and can
// never collide with a user-chosen M.m (validation requires M ≥ 0, m ≥ 0).
// There is NO auto-assignment: an open main must be given a new M.m by the
// user before its next build, and a build on an open branch is refused until
// that happens.
export const OPEN_SENTINEL = -1;

/** True when this M.m is unassigned / open (null/undefined component, or < 0). */
export function isOpenMm(mm) {
    if (mm == null) return true;
    if (mm.major == null || mm.minor == null) return true; // explicit null = open
    const M = Number(mm.major);
    const m = Number(mm.minor);
    return !Number.isFinite(M) || !Number.isFinite(m) || M < 0 || m < 0;
}

/** The persisted "open" M.m written to a branch when it loses its version. */
export function openMm() {
    return { major: OPEN_SENTINEL, minor: OPEN_SENTINEL };
}

// §4.4 reserved-range table. For a sub-branch:
//     branchNumber = base + (ord0 + ordBase) * stride + buildIndex
// `ord0` is the 0-indexed ordinal of this branch among same-type sibling
// branches off the same parent build. `csr` is expressed with ordBase=1 so it
// evaluates to ord1 * 1000 (csr-1 → 1000–1999, csr-2 → 2000–2999). `main` is
// special-cased to MAIN_BRANCH_NUMBER and never consults this table.
const BRANCH_NUMBER_RULES = {
    release:          { base: 1,    stride: 50,   ordBase: 0 },
    'sample-release': { base: 1,    stride: 50,   ordBase: 0 },
    csr:              { base: 0,    stride: 1000, ordBase: 1 },
    hotfix:           { base: 6000, stride: 50,   ordBase: 0 },
    development:      { base: 7000, stride: 100,  ordBase: 0 },
    bootleg:          { base: 9000, stride: 50,   ordBase: 0 },
};
const FALLBACK_RULE = BRANCH_NUMBER_RULES.development;

// Nullish-preserving numeric coercion — keeps an explicit 0 (e.g. Major=0)
// rather than collapsing it to a fallback the way `Number(x) || fallback` does.
const num = (v, fallback) => (v == null || Number.isNaN(Number(v)) ? fallback : Number(v));

/**
 * §4.4 — Branch# for the build at `buildIndex` (0-based) on a sub-branch that is
 * the `ord0`-th (0-based) of its type off its parent build. `main` → 0.
 */
export function computeBranchNumber(branchType, ord0 = 0, buildIndex = 0) {
    if (branchType === 'main') return MAIN_BRANCH_NUMBER;
    const rule = BRANCH_NUMBER_RULES[branchType] || FALLBACK_RULE;
    return rule.base + (ord0 + rule.ordBase) * rule.stride + buildIndex;
}

/** Render a canonical version object as the `M.m.B.b` string. */
export function formatVersion(v) {
    if (!v) return '';
    return `${num(v.major, 0)}.${num(v.minor, 0)}.${num(v.build, 0)}.${num(v.branchNumber, 0)}`;
}

/** Adapt an in-memory model build (`{build, branchNum, major, minor}`) → canonical. */
export function fromModelBuild(b) {
    if (!b) return null;
    return {
        major: num(b.major, 1),
        minor: num(b.minor, 0),
        build: num(b.build, 0),
        branchNumber: num(b.branchNum, 0),
    };
}

/** Adapt a canonical version object → `builds` SQL row columns. */
export function toBuildRow(v) {
    return {
        build_number: num(v.build, 1),
        branch_number: num(v.branchNumber, 0),
        major: num(v.major, 1),
        minor: num(v.minor, 0),
    };
}

/**
 * §4.6 — first build on a brand-new project's main trunk. `initialBuildNumber`
 * seeds the trunk's monotonic Build# (defaults to 1); Branch# is always 0.
 */
export function firstMainBuildVersion({ major = 1, minor = 0, initialBuildNumber = 1 } = {}) {
    return {
        major: num(major, 1),
        minor: num(minor, 0),
        build: Math.max(1, num(initialBuildNumber, 1)),
        branchNumber: MAIN_BRANCH_NUMBER,
    };
}

/**
 * §4.3 / §4.4 — next build appended to an EXISTING branch.
 *   main → Build# increments, Branch# stays 0.
 *   sub  → Build# frozen, Branch# walks +1 (the build index i advances by one).
 *
 * M.m is stamped from the BRANCH's current M.m (`branchMm`) — NOT the last
 * build — because that is the single "stamp source" per §4.3/§4.2: for main it
 * is the live M.m (which changes after a release handoff), for a sub-branch it
 * is the frozen snapshot (equal to its builds' M.m). Callers MUST check
 * isOpenMm(branchMm) first and refuse the build when open (§4.2). Throws if
 * called with an open M.m so the rule cannot be silently bypassed.
 *
 * main Build# RESETS to 1 whenever the M.m changes (§4.3 — management assigned
 * a new M.m after a release: `5.0.8.0` → main `5.1` → next build `5.1.1.0`);
 * it only increments while the M.m is unchanged.
 */
export function nextBuildVersion({ branchType, lastBuild, branchMm }) {
    if (isOpenMm(branchMm)) {
        throw new Error('nextBuildVersion: branch M.m is open — assign a Major.Minor first');
    }
    const last = lastBuild || null;
    const major = num(branchMm.major, 1);
    const minor = num(branchMm.minor, 0);
    if (branchType === 'main') {
        const sameMm = last && num(last.major, NaN) === major && num(last.minor, NaN) === minor;
        return {
            major,
            minor,
            build: sameMm ? num(last.build, 0) + 1 : 1,
            branchNumber: MAIN_BRANCH_NUMBER,
        };
    }
    return {
        major,
        minor,
        build: last ? num(last.build, 1) : 1,
        branchNumber: last ? num(last.branchNumber, 0) + 1 : 0,
    };
}

/**
 * §4.3 / §4.4 — first build on a NEWLY CREATED sub-branch off `parentBuild`.
 * Build# frozen to the parent's; Branch# is the reserved-range start for this
 * sibling ordinal; M.m inherited (stamped) from the parent build.
 * `siblingOrd0` = count of pre-existing same-type sibling branches off the same
 * parent build (0 for the first).
 */
export function firstBuildOnNewBranchVersion({ type, parentBuild, siblingOrd0 = 0 }) {
    const p = parentBuild || {};
    return {
        major: num(p.major, 1),
        minor: num(p.minor, 0),
        build: num(p.build, 1),
        branchNumber: computeBranchNumber(type, siblingOrd0, 0),
    };
}

// §4.2 — a `release` (NOT `sample-release`) carries main's M.m away, leaving
// main open. There is deliberately NO defaultNewMainAfterRelease(): main's new
// M.m is supplied by the user, never computed. See isOpenMm / openMm.
export function takesMainMm(branchType) {
    return branchType === 'release';
}

// ─── Branch# collision helpers (req #2742) ────────────────────────────────
//
// When a sample-release is created off a release parent, both types share the
// same Branch# range (base:1, stride:50) AND the same frozen Build#, so the
// default first Branch# (=1) collides with the release's own builds. These
// two helpers let the UI prompt the user for a collision-free first Branch#.

/**
 * Sorted array of Branch#s already used on the same M.m.B coordinate as
 * `parentBuild`. Useful for displaying "in use" values so the user can pick
 * a free one.
 *
 * `builds` is the model's builds map (Object) or array — normalized
 * internally. Null-safe.
 */
export function usedBranchNumbersFor({ parentBuild, builds }) {
    if (!parentBuild || !builds) return [];
    const M = num(parentBuild.major, NaN);
    const m = num(parentBuild.minor, NaN);
    const B = num(parentBuild.build, NaN);
    if (!Number.isFinite(M) || !Number.isFinite(m) || !Number.isFinite(B)) return [];

    const arr = Array.isArray(builds) ? builds : Object.values(builds);
    const used = new Set();
    for (const b of arr) {
        if (!b) continue;
        if (num(b.major, NaN) === M && num(b.minor, NaN) === m && num(b.build, NaN) === B) {
            const bn = num(b.branchNum != null ? b.branchNum : b.branchNumber, NaN);
            if (Number.isFinite(bn)) used.add(bn);
        }
    }
    return [...used].sort((a, b) => a - b);
}

/**
 * Suggest a first Branch# for a new sub-branch that shares `parentBuild`'s
 * M.m.B coordinate. Returns `1 + max(branchNum)` over all builds on that
 * coordinate — guaranteed collision-free.
 *
 * Fallback chain:
 *   1. max+1 over the shared M.m.B coordinate.
 *   2. parentBuild.branchNum + 1 (shouldn't be needed — the parent itself
 *      occupies the coordinate).
 *   3. 1 (absolute fallback).
 */
export function suggestFirstBranchNumber({ parentBuild, builds }) {
    const used = usedBranchNumbersFor({ parentBuild, builds });
    if (used.length > 0) return used[used.length - 1] + 1;
    // Fallback — the parent itself should be in the set, but be safe.
    if (parentBuild) {
        const bn = num(
            parentBuild.branchNum != null ? parentBuild.branchNum : parentBuild.branchNumber,
            NaN,
        );
        if (Number.isFinite(bn)) return bn + 1;
    }
    return 1;
}
