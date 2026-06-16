// req #2633 — Acceptance Test matrix config.
import { describe, it, expect } from 'vitest';
import {
    AT_MATRIX, BUILD_AT_ALL_BRANCHES, branchLevelAtsFor, runsBuildAt,
} from '../acceptanceTestConfig';

describe('acceptanceTestConfig — branch-level matrix', () => {
    it('maps each branch type to its required branch-level ATs (image 7 matrix)', () => {
        expect(branchLevelAtsFor('sample-release')).toEqual(['Sprint AT']);
        expect(branchLevelAtsFor('release')).toEqual(
            ['Sprint AT', 'Functional AT', 'OEM AT', 'RC AT', 'Cert AT']);
        expect(branchLevelAtsFor('csr')).toEqual(['Sprint AT', 'OEM AT', 'Cert AT']);
        expect(branchLevelAtsFor('hotfix')).toEqual(['Sprint AT', 'Cert AT']);
        expect(branchLevelAtsFor('main')).toEqual(['Daily AT']);
    });

    it('Build AT is NEVER a branch-level AT (it is the per-build loop)', () => {
        for (const names of Object.values(AT_MATRIX)) {
            expect(names).not.toContain('Build AT');
        }
    });

    it('bootleg and development carry no branch-level ATs', () => {
        expect(branchLevelAtsFor('bootleg')).toEqual([]);
        expect(branchLevelAtsFor('development')).toEqual([]);
    });

    it('unknown branch types return an empty list (safe default)', () => {
        expect(branchLevelAtsFor('nonsense')).toEqual([]);
        expect(branchLevelAtsFor(undefined)).toEqual([]);
    });
});

describe('acceptanceTestConfig — Build AT (per-build loop)', () => {
    it('Build AT runs on every branch type (universal, req #2633 review round)', () => {
        expect(BUILD_AT_ALL_BRANCHES).toBe(true);
        for (const t of ['main', 'bootleg', 'release', 'csr', 'hotfix', 'sample-release', 'development']) {
            expect(runsBuildAt(t)).toBe(true);
        }
    });
});
