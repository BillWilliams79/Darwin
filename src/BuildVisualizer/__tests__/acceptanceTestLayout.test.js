// req #2633 — computeLayout emits Acceptance Test annotations.
import { describe, it, expect } from 'vitest';
import { computeLayout, DEFAULT_OPTS } from '../d3LayoutEngine';

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
    it('glyph anchors ABOVE the latest build; names + box ride above the build (req #2890)', () => {
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
        // req #2890 — box anchored at the LATEST build's x/y (no longer mid-segment);
        // the render lifts the box + names above the dot. Below-anchored fields gone.
        expect(g.x).toBe(lastBuild.x);
        expect(g.y).toBe(lastBuild.y);
        expect(g.namesX).toBeUndefined();
        expect(g.namesStartY).toBeUndefined();
        expect(g.nameLineH).toBe(14);
    });

    it('single-build branch anchors the glyph at the build (req #2890)', () => {
        const model = makeModel({
            id: 'hf', type: 'hotfix', buildCount: 1, acceptanceTests: ['Cert AT'],
        });
        const layout = computeLayout(model);
        const g = layout.atBranchGlyphs.find(x => x.branchId === 'hf');
        const lastBuild = layout.builds.filter(b => b.branchId === 'hf').at(-1);
        expect(g.x).toBe(lastBuild.x);
        expect(g.y).toBe(lastBuild.y);
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

describe('computeLayout — Build AT folded into the single per-branch box (req #2890)', () => {
    it('adds a trailing "Build AT" line to the branch\'s AT-name list (no per-build boxes)', () => {
        const model = makeModel({ id: 'boot', type: 'bootleg', buildCount: 3, buildAT: true });
        const layout = computeLayout(model);
        // No per-build Build AT boxes are emitted anymore.
        expect(layout.atBuildLoops).toBeUndefined();
        // A bootleg (no branch-level ATs) with Build AT renders ONE box at the
        // latest build, with just "Build AT" in the list.
        const g = layout.atBranchGlyphs.find(x => x.branchId === 'boot');
        expect(g).toBeTruthy();
        expect(g.names).toEqual(['Build AT']);
        const lastBuild = layout.builds.filter(b => b.branchId === 'boot').at(-1);
        expect(g.x).toBe(lastBuild.x);
        expect(g.y).toBe(lastBuild.y);
    });

    it('appends "Build AT" AFTER the branch-level ATs in the combined list', () => {
        const model = makeModel({
            id: 'rel', type: 'release', buildCount: 2,
            acceptanceTests: ['Sprint AT', 'Cert AT'], buildAT: true,
        });
        const g = computeLayout(model).atBranchGlyphs.find(x => x.branchId === 'rel');
        expect(g.names).toEqual(['Sprint AT', 'Cert AT', 'Build AT']);
    });

    it('omits "Build AT" for a non-buildAT branch', () => {
        const model = makeModel({ id: 'rel', type: 'release', buildAT: false, acceptanceTests: ['Sprint AT'] });
        const g = computeLayout(model).atBranchGlyphs.find(x => x.branchId === 'rel');
        expect(g.names).toEqual(['Sprint AT']);
    });

    it('the showBuildAt:false opt drops the "Build AT" line (header toggle off)', () => {
        // bootleg has ONLY Build AT, so with the toggle off it has no AT names at
        // all → no box emitted.
        const model = makeModel({ id: 'boot', type: 'bootleg', buildCount: 3, buildAT: true });
        const layout = computeLayout(model, { showBuildAt: false });
        expect(layout.atBranchGlyphs.find(x => x.branchId === 'boot')).toBeUndefined();
        // A branch WITH branch-level ATs keeps them but loses the Build AT line.
        const relModel = makeModel({ id: 'rel', type: 'release', buildCount: 2, acceptanceTests: ['Sprint AT'], buildAT: true });
        const g = computeLayout(relModel, { showBuildAt: false }).atBranchGlyphs.find(x => x.branchId === 'rel');
        expect(g.names).toEqual(['Sprint AT']);
    });
});

describe('computeLayout — master Acceptance Tests toggle', () => {
    it('showAcceptanceTests:false suppresses the per-branch AT box entirely', () => {
        const model = makeModel({
            id: 'rel', type: 'release', buildCount: 2,
            acceptanceTests: ['Sprint AT', 'Cert AT'], buildAT: true,
        });
        const layout = computeLayout(model, { showAcceptanceTests: false });
        expect(layout.atBranchGlyphs).toHaveLength(0);
        expect(layout.atBuildLoops).toBeUndefined();
    });
});

describe('computeLayout — AT name stack rides ABOVE the build (req #2890)', () => {
    it('a branch carrying N AT names reserves box + N lineHeights ABOVE its own row', () => {
        // Isolate from the Build AT overlay (showBuildAt:false) so only the branch
        // AT box + names factor into the row spacing.
        const y = (names) => computeLayout(
            makeModel({ id: 'rel', type: 'release', buildCount: 2, acceptanceTests: names }),
            { showBuildAt: false },
        ).branches.find(b => b.id === 'rel').y;
        // The release row is the topmost above-stratum lane; adding names widens the
        // gap ABOVE it, pushing the row DOWN by branchAtClearance + N*ATNAME_LINE_H.
        expect(y(['Sprint AT', 'Cert AT']) - y([]))
            .toBe(DEFAULT_OPTS.branchAtClearance + 2 * 14); // ATNAME_LINE_H = 14
    });

    // Two CSR branches off the same parent build land on two lanes (cs1 = lane 0
    // lower/inner, cs2 = lane 1 upper). req #2890 — name stacks rise UPWARD and are
    // reserved in the OWN row's gapAbove, so adding names to cs1 (the LOWER lane)
    // widens the cs1↔cs2 gap; adding them to cs2 (upper) does not.
    const twoCsr = (cs1Names = []) => computeLayout(makeModelTwoCsr(cs1Names), { showBuildAt: false });
    function makeModelTwoCsr(cs1Names) {
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
            buildIds: mk('cs1', 3), acceptanceTests: cs1Names, acceptanceStatus: 'pass', buildAT: false });
        branches.push({ id: 'cs2', type: 'csr', name: 'cs2', parentBuildId: 'm1', parentBranchId: 'main',
            buildIds: mk('cs2', 3), acceptanceTests: [], acceptanceStatus: 'pass', buildAT: false });
        return { branches, builds, releaseEvents: {}, releaseEventDetails: {} };
    }
    const gap = (layout) => {
        const cs1 = layout.branches.find(b => b.id === 'cs1');
        const cs2 = layout.branches.find(b => b.id === 'cs2');
        return Math.abs(cs1.y - cs2.y);
    };

    it('adding N AT names to the LOWER lane widens the gap to the lane above by box + N lineHeights', () => {
        const noNames = gap(twoCsr([]));
        const threeNames = gap(twoCsr(['Sprint AT', 'OEM AT', 'Cert AT']));
        expect(threeNames - noNames).toBe(DEFAULT_OPTS.branchAtClearance + 3 * 14);
    });
});
