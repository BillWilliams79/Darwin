import { describe, it, expect } from 'vitest';
import { canDeleteBuild, canDeleteBranch } from '../deleteRules';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeBranch = (id, type, buildIds, parentBranchId = null) => ({
    id,
    type,
    buildIds: buildIds || [],
    parentBranchId,
});

// ─── canDeleteBuild ──────────────────────────────────────────────────────────

describe('canDeleteBuild', () => {
    it('returns true for the last build on a branch with siblings and no child branches', () => {
        const branch = makeBranch('release-1', 'release', ['b1', 'b2', 'b3']);
        const branches = [makeBranch('main', 'main', ['m1']), branch];
        expect(canDeleteBuild({ branch, buildId: 'b3', branches })).toBe(true);
    });

    it('returns false for a middle build (not the last)', () => {
        const branch = makeBranch('release-1', 'release', ['b1', 'b2', 'b3']);
        const branches = [makeBranch('main', 'main', ['m1']), branch];
        expect(canDeleteBuild({ branch, buildId: 'b2', branches })).toBe(false);
    });

    it('returns false for the first build (not the last)', () => {
        const branch = makeBranch('release-1', 'release', ['b1', 'b2', 'b3']);
        const branches = [makeBranch('main', 'main', ['m1']), branch];
        expect(canDeleteBuild({ branch, buildId: 'b1', branches })).toBe(false);
    });

    it('returns true when the build is the only build on the branch and no child branch', () => {
        const branch = makeBranch('dev-a', 'development', ['b1']);
        const branches = [makeBranch('main', 'main', ['m1']), branch];
        expect(canDeleteBuild({ branch, buildId: 'b1', branches })).toBe(true);
    });

    it('returns false when the build is the only build AND a child branch is parented off it', () => {
        const branch = makeBranch('release-1', 'release', ['b1']);
        const child = makeBranch('hotfix-1', 'hotfix', ['h1'], 'release-1');
        child.parentBuildId = 'b1';
        const branches = [makeBranch('main', 'main', ['m1']), branch, child];
        expect(canDeleteBuild({ branch, buildId: 'b1', branches })).toBe(false);
    });

    it('returns false when a child branch is parented off the last build', () => {
        const branch = makeBranch('release-1', 'release', ['b1', 'b2']);
        const child = makeBranch('hotfix-1', 'hotfix', ['h1'], 'release-1');
        child.parentBuildId = 'b2';
        const branches = [makeBranch('main', 'main', ['m1']), branch, child];
        expect(canDeleteBuild({ branch, buildId: 'b2', branches })).toBe(false);
    });

    it('returns true when a child branch is parented off a NON-last build', () => {
        const branch = makeBranch('release-1', 'release', ['b1', 'b2', 'b3']);
        const child = makeBranch('hotfix-1', 'hotfix', ['h1'], 'release-1');
        child.parentBuildId = 'b1';
        const branches = [makeBranch('main', 'main', ['m1']), branch, child];
        // b3 is the last build; the child branches off b1, not b3
        expect(canDeleteBuild({ branch, buildId: 'b3', branches })).toBe(true);
    });

    // ─── Null / empty guard cases ──────────────────────────────────────────

    it('returns false when branch is null', () => {
        expect(canDeleteBuild({ branch: null, buildId: 'b1', branches: [] })).toBe(false);
    });

    it('returns false when branch is undefined', () => {
        expect(canDeleteBuild({ branch: undefined, buildId: 'b1', branches: [] })).toBe(false);
    });

    it('returns false when buildId is null', () => {
        const branch = makeBranch('dev-a', 'development', ['b1', 'b2']);
        expect(canDeleteBuild({ branch, buildId: null, branches: [] })).toBe(false);
    });

    it('returns false when buildId is undefined', () => {
        const branch = makeBranch('dev-a', 'development', ['b1', 'b2']);
        expect(canDeleteBuild({ branch, buildId: undefined, branches: [] })).toBe(false);
    });

    it('returns false when buildIds is empty', () => {
        const branch = makeBranch('dev-a', 'development', []);
        expect(canDeleteBuild({ branch, buildId: 'b1', branches: [] })).toBe(false);
    });

    it('returns false when buildIds is null/missing', () => {
        const branch = { id: 'dev-a', type: 'development', buildIds: null };
        expect(canDeleteBuild({ branch, buildId: 'b1', branches: [] })).toBe(false);
    });

    it('returns false when branches array is null', () => {
        const branch = makeBranch('dev-a', 'development', ['b1', 'b2']);
        expect(canDeleteBuild({ branch, buildId: 'b2', branches: null })).toBe(false);
    });
});

// ─── canDeleteBranch ─────────────────────────────────────────────────────────

describe('canDeleteBranch', () => {
    it('returns true for a leaf sub-branch with no children', () => {
        const mainBranch = makeBranch('main', 'main', ['m1']);
        const leaf = makeBranch('dev-a', 'development', ['d1'], 'main');
        const branches = [mainBranch, leaf];
        expect(canDeleteBranch({ branch: leaf, branches })).toBe(true);
    });

    it('returns false for main branch', () => {
        const mainBranch = makeBranch('main', 'main', ['m1']);
        const branches = [mainBranch];
        expect(canDeleteBranch({ branch: mainBranch, branches })).toBe(false);
    });

    it('returns false for a branch that has child branches', () => {
        const mainBranch = makeBranch('main', 'main', ['m1']);
        const release = makeBranch('release-1', 'release', ['r1'], 'main');
        const hotfix = makeBranch('hotfix-1', 'hotfix', ['h1'], 'release-1');
        const branches = [mainBranch, release, hotfix];
        expect(canDeleteBranch({ branch: release, branches })).toBe(false);
    });

    it('returns true for a release branch with no children', () => {
        const mainBranch = makeBranch('main', 'main', ['m1']);
        const release = makeBranch('release-1', 'release', ['r1'], 'main');
        const branches = [mainBranch, release];
        expect(canDeleteBranch({ branch: release, branches })).toBe(true);
    });

    it('returns true for hotfix with no children', () => {
        const mainBranch = makeBranch('main', 'main', ['m1']);
        const hotfix = makeBranch('hotfix-1', 'hotfix', ['h1'], 'main');
        const branches = [mainBranch, hotfix];
        expect(canDeleteBranch({ branch: hotfix, branches })).toBe(true);
    });

    it('returns true for bootleg with no children', () => {
        const mainBranch = makeBranch('main', 'main', ['m1']);
        const bootleg = makeBranch('bootleg-1', 'bootleg', ['bl1'], 'main');
        const branches = [mainBranch, bootleg];
        expect(canDeleteBranch({ branch: bootleg, branches })).toBe(true);
    });

    // ─── Null / empty guard cases ──────────────────────────────────────────

    it('returns false when branch is null', () => {
        expect(canDeleteBranch({ branch: null, branches: [] })).toBe(false);
    });

    it('returns false when branch is undefined', () => {
        expect(canDeleteBranch({ branch: undefined, branches: [] })).toBe(false);
    });

    it('returns false when branches array is null', () => {
        const leaf = makeBranch('dev-a', 'development', ['d1'], 'main');
        expect(canDeleteBranch({ branch: leaf, branches: null })).toBe(false);
    });

    it('returns false when branches array is undefined', () => {
        const leaf = makeBranch('dev-a', 'development', ['d1'], 'main');
        expect(canDeleteBranch({ branch: leaf, branches: undefined })).toBe(false);
    });
});
