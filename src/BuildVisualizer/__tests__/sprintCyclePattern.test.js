import { describe, it, expect } from 'vitest';
import { generateSprintCyclePattern } from '../sprintCyclePattern';

describe('generateSprintCyclePattern', () => {
    it('produces a builds.json-shaped object with the documented top-level fields', () => {
        const data = generateSprintCyclePattern();
        expect(data.version).toBe(1);
        expect(typeof data.currentMajor).toBe('number');
        expect(typeof data.currentMinor).toBe('number');
        expect(typeof data.nextBuildNumber).toBe('number');
        expect(typeof data.nextBranchNumber).toBe('number');
        expect(Array.isArray(data.branches)).toBe(true);
        expect(typeof data.builds).toBe('object');
    });

    it('is deterministic for a given seed', () => {
        const a = generateSprintCyclePattern({ seed: 2602 });
        const b = generateSprintCyclePattern({ seed: 2602 });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('varies output when seeds differ', () => {
        const a = generateSprintCyclePattern({ seed: 1 });
        const b = generateSprintCyclePattern({ seed: 2 });
        expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    });

    it('emits exactly 10 sprint-release branches', () => {
        const data = generateSprintCyclePattern();
        const sprints = data.branches.filter(b => b.type === 'sample-release');
        expect(sprints).toHaveLength(10);
        for (const sprint of sprints) {
            expect(sprint.buildIds.length).toBeGreaterThanOrEqual(1);
            expect(sprint.buildIds.length).toBeLessThanOrEqual(5);
            const lastBuildId = sprint.buildIds[sprint.buildIds.length - 1];
            expect(data.builds[lastBuildId].dotColor).toBe('gray');
        }
    });

    it('emits 4 development branches per sprint period (40 total), all parented on main', () => {
        const data = generateSprintCyclePattern();
        const devs = data.branches.filter(b => b.type === 'development');
        expect(devs).toHaveLength(4 * 10);
        for (const dev of devs) {
            expect(dev.parentBranchId).toBe('main');
            expect(dev.side).toBe('below');
            expect(dev.buildIds.length).toBeGreaterThan(0);
        }
    });

    it('sprinkles dev branches across the period — not all on the same main build', () => {
        const data = generateSprintCyclePattern();
        const devs = data.branches.filter(b => b.type === 'development');
        const distinctParents = new Set(devs.map(d => d.parentBuildId));
        // With 40 dev branches each picking a random parent from a pool of 8-10
        // candidates per period, the seeded run produces well more than one
        // distinct parent build — guard with a forgiving lower bound.
        expect(distinctParents.size).toBeGreaterThan(20);
    });

    it('places 8-10 main builds between consecutive sprint branch points', () => {
        const data = generateSprintCyclePattern();
        const main = data.branches.find(b => b.type === 'main');
        const sprints = data.branches.filter(b => b.type === 'sample-release');
        const sprintParentPositions = sprints.map(s => main.buildIds.indexOf(s.parentBuildId));
        // First sprint parent is at index (periodLength - 1). Subsequent gaps
        // between sprint parent positions are the next period's length.
        expect(sprintParentPositions[0]).toBeGreaterThanOrEqual(7);
        expect(sprintParentPositions[0]).toBeLessThanOrEqual(9);
        for (let i = 1; i < sprintParentPositions.length; i += 1) {
            const gap = sprintParentPositions[i] - sprintParentPositions[i - 1];
            expect(gap).toBeGreaterThanOrEqual(8);
            expect(gap).toBeLessThanOrEqual(10);
        }
    });

    it('mixes short (1-2 build) and long (8-10 build) dev branches', () => {
        const data = generateSprintCyclePattern();
        const devLengths = data.branches
            .filter(b => b.type === 'development')
            .map(b => b.buildIds.length);
        for (const len of devLengths) {
            // Allowed: 1, 2 (short) or 8, 9, 10 (long)
            expect([1, 2, 8, 9, 10]).toContain(len);
        }
        // At least one long branch should appear with seed=2602 (40 trials at
        // 10% probability — getting zero is highly unlikely but the seed locks
        // the outcome).
        const longCount = devLengths.filter(len => len >= 8).length;
        expect(longCount).toBeGreaterThan(0);
        // And most should be short.
        const shortCount = devLengths.filter(len => len <= 2).length;
        expect(shortCount).toBeGreaterThan(longCount);
    });

    it('cuts the release branch off a main build after the final sprint', () => {
        const data = generateSprintCyclePattern();
        const release = data.branches.find(b => b.type === 'release');
        expect(release).toBeDefined();
        expect(release.parentBranchId).toBe('main');
        const main = data.branches.find(b => b.type === 'main');
        // Release parent comes AFTER the last sprint branch parent in main's order.
        const sprints = data.branches.filter(b => b.type === 'sample-release');
        const lastSprintParentIdx = main.buildIds.indexOf(sprints[sprints.length - 1].parentBuildId);
        const releaseParentIdx = main.buildIds.indexOf(release.parentBuildId);
        expect(releaseParentIdx).toBeGreaterThan(lastSprintParentIdx);
    });

    it('puts two yellow sprint-end builds then a green final release on the release branch', () => {
        const data = generateSprintCyclePattern();
        const release = data.branches.find(b => b.type === 'release');
        expect(release.buildIds).toHaveLength(3);
        const [b1, b2, b3] = release.buildIds;
        expect(data.builds[b1].dotColor).toBe('yellow');
        expect(data.builds[b2].dotColor).toBe('yellow');
        expect(data.builds[b3].dotColor).toBe('green');
    });

    it('emits 1 CSR, 5 bootleg, and 3 hotfix branches scattered across the release branch builds', () => {
        const data = generateSprintCyclePattern();
        const release = data.branches.find(b => b.type === 'release');
        const releaseBuildIds = new Set(release.buildIds);

        const tailOf = (type) => data.branches.filter(b => b.type === type);

        expect(tailOf('csr')).toHaveLength(1);
        expect(tailOf('bootleg')).toHaveLength(5);
        expect(tailOf('hotfix')).toHaveLength(3);

        // Every tail branch parents on SOME release-branch build (not all the
        // same one — that's the "remove the cluster" requirement).
        const tailParents = [...tailOf('csr'), ...tailOf('bootleg'), ...tailOf('hotfix')]
            .map(b => b.parentBuildId);
        for (const parentId of tailParents) {
            expect(releaseBuildIds.has(parentId)).toBe(true);
        }
        const distinctTailParents = new Set(tailParents);
        // 9 tail items, 3 release-branch builds: at least 2 distinct parents
        // means the cluster is broken up.
        expect(distinctTailParents.size).toBeGreaterThanOrEqual(2);
    });

    it('numbers builds contiguously from 1 in declaration order', () => {
        const data = generateSprintCyclePattern();
        const ids = Object.keys(data.builds);
        const sorted = [...ids].sort((a, b) => data.builds[a].number - data.builds[b].number);
        // Numbers are 1..N with no gaps
        sorted.forEach((id, i) => {
            expect(data.builds[id].number).toBe(i + 1);
        });
        expect(data.nextBuildNumber).toBe(sorted.length + 1);
    });

    it('keeps every build referenced exactly once from a branch.buildIds', () => {
        const data = generateSprintCyclePattern();
        const referenced = new Map();
        for (const branch of data.branches) {
            for (const buildId of branch.buildIds) {
                referenced.set(buildId, (referenced.get(buildId) || 0) + 1);
            }
        }
        for (const buildId of Object.keys(data.builds)) {
            expect(referenced.get(buildId)).toBe(1);
        }
    });

    it('every non-main branch points at a parent build that actually exists', () => {
        const data = generateSprintCyclePattern();
        for (const branch of data.branches) {
            if (branch.type === 'main') continue;
            expect(data.builds[branch.parentBuildId]).toBeDefined();
        }
    });
});
