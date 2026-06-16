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
        expect(isGapId(branchGapId('s1'))).toBe(true);
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
    it('keeps ONLY the branch-origin build (no ±1 window) plus a tip run (req #2881)', () => {
        // samples at m2 and m6 (latest). Keep m2 (s1 origin), m6 (s2 origin) and
        // the tip m6→m7. Everything else collapses — no neighbours of m2 survive.
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm2' },
            { id: 's2', type: 'sample-release', parentBuildId: 'm6' },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        const out = mainOf(r.model);
        // Origin builds + tip only.
        expect(out).toContain('m2');         // s1 origin
        expect(out).toContain('m6');         // s2 origin
        expect(out).toContain('m7');         // tip
        // ±1 neighbours of the (non-tip) branch origin now collapse.
        expect(out).not.toContain('m0');
        expect(out).not.toContain('m1');     // was kept by old ±1 window
        expect(out).not.toContain('m3');     // was kept by old ±1 window
        expect(out).not.toContain('m4');
        expect(out).not.toContain('m5');
        const gaps = out.filter(isGapId);
        expect(gaps.length).toBe(2);         // [m0,m1] run + [m3,m4,m5] run
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

    it('hides a dev branch whose branch point falls inside a collapsed span', () => {
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm1' },
            { id: 's2', type: 'sample-release', parentBuildId: 'm7' },
            { id: 'dev1', type: 'development', parentBuildId: 'm4' },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        expect(r.hiddenBranchIds.has('dev1')).toBe(true);
        // the collapsed token records the reveal-on-expand branch
        const tok = [...r.tokenMeta.values()].find(t => t.revealBranchIds.includes('dev1'));
        expect(tok).toBeTruthy();
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
        // Only the first and last build survive — the second-to-last (s1-b4) collapses too.
        expect(out).toEqual(['s1-b0', branchGapId('s1'), 's1-b5']);
        expect(r.tokenMeta.get(branchGapId('s1')).hiddenBuildIds).toEqual(['s1-b1', 's1-b2', 's1-b3', 's1-b4']);
    });

    it('leaves a branch with <= 3 builds untouched', () => {
        const model = makeModel({ mainBuilds: 4, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm2', buildCount: 3 },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        expect(branchOf(r.model, 's1').some(isGapId)).toBe(false);
    });

    it('does not branch-collapse hotfix/dev branches', () => {
        const model = makeModel({ mainBuilds: 4, subBranches: [
            { id: 'h1', type: 'hotfix', parentBuildId: 'm2', buildCount: 6 },
        ] });
        const r = computeSemanticModel(model, { level: 2 });
        expect(branchOf(r.model, 'h1').some(isGapId)).toBe(false);
    });
});

describe('expanded tokens', () => {
    it('reveals a collapsed branch run when its token is expanded', () => {
        const model = makeModel({ mainBuilds: 4, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm2', buildCount: 6 },
        ] });
        const tok = branchGapId('s1');
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
