import { describe, it, expect } from 'vitest';
import { computeLayout, STRATA_ORDER, DEFAULT_OPTS } from '../d3LayoutEngine';

// ---------------------------------------------------------------------------
// Helpers — build minimal models that exercise layout without noise.
// ---------------------------------------------------------------------------

/** Build a simple model with a main branch + arbitrary sub-branches. */
function makeModel({ mainBuilds = 5, subBranches = [], releaseEvents = {}, releaseEventDetails = {} } = {}) {
    const builds = {};
    const mainBuildIds = [];
    for (let i = 0; i < mainBuilds; i++) {
        const id = `m${i + 1}`;
        mainBuildIds.push(id);
        builds[id] = {
            id,
            branchId: 'main',
            position: i,
            build: i + 1,
            branchNum: 0,
            major: 1,
            minor: 0,
        };
    }

    const branches = [
        {
            id: 'main',
            type: 'main',
            name: 'Main',
            parentBuildId: null,
            parentBranchId: null,
            buildIds: mainBuildIds,
        },
    ];

    for (const sub of subBranches) {
        const subBuildIds = [];
        for (let i = 0; i < (sub.buildCount ?? 1); i++) {
            const bid = `${sub.id}-b${i + 1}`;
            subBuildIds.push(bid);
            builds[bid] = {
                id: bid,
                branchId: sub.id,
                position: i,
                build: i + 1,
                branchNum: 1,
                major: 1,
                minor: 0,
            };
        }
        branches.push({
            id: sub.id,
            type: sub.type,
            name: sub.name || sub.id,
            parentBuildId: sub.parentBuildId || 'm1',
            parentBranchId: sub.parentBranchId || 'main',
            buildIds: subBuildIds,
        });
    }

    return { branches, builds, releaseEvents, releaseEventDetails };
}

// ---------------------------------------------------------------------------
// 1. STRATA ORDER — exported constant
// ---------------------------------------------------------------------------
describe('STRATA_ORDER', () => {
    it('has 7 strata in the documented order', () => {
        const ids = STRATA_ORDER.map(s => s.id);
        expect(ids).toEqual([
            'bootleg', 'hotfix', 'csr', 'release', 'sample', 'main', 'dev',
        ]);
    });

    it('all above-main strata precede main in the array', () => {
        const ids = STRATA_ORDER.map(s => s.id);
        const mainIdx = ids.indexOf('main');
        const aboveIds = ['bootleg', 'hotfix', 'csr', 'release', 'sample'];
        for (const id of aboveIds) {
            expect(ids.indexOf(id)).toBeLessThan(mainIdx);
        }
    });

    it('dev stratum follows main', () => {
        const ids = STRATA_ORDER.map(s => s.id);
        expect(ids.indexOf('dev')).toBeGreaterThan(ids.indexOf('main'));
    });
});

