import { describe, it, expect } from 'vitest';
import { computeHiddenBranchIds } from '../visibilityRules';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_TYPES = ['release', 'sample-release', 'hotfix', 'bootleg', 'csr', 'development'];

const makeBranch = (id, type, parentBranchId = null) => ({
    id,
    type,
    parentBranchId,
});

// A reusable tree for multi-level tests:
//
//   main
//     ├── release-1   (release)
//     │     ├── hotfix-1  (hotfix)
//     │     └── bootleg-1 (bootleg)
//     ├── release-2   (release)
//     │     └── bootleg-2 (bootleg)
//     ├── dev-a       (development)
//     └── csr-1       (csr)
//
const TREE_BRANCHES = [
    makeBranch('main',       'main'),
    makeBranch('release-1',  'release',     'main'),
    makeBranch('hotfix-1',   'hotfix',      'release-1'),
    makeBranch('bootleg-1',  'bootleg',     'release-1'),
    makeBranch('release-2',  'release',     'main'),
    makeBranch('bootleg-2',  'bootleg',     'release-2'),
    makeBranch('dev-a',      'development', 'main'),
    makeBranch('csr-1',      'csr',         'main'),
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('computeHiddenBranchIds', () => {
    // ─── Basic type filtering ─────────────────────────────────────────────

    it('hides all non-main branches when only main is selected (no selectedTypes)', () => {
        const hidden = computeHiddenBranchIds({
            branches: TREE_BRANCHES,
            selectedTypes: [],
            allTypes: ALL_TYPES,
        });
        // Every non-main branch is hidden because no type is selected,
        // and no non-main branch is shown to trigger ancestor rescue.
        expect(hidden.size).toBe(TREE_BRANCHES.length - 1); // all except main
        expect(hidden.has('main')).toBe(false);
    });

    it('hides nothing when all types are selected', () => {
        const hidden = computeHiddenBranchIds({
            branches: TREE_BRANCHES,
            selectedTypes: ALL_TYPES,
            allTypes: ALL_TYPES,
        });
        expect(hidden.size).toBe(0);
    });

    // ─── Direct-off-main — no ancestors needed ────────────────────────────

    it('shows only dev branches when development is selected (all off main, no rescue needed)', () => {
        const hidden = computeHiddenBranchIds({
            branches: TREE_BRANCHES,
            selectedTypes: ['development'],
            allTypes: ALL_TYPES,
        });
        // dev-a is shown (selected type, parent is main).
        // All other non-main branches are hidden.
        expect(hidden.has('dev-a')).toBe(false);
        expect(hidden.has('release-1')).toBe(true);
        expect(hidden.has('release-2')).toBe(true);
        expect(hidden.has('hotfix-1')).toBe(true);
        expect(hidden.has('bootleg-1')).toBe(true);
        expect(hidden.has('bootleg-2')).toBe(true);
        expect(hidden.has('csr-1')).toBe(true);
    });

    // ─── Ancestor rescue — the core bug fix ───────────────────────────────

    it('un-hides a release ancestor when bootleg (off that release) is selected', () => {
        // Select ONLY bootleg. bootleg-1 descends from release-1.
        // release-1's type is deselected, but it must be un-hidden so
        // bootleg-1 can render (its parent build X comes from release-1).
        const hidden = computeHiddenBranchIds({
            branches: TREE_BRANCHES,
            selectedTypes: ['bootleg'],
            allTypes: ALL_TYPES,
        });
        // bootleg-1 and bootleg-2 are shown.
        expect(hidden.has('bootleg-1')).toBe(false);
        expect(hidden.has('bootleg-2')).toBe(false);
        // release-1 rescued by bootleg-1; release-2 rescued by bootleg-2.
        expect(hidden.has('release-1')).toBe(false);
        expect(hidden.has('release-2')).toBe(false);
        // Other types stay hidden.
        expect(hidden.has('hotfix-1')).toBe(true);
        expect(hidden.has('dev-a')).toBe(true);
        expect(hidden.has('csr-1')).toBe(true);
    });

    // ─── 2-deep chain ─────────────────────────────────────────────────────

    it('un-hides a 2-deep ancestor chain (bootleg -> release-A -> release-B -> main)', () => {
        // Build a chain: bootleg -> release-A -> release-B -> main
        const branches = [
            makeBranch('main',      'main'),
            makeBranch('rel-B',     'release',  'main'),
            makeBranch('rel-A',     'release',  'rel-B'),
            makeBranch('boot-deep', 'bootleg',  'rel-A'),
        ];
        const hidden = computeHiddenBranchIds({
            branches,
            selectedTypes: ['bootleg'],
            allTypes: ALL_TYPES,
        });
        // boot-deep is shown; BOTH rel-A and rel-B must be rescued.
        expect(hidden.has('boot-deep')).toBe(false);
        expect(hidden.has('rel-A')).toBe(false);
        expect(hidden.has('rel-B')).toBe(false);
    });

    // ─── Two shown branches sharing one hidden ancestor ───────────────────

    it('un-hides a shared ancestor once; siblings with no shown descendants stay hidden', () => {
        // Two bootlegs off release-1; release-2 has NO shown descendant.
        const branches = [
            makeBranch('main',       'main'),
            makeBranch('release-1',  'release',  'main'),
            makeBranch('release-2',  'release',  'main'),
            makeBranch('bootleg-x',  'bootleg',  'release-1'),
            makeBranch('bootleg-y',  'bootleg',  'release-1'),
        ];
        const hidden = computeHiddenBranchIds({
            branches,
            selectedTypes: ['bootleg'],
            allTypes: ALL_TYPES,
        });
        expect(hidden.has('bootleg-x')).toBe(false);
        expect(hidden.has('bootleg-y')).toBe(false);
        expect(hidden.has('release-1')).toBe(false);  // rescued
        expect(hidden.has('release-2')).toBe(true);   // no shown descendant — stays hidden
    });

    // ─── Cycle guard ──────────────────────────────────────────────────────

    it('does not infinite-loop on a cycle in parentBranchId', () => {
        // Defensive: data should never have cycles, but the guard must
        // prevent an infinite loop if one exists.
        const branches = [
            makeBranch('main', 'main'),
            { id: 'a', type: 'release', parentBranchId: 'b' },
            { id: 'b', type: 'release', parentBranchId: 'a' },
            { id: 'c', type: 'bootleg', parentBranchId: 'a' },
        ];
        // Should terminate without throwing.
        const hidden = computeHiddenBranchIds({
            branches,
            selectedTypes: ['bootleg'],
            allTypes: ALL_TYPES,
        });
        // c is shown; a is rescued; b is rescued via a's parent walk.
        expect(hidden.has('c')).toBe(false);
        expect(hidden.has('a')).toBe(false);
        expect(hidden.has('b')).toBe(false);
    });

    // ─── Edge cases ───────────────────────────────────────────────────────

    it('returns empty set for empty branches array', () => {
        const hidden = computeHiddenBranchIds({
            branches: [],
            selectedTypes: ['release'],
            allTypes: ALL_TYPES,
        });
        expect(hidden.size).toBe(0);
    });

    it('returns empty set for null branches', () => {
        const hidden = computeHiddenBranchIds({
            branches: null,
            selectedTypes: ['release'],
            allTypes: ALL_TYPES,
        });
        expect(hidden.size).toBe(0);
    });

    it('returns empty set for undefined branches', () => {
        const hidden = computeHiddenBranchIds({
            branches: undefined,
            selectedTypes: [],
            allTypes: ALL_TYPES,
        });
        expect(hidden.size).toBe(0);
    });

    it('treats empty selectedTypes as "only main"', () => {
        const branches = [
            makeBranch('main', 'main'),
            makeBranch('dev-a', 'development', 'main'),
        ];
        const hidden = computeHiddenBranchIds({
            branches,
            selectedTypes: [],
            allTypes: ALL_TYPES,
        });
        expect(hidden.has('dev-a')).toBe(true);
    });

    it('treats null selectedTypes as "all selected" (defaults to empty -> adds main)', () => {
        // When selectedTypes is null, the function wraps it with
        // new Set(null) → empty set, then adds 'main'. So everything
        // whose type is in allTypes is hidden. This matches the
        // BuildVisualizerCanvas guard that passes `selectedTypes || BRANCH_TYPES`.
        const branches = [
            makeBranch('main', 'main'),
            makeBranch('dev-a', 'development', 'main'),
        ];
        const hidden = computeHiddenBranchIds({
            branches,
            selectedTypes: null,
            allTypes: ALL_TYPES,
        });
        expect(hidden.has('dev-a')).toBe(true);
    });

    // ─── Non-togglable types are never hidden ─────────────────────────────

    it('never hides a branch whose type is not in allTypes', () => {
        // A hypothetical branch type 'custom' not in allTypes.
        const branches = [
            makeBranch('main', 'main'),
            makeBranch('custom-1', 'custom', 'main'),
        ];
        const hidden = computeHiddenBranchIds({
            branches,
            selectedTypes: [],
            allTypes: ALL_TYPES,
        });
        // 'custom' is not in allTypes, so it's not eligible to be hidden.
        expect(hidden.has('custom-1')).toBe(false);
    });

    // ─── Hotfix off release — same ancestor rescue pattern ────────────────

    it('un-hides release ancestor when hotfix (off that release) is selected', () => {
        const hidden = computeHiddenBranchIds({
            branches: TREE_BRANCHES,
            selectedTypes: ['hotfix'],
            allTypes: ALL_TYPES,
        });
        expect(hidden.has('hotfix-1')).toBe(false);
        // release-1 must be rescued because hotfix-1 descends from it.
        expect(hidden.has('release-1')).toBe(false);
        // release-2 has no shown descendant — stays hidden.
        expect(hidden.has('release-2')).toBe(true);
    });

    // ─── Mixed selection — some types on, some off ────────────────────────

    it('keeps deselected branches hidden when their type has no shown descendants needing rescue', () => {
        // Select release + development. Bootleg / hotfix / csr are off.
        const hidden = computeHiddenBranchIds({
            branches: TREE_BRANCHES,
            selectedTypes: ['release', 'development'],
            allTypes: ALL_TYPES,
        });
        // Releases and dev are shown.
        expect(hidden.has('release-1')).toBe(false);
        expect(hidden.has('release-2')).toBe(false);
        expect(hidden.has('dev-a')).toBe(false);
        // Bootlegs, hotfix, csr are hidden — none are selected and none
        // have shown descendants that need them.
        expect(hidden.has('bootleg-1')).toBe(true);
        expect(hidden.has('bootleg-2')).toBe(true);
        expect(hidden.has('hotfix-1')).toBe(true);
        expect(hidden.has('csr-1')).toBe(true);
    });

    // ─── Dangling parentBranchId ──────────────────────────────────────────

    it('stops walking when parentBranchId references a non-existent branch', () => {
        const branches = [
            makeBranch('main', 'main'),
            makeBranch('boot-1', 'bootleg', 'ghost'), // ghost doesn't exist
        ];
        // Should not throw.
        const hidden = computeHiddenBranchIds({
            branches,
            selectedTypes: ['bootleg'],
            allTypes: ALL_TYPES,
        });
        expect(hidden.has('boot-1')).toBe(false);
    });
});
