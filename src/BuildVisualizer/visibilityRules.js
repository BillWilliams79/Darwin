// Pure-logic module for branch visibility / filtering (req #2742).
//
// Extracted from BuildVisualizerCanvas.jsx so the hidden-branch-id
// computation is independently testable (follows the section 20
// testability pattern from the design guide).
//
// The core rule: selecting a branch type auto-reveals the minimum
// ancestor-branch chain needed to anchor each shown branch to the
// trunk. A deselected type never hides a branch that a shown branch
// depends on for positioning.

/**
 * Compute the set of branch IDs that should be hidden from the layout.
 *
 * @param {object} params
 * @param {Array<{id: string, type: string, parentBranchId?: string|null}>} params.branches
 *   All branches in the model (including main).
 * @param {string[]} params.selectedTypes
 *   Currently-on type strings from the chip rail.
 * @param {string[]} params.allTypes
 *   The full BRANCH_TYPES list (togglable types). Only branches whose
 *   type is in this list are eligible to be hidden. Main and any
 *   non-togglable type are always allowed.
 * @returns {Set<string>} IDs of branches to hide.
 */
export function computeHiddenBranchIds({ branches, selectedTypes, allTypes }) {
    if (!branches?.length) return new Set();

    const allTypesSet = new Set(allTypes || []);
    const allowedTypes = new Set(selectedTypes || []);
    allowedTypes.add('main');

    // Step 1: type-based hidden set — every branch whose type is a
    // togglable type (in allTypes) but is NOT in the allowed set.
    const hidden = new Set();
    for (const b of branches) {
        if (allTypesSet.has(b.type) && !allowedTypes.has(b.type)) {
            hidden.add(b.id);
        }
    }

    // Step 2: ancestor-rescue pass. For every branch that is NOT hidden,
    // walk its parentBranchId chain toward main. Any ancestor currently
    // in the hidden set is removed (un-hidden) so the shown branch has
    // an unbroken visible chain to the trunk.
    const branchById = new Map(branches.map(b => [b.id, b]));

    for (const b of branches) {
        if (hidden.has(b.id)) continue;       // this branch is hidden — skip
        if (b.type === 'main') continue;       // main is never hidden

        // Walk ancestors toward root.
        const visited = new Set();             // cycle guard (defensive)
        let current = b;
        while (current?.parentBranchId) {
            const parentId = current.parentBranchId;
            if (visited.has(parentId)) break;  // cycle detected — stop
            visited.add(parentId);

            const parent = branchById.get(parentId);
            if (!parent) break;                // dangling ref — stop
            if (parent.type === 'main') break; // reached the trunk — done

            // Un-hide this ancestor if it was hidden by the type filter.
            hidden.delete(parentId);

            current = parent;
        }
    }

    return hidden;
}