// ---------------------------------------------------------------------------
// 2. STRATA Y ORDERING — bootleg above hotfix above csr above release above
//    sample above main. Asserting branch Y ordering for one branch per type.
// ---------------------------------------------------------------------------
describe('strata Y ordering — computeLayout', () => {
    it('bootleg Y < hotfix Y < csr Y < release Y < sample Y < main Y < dev Y', () => {
        const model = makeModel({
            mainBuilds: 5,
            subBranches: [
                { id: 'bl1',  type: 'bootleg',        parentBuildId: 'm1', buildCount: 1 },
                { id: 'hf1',  type: 'hotfix',         parentBuildId: 'm1', buildCount: 1 },
                { id: 'cs1',  type: 'csr',            parentBuildId: 'm1', buildCount: 1 },
                { id: 'rel1', type: 'release',        parentBuildId: 'm1', buildCount: 1 },
                { id: 'sr1',  type: 'sample-release', parentBuildId: 'm1', buildCount: 1 },
                { id: 'dev1', type: 'development',    parentBuildId: 'm1', buildCount: 1 },
            ],
        });

        const layout = computeLayout(model);
        const yByType = new Map();
        for (const b of layout.branches) {
            yByType.set(b.type, b.y);
        }

        // In SVG, smaller Y = higher on canvas. Above-main types have Y < mainY.
        const mainY = yByType.get('main');
        expect(yByType.get('bootleg')).toBeLessThan(yByType.get('hotfix'));
        expect(yByType.get('hotfix')).toBeLessThan(yByType.get('csr'));
        expect(yByType.get('csr')).toBeLessThan(yByType.get('release'));
        expect(yByType.get('release')).toBeLessThan(yByType.get('sample-release'));
        expect(yByType.get('sample-release')).toBeLessThan(mainY);
        expect(mainY).toBeLessThan(yByType.get('development'));
    });

    it('bootleg is the TOPMOST stratum (smallest Y of all non-main branches)', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'bl1',  type: 'bootleg',        parentBuildId: 'm1', buildCount: 1 },
                { id: 'hf1',  type: 'hotfix',         parentBuildId: 'm1', buildCount: 1 },
                { id: 'rel1', type: 'release',        parentBuildId: 'm1', buildCount: 1 },
            ],
        });

        const layout = computeLayout(model);
        const ys = layout.branches.filter(b => !b.isMain).map(b => b.y);
        const bootlegY = layout.branches.find(b => b.type === 'bootleg').y;
        expect(bootlegY).toBe(Math.min(...ys));
    });

    it('multiple branches of the same type use interval-scheduled lanes', () => {
        // Two overlapping hotfix branches should land on different lanes
        const model = makeModel({
            mainBuilds: 5,
            subBranches: [
                { id: 'hf1', type: 'hotfix', parentBuildId: 'm1', buildCount: 3 },
                { id: 'hf2', type: 'hotfix', parentBuildId: 'm2', buildCount: 3 },
            ],
        });

        const layout = computeLayout(model);
        const hf1 = layout.branches.find(b => b.id === 'hf1');
        const hf2 = layout.branches.find(b => b.id === 'hf2');
        // They overlap horizontally, so they must be on different lanes → different Y
        expect(hf1.y).not.toBe(hf2.y);
        // Both should still be above main
        expect(hf1.y).toBeLessThan(layout.mainY);
        expect(hf2.y).toBeLessThan(layout.mainY);
    });
});

// ---------------------------------------------------------------------------
// 3. CANVAS WIDTH FIX (req #2741) — width spans rightmost VISIBLE build,
//    not just main's last build. A sub-branch off a late main build must
//    extend the canvas width.
// ---------------------------------------------------------------------------
describe('canvas width — rightmost visible build', () => {
    it('a dev branch off main last build with many builds extends width past main tail', () => {
        // Main has 3 builds. Dev branch off m3 has 6 builds → extends well past main.
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'dev1', type: 'development', parentBuildId: 'm3', buildCount: 6 },
            ],
        });

        const layout = computeLayout(model);

        // Also compute what the width WOULD be if only main builds were considered:
        // (old formula: leftPad + (mainBuilds - 1) * colW + arrowTail + rightPad + 160)
        const o = DEFAULT_OPTS;
        const mainOnlyMaxX = o.leftPad + (3 - 1) * o.colW;
        const mainOnlyWidth = mainOnlyMaxX + o.colW * o.arrowExtColumns + o.rightPad + 160;

        // The actual layout width MUST exceed the main-only width because the dev
        // branch extends beyond main's last build.
        expect(layout.width).toBeGreaterThan(mainOnlyWidth);
    });

    it('when no sub-branches exist, width is based on main builds', () => {
        const model = makeModel({ mainBuilds: 5 });
        const layout = computeLayout(model);

        const o = DEFAULT_OPTS;
        const maxBuildX = o.leftPad + (5 - 1) * o.colW;
        const expectedWidth = maxBuildX + o.colW * o.arrowExtColumns + o.rightPad + 160;
        expect(layout.width).toBe(expectedWidth);
    });

    it('hidden branches do not affect width', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'dev1', type: 'development', parentBuildId: 'm3', buildCount: 10 },
            ],
        });

        const layoutWithDev = computeLayout(model);
        const layoutHidden = computeLayout(model, { hiddenBranchIds: new Set(['dev1']) });

        // With dev hidden, width should be narrower (based on main only)
        expect(layoutHidden.width).toBeLessThan(layoutWithDev.width);
    });

    it('sub-branch off an early main build does NOT widen canvas past main tail', () => {
        // Dev branch off m1 with 2 builds — can't extend past main's m5
        const model = makeModel({
            mainBuilds: 5,
            subBranches: [
                { id: 'dev1', type: 'development', parentBuildId: 'm1', buildCount: 2 },
            ],
        });

        const layoutWithSub = computeLayout(model);
        const layoutNoSub = computeLayout(makeModel({ mainBuilds: 5 }));

        // Width should be the same (both determined by main's last build)
        expect(layoutWithSub.width).toBe(layoutNoSub.width);
    });
});

