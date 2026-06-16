// req #2633 — Acceptance Test (AT) → branch-type matrix.
//
// The "Acceptance Test – Release Mapping" matrix (which ATs each release type
// requires) lives here as frontend config, keyed by the Build Visualizer branch
// `type`. Source of truth for which AT name labels a branch renders and which
// branches auto-get their AT links on create.
//
// Two kinds of AT render differently (see d3LayoutEngine §8b + Canvas):
//   • Branch-level ATs (AT_MATRIX) — stacked name labels below the branch's
//     LATEST build + a single pass/fail glyph (green ✓ / red ✗) driven by the
//     branch's `acceptance_test_status`. Persisted in branch_acceptance_tests.
//   • Build AT — a special, automatic, per-build self-loop glyph (always pass).
//     Runs on EVERY build of EVERY branch (req #2633 review round), very fast;
//     does NOT push to the latest build like the others. Render-only — not
//     stored in the junction. Toggleable via the header "Build AT" chip.
//
// Branch-type keys mirror d3LayoutEngine REGISTRY: main (Daily), sample-release
// (Sample), release (Production), csr, hotfix, bootleg, development.

// Branch-level required ATs per branch type (Build AT deliberately excluded —
// it is the per-build loop handled by BUILD_AT_TYPES).
export const AT_MATRIX = {
    main:             ['Daily AT'],
    'sample-release': ['Sprint AT'],
    release:          ['Sprint AT', 'Functional AT', 'OEM AT', 'RC AT', 'Cert AT'],
    csr:              ['Sprint AT', 'OEM AT', 'Cert AT'],
    hotfix:           ['Sprint AT', 'Cert AT'],
    bootleg:          [],
    development:      [],
};

// Build AT runs automatically on EVERY build of EVERY branch (req #2633 review
// round). Kept as a function (not a per-type gate) so callers read clearly and
// a future per-type restriction is a one-line change.
export const BUILD_AT_ALL_BRANCHES = true;

// Branch-level AT names for a branch type (never includes Build AT).
export function branchLevelAtsFor(type) {
    return AT_MATRIX[type] || [];
}

// Whether this branch type runs the per-build Build AT loop. Universal now.
export function runsBuildAt(/* type */) {
    return BUILD_AT_ALL_BRANCHES;
}

export default AT_MATRIX;
