import { describe, it, expect } from 'vitest';
import { computeTypeVisibility } from '../typeVisibility';
import { BRANCH_TYPES } from '../branchTypeChipStyles';

// Reuse the same model builder shape as semanticModel.test.js: a main trunk plus
// sub-branches anchored to main builds, with optional release events.
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

const allTypes = () => [...BRANCH_TYPES];

describe('computeTypeVisibility — off / none', () => {
    it('marks a deselected type as "off"', () => {
        const model = makeModel({ subBranches: [{ id: 'dev1', type: 'development' }] });
        const sel = allTypes().filter(t => t !== 'development');
        const r = computeTypeVisibility({ model, level: 3, selectedTypes: sel });
        expect(r.development).toBe('off');
    });

    it('marks a selected type with no branches present as "none"', () => {
        const model = makeModel({ subBranches: [{ id: 'r1', type: 'release' }] });
        const r = computeTypeVisibility({ model, level: 3, selectedTypes: allTypes() });
        // No hotfix/bootleg/csr/development/sample-release branches exist.
        expect(r.hotfix).toBe('none');
        expect(r.development).toBe('none');
        expect(r.release).toBe('shown');
    });
});

describe('computeTypeVisibility — L3 full detail', () => {
    it('marks every present, selected type as "shown"', () => {
        const model = makeModel({ subBranches: [
            { id: 'dev1', type: 'development', parentBuildId: 'm1' },
            { id: 's1', type: 'sample-release', parentBuildId: 'm4' },
            { id: 'r1', type: 'release', parentBuildId: 'm2' },
        ] });
        const r = computeTypeVisibility({ model, level: 3, selectedTypes: allTypes() });
        expect(r.development).toBe('shown');
        expect(r['sample-release']).toBe('shown');
        expect(r.release).toBe('shown');
    });
});

describe('computeTypeVisibility — L1 hides types', () => {
    it('marks development as "hidden" (all dev branches hidden at L1)', () => {
        const model = makeModel({ subBranches: [
            { id: 'dev1', type: 'development', parentBuildId: 'm1' },
            { id: 'dev2', type: 'development', parentBuildId: 'm3' },
            { id: 's1', type: 'sample-release', parentBuildId: 'm4' },
        ] });
        const r = computeTypeVisibility({ model, level: 1, selectedTypes: allTypes() });
        expect(r.development).toBe('hidden');
    });

    it('marks sample-release "partial" when the level hides some but not all', () => {
        // sOld is a completed, not-latest, undelivered sample → hidden at L1.
        // sNew is the latest sample → stays shown. Mixed → partial.
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 'sOld', type: 'sample-release', parentBuildId: 'm2' },
            { id: 'sNew', type: 'sample-release', parentBuildId: 'm6' },
        ] });
        const r = computeTypeVisibility({ model, level: 1, selectedTypes: allTypes() });
        expect(r['sample-release']).toBe('partial');
    });

    it('marks sample-release "shown" when the only sample is the latest', () => {
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 'sNew', type: 'sample-release', parentBuildId: 'm6' },
        ] });
        const r = computeTypeVisibility({ model, level: 1, selectedTypes: allTypes() });
        expect(r['sample-release']).toBe('shown');
    });

    it('keeps a delivered non-latest sample "shown" (delivered stays at L1)', () => {
        const model = makeModel({
            mainBuilds: 8,
            subBranches: [
                { id: 'sOld', type: 'sample-release', parentBuildId: 'm2', buildCount: 2 },
                { id: 'sNew', type: 'sample-release', parentBuildId: 'm6' },
            ],
            releaseEvents: { 'sOld-b1': ['AcmeCorp'] },
        });
        const r = computeTypeVisibility({ model, level: 1, selectedTypes: allTypes() });
        expect(r['sample-release']).toBe('shown');
    });

    it('leaves release "shown" at L1 (release type not hidden by the level)', () => {
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 'r1', type: 'release', parentBuildId: 'm2' },
            { id: 'sNew', type: 'sample-release', parentBuildId: 'm6' },
        ] });
        const r = computeTypeVisibility({ model, level: 1, selectedTypes: allTypes() });
        expect(r.release).toBe('shown');
    });
});

describe('computeTypeVisibility — L2 main-trunk collapse', () => {
    it('reports development "shown" at L2 — branch points always show (req #2892)', () => {
        // req #2892: at L2 EVERY shown branch point survives collapse, including
        // development, so a dev branch parented inside what used to be a collapsed
        // main run stays visible (its branch-point build is protected). The stoplight
        // therefore reads "shown" for development at L2, matching the canvas.
        const model = makeModel({ mainBuilds: 8, subBranches: [
            { id: 's1', type: 'sample-release', parentBuildId: 'm2' },
            { id: 's2', type: 'sample-release', parentBuildId: 'm6' },
            { id: 'dev1', type: 'development', parentBuildId: 'm4' },
        ] });
        const r = computeTypeVisibility({ model, level: 2, selectedTypes: allTypes() });
        expect(r.development).toBe('shown');
        // Samples anchor the trunk and stay shown at L2.
        expect(r['sample-release']).toBe('shown');
    });
});

describe('computeTypeVisibility — edge cases', () => {
    it('returns off/none only for an empty model', () => {
        const r = computeTypeVisibility({ model: { branches: [] }, level: 1, selectedTypes: allTypes() });
        for (const t of BRANCH_TYPES) expect(r[t]).toBe('none');
    });

    it('defaults to all selected + L3 when args omitted', () => {
        const model = makeModel({ subBranches: [{ id: 'dev1', type: 'development' }] });
        const r = computeTypeVisibility({ model });
        expect(r.development).toBe('shown');
    });
});