// ---------------------------------------------------------------------------
// 4. LABEL Y — top-track raise for branches with release events (req #2741).
//    A branch with a release event gets labelY = y - 34; without → y - 16.
// ---------------------------------------------------------------------------
describe('labelY — top-track raise for release events', () => {
    it('branch WITH release events → labelY = y - 34', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'rel1', type: 'release', parentBuildId: 'm1', buildCount: 2 },
            ],
            releaseEvents: { 'rel1-b1': ['Acme Corp'] },
        });

        const layout = computeLayout(model);
        const rel = layout.branches.find(b => b.id === 'rel1');
        expect(rel.labelY).toBe(rel.y - 34);
    });

    it('branch WITHOUT release events → labelY = y - 16', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'rel1', type: 'release', parentBuildId: 'm1', buildCount: 2 },
            ],
            // No releaseEvents at all
        });

        const layout = computeLayout(model);
        const rel = layout.branches.find(b => b.id === 'rel1');
        expect(rel.labelY).toBe(rel.y - 16);
    });

    it('main branch has null labelY (endpoint labels used instead)', () => {
        const model = makeModel({ mainBuilds: 3 });
        const layout = computeLayout(model);
        const mainBranch = layout.branches.find(b => b.isMain);
        expect(mainBranch.labelY).toBeNull();
    });

    it('branch with release on SOME builds still gets the raise', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'rel1', type: 'release', parentBuildId: 'm1', buildCount: 3 },
            ],
            releaseEvents: { 'rel1-b2': ['Customer A'] }, // only build 2 has a release
        });

        const layout = computeLayout(model);
        const rel = layout.branches.find(b => b.id === 'rel1');
        expect(rel.labelY).toBe(rel.y - 34);
    });
});

