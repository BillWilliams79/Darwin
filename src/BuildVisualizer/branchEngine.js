// Build Visualizer — BranchEngine (req #2737, matrix revised #2894).
//
// SINGLE SOURCE OF TRUTH — the DOCUMENT, not this file (req #2894).
// The authoritative branch-creation matrix + principles live in
// memory/build-visualizer-design.md §4.7 "Branch-Creation Rules". This module is
// the *implementation* of that document, and branchEngine.test.js is the
// *executable transcription* of it. When the doc and this code disagree, the DOC
// wins: update the doc first, then bring ALLOWED_CHILDREN and the test fixtures
// back into agreement with it. Keep all three in lock-step.
//
// This module is still the sole PLACE branch-creation policy is implemented in
// code: the "Create branch" submenu renders from allowedChildTypes(); the create
// handler calls canCreate() + creationGate() before any mutation. No
// branch-creation policy lives anywhere else in code — but the policy it encodes
// is owned by the document.
//
// Version numbers are NOT this module's concern — that is versionEngine.js.
//
// LAYERING (req #2737): this matrix is a UI-LAYER gate only. The database is
// intentionally permissive — `branches.branch_type` / `parent_build_fk` are
// plain columns and nothing in SQL or the MCP backend enforces legality, so the
// data layer stays fair to all possibilities. A future "override" UI can let a
// user break the rules deliberately by rendering create options from
// CREATABLE_TYPES (the full list) instead of allowedChildTypes() (the gated
// subset) — no schema, backend, or engine change needed.

// Single canonical type order, used for BOTH axes of the §4.7 matrix and the
// submenu. `main` (the singleton trunk, never creatable) leads the full order;
// CREATABLE_TYPES is that order minus `main`. Sprint ("Sprint/Sample",
// type `sample-release`) precedes release.
export const CREATABLE_TYPES = [
    'sample-release', // "Sprint/Sample"
    'release',
    'csr',
    'development',
    'hotfix',
    'bootleg',
];

// §4.7 allowed/not-allowed matrix — keyed by PARENT branch type → set of child
// types creatable from it. Principles that fix the whole table (revised #2894):
//   • development is always available ("engineering is king") → allowed everywhere
//   • bootleg is maintenance → allowed from anywhere (incl. bootleg-off-bootleg)
//   • csr is available from ANY parent (req #2894, reverses the #2603 release-only
//     rule): a CSR is gated CONCEPTUALLY by a passed full-production-release
//     quality gate on the designated build, not by branch structure — "the branch
//     location doesn't matter, it's about the build." → allowed everywhere.
//   • sample-release (Sprint/Sample) is available from ANY parent EXCEPT another
//     sprint (req #2894). Sprint-off-sprint is disallowed ("what a mess").
//   • hotfix may chain off a hotfix, AND off a bootleg (req #2894) — a bootleg's
//     common end-state is a release-ready hotfix carrying its fixes. (Part 2 will
//     auto-generate that hotfix branch; see design-guide §4.7.) hotfix is NOT
//     creatable off development.
const ALLOWED_CHILDREN = {
    main:             new Set(['sample-release', 'release', 'csr', 'hotfix', 'bootleg', 'development']),
    release:          new Set(['sample-release', 'release', 'csr', 'hotfix', 'bootleg', 'development']),
    'sample-release': new Set(['csr', 'hotfix', 'bootleg', 'development']),
    csr:              new Set(['sample-release', 'csr', 'hotfix', 'bootleg', 'development']),
    hotfix:           new Set(['sample-release', 'csr', 'hotfix', 'bootleg', 'development']),
    bootleg:          new Set(['sample-release', 'csr', 'hotfix', 'bootleg', 'development']),
    development:      new Set(['sample-release', 'csr', 'bootleg', 'development']),
};

/** The child types creatable from a parent of `parentType`, in display order. */
export function allowedChildTypes(parentType) {
    const allowed = ALLOWED_CHILDREN[parentType] || new Set();
    return CREATABLE_TYPES.filter(t => allowed.has(t));
}

/**
 * Whether `childType` may be created from a parent of `parentType`.
 * @returns {{allowed: boolean, reason: string}}
 */
export function canCreate(parentType, childType) {
    if (childType === 'main') {
        return { allowed: false, reason: 'main is the trunk and cannot be created' };
    }
    const allowed = (ALLOWED_CHILDREN[parentType] || new Set()).has(childType);
    return {
        allowed,
        reason: allowed ? '' : `${childType} cannot be created from ${parentType}`,
    };
}

// creationGate actions.
export const GATE_PROCEED = 'proceed';
export const GATE_CONFIRM = 'confirm';
export const GATE_BLOCK = 'block';

/**
 * §4.4 — True when creating `childType` from a parent branch of
 * `parentBranchType` requires a user-chosen first Branch#. Today this fires
 * ONLY for `sample-release` off a `release` parent, because both types share
 * the same `base:1, stride:50` reserved Branch# range and the sample freezes
 * the SAME Build# as the release — a head-on collision. Every other create
 * path has a distinct reserved range or a distinct frozen Build#.
 *
 * The predicate is a simple boolean — it doesn't compute the suggestion or the
 * used set; those live in versionEngine.js (suggestFirstBranchNumber /
 * usedBranchNumbersFor). Keeping them separate matches the existing module
 * boundary: branchEngine owns policy, versionEngine owns version arithmetic.
 *
 * NB (req #2894): sample-release is now creatable off many more parents
 * (main, csr, hotfix, bootleg, development — see ALLOWED_CHILDREN), but the
 * prompt still fires ONLY for a `release` parent. Off any other parent the
 * sprint's frozen Build# is NOT already populated in the shared base:1/stride:50
 * range (those parents' builds live in the 0 / 1k / 6k / 7k / 9k ranges), so the
 * default first Branch# = 1 does not collide and no prompt is needed.
 */
export function needsBranchNumberPrompt({ childType, parentBranchType }) {
    return childType === 'sample-release' && parentBranchType === 'release';
}

/**
 * Gate a (would-be) creation on the parent build's state (§4.7).
 *
 * There are currently NO creation gates. The earlier "release requires a
 * production-ready build" confirm was removed (req #2737) — it was never a
 * stated requirement; a release branch is simply where the end-game of a
 * release is branched, with no production-ready precondition. This function is
 * retained as the single, documented extension point: add a per-type rule here
 * (returning GATE_CONFIRM or GATE_BLOCK) only when a gate is actually agreed.
 */
export function creationGate(/* childType, parentBuild */) {
    return { action: GATE_PROCEED, message: '' };
}
