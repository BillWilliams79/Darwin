// req #2633 — computeLayout emits Acceptance Test annotations.
import { describe, it, expect } from 'vitest';
import { computeLayout } from '../d3LayoutEngine';

// Minimal model: main + one sub-branch, with AT fields populated the way
// useBuildVisualizerData does.
function makeModel(sub) {
    const builds = {};
    const mainBuildIds = [];
    for (let i = 0; i < 3; i++) {
        const id = `m${i + 1}`;
        mainBuildIds.push(id);
        builds[id] = { id, branchId: 'main', position: i, build: i + 1, branchNum: 0, major: 1, minor: 0 };
    }
    const branches = [{
        id: 'main', type: 'main', name: 'Main',
        parentBuildId: null, parentBranchId: null, buildIds: mainBuildIds,
        acceptanceTests: [], acceptanceStatus: 'pass', buildAT: false,
    }];
    if (sub) {
        const subIds = [];
        for (let i = 0; i < (sub.buildCount ?? 2); i++) {
            const bid = `${sub.id}-b${i + 1}`;
            subIds.push(bid);
            builds[bid] = { id: bid, branchId: sub.id, position: i, build: i + 1, branchNum: 1, major: 1, minor: 0 };
        }
        branches.push({
            id: sub.id, type: sub.type, name: sub.name || sub.id,
            parentBuildId: 'm1', parentBranchId: 'main', buildIds: subIds,
            acceptanceTests: sub.acceptanceTests || [],
            acceptanceStatus: sub.acceptanceStatus || 'pass',
            buildAT: !!sub.buildAT,
        });
    }
    return { branches, builds, releaseEvents: {}, releaseEventDetails: {} };
}

describe('computeLayout — branch-level AT glyphs', () => {
    it('glyph sits MID-SEGMENT between the last two builds; names anchor under the latest build', () => {
        const model = makeModel({
            id: 'rel', type: 'release', buildCount: 2,
            acceptanceTests: ['Sprint AT', 'Cert AT'], acceptanceStatus: 'pass',
        });
        const layout = computeLayout(model);
        const g = layout.atBranchGlyphs.find(x => x.branchId === 'rel');
        expect(g).toBeTruthy();
        expect(g.names).toEqual(['Sprint AT', 'Cert AT']);
        expect(g.status).toBe('pass');
        const relBuilds = layout.builds.filter(b => b.branchId === 'rel');
        const lastBuild = relBuilds.at(-1);
        const prevBuild = relBuilds.at(-2);
        // Glyph at the midpoint between the last two builds, on the line.
        expect(g.x).toBeCloseTo((lastBuild.x + prevBuild.x) / 2);
        expect(g.y).toBe(lastBuild.y);
        // Names anchored at the latest build.
        expect(g.namesX).toBe(lastBuild.x);
    });

    it('single-build branch places the glyph half a column back from the build', () => {
        const model = makeModel({
            id: 'hf', type: 'hotfix', buildCount: 1, acceptanceTests: ['Cert AT'],
        });
        const layout = computeLayout(model);
        const g = layout.atBranchGlyphs.find(x => x.branchId === 'hf');
        const lastBuild = layout.builds.filter(b => b.branchId === 'hf').at(-1);
        expect(g.x).toBeLessThan(lastBuild.x);
        expect(g.namesX).toBe(lastBuild.x);
    });

    it('propagates fail status', () => {
        const model = makeModel({
            id: 'hf', type: 'hotfix', acceptanceTests: ['Cert AT'], acceptanceStatus: 'fail',
        });
        const layout = computeLayout(model);
        expect(layout.atBranchGlyphs.find(x => x.branchId === 'hf').status).toBe('fail');
    });

    it('emits NO branch glyph when the branch has no branch-level ATs', () => {
        const model = makeModel({ id: 'boot', type: 'bootleg', acceptanceTests: [] });
        const layout = computeLayout(model);
        expect(layout.atBranchGlyphs.find(x => x.branchId === 'boot')).toBeUndefined();
    });

    it('emits NO branch glyph when the branch has ATs but zero builds', () => {
        const model = makeModel({ id: 'rel', type: 'release', buildCount: 0, acceptanceTests: ['Sprint AT'] });
        const layout = computeLayout(model);
        expect(layout.atBranchGlyphs.find(x => x.branchId === 'rel')).toBeUndefined();
    });
});