// ---------------------------------------------------------------------------
// 4b. RELEASE CLEARANCE (req #2772) — a release-bearing row reserves extra
//     vertical room ABOVE it so its star row + raised label don't collide with
//     the version labels of the row directly above. Applied only to the gap
//     above the release-bearing row; release-free layouts are unchanged.
// ---------------------------------------------------------------------------
describe('release clearance — extra room above a release-bearing row', () => {
    // Two CSR branches off the SAME parent build overlap horizontally, so they
    // land on different lanes of the CSR stratum (lane 0 = inner/lower, lane 1
    // = outer/upper). cs1 is first in model order → lane 0 (nearest main).
    const twoCsr = (releaseEvents = {}) => computeLayout(makeModel({
        mainBuilds: 4,
        subBranches: [
            { id: 'cs1', type: 'csr', parentBuildId: 'm1', buildCount: 3 },
            { id: 'cs2', type: 'csr', parentBuildId: 'm1', buildCount: 3 },
        ],
        releaseEvents,
    }));
    const gapBetween = (layout) => {
        const cs1 = layout.branches.find(b => b.id === 'cs1');
        const cs2 = layout.branches.find(b => b.id === 'cs2');
        return Math.abs(cs1.y - cs2.y);
    };

    it('release-free: adjacent same-stratum lanes are exactly laneGap apart', () => {
        expect(gapBetween(twoCsr())).toBe(DEFAULT_OPTS.laneGap);
    });

    it('release on the INNER lane widens the gap above it by releaseClearance', () => {
        // cs1 (lane 0, lower) bears the release → clearance is inserted between
        // it and cs2 (the lane directly above).
        const gap = gapBetween(twoCsr({ 'cs1-b1': ['Acme'] }));
        expect(gap).toBe(DEFAULT_OPTS.laneGap + DEFAULT_OPTS.releaseClearance);
    });

    it('release on the OUTER lane does NOT widen the inter-lane gap', () => {
        // cs2 (lane 1, upper) bears the release → clearance goes above cs2
        // (toward the stratum/canvas above), not between the two CSR lanes.
        const gap = gapBetween(twoCsr({ 'cs2-b1': ['Acme'] }));
        expect(gap).toBe(DEFAULT_OPTS.laneGap);
    });

    it('release-free absolute Y matches the documented formula (no upward shift)', () => {
        // One 1-lane above stratum (bootleg) + main. The prior engine placed the
        // topmost lane at canvasPadTop + laneGap and main a sideGap below the
        // band — locking this guards against the rows-walk shifting everything up.
        const { canvasPadTop, laneGap, sideGap } = DEFAULT_OPTS;
        const layout = computeLayout(makeModel({
            mainBuilds: 3,
            subBranches: [{ id: 'bl1', type: 'bootleg', parentBuildId: 'm1', buildCount: 1 }],
        }));
        const bootleg = layout.branches.find(b => b.id === 'bl1');
        expect(bootleg.y).toBe(canvasPadTop + laneGap);          // 40 + 70 = 110
        expect(layout.mainY).toBe(canvasPadTop + laneGap + sideGap); // 110 + 70 = 180
    });

    it('a release on a dev branch pushes it further below main', () => {
        const plain = computeLayout(makeModel({
            mainBuilds: 3,
            subBranches: [{ id: 'dev1', type: 'development', parentBuildId: 'm1', buildCount: 2 }],
        }));
        const withRel = computeLayout(makeModel({
            mainBuilds: 3,
            subBranches: [{ id: 'dev1', type: 'development', parentBuildId: 'm1', buildCount: 2 }],
            releaseEvents: { 'dev1-b1': ['Acme'] },
        }));
        const devPlain = plain.branches.find(b => b.id === 'dev1');
        const devRel = withRel.branches.find(b => b.id === 'dev1');
        // main stays put; the dev lane drops by releaseClearance to clear main's
        // version labels with its star row.
        expect(devRel.y - devPlain.y).toBe(DEFAULT_OPTS.releaseClearance);
    });
});

// ---------------------------------------------------------------------------
// 5. BUILD RECORDS — branchType and releaseDetails carried through
// ---------------------------------------------------------------------------
describe('build records — branchType and releaseDetails', () => {
    it('each build record carries its branch type', () => {
        const model = makeModel({
            mainBuilds: 2,
            subBranches: [
                { id: 'hf1', type: 'hotfix', parentBuildId: 'm1', buildCount: 1 },
            ],
        });

        const layout = computeLayout(model);
        const mainBuild = layout.builds.find(b => b.branchType === 'main');
        expect(mainBuild).toBeTruthy();
        expect(mainBuild.branchType).toBe('main');

        const hfBuild = layout.builds.find(b => b.branchType === 'hotfix');
        expect(hfBuild).toBeTruthy();
        expect(hfBuild.branchType).toBe('hotfix');
    });

    it('build records include releaseDetails from the model', () => {
        const details = [{ name: 'Acme', date: '2026-01-15' }];
        const model = makeModel({
            mainBuilds: 2,
            subBranches: [
                { id: 'rel1', type: 'release', parentBuildId: 'm1', buildCount: 1 },
            ],
            releaseEvents: { 'rel1-b1': ['Acme'] },
            releaseEventDetails: { 'rel1-b1': details },
        });

        const layout = computeLayout(model);
        const relBuild = layout.builds.find(b => b.id === 'rel1-b1');
        expect(relBuild.releaseCustomers).toEqual(['Acme']);
        expect(relBuild.releaseDetails).toEqual(details);
    });

    it('builds without release events have empty arrays', () => {
        const model = makeModel({ mainBuilds: 2 });
        const layout = computeLayout(model);
        for (const build of layout.builds) {
            expect(build.releaseCustomers).toEqual([]);
            expect(build.releaseDetails).toEqual([]);
        }
    });
});

