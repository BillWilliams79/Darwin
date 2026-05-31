import { describe, it, expect } from 'vitest';
import {
    MAIN_BRANCH_NUMBER,
    OPEN_SENTINEL,
    isOpenMm,
    openMm,
    computeBranchNumber,
    formatVersion,
    fromModelBuild,
    toBuildRow,
    firstMainBuildVersion,
    nextBuildVersion,
    firstBuildOnNewBranchVersion,
    takesMainMm,
} from '../versionEngine';

// All fixtures below are the worked examples from
// memory/build-visualizer-design.md §4.5 — the engine is correct iff it
// reproduces them exactly.

describe('formatVersion', () => {
    it('renders M.m.B.b', () => {
        expect(formatVersion({ major: 1, minor: 3, build: 41, branchNumber: 2 })).toBe('1.3.41.2');
    });
    it('preserves explicit zeros (Major=0)', () => {
        expect(formatVersion({ major: 0, minor: 0, build: 1, branchNumber: 0 })).toBe('0.0.1.0');
    });
});

describe('computeBranchNumber — §4.4 reserved ranges', () => {
    it('main is always 0', () => {
        expect(computeBranchNumber('main', 0, 0)).toBe(MAIN_BRANCH_NUMBER);
        expect(computeBranchNumber('main', 3, 5)).toBe(0);
    });
    it('release / sample-release: 1 + ord0*50 + i', () => {
        expect(computeBranchNumber('release', 0, 0)).toBe(1);
        expect(computeBranchNumber('release', 0, 2)).toBe(3);
        expect(computeBranchNumber('release', 1, 0)).toBe(51);
        expect(computeBranchNumber('sample-release', 0, 0)).toBe(1);
    });
    it('hotfix: 6000 + ord0*50 + i', () => {
        expect(computeBranchNumber('hotfix', 0, 0)).toBe(6000);
        expect(computeBranchNumber('hotfix', 1, 0)).toBe(6050);
    });
    it('development: 7000 + ord0*100 + i', () => {
        expect(computeBranchNumber('development', 0, 0)).toBe(7000);
        expect(computeBranchNumber('development', 1, 2)).toBe(7102);
    });
    it('bootleg: 9000 + ord0*50 + i', () => {
        expect(computeBranchNumber('bootleg', 0, 0)).toBe(9000);
    });
    it('csr: (ord0+1)*1000 + i  [ord1*1000]', () => {
        expect(computeBranchNumber('csr', 0, 0)).toBe(1000);
        expect(computeBranchNumber('csr', 0, 5)).toBe(1005);
        expect(computeBranchNumber('csr', 1, 0)).toBe(2000);
    });
});

describe('firstMainBuildVersion — §4.6', () => {
    it('seeds M.m + initialBuildNumber, Branch# 0', () => {
        expect(firstMainBuildVersion({ major: 10, minor: 0, initialBuildNumber: 1 }))
            .toEqual({ major: 10, minor: 0, build: 1, branchNumber: 0 });
    });
    it('honors a non-1 first build #', () => {
        expect(firstMainBuildVersion({ major: 5, minor: 0, initialBuildNumber: 42 }).build).toBe(42);
    });
    it('preserves Major=0', () => {
        expect(formatVersion(firstMainBuildVersion({ major: 0, minor: 0, initialBuildNumber: 1 })))
            .toBe('0.0.1.0');
    });
});