describe('computeLayout — Build AT per-build loops', () => {
    it('emits one loop per build on a buildAT branch', () => {
        const model = makeModel({ id: 'boot', type: 'bootleg', buildCount: 3, buildAT: true });
        const layout = computeLayout(model);
        const loops = layout.atBuildLoops.filter(l => l.branchId === 'boot');
        expect(loops).toHaveLength(3);
        // Each loop sits at its build's coordinates.
        for (const l of loops) {
            const b = layout.builds.find(x => x.id === l.buildId);
            expect(l.x).toBe(b.x);
            expect(l.y).toBe(b.y);
        }
    });

    it('emits no loops for a non-buildAT branch', () => {
        const model = makeModel({ id: 'rel', type: 'release', buildAT: false, acceptanceTests: ['Sprint AT'] });
        const layout = computeLayout(model);
        expect(layout.atBuildLoops.filter(l => l.branchId === 'rel')).toHaveLength(0);
    });

    it('the showBuildAt:false opt suppresses ALL loops (header toggle off)', () => {
        const model = makeModel({ id: 'boot', type: 'bootleg', buildCount: 3, buildAT: true });
        const layout = computeLayout(model, { showBuildAt: false });
        expect(layout.atBuildLoops).toHaveLength(0);
    });

    it('a loop flags whether its build also bears a release event', () => {
        const model = makeModel({ id: 'boot', type: 'bootleg', buildCount: 2, buildAT: true });
        // Attach a release to the first bootleg build.
        const firstBid = 'boot-b1';
        model.releaseEvents = { [firstBid]: ['Acme'] };
        const layout = computeLayout(model);
        const withRel = layout.atBuildLoops.find(l => l.buildId === firstBid);
        const without = layout.atBuildLoops.find(l => l.buildId === 'boot-b2');
        expect(withRel.hasRelease).toBe(true);
        expect(without.hasRelease).toBe(false);
    });
});

describe('computeLayout — master Acceptance Tests toggle', () => {
    it('showAcceptanceTests:false suppresses BOTH branch glyphs and Build AT loops', () => {
        const model = makeModel({
            id: 'rel', type: 'release', buildCount: 2,
            acceptanceTests: ['Sprint AT', 'Cert AT'], buildAT: true,
        });
        const layout = computeLayout(model, { showAcceptanceTests: false });
        expect(layout.atBranchGlyphs).toHaveLength(0);
        expect(layout.atBuildLoops).toHaveLength(0);
    });
});

describe('computeLayout — AT name labels clear build numbers + expand lanes', () => {
    it('name labels start BELOW the latest build version far-lane', () => {
        const model = makeModel({
            id: 'rel', type: 'release', buildCount: 2, acceptanceTests: ['Sprint AT'],
        });
        const layout = computeLayout(model, { versionLanes: true });
        const g = layout.atBranchGlyphs.find(x => x.branchId === 'rel');
        const lastBuild = layout.builds.filter(b => b.branchId === 'rel').at(-1);
        // namesStartY must clear the build's version label row.
        expect(g.namesStartY).toBeGreaterThan(lastBuild.versionY);
    });

    // Two CSR branches off the same parent build land on two lanes (cs1 = lane 0
    // lower/inner, cs2 = lane 1 upper). cs2's name stack extends DOWN toward cs1,
    // so adding names to cs2 widens the cs1↔cs2 gap by names*lineH.
    const twoCsr = (cs2Names = []) => computeLayout(makeModelTwoCsr(cs2Names));
    function makeModelTwoCsr(cs2Names) {
        const base = makeModel();
        const builds = { ...base.builds };
        const mk = (id, n) => {
            const ids = [];
            for (let i = 0; i < n; i++) {
                const bid = `${id}-b${i + 1}`;
                ids.push(bid);
                builds[bid] = { id: bid, branchId: id, position: i, build: i + 1, branchNum: 1, major: 1, minor: 0 };
            }
            return ids;
        };
        const branches = [base.branches[0]]; // main
        branches.push({ id: 'cs1', type: 'csr', name: 'cs1', parentBuildId: 'm1', parentBranchId: 'main',
            buildIds: mk('cs1', 3), acceptanceTests: [], acceptanceStatus: 'pass', buildAT: false });
        branches.push({ id: 'cs2', type: 'csr', name: 'cs2', parentBuildId: 'm1', parentBranchId: 'main',
            buildIds: mk('cs2', 3), acceptanceTests: cs2Names, acceptanceStatus: 'pass', buildAT: false });
        return { branches, builds, releaseEvents: {}, releaseEventDetails: {} };
    }
    const gap = (layout) => {
        const cs1 = layout.branches.find(b => b.id === 'cs1');
        const cs2 = layout.branches.find(b => b.id === 'cs2');
        return Math.abs(cs1.y - cs2.y);
    };

    it('adding N AT names to a lane widens the gap to the lane below by N lineHeights', () => {
        const noNames = gap(twoCsr([]));
        const threeNames = gap(twoCsr(['Sprint AT', 'OEM AT', 'Cert AT']));
        expect(threeNames - noNames).toBe(3 * 14); // ATNAME_LINE_H = 14 (req #2876)
    });
});