// ---------------------------------------------------------------------------
// 6. EMPTY MODEL — edge case
// ---------------------------------------------------------------------------
describe('empty model', () => {
    it('returns sensible defaults for an empty model', () => {
        const layout = computeLayout({ branches: [], builds: {}, releaseEvents: {} });
        expect(layout.branches).toEqual([]);
        expect(layout.builds).toEqual([]);
        expect(layout.connectors).toEqual([]);
        expect(layout.mainPath).toBeNull();
        expect(layout.width).toBe(800);
        expect(layout.height).toBe(200);
    });

    it('handles null model gracefully', () => {
        const layout = computeLayout(null);
        expect(layout.branches).toEqual([]);
        expect(layout.width).toBe(800);
    });
});

// ---------------------------------------------------------------------------
// 7. CONNECTOR RECORDS
// ---------------------------------------------------------------------------
describe('connectors', () => {
    it('produces one connector per visible non-main branch', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'hf1', type: 'hotfix', parentBuildId: 'm1', buildCount: 1 },
                { id: 'dev1', type: 'development', parentBuildId: 'm2', buildCount: 1 },
            ],
        });

        const layout = computeLayout(model);
        expect(layout.connectors).toHaveLength(2);
        const ids = layout.connectors.map(c => c.branchId).sort();
        expect(ids).toEqual(['dev1', 'hf1']);
    });

    it('hidden branches do not produce connectors', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'hf1', type: 'hotfix', parentBuildId: 'm1', buildCount: 1 },
            ],
        });

        const layout = computeLayout(model, { hiddenBranchIds: new Set(['hf1']) });
        expect(layout.connectors).toHaveLength(0);
    });

    it('connector has separate curveD and lineD paths', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'hf1', type: 'hotfix', parentBuildId: 'm1', buildCount: 1 },
            ],
        });

        const layout = computeLayout(model);
        const conn = layout.connectors[0];
        expect(conn.curveD).toMatch(/^M .* C .*/);
        expect(conn.lineD).toMatch(/^M .* L .*/);
    });
});

// ---------------------------------------------------------------------------
// 8. STRATUM BANDS
// ---------------------------------------------------------------------------
describe('stratum bands', () => {
    it('only non-empty strata produce bands', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'hf1', type: 'hotfix', parentBuildId: 'm1', buildCount: 1 },
            ],
        });

        const layout = computeLayout(model);
        // Only hotfix stratum has branches; main has no band
        expect(layout.strata).toHaveLength(1);
        expect(layout.strata[0].id).toBe('hotfix');
    });

    it('each band has yTop < yBottom and reports the correct lane count', () => {
        const model = makeModel({
            mainBuilds: 5,
            subBranches: [
                { id: 'hf1', type: 'hotfix', parentBuildId: 'm1', buildCount: 3 },
                { id: 'hf2', type: 'hotfix', parentBuildId: 'm2', buildCount: 3 },
            ],
        });

        const layout = computeLayout(model);
        const hfBand = layout.strata.find(s => s.id === 'hotfix');
        expect(hfBand).toBeTruthy();
        expect(hfBand.yTop).toBeLessThan(hfBand.yBottom);
        expect(hfBand.laneCount).toBe(2); // two overlapping branches
    });
});

