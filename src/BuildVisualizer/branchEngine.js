// Build Visualizer — BranchEngine (req #2737).
//
// THE single source of truth for branch-CREATION policy: which branch types may
// be created from which parent branch type, and any gating (e.g. on a build
// being approved-for-release). Authoritative rules: memory/build-visualizer-design.md
// §4.7. The "Create branch" submenu renders from allowedChildTypes(); the
// create handler calls canCreate() + creationGate() before any mutation. No
// branch-creation policy lives anywhere else.
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
// CREATABLE_TYPES is that order minus `main`. Sprint ("Sprint = Sample",
// type `sample-release`) precedes release.
export const CREATABLE_TYPES = [
    'sample-release', // "Sprint = Sample"
    'release',
    'csr',
    'development',
    'hotfix',
    'bootleg',
];

// §4.7 allowed/not-allowed matrix — keyed by PARENT branch type → set of child
// types creatable from it. Principles that fix the whole table:
//   • bootleg is maintenance → allowed from anywhere (incl. bootleg-off-bootleg)
//   • development is always available ("engineering is king") → allowed everywhere
//   • hotfix may chain off a hotfix
const ALLOWED_CHILDREN = {
    main:             new Set(['sample-release', 'release', 'csr', 'hotfix', 'bootleg', 'development']),
    release:          new Set(['sample-release', 'release', 'csr', 'hotfix', 'bootleg', 'development']),
    'sample-release': new Set(['hotfix', 'bootleg', 'development']),
    csr:              new Set(['hotfix', 'bootleg', 'development']),
    hotfix:           new Set(['hotfix', 'bootleg', 'development']),
    bootleg:          new Set(['bootleg', 'development']),
    development:      new Set(['bootleg', 'development']),
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
