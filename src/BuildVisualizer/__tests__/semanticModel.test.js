import { describe, it, expect } from 'vitest';
import {
    computeSemanticModel, isGapId, mainGapId, branchGapId,
} from '../semanticModel';

// ---------------------------------------------------------------------------
// Model builder — a main trunk + arbitrary sub-branches anchored to main
// builds, with optional release events to mark "delivered" branches.
// ---------------------------------------------------------------------------
function makeModel({ mainBuilds = 8, subBranches = [], releaseEvents = {} } = {}) {
    const builds = {};
    const mainBuildIds = [];
    for (let i = 0; i < mainBuilds; i++) {
        const id = `m${i}`;
        mainBuildIds.push(id);
        builds[id] = { id, branchId: 'main', position: i };
    }
    const branches = [{
        id: 'main', type: 'main', name: 'Main',
        parentBuildId: null, parentBranchId: null, buildIds: mainBuildIds,
    }];
    for (const sub of subBranches) {
        const ids = [];
        for (let i = 0; i < (sub.buildCount ?? 1); i++) {
            const bid = `${sub.id}-b${i}`;
            ids.push(bid);
            builds[bid] = { id: bid, branchId: sub.id, position: i };
        }
        branches.push({
            id: sub.id, type: sub.type, name: sub.name || sub.id,
            parentBuildId: sub.parentBuildId ?? 'm0',
            parentBranchId: sub.parentBranchId ?? 'main',
            buildIds: ids,
        });
    }
    return { branches, builds, releaseEvents, releaseEventDetails: {} };
}

const mainOf = (m) => m.branches.find(b => b.type === 'main').buildIds;
const branchOf = (m, id) => m.branches.find(b => b.id === id).buildIds;

describe('isGapId', () => {
    it('recognizes sentinel ids and rejects real build ids', () => {
        expect(isGapId(mainGapId('m1', 'm3'))).toBe(true);
        expect(isGapId(branchGapId('s1', 's1-b1', 's1-b4'))).toBe(true);
        expect(isGapId('m1')).toBe(false);
        expect(isGapId(null)).toBe(false);
        expect(isGapId(42)).toBe(false);
    });
});

describe('L3 — full detail', () => {
    it('returns the model unchanged with no tokens', () => {
        const model = makeModel({ mainBuilds: 10, subBranches: [
            { id: 'dev1', type: 'development' },
            { id: 's1', type: 'sample-release', parentBuildId: 'm3' },
        ] });
        const r = computeSemanticModel(model, { level: 3 });
        expect(r.model).toBe(model);                 // identity reference
        expect(r.tokenMeta.size).toBe(0);
        expect(r.hiddenBranchIds.size).toBe(0);
    });
});

describe('L1 — visibility', () => {
    it('hides all development branches', () => {
        const model = makeModel({ subBranches: [
            { id: 'dev1', type: 'development', parentBuildId: 'm1' },
            { id: 's1', type: 'sample-release', parentBuildId: 'm4' },
        ] });
        const r = computeSemanticModel(model, { level: 1 });
        expect(r.hiddenBranchIds.has('dev1')).toBe(true);
    });

    it('hides a not-latest, undelivered sample branch but keeps the latest', () => {
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 'sOld', type: 'sample-release', parentBuildId: 'm2' },
            { id: 'sNew', type: 'sample-release', parentBuildId: 'm6' },
        ] });
        const r = computeSemanticModel(model, { level: 1 });
        expect(r.hiddenBranchIds.has('sOld')).toBe(true);
        expect(r.hiddenBranchIds.has('sNew')).toBe(false);  // latest stays
    });

    it('keeps a not-latest sample branch when it is customer-delivered', () => {
        const model = makeModel({
            mainBuilds: 8,
            subBranches: [
                { id: 'sOld', type: 'sample-release', parentBuildId: 'm2', buildCount: 2 },
                { id: 'sNew', type: 'sample-release', parentBuildId: 'm6' },
            ],
            releaseEvents: { 'sOld-b1': ['AcmeCorp'] },     // delivered
        });
        const r = computeSemanticModel(model, { level: 1 });
        expect(r.hiddenBranchIds.has('sOld')).toBe(false);
    });
});