// ---------------------------------------------------------------------------
// 9. MAIN PATH
// ---------------------------------------------------------------------------
describe('main path', () => {
    it('is generated when main has builds', () => {
        const model = makeModel({ mainBuilds: 3 });
        const layout = computeLayout(model);
        expect(layout.mainPath).not.toBeNull();
        expect(layout.mainPath.d).toMatch(/^M .* L .*/);
        expect(layout.mainPath.hasArrow).toBe(true);
    });

    it('is null when main has no builds', () => {
        const model = {
            branches: [{ id: 'main', type: 'main', name: 'Main', buildIds: [] }],
            builds: {},
            releaseEvents: {},
        };
        const layout = computeLayout(model);
        expect(layout.mainPath).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 10. EMPTY BRANCHES — emptyAnchors, label, connector (req #2742)
// ---------------------------------------------------------------------------
describe('empty branches', () => {
    it('a branch with zero builds emits an emptyAnchors entry at parentX + colW', () => {
        const model = makeModel({
            mainBuilds: 5,
            subBranches: [
                { id: 'dev-empty', type: 'development', parentBuildId: 'm3', buildCount: 0, name: 'Empty Dev' },
            ],
        });

        const layout = computeLayout(model);
        expect(layout.emptyAnchors).toHaveLength(1);
        const anchor = layout.emptyAnchors[0];
        expect(anchor.branchId).toBe('dev-empty');
        // x should be at parentX + colW (first-build slot)
        const parentBuildRecord = layout.builds.find(b => b.id === 'm3');
        expect(anchor.x).toBe(parentBuildRecord.x + DEFAULT_OPTS.colW);
        // y should match the branch's assigned Y
        const branchRecord = layout.branches.find(b => b.id === 'dev-empty');
        expect(anchor.y).toBe(branchRecord.y);
    });

    it('a named empty branch gets a non-null labelX', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'dev-empty', type: 'development', parentBuildId: 'm2', buildCount: 0, name: 'Empty Dev' },
            ],
        });

        const layout = computeLayout(model);
        const branchRecord = layout.branches.find(b => b.id === 'dev-empty');
        expect(branchRecord.labelX).not.toBeNull();
        expect(branchRecord.labelY).not.toBeNull();
    });

    it('an empty branch connector has hasArrow: true and lineD reaching the first-build slot', () => {
        const model = makeModel({
            mainBuilds: 5,
            subBranches: [
                { id: 'hf-empty', type: 'hotfix', parentBuildId: 'm2', buildCount: 0, name: 'Empty HF' },
            ],
        });

        const layout = computeLayout(model);
        const conn = layout.connectors.find(c => c.branchId === 'hf-empty');
        expect(conn).toBeTruthy();
        expect(conn.hasArrow).toBe(true);
        // lineD should contain a segment extending past the parent X
        expect(conn.lineD).toMatch(/^M .* L .*/);
    });

    it('a branch keeps its tail arrow even when a child sprouts off its last build (req #2603)', () => {
        // release has 2 builds; a sample-release branches off the release's LAST
        // build. The release must still show its follow-on arrow — more builds
        // can always be added to it.
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'rel', type: 'release', parentBuildId: 'm2', parentBranchId: 'main', buildCount: 2 },
                { id: 'samp', type: 'sample-release', parentBuildId: 'rel-b2', parentBranchId: 'rel', buildCount: 1 },
            ],
        });
        const layout = computeLayout(model);
        const relConn = layout.connectors.find(c => c.branchId === 'rel');
        expect(relConn).toBeTruthy();
        expect(relConn.hasArrow).toBe(true);
    });

    it('every branch (main + subs) uses the SAME follow-on tail length (req #2603)', () => {
        const model = makeModel({
            mainBuilds: 4,
            subBranches: [
                { id: 'rel', type: 'release', parentBuildId: 'm2', parentBranchId: 'main', buildCount: 2 },
                { id: 'dev1', type: 'development', parentBuildId: 'm3', parentBranchId: 'main', buildCount: 3 },
            ],
        });
        const layout = computeLayout(model);
        const tailEndX = (d) => parseFloat(d.match(/L (-?\d+(?:\.\d+)?) /)[1]);
        const lastBuildX = (id) => Math.max(...layout.builds.filter(b => b.branchId === id).map(b => b.x));
        const mainTail = tailEndX(layout.mainPath.d) - lastBuildX('main');
        const relTail = tailEndX(layout.connectors.find(c => c.branchId === 'rel').lineD) - lastBuildX('rel');
        const devTail = tailEndX(layout.connectors.find(c => c.branchId === 'dev1').lineD) - lastBuildX('dev1');
        expect(relTail).toBeCloseTo(mainTail, 5);
        expect(devTail).toBeCloseTo(mainTail, 5);
        expect(mainTail).toBeCloseTo(DEFAULT_OPTS.colW * DEFAULT_OPTS.arrowExtColumns, 5);
    });

    it('a branch with builds does NOT emit an emptyAnchors entry', () => {
        const model = makeModel({
            mainBuilds: 3,
            subBranches: [
                { id: 'dev1', type: 'development', parentBuildId: 'm1', buildCount: 2 },
            ],
        });

        const layout = computeLayout(model);
        expect(layout.emptyAnchors).toHaveLength(0);
    });

    it('empty anchor x is included in canvas width calculation', () => {
        // Main has 2 builds. Empty branch off m2 → anchor at m2.x + colW.
        // That anchor extends past main's last build and should widen the canvas.
        const model = makeModel({
            mainBuilds: 2,
            subBranches: [
                { id: 'dev-empty', type: 'development', parentBuildId: 'm2', buildCount: 0, name: 'Empty' },
            ],
        });

        const layoutWithEmpty = computeLayout(model);
        const layoutNoEmpty = computeLayout(makeModel({ mainBuilds: 2 }));

        // The empty anchor extends past main's tail, so width should be >=
        expect(layoutWithEmpty.width).toBeGreaterThanOrEqual(layoutNoEmpty.width);
    });
});

