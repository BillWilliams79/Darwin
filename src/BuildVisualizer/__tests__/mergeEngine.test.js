import { describe, it, expect } from 'vitest';
import { computeLayout } from '../d3LayoutEngine';
import {
    computeMerges,
    mergePath,
    hasMergeRules,
    MERGE_RULES,
    MERGE_REQUIRED,
    MERGE_EVALUATE,
    MERGE_DAYZERO,
} from '../mergeEngine';

// ---------------------------------------------------------------------------
// Model builder. `branchSpecs` is a list of:
//   { id, type, parentBuildId, parentBranchId, nBuilds }
// 'main' is added automatically with `mainBuilds` builds.
// Build extIds follow `${branchId}-b${n}` so they are unique per project.
// ---------------------------------------------------------------------------
function makeModel({ mainBuilds = 4, branchSpecs = [], releaseEvents = {} } = {}) {
    const builds = {};
    const mkBuilds = (branchId, n) => {
        const ids = [];
        for (let i = 0; i < n; i++) {
            const id = `${branchId}-b${i + 1}`;
            ids.push(id);
            builds[id] = {
                id, branchId, position: i, build: i + 1,
                branchNum: 0, major: 1, minor: 0,
            };
        }
        return ids;
    };

    const branches = [{
        id: 'main', type: 'main', name: 'Main',
        parentBuildId: null, parentBranchId: null,
        buildIds: mkBuilds('main', mainBuilds),
    }];
    for (const s of branchSpecs) {
        branches.push({
            id: s.id,
            type: s.type,
            name: s.id,
            parentBuildId: s.parentBuildId,
            parentBranchId: s.parentBranchId,
            buildIds: mkBuilds(s.id, s.nBuilds ?? 1),
        });
    }
    return { branches, builds, releaseEvents, releaseEventDetails: {} };
}

// A representative tree exercising every branch type. csr/hotfix/bootleg sit on
// release-1 so the "release scheme" (main + origin release + its CSRs) is
// exercised; `hotfix-main` sits off main with NO release ancestor to exercise
// the required→main-only case.
function fixture() {
    return makeModel({
        mainBuilds: 4,
        branchSpecs: [
            { id: 'release-1',  type: 'release',        parentBuildId: 'main-b2',      parentBranchId: 'main',      nBuilds: 2 },
            { id: 'sample-1',   type: 'sample-release', parentBuildId: 'main-b1',      parentBranchId: 'main',      nBuilds: 1 },
            { id: 'dev-1',      type: 'development',     parentBuildId: 'main-b3',      parentBranchId: 'main',      nBuilds: 1 },
            { id: 'csr-1',      type: 'csr',            parentBuildId: 'release-1-b1', parentBranchId: 'release-1', nBuilds: 1 },
            { id: 'csr-2',      type: 'csr',            parentBuildId: 'release-1-b2', parentBranchId: 'release-1', nBuilds: 1 },
            { id: 'hotfix-1',   type: 'hotfix',         parentBuildId: 'release-1-b2', parentBranchId: 'release-1', nBuilds: 1 },
            { id: 'bootleg-1',  type: 'bootleg',        parentBuildId: 'release-1-b1', parentBranchId: 'release-1', nBuilds: 1 },
            { id: 'hotfix-main', type: 'hotfix',        parentBuildId: 'main-b4',      parentBranchId: 'main',      nBuilds: 1 },
        ],
    });
}

const layoutOf = (model, opts = {}) => computeLayout(model, opts);
const has = (merges, kind, source, dest) =>
    merges.some(m => m.kind === kind && m.source === source && m.dest === dest);
const find = (merges, kind, source, dest) =>
    merges.find(m => m.kind === kind && m.source === source && m.dest === dest);

describe('mergeEngine — rule table', () => {
    it('main has no merge rules', () => {
        expect(MERGE_RULES.main).toEqual([]);
    });
    it('csr carries one required + two evaluate rules', () => {
        const kinds = MERGE_RULES.csr.map(r => r.kind);
        expect(kinds.filter(k => k === MERGE_REQUIRED)).toHaveLength(1);
        expect(kinds.filter(k => k === MERGE_EVALUATE)).toHaveLength(2);
    });

    it('hasMergeRules is true for mergeable types, false for main', () => {
        expect(hasMergeRules('main')).toBe(false);
        for (const t of ['sample-release', 'release', 'hotfix', 'development', 'bootleg', 'csr']) {
            expect(hasMergeRules(t)).toBe(true);
        }
        expect(hasMergeRules('nope')).toBe(false);
    });
});

