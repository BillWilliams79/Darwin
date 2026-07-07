// typeVisibility.js — per-branch-type "stoplight" state for the Build Visualizer
// toolbar chip rail (req #2897).
//
// The semantic-zoom level (L1/L2/L3) hides whole branch types independently of
// the user's chip filter: at L1 the semantic transform hides ALL development
// branches and completed (not-latest, undelivered) sample branches. The filter
// chips previously reflected ONLY the manual on/off filter (`selectedTypes`), so
// a chip could read "on" while zero branches of that type actually rendered.
//
// This pure helper answers, for the CURRENT effective level, whether each branch
// type is fully / partially / not shown — the chip rail renders a red/amber/green
// stoplight dot from the result. It reuses the exact functions the canvas uses to
// decide visibility (`computeHiddenBranchIds` for the toolbar filter, then
// `computeSemanticModel` for the level transform), so for the level's DEFAULT
// (as-collapsed) view the stoplight matches the canvas exactly.
//
// It reports the baseline visibility for the level. Callers may pass the canvas's
// live `expandedTokens` for a precise match; when omitted (the page default) the
// stoplight ignores user-expanded L2 collapse tokens — a dev branch buried inside
// a collapsed main-trunk run that the user later expands reads 'hidden' here while
// the canvas reveals it. That drift is confined to L2 after a manual expand; L1
// (dev hidden by level rule before collapse) and L3 (no collapse) always match.
//
// Statuses (per type):
//   'off'     — user has deselected the type (chip already dimmed; no dot).
//   'none'    — the project has no branches of this type (nothing to signal).
//   'shown'   — selected AND every branch of this type renders at this level.
//   'partial' — selected AND the level hides SOME (not all) branches of this type.
//   'hidden'  — selected BUT the level hides ALL branches of this type.
//
// Pure + exported → unit-testable in isolation.

import { computeHiddenBranchIds } from './visibilityRules';
import { computeSemanticModel } from './semanticModel';
import { BRANCH_TYPES } from './branchTypeChipStyles';

/**
 * Compute the stoplight status for every togglable branch type.
 *
 * @param {object} params
 * @param {object} params.model — {branches, builds, releaseEvents, …}
 * @param {1|2|3} params.level — the effective semantic level being rendered.
 * @param {string[]} params.selectedTypes — currently-on chip types.
 * @param {Set<string>} [params.expandedTokens] — sticky expanded collapse tokens
 *   (canvas state). Optional; defaults to none (the as-collapsed default view).
 * @returns {Record<string, 'off'|'none'|'shown'|'partial'|'hidden'>}
 *   Keyed by every entry in BRANCH_TYPES.
 */
export function computeTypeVisibility({ model, level = 3, selectedTypes, expandedTokens } = {}) {
    const selected = Array.isArray(selectedTypes) ? selectedTypes : BRANCH_TYPES;
    const selectedSet = new Set(selected);
    const branches = model?.branches || [];

    // Actual hidden set the canvas would render: toolbar type-filter hides unioned
    // with the semantic-level hides. Identical inputs to KonvaBuildCanvas.
    const baseHidden = branches.length
        ? computeHiddenBranchIds({ branches, selectedTypes: selected, allTypes: BRANCH_TYPES })
        : new Set();
    const { hiddenBranchIds } = computeSemanticModel(model || { branches: [] }, {
        level,
        expandedTokens,
        baseHiddenBranchIds: baseHidden,
    });

    const out = {};
    for (const type of BRANCH_TYPES) {
        if (!selectedSet.has(type)) { out[type] = 'off'; continue; }

        const ofType = branches.filter(b => b.type === type);
        if (ofType.length === 0) { out[type] = 'none'; continue; }

        const hiddenCount = ofType.reduce(
            (n, b) => (hiddenBranchIds.has(b.id) ? n + 1 : n), 0);

        if (hiddenCount === 0) out[type] = 'shown';
        else if (hiddenCount === ofType.length) out[type] = 'hidden';
        else out[type] = 'partial';
    }
    return out;
}

export default computeTypeVisibility;