describe('L2 — main-trunk collapse around sample branch points', () => {
    it('keeps branch-origin builds + first + last main build (req #2881, #2892)', () => {
        // samples at m2 and m6. Keep m2 (s1 origin), m6 (s2 origin), m0 (first),
        // m7 (last). Everything else collapses — there is no "tip run" any more.
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm2' },
            { id: 's2', type: 'sample-release', parentBuildId: 'm6' },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        const out = mainOf(r.model);
        expect(out).toContain('m0');         // first main build always shown (req #2892)
        expect(out).toContain('m2');         // s1 origin
        expect(out).toContain('m6');         // s2 origin
        expect(out).toContain('m7');         // tip / last main build
        expect(out).not.toContain('m1');     // collapses between m0 and m2
        expect(out).not.toContain('m3');
        expect(out).not.toContain('m4');
        expect(out).not.toContain('m5');
        const gaps = out.filter(isGapId);
        expect(gaps.length).toBe(2);         // [m1] run + [m3,m4,m5] run
        // token meta records the hidden builds of the between-origins run.
        const between = r.tokenMeta.get(mainGapId('m3', 'm5'));
        expect(between.hiddenBuildIds).toEqual(['m3', 'm4', 'm5']);
    });

    it('does not collapse main when there are no sample branches', () => {
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 'h1', type: 'hotfix', parentBuildId: 'm3' },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        expect(mainOf(r.model).some(isGapId)).toBe(false);
    });

    it('protects the parent build of a shown non-dev branch from collapse', () => {
        // hotfix at m4 (between the two sample windows) must keep m4 visible.
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm1' },
            { id: 's2', type: 'sample-release', parentBuildId: 'm7' },
            { id: 'h1', type: 'hotfix', parentBuildId: 'm4' },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        expect(mainOf(r.model)).toContain('m4');
        expect(r.hiddenBranchIds.has('h1')).toBe(false);
    });

    it('keeps a dev branch point visible at L2 — branch points always show (req #2892)', () => {
        // req #2892: at L2 EVERY shown branch point survives collapse, including
        // development. So m4 (dev1 origin) stays, dev1 is not hidden, and no token
        // needs to reveal it.
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm1' },
            { id: 's2', type: 'sample-release', parentBuildId: 'm7' },
            { id: 'dev1', type: 'development', parentBuildId: 'm4' },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        expect(mainOf(r.model)).toContain('m4');
        expect(r.hiddenBranchIds.has('dev1')).toBe(false);
        const anyReveals = [...r.tokenMeta.values()].some(t => t.revealBranchIds.includes('dev1'));
        expect(anyReveals).toBe(false);
    });

    it('does NOT mark an L1-hidden dev branch as revealable on main-gap expand', () => {
        // At L1 all dev branches are unconditionally hidden BEFORE main collapse,
        // so expanding a collapsed main span must not resurrect them.
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm1' },
            { id: 's2', type: 'sample-release', parentBuildId: 'm7' },
            { id: 'dev1', type: 'development', parentBuildId: 'm4' },
        ] });
        const r = computeSemanticModel(model, { level: 1 });
        expect(r.hiddenBranchIds.has('dev1')).toBe(true);
        const anyReveals = [...r.tokenMeta.values()].some(t => t.revealBranchIds.includes('dev1'));
        expect(anyReveals).toBe(false);   // stays hidden even when the gap is expanded
    });
});

