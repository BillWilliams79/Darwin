// deleteRules.js — Pure predicates for delete-affordance visibility (req #2742).
//
// Both predicates enforce the no-orphan invariant: a build or branch may only
// be deleted when doing so cannot strand a child branch.

/**
 * Can the given build be deleted?
 *
 * True when ALL of:
 *   1. It is the LAST build on the branch.
 *   2. No branch is parented off this build.
 *
 * The sole build on a branch IS now deletable (leaves an empty branch with
 * an arrow hover anchor for re-creating the first build). The prior ">1 build"
 * condition was removed to enable this. The no-orphan invariant (condition 2)
 * still prevents deletion when a child branch depends on the build.
 *
 * @param {{ branch: object|null, buildId: string, branches: object[] }} opts
 * @returns {boolean}
 */
export function canDeleteBuild({ branch, buildId, branches }) {
    if (!branch || !buildId) return false;
    const ids = branch.buildIds;
    if (!Array.isArray(ids) || ids.length === 0) return false;
    if (ids[ids.length - 1] !== buildId) return false;
    if (!Array.isArray(branches)) return false;
    if (branches.some(b => b.parentBuildId === buildId)) return false;
    return true;
}

/**
 * Can the given branch be deleted?
 *
 * True when BOTH of:
 *   1. Not main (the trunk cannot be deleted).
 *   2. No child branches exist off this branch.
 *
 * @param {{ branch: object|null, branches: object[] }} opts
 * @returns {boolean}
 */
export function canDeleteBranch({ branch, branches }) {
    if (!branch) return false;
    if (branch.type === 'main') return false;
    if (!Array.isArray(branches)) return false;
    if (branches.some(b => b.parentBranchId === branch.id)) return false;
    return true;
}