describe('mergeEngine — standard merges', () => {
    const model = fixture();
    const layout = layoutOf(model);
    const merges = computeMerges({ model, layout });

    it('main is never a merge source', () => {
        expect(merges.some(m => m.source === 'main')).toBe(false);
    });

    it('sample and release each merge to main (required)', () => {
        expect(has(merges, MERGE_REQUIRED, 'sample-1', 'main')).toBe(true);
        expect(has(merges, MERGE_REQUIRED, 'release-1', 'main')).toBe(true);
    });

    it('dev merges to its origin (parent) branch (required)', () => {
        expect(has(merges, MERGE_REQUIRED, 'dev-1', 'main')).toBe(true);
    });

    it('csr / hotfix / bootleg merge to main (required) + origin release + its CSRs (evaluate)', () => {
        for (const src of ['csr-1', 'hotfix-1', 'bootleg-1']) {
            expect(has(merges, MERGE_REQUIRED, src, 'main')).toBe(true);       // required → main
            expect(has(merges, MERGE_EVALUATE, src, 'release-1')).toBe(true);  // evaluate → origin release
        }
        // evaluate → every CSR on release-1. csr-1 excludes itself (self-merge
        // guard); hotfix-1 / bootleg-1 reach BOTH CSRs.
        expect(has(merges, MERGE_EVALUATE, 'csr-1', 'csr-2')).toBe(true);
        expect(has(merges, MERGE_EVALUATE, 'csr-1', 'csr-1')).toBe(false);
        for (const src of ['hotfix-1', 'bootleg-1']) {
            expect(has(merges, MERGE_EVALUATE, src, 'csr-1')).toBe(true);
            expect(has(merges, MERGE_EVALUATE, src, 'csr-2')).toBe(true);
        }
        // bootleg no longer merges to its parent branch (the old origin rule).
        expect(has(merges, MERGE_REQUIRED, 'bootleg-1', 'release-1')).toBe(false);
    });

    it('a hotfix/bootleg with NO release ancestor gets only required→main (no evaluate)', () => {
        expect(has(merges, MERGE_REQUIRED, 'hotfix-main', 'main')).toBe(true);
        expect(merges.some(m => m.source === 'hotfix-main' && m.kind === MERGE_EVALUATE)).toBe(false);
    });

    it('never produces a self-merge', () => {
        expect(merges.some(m => m.source === m.dest)).toBe(false);
    });

    it('emits unique merge ids (deduped)', () => {
        const ids = merges.map(m => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('mergeEngine — release re-spin caveat', () => {
    // release-1 has 3 builds; rel-b2 is RELEASED (release event) and has a
    // hotfix + csr child; rel-b3 is a build BEYOND the released build.
    const respinModel = () => makeModel({
        mainBuilds: 3,
        branchSpecs: [
            { id: 'release-1', type: 'release', parentBuildId: 'main-b2',      parentBranchId: 'main',      nBuilds: 3 },
            { id: 'hf-r',      type: 'hotfix',  parentBuildId: 'release-1-b2', parentBranchId: 'release-1', nBuilds: 1 },
            { id: 'csr-r',     type: 'csr',     parentBuildId: 'release-1-b2', parentBranchId: 'release-1', nBuilds: 1 },
        ],
        releaseEvents: { 'release-1-b2': ['CustomerX'] },
    });

    it('release evaluate-merges to the hotfix/CSR children of a released build with a build beyond it', () => {
        const model = respinModel();
        const merges = computeMerges({ model, layout: layoutOf(model) });
        expect(has(merges, MERGE_REQUIRED, 'release-1', 'main')).toBe(true);
        expect(has(merges, MERGE_EVALUATE, 'release-1', 'hf-r')).toBe(true);
        expect(has(merges, MERGE_EVALUATE, 'release-1', 'csr-r')).toBe(true);
    });

    it('no re-spin merge when the released build is the LAST build (nothing beyond)', () => {
        // Same tree but the release event is on the LAST build (rel-b3).
        const model = makeModel({
            mainBuilds: 3,
            branchSpecs: [
                { id: 'release-1', type: 'release', parentBuildId: 'main-b2',      parentBranchId: 'main',      nBuilds: 3 },
                { id: 'hf-r',      type: 'hotfix',  parentBuildId: 'release-1-b3', parentBranchId: 'release-1', nBuilds: 1 },
            ],
            releaseEvents: { 'release-1-b3': ['CustomerX'] },
        });
        const merges = computeMerges({ model, layout: layoutOf(model) });
        expect(has(merges, MERGE_EVALUATE, 'release-1', 'hf-r')).toBe(false);
    });

    it('accumulates re-spin targets across MULTIPLE released builds', () => {
        // b1 released (hf-1 child) + b2 released (csr-2 child), b3 is the build
        // beyond both. Release should evaluate-merge to BOTH children.
        const model = makeModel({
            mainBuilds: 3,
            branchSpecs: [
                { id: 'release-1', type: 'release', parentBuildId: 'main-b2',      parentBranchId: 'main',      nBuilds: 3 },
                { id: 'hf-1',      type: 'hotfix',  parentBuildId: 'release-1-b1', parentBranchId: 'release-1', nBuilds: 1 },
                { id: 'csr-2',     type: 'csr',     parentBuildId: 'release-1-b2', parentBranchId: 'release-1', nBuilds: 1 },
            ],
            releaseEvents: { 'release-1-b1': ['CustA'], 'release-1-b2': ['CustB'] },
        });
        const merges = computeMerges({ model, layout: layoutOf(model) });
        expect(has(merges, MERGE_EVALUATE, 'release-1', 'hf-1')).toBe(true);
        expect(has(merges, MERGE_EVALUATE, 'release-1', 'csr-2')).toBe(true);
    });

    it('no re-spin merge when the build with children was never released', () => {
        const model = makeModel({
            mainBuilds: 3,
            branchSpecs: [
                { id: 'release-1', type: 'release', parentBuildId: 'main-b2',      parentBranchId: 'main',      nBuilds: 3 },
                { id: 'hf-r',      type: 'hotfix',  parentBuildId: 'release-1-b2', parentBranchId: 'release-1', nBuilds: 1 },
            ],
            // no releaseEvents at all
        });
        const merges = computeMerges({ model, layout: layoutOf(model) });
        expect(has(merges, MERGE_EVALUATE, 'release-1', 'hf-r')).toBe(false);
    });
});

describe('mergeEngine — geometry', () => {
    const model = fixture();
    const layout = layoutOf(model);
    const merges = computeMerges({ model, layout });

    it('lands the arrow just past the destination last build, on the dest line', () => {
        const m = find(merges, MERGE_REQUIRED, 'release-1', 'main');
        const mainBuilds = layout.builds.filter(b => b.branchId === 'main');
        const mainLastX = Math.max(...mainBuilds.map(b => b.x));
        const mainY = layout.mainY;
        expect(m.destX).toBe(mainLastX + 30);
        expect(m.destY).toBe(mainY);
    });

    it('originates at the source branch tip (its last build)', () => {
        const m = find(merges, MERGE_REQUIRED, 'release-1', 'main');
        const relBuilds = layout.builds.filter(b => b.branchId === 'release-1');
        const relLastX = Math.max(...relBuilds.map(b => b.x));
        expect(m.sourceX).toBe(relLastX);
        const relRecord = layout.branches.find(b => b.id === 'release-1');
        expect(m.sourceY).toBe(relRecord.y);
    });

    it('mergePath starts at the source, lands exactly on the dest, has a lane run', () => {
        const d = mergePath(400, 300, 300, 240); // dev tip → main (dest above-left)
        expect(d.startsWith('M 400 300')).toBe(true);
        expect(d.endsWith('300 240')).toBe(true); // arrives exactly on the destination
        expect(d).toContain('L');                 // horizontal lane run
        expect(d).toContain('C');                 // corners
    });

    it('mergePath drops the horizontal run into a lane BELOW the source line', () => {
        const d = mergePath(400, 300, 300, 240);
        const m = d.match(/L (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/);
        expect(m).toBeTruthy();
        const laneY = parseFloat(m[2]);
        expect(laneY).toBeGreaterThan(300);       // lane sits below the source line (y0=300)
    });

    it('mergePath arrives VERTICALLY at the destination (cp2.x === dest x)', () => {
        // Final cubic ends `C <ax> <ay>, <x1> <cy>, <x1> <y1>` — cp2 sharing the
        // destination x gives a vertical tangent, so the arrowhead points into
        // the branch rather than gliding in horizontally.
        expect(/, 300 -?[\d.]+, 300 240$/.test(mergePath(400, 300, 300, 240))).toBe(true);
        // Forward/backward both end with a vertical-tangent control point.
        expect(/, 700 -?[\d.]+, 700 120$/.test(mergePath(500, 300, 700, 120))).toBe(true);
    });

    it('mergePath clamps the lane so a downward merge does not overshoot the dest', () => {
        // dest 40px below source → drop clamped to 40*0.6=24, lane at y=324 < 340.
        const d = mergePath(0, 300, 120, 340);
        const m = d.match(/L (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/);
        expect(parseFloat(m[2])).toBeLessThan(340);
    });
});

describe('mergeEngine — empty + hidden branches', () => {
    it('an empty branch (no builds) is never a merge source', () => {
        const model = makeModel({
            mainBuilds: 3,
            branchSpecs: [
                { id: 'dev-empty', type: 'development', parentBuildId: 'main-b1', parentBranchId: 'main', nBuilds: 0 },
            ],
        });
        const layout = layoutOf(model);
        const merges = computeMerges({ model, layout });
        expect(merges.some(m => m.source === 'dev-empty')).toBe(false);
    });

    it('a hidden leaf branch (absent from layout) drops its merges only', () => {
        const model = fixture();
        // hotfix-1 is a leaf — hiding it doesn't orphan any child.
        const layout = layoutOf(model, { hiddenBranchIds: new Set(['hotfix-1']) });
        const merges = computeMerges({ model, layout });
        expect(merges.some(m => m.source === 'hotfix-1' || m.dest === 'hotfix-1')).toBe(false);
        // Unrelated merges survive.
        expect(has(merges, MERGE_REQUIRED, 'release-1', 'main')).toBe(true);
        expect(has(merges, MERGE_EVALUATE, 'csr-1', 'release-1')).toBe(true);
    });

    it('hiding a parent branch orphans its child — both drop out of merges', () => {
        const model = fixture();
        // Hiding release-1 leaves csr-1 (its child) unpositionable, so neither
        // can be a merge endpoint, and csr evaluate→release targets vanish.
        const layout = layoutOf(model, { hiddenBranchIds: new Set(['release-1']) });
        const merges = computeMerges({ model, layout });
        expect(merges.some(m => m.source === 'release-1' || m.dest === 'release-1')).toBe(false);
        expect(merges.some(m => m.source === 'csr-1' || m.dest === 'csr-1')).toBe(false);
    });
});

describe('mergeEngine — day-zero fan-out', () => {
    const model = fixture();
    const layout = layoutOf(model);
    const merges = computeMerges({
        model, layout, dayZeroBuildIds: new Set(['main-b2']),
    });
    const dz = merges.filter(m => m.kind === MERGE_DAYZERO);

    it('fans to every release / hotfix / csr branch', () => {
        expect(has(merges, MERGE_DAYZERO, 'main-b2', 'release-1')).toBe(true);
        expect(has(merges, MERGE_DAYZERO, 'main-b2', 'hotfix-1')).toBe(true);
        expect(has(merges, MERGE_DAYZERO, 'main-b2', 'csr-1')).toBe(true);
        expect(has(merges, MERGE_DAYZERO, 'main-b2', 'csr-2')).toBe(true);
    });

    it('does NOT target dev, bootleg, sample, or main branches', () => {
        const dests = new Set(dz.map(m => m.dest));
        expect(dests.has('dev-1')).toBe(false);
        expect(dests.has('bootleg-1')).toBe(false);
        expect(dests.has('sample-1')).toBe(false);
        expect(dests.has('main')).toBe(false);
    });

    it('originates at the declared build position', () => {
        const m = find(merges, MERGE_DAYZERO, 'main-b2', 'hotfix-1');
        const b = layout.builds.find(x => x.id === 'main-b2');
        expect(m.sourceX).toBe(b.x);
        expect(m.sourceY).toBe(b.y);
    });

    it('produces nothing for an unknown / hidden day-zero build', () => {
        const merges2 = computeMerges({
            model, layout, dayZeroBuildIds: new Set(['does-not-exist']),
        });
        expect(merges2.some(m => m.kind === MERGE_DAYZERO)).toBe(false);
    });
});

describe('mergeEngine — guards', () => {
    it('returns [] for an empty / missing model', () => {
        expect(computeMerges({})).toEqual([]);
        expect(computeMerges({ model: { branches: [] }, layout: { branches: [] } })).toEqual([]);
    });
});