describe('nextBuildVersion — §4.3', () => {
    it('main increments Build#, keeps Branch# 0 (10.0.1.0 → 10.0.2.0 → 10.0.3.0)', () => {
        const b1 = firstMainBuildVersion({ major: 10, minor: 0, initialBuildNumber: 1 });
        const b2 = nextBuildVersion({ branchType: 'main', lastBuild: b1, branchMm: { major: 10, minor: 0 } });
        const b3 = nextBuildVersion({ branchType: 'main', lastBuild: b2, branchMm: { major: 10, minor: 0 } });
        expect(formatVersion(b2)).toBe('10.0.2.0');
        expect(formatVersion(b3)).toBe('10.0.3.0');
    });
    it('main resets Build# to 1 on a new M.m after a release (5.0.8.0 → 5.1.1.0)', () => {
        const last = { major: 5, minor: 0, build: 8, branchNumber: 0 };
        const next = nextBuildVersion({ branchType: 'main', lastBuild: last, branchMm: { major: 5, minor: 1 } });
        expect(next).toEqual({ major: 5, minor: 1, build: 1, branchNumber: 0 });
    });
    it('sub-branch freezes Build#, walks Branch# (5.0.8.1 → 5.0.8.2)', () => {
        const b1 = { major: 5, minor: 0, build: 8, branchNumber: 1 };
        const b2 = nextBuildVersion({ branchType: 'release', lastBuild: b1, branchMm: { major: 5, minor: 0 } });
        expect(formatVersion(b2)).toBe('5.0.8.2');
    });
    it('throws when the branch M.m is open (refuse path)', () => {
        expect(() => nextBuildVersion({ branchType: 'main', lastBuild: null, branchMm: openMm() }))
            .toThrow();
    });
});

describe('firstBuildOnNewBranchVersion — §4.4/§4.5', () => {
    const parent = { major: 5, minor: 0, build: 8, branchNumber: 0 };
    it('release off 5.0.8.0 → 5.0.8.1 (frozen B=8, Branch# 1)', () => {
        expect(formatVersion(firstBuildOnNewBranchVersion({ type: 'release', parentBuild: parent, siblingOrd0: 0 })))
            .toBe('5.0.8.1');
    });
    it('hotfix off 5.1.3.0 → 5.1.3.6000; 2nd hotfix → 5.1.3.6050', () => {
        const p = { major: 5, minor: 1, build: 3, branchNumber: 0 };
        expect(formatVersion(firstBuildOnNewBranchVersion({ type: 'hotfix', parentBuild: p, siblingOrd0: 0 })))
            .toBe('5.1.3.6000');
        expect(formatVersion(firstBuildOnNewBranchVersion({ type: 'hotfix', parentBuild: p, siblingOrd0: 1 })))
            .toBe('5.1.3.6050');
    });
    it('sprint-release off release build 5.0.8.3 → 5.0.8.1 (frozen B=8)', () => {
        const p = { major: 5, minor: 0, build: 8, branchNumber: 3 };
        expect(formatVersion(firstBuildOnNewBranchVersion({ type: 'sample-release', parentBuild: p, siblingOrd0: 0 })))
            .toBe('5.0.8.1');
    });
});

describe('open state — §4.2', () => {
    it('isOpenMm detects null / undefined / negative', () => {
        expect(isOpenMm(null)).toBe(true);
        expect(isOpenMm({ major: -1, minor: -1 })).toBe(true);
        expect(isOpenMm({ major: 5, minor: null })).toBe(true);
        expect(isOpenMm({ major: 0, minor: 0 })).toBe(false); // 0.0 is a VALID M.m
        expect(isOpenMm({ major: 5, minor: 1 })).toBe(false);
    });
    it('openMm is the persisted sentinel and reads back as open', () => {
        expect(openMm()).toEqual({ major: OPEN_SENTINEL, minor: OPEN_SENTINEL });
        expect(isOpenMm(openMm())).toBe(true);
    });
    it('only release takes main\'s M.m', () => {
        expect(takesMainMm('release')).toBe(true);
        expect(takesMainMm('sample-release')).toBe(false);
        expect(takesMainMm('hotfix')).toBe(false);
    });
});

describe('adapters', () => {
    it('fromModelBuild maps branchNum → branchNumber', () => {
        expect(fromModelBuild({ major: 10, minor: 0, build: 2, branchNum: 0 }))
            .toEqual({ major: 10, minor: 0, build: 2, branchNumber: 0 });
        expect(fromModelBuild(null)).toBeNull();
    });
    it('toBuildRow maps to SQL columns', () => {
        expect(toBuildRow({ major: 10, minor: 0, build: 2, branchNumber: 0 }))
            .toEqual({ build_number: 2, branch_number: 0, major: 10, minor: 0 });
    });
});