// ---------------------------------------------------------------------------
// 11. MAIN ENDPOINT LABELS
// ---------------------------------------------------------------------------
describe('main endpoint labels', () => {
    it('includes left label using the main branch name', () => {
        const model = makeModel({ mainBuilds: 3 });
        model.branches[0].name = 'Trunk';
        const layout = computeLayout(model);
        expect(layout.mainEndpointLabels.leftText).toBe('Trunk');
    });

    it('includes right label when main has labelEnd', () => {
        const model = makeModel({ mainBuilds: 3 });
        model.branches[0].labelEnd = 'HEAD';
        const layout = computeLayout(model);
        expect(layout.mainEndpointLabels.rightText).toBe('HEAD');
    });

    it('rightText is null when no labelEnd', () => {
        const model = makeModel({ mainBuilds: 3 });
        const layout = computeLayout(model);
        expect(layout.mainEndpointLabels.rightText).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 7. COLLAPSE TOKENS — semantic-zoom sentinels in buildIds (req #2864).
//    A `__gap__:…` id consumes one column like a real build but emits a
//    collapseTokens entry instead of a build record. Absent any sentinel the
//    output is byte-identical to the pre-#2864 engine.
// ---------------------------------------------------------------------------
describe('collapse tokens — __gap__ sentinels', () => {
    it('emits an empty collapseTokens array and unchanged geometry with no sentinels', () => {
        const model = makeModel({ mainBuilds: 6 });
        const layout = computeLayout(model);
        expect(layout.collapseTokens).toEqual([]);
        expect(layout.builds.length).toBe(6);
    });

    it('treats a sentinel as a positioned token, not a build dot, and compacts', () => {
        // main = m1, __gap__, m4, m5 → 4 columns; the gap sits at column index 1.
        const model = makeModel({ mainBuilds: 5 });
        const main = model.branches.find(b => b.type === 'main');
        const gap = '__gap__:main:m2:m3';
        main.buildIds = ['m1', gap, 'm4', 'm5'];

        const layout = computeLayout(model);
        // m2/m3 are no longer in buildIds → not rendered as dots.
        const ids = layout.builds.map(b => b.id).sort();
        expect(ids).toEqual(['m1', 'm4', 'm5']);
        // exactly one collapse token, positioned in the gap column.
        expect(layout.collapseTokens.length).toBe(1);
        const tok = layout.collapseTokens[0];
        expect(tok.id).toBe(gap);
        expect(tok.branchId).toBe('main');
        const m1 = layout.builds.find(b => b.id === 'm1');
        const m4 = layout.builds.find(b => b.id === 'm4');
        // gap x sits strictly between m1 and m4 (one column each).
        expect(tok.x).toBeGreaterThan(m1.x);
        expect(tok.x).toBeLessThan(m4.x);
        expect(tok.y).toBe(layout.mainY);
    });
});