describe('per-branch build collapse (sample + release, >3 builds)', () => {
    it('collapses a long sample branch to first + gap + last (req #2881)', () => {
        const model = makeModel({ mainBuilds: 4, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm2', buildCount: 6 },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        const out = branchOf(r.model, 's1');
        const tok = branchGapId('s1', 's1-b1', 's1-b4');
        // Only the first and last build survive — the second-to-last (s1-b4) collapses too.
        expect(out).toEqual(['s1-b0', tok, 's1-b5']);
        expect(r.tokenMeta.get(tok).hiddenBuildIds).toEqual(['s1-b1', 's1-b2', 's1-b3', 's1-b4']);
    });

    it('leaves a branch with <= 3 builds untouched', () => {
        const model = makeModel({ mainBuilds: 4, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm2', buildCount: 3 },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        expect(branchOf(r.model, 's1').some(isGapId)).toBe(false);
    });

    it('branch-collapses dev and hotfix branches like any other branch (req #2892)', () => {
        const model = makeModel({ mainBuilds: 4, subBranches: [
            { id: 'h1', type: 'hotfix', parentBuildId: 'm2', buildCount: 6 },
            { id: 'dev1', type: 'development', parentBuildId: 'm1', buildCount: 6 },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        // Both collapse to first · … · last.
        expect(branchOf(r.model, 'h1')).toEqual(['h1-b0', branchGapId('h1', 'h1-b1', 'h1-b4'), 'h1-b5']);
        expect(branchOf(r.model, 'dev1')).toEqual(['dev1-b0', branchGapId('dev1', 'dev1-b1', 'dev1-b4'), 'dev1-b5']);
    });
});

describe('req #2892 — always-show milestones', () => {
    it('L2 keeps the first main build, the last main build, and released main builds', () => {
        const model = makeModel({
            mainBuilds: 8,
            subBranches: [
                { id: 's1', type: 'sample-release', parentBuildId: 'm1' },
                { id: 's2', type: 'sample-release', parentBuildId: 'm6' },
            ],
            releaseEvents: { m3: ['AcmeCorp'] },        // a released build on main
        });
        const r = computeSemanticModel(model, { level: 2 });
        const out = mainOf(r.model);
        expect(out).toContain('m0');                    // first main build
        expect(out).toContain('m7');                    // last main build
        expect(out).toContain('m3');                    // released build stays
    });

    it('L1 keeps the first + last main build ("where we came from" + the tip)', () => {
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm2' },
            { id: 's2', type: 'sample-release', parentBuildId: 'm6' },
        ] });
        const r = computeSemanticModel(model, { level: 1 });
        const out = mainOf(r.model);
        expect(out).toContain('m0');                    // survives even at L1
        expect(out).toContain('m7');                    // tip survives
        expect(out.some(isGapId)).toBe(true);           // rest still collapses
    });

    it('L2 main collapses between the latest sample and a later Release (no tip run)', () => {
        // samples at m1 (idx1) + m3 (idx3, latest); release branches at m7 (idx7).
        // The old tip rule force-kept idx3→end; now idx4,5,6 collapse.
        const model = makeModel({ mainBuilds: 10, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm1' },
            { id: 's2', type: 'sample-release', parentBuildId: 'm3' },
            { id: 'rel', type: 'release', parentBuildId: 'm7' },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        const out = mainOf(r.model);
        expect(out).toContain('m3');                    // latest sample point
        expect(out).toContain('m7');                    // release branch point
        expect(out).not.toContain('m4');                // the span now collapses
        expect(out).not.toContain('m5');
        expect(out).not.toContain('m6');
        expect(r.tokenMeta.get(mainGapId('m4', 'm6')).hiddenBuildIds).toEqual(['m4', 'm5', 'm6']);
    });

    it('L2 keeps a released build on a long sample branch, splitting it into runs', () => {
        const model = makeModel({
            mainBuilds: 4,
            subBranches: [
                { id: 's1', type: 'sample-release', parentBuildId: 'm2', buildCount: 6 },
            ],
            releaseEvents: { 's1-b3': ['AcmeCorp'] },   // delivered mid-branch
        });
        const r = computeSemanticModel(model, { level: 2 });
        const out = branchOf(r.model, 's1');
        expect(out[0]).toBe('s1-b0');                   // first
        expect(out[out.length - 1]).toBe('s1-b5');      // last
        expect(out).toContain('s1-b3');                 // released build stays
        expect(out.filter(isGapId).length).toBe(2);     // [b1,b2] run + [b4] run
    });

    it('L1 does NOT keep a released mid-branch build (L1 is its own thing)', () => {
        const model = makeModel({
            mainBuilds: 4,
            subBranches: [
                // latest + delivered sample so it stays shown at L1
                { id: 's1', type: 'sample-release', parentBuildId: 'm2', buildCount: 6 },
            ],
            releaseEvents: { 's1-b3': ['AcmeCorp'] },
        });
        const r = computeSemanticModel(model, { level: 1 });
        const out = branchOf(r.model, 's1');
        expect(out).toEqual(['s1-b0', branchGapId('s1', 's1-b1', 's1-b4'), 's1-b5']);
    });
});

describe('expanded tokens', () => {
    it('reveals a collapsed branch run when its token is expanded', () => {
        const model = makeModel({ mainBuilds: 4, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm2', buildCount: 6 },
        ] });
        const tok = branchGapId('s1', 's1-b1', 's1-b4');
        const r = computeSemanticModel(model, { level: 2, expandedTokens: new Set([tok]) });
        expect(branchOf(r.model, 's1')).toEqual(['s1-b0', 's1-b1', 's1-b2', 's1-b3', 's1-b4', 's1-b5']);
        expect(r.tokenMeta.has(tok)).toBe(false);
    });
});

describe('base hidden branch ids union', () => {
    it('unions toolbar-hidden branches into the result', () => {
        const model = makeModel({ subBranches: [{ id: 'h1', type: 'hotfix', parentBuildId: 'm1' }] });
        const r = computeSemanticModel(model, { level: 2, baseHiddenBranchIds: new Set(['h1']) });
        expect(r.hiddenBranchIds.has('h1')).toBe(true);
    });
});

describe('autoLevel — zoom-ratio level selection', () => {
    it('selects L1 below the out threshold, L2 mid, L3 above the in threshold', async () => {
        const { autoLevel } = await import('../semanticModel');
        expect(autoLevel(0.3)).toBe(1);
        expect(autoLevel(0.61)).toBe(1);
        expect(autoLevel(0.62)).toBe(2);
        expect(autoLevel(1)).toBe(2);       // framed view → default detail
        expect(autoLevel(1.39)).toBe(2);
        expect(autoLevel(1.4)).toBe(3);
        expect(autoLevel(5)).toBe(3);
        expect(autoLevel(NaN)).toBe(1);     // degenerate → most compact
    });
});
