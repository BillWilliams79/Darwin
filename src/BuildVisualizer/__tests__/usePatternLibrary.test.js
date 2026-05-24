import { describe, it, expect } from 'vitest';
import {
    STORAGE_KEY,
    emptyLibrary,
    isValidLibrary,
    makePattern,
    seedLibraryFrom,
    listPatternsSorted,
    setActive,
    updateActiveData,
    addPatternFromActive,
    renamePattern,
    removePattern,
    libraryToJson,
    importLibrary,
    loadLibraryFromStorage,
    saveLibraryToStorage,
    makeEmptyBuildDoc,
    addEmptyPattern,
} from '../usePatternLibrary';

function fakeStorage() {
    const store = new Map();
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => { store.clear(); },
        get _store() { return store; },
    };
}

const sampleBuildsJson = {
    version: 1,
    nextBuildNumber: 3,
    nextBranchNumber: 2,
    branches: [
        { id: 'main', type: 'main', name: 'Main', parentBranchId: null, parentBuildId: null, side: 'center', buildIds: ['m1', 'm2'] },
    ],
    builds: {
        m1: { id: 'm1', number: 1, branchId: 'main', name: null, dotColor: null },
        m2: { id: 'm2', number: 2, branchId: 'main', name: null, dotColor: null },
    },
};

describe('isValidLibrary', () => {
    it('accepts an empty patterns library at version 1', () => {
        expect(isValidLibrary({ version: 1, activeId: null, patterns: {} })).toBe(true);
    });
    it('rejects null / non-object inputs', () => {
        expect(isValidLibrary(null)).toBe(false);
        expect(isValidLibrary('string')).toBe(false);
    });
    it('rejects mismatched version', () => {
        expect(isValidLibrary({ version: 2, patterns: {} })).toBe(false);
    });
    it('rejects pattern missing id / name / data', () => {
        expect(isValidLibrary({ version: 1, patterns: { p1: { id: 'p1', name: 'x' } } })).toBe(false);
        expect(isValidLibrary({ version: 1, patterns: { p1: { id: 'p1', name: 'x', data: null } } })).toBe(false);
    });
});

describe('seedLibraryFrom + load/save round-trip', () => {
    it('seeds with one pattern that becomes active', () => {
        const lib = seedLibraryFrom(sampleBuildsJson, 'Default');
        const ids = Object.keys(lib.patterns);
        expect(ids).toHaveLength(1);
        expect(lib.activeId).toBe(ids[0]);
        expect(lib.patterns[ids[0]].name).toBe('Default');
        expect(lib.patterns[ids[0]].data).toBe(sampleBuildsJson);
    });

    it('saves to storage and loads back as the same object', () => {
        const storage = fakeStorage();
        const lib = seedLibraryFrom(sampleBuildsJson);
        const writeResult = saveLibraryToStorage(lib, storage);
        expect(writeResult.ok).toBe(true);
        expect(storage.getItem(STORAGE_KEY)).toBeTruthy();
        const loaded = loadLibraryFromStorage(storage);
        expect(loaded).toEqual(lib);
    });

    it('returns null when storage is empty', () => {
        const storage = fakeStorage();
        expect(loadLibraryFromStorage(storage)).toBeNull();
    });

    it('returns null when storage contains corrupt JSON', () => {
        const storage = fakeStorage();
        storage.setItem(STORAGE_KEY, '{not valid json');
        expect(loadLibraryFromStorage(storage)).toBeNull();
    });

    it('returns null when stored shape is invalid', () => {
        const storage = fakeStorage();
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, patterns: {} }));
        expect(loadLibraryFromStorage(storage)).toBeNull();
    });
});

describe('setActive', () => {
    it('updates activeId when the pattern exists', () => {
        const lib = seedLibraryFrom(sampleBuildsJson);
        const next = addPatternFromActive(lib, 'Second');
        const secondId = next.activeId;
        const switched = setActive(next, Object.keys(next.patterns).find(id => id !== secondId));
        expect(switched.activeId).not.toBe(secondId);
    });
    it('is a no-op when the id is unknown', () => {
        const lib = seedLibraryFrom(sampleBuildsJson);
        expect(setActive(lib, 'does-not-exist')).toBe(lib);
    });
});

describe('updateActiveData', () => {
    it('overwrites the active pattern data and bumps updatedAt', async () => {
        const lib = seedLibraryFrom(sampleBuildsJson);
        await new Promise(r => setTimeout(r, 5)); // ensure timestamp differs
        const newData = { ...sampleBuildsJson, nextBuildNumber: 999 };
        const next = updateActiveData(lib, newData);
        expect(next.patterns[next.activeId].data).toBe(newData);
        expect(next.patterns[next.activeId].updatedAt)
            .not.toBe(lib.patterns[lib.activeId].updatedAt);
    });
});

describe('addPatternFromActive', () => {
    it('creates a new pattern with a unique id and switches active to it', () => {
        const lib = seedLibraryFrom(sampleBuildsJson);
        const next = addPatternFromActive(lib, 'Release 1');
        const ids = Object.keys(next.patterns);
        expect(ids).toHaveLength(2);
        expect(next.activeId).not.toBe(lib.activeId);
        expect(next.patterns[next.activeId].name).toBe('Release 1');
        expect(next.patterns[next.activeId].data).toBe(lib.patterns[lib.activeId].data);
    });
});

describe('renamePattern', () => {
    it('only changes the targeted pattern', () => {
        const lib = seedLibraryFrom(sampleBuildsJson);
        const next = renamePattern(lib, lib.activeId, 'Renamed');
        expect(next.patterns[lib.activeId].name).toBe('Renamed');
    });
    it('is a no-op when id is unknown', () => {
        const lib = seedLibraryFrom(sampleBuildsJson);
        expect(renamePattern(lib, 'nope', 'X')).toBe(lib);
    });
});

describe('removePattern', () => {
    it('refuses when there is only one pattern', () => {
        const lib = seedLibraryFrom(sampleBuildsJson);
        const result = removePattern(lib, lib.activeId);
        expect(result.error).toMatch(/last pattern/i);
        expect(result.library).toBe(lib);
    });
    it('drops the targeted pattern and reassigns activeId when active is removed', () => {
        let lib = seedLibraryFrom(sampleBuildsJson);
        lib = addPatternFromActive(lib, 'Second');
        const removeId = lib.activeId;
        const { library: next, error } = removePattern(lib, removeId);
        expect(error).toBeUndefined();
        expect(Object.keys(next.patterns)).toHaveLength(1);
        expect(next.activeId).not.toBe(removeId);
    });
    it('preserves activeId when a non-active pattern is removed', () => {
        let lib = seedLibraryFrom(sampleBuildsJson);
        lib = addPatternFromActive(lib, 'Second');
        const stillActive = lib.activeId;
        const otherId = Object.keys(lib.patterns).find(id => id !== stillActive);
        const { library: next, error } = removePattern(lib, otherId);
        expect(error).toBeUndefined();
        expect(next.activeId).toBe(stillActive);
    });
    it('returns an error when the id is unknown', () => {
        const lib = seedLibraryFrom(sampleBuildsJson);
        const result = removePattern(lib, 'does-not-exist');
        expect(result.error).toMatch(/not found/);
    });
});

describe('listPatternsSorted', () => {
    it('sorts by updatedAt desc, then name asc for stable ordering', () => {
        const a = makePattern({ name: 'A', data: {}, updatedAt: '2026-05-23T10:00:00Z' });
        const b = makePattern({ name: 'B', data: {}, updatedAt: '2026-05-23T11:00:00Z' });
        const c = makePattern({ name: 'C', data: {}, updatedAt: '2026-05-23T10:00:00Z' });
        const lib = { version: 1, activeId: a.id, patterns: { [a.id]: a, [b.id]: b, [c.id]: c } };
        const sorted = listPatternsSorted(lib);
        expect(sorted.map(p => p.name)).toEqual(['B', 'A', 'C']);
    });
});

describe('makeEmptyBuildDoc (req #2597)', () => {
    it('produces a fresh doc with one main branch and one first build', () => {
        const d = makeEmptyBuildDoc({ major: 5, minor: 2, initialBuildNumber: 1 });
        expect(d.version).toBe(1);
        expect(d.currentMajor).toBe(5);
        expect(d.currentMinor).toBe(2);
        expect(d.initialBuildNumber).toBe(1);
        expect(d.nextBuildNumber).toBe(2);
        expect(d.nextBranchNumber).toBe(2);
        expect(d.branches).toHaveLength(1);
        expect(d.branches[0]).toMatchObject({
            id: 'main',
            type: 'main',
            name: 'Main',
            parentBranchId: null,
            parentBuildId: null,
            side: 'center',
            buildIds: ['m1'],
        });
        expect(d.builds.m1).toMatchObject({ id: 'm1', number: 1, branchId: 'main', dotColor: null });
    });

    it('seeds trunkSegments with one entry mirroring the dialog inputs', () => {
        const d = makeEmptyBuildDoc({ major: 2, minor: 10, initialBuildNumber: 345 });
        expect(d.trunkSegments).toEqual([
            { startIdx: 0, major: 2, minor: 10, initialBuildNumber: 345 },
        ]);
    });

    it('defaults when called with no args', () => {
        const d = makeEmptyBuildDoc();
        expect(d.currentMajor).toBe(1);
        expect(d.currentMinor).toBe(0);
        expect(d.initialBuildNumber).toBe(1);
    });

    it('clamps negative major/minor and non-positive initialBuildNumber to safe defaults', () => {
        const d = makeEmptyBuildDoc({ major: -2, minor: -1, initialBuildNumber: 0 });
        expect(d.currentMajor).toBe(1);
        expect(d.currentMinor).toBe(0);
        expect(d.initialBuildNumber).toBe(1);
    });

    it('floors non-integer numeric inputs', () => {
        const d = makeEmptyBuildDoc({ major: 5.7, minor: 2.4, initialBuildNumber: 42.9 });
        expect(d.currentMajor).toBe(5);
        expect(d.currentMinor).toBe(2);
        expect(d.initialBuildNumber).toBe(42);
    });

    it('round-trips the initialBuildNumber so the iframe BuildModel reads it back', () => {
        const d = makeEmptyBuildDoc({ major: 5, minor: 2, initialBuildNumber: 42 });
        const json = JSON.stringify(d);
        const parsed = JSON.parse(json);
        expect(parsed.initialBuildNumber).toBe(42);
    });
});

describe('addEmptyPattern (req #2597)', () => {
    it('adds a fresh pattern, switches active to it, preserves others', () => {
        const lib = seedLibraryFrom(sampleBuildsJson, 'Default');
        const originalId = lib.activeId;
        const next = addEmptyPattern(lib, 'Project X', { major: 2, minor: 1, initialBuildNumber: 10 });
        expect(Object.keys(next.patterns)).toHaveLength(2);
        expect(next.activeId).not.toBe(originalId);
        expect(next.patterns[next.activeId].name).toBe('Project X');
        expect(next.patterns[next.activeId].data.currentMajor).toBe(2);
        expect(next.patterns[next.activeId].data.currentMinor).toBe(1);
        expect(next.patterns[next.activeId].data.initialBuildNumber).toBe(10);
        // Old pattern still present unchanged
        expect(next.patterns[originalId]).toBe(lib.patterns[originalId]);
    });
});

describe('exportAll / importLibrary round-trip', () => {
    it('round-trips a multi-pattern library byte-identically when no collisions', () => {
        let lib = seedLibraryFrom(sampleBuildsJson);
        lib = addPatternFromActive(lib, 'Release 1');
        lib = addPatternFromActive(lib, 'Release 2');
        const exported = libraryToJson(lib);
        const empty = emptyLibrary();
        const { library: imported, error } = importLibrary(empty, exported);
        expect(error).toBeUndefined();
        expect(Object.keys(imported.patterns)).toHaveLength(3);
        expect(imported.patterns).toEqual(lib.patterns);
    });

    it('renames on name collision under default rename mode', () => {
        let lib = seedLibraryFrom(sampleBuildsJson, 'Default');
        // Build an incoming library that ALSO has a "Default" pattern but with a different id
        const incoming = seedLibraryFrom({ ...sampleBuildsJson, nextBuildNumber: 50 }, 'Default');
        const incomingJson = libraryToJson(incoming);
        const { library: merged, error } = importLibrary(lib, incomingJson);
        expect(error).toBeUndefined();
        const names = Object.values(merged.patterns).map(p => p.name).sort();
        expect(names).toEqual(['Default', 'Default (imported)']);
    });

    it('overwrites on id collision under overwrite mode', () => {
        const lib = seedLibraryFrom(sampleBuildsJson, 'Default');
        const originalActive = lib.patterns[lib.activeId];
        // Create incoming with SAME id but different data
        const incoming = {
            version: 1,
            activeId: originalActive.id,
            patterns: {
                [originalActive.id]: {
                    ...originalActive,
                    name: 'Overwritten',
                    data: { ...sampleBuildsJson, nextBuildNumber: 777 },
                },
            },
        };
        const { library: merged } = importLibrary(lib, JSON.stringify(incoming), { onCollision: 'overwrite' });
        expect(Object.keys(merged.patterns)).toHaveLength(1);
        expect(merged.patterns[originalActive.id].name).toBe('Overwritten');
        expect(merged.patterns[originalActive.id].data.nextBuildNumber).toBe(777);
    });

    it('returns error on malformed JSON', () => {
        const lib = seedLibraryFrom(sampleBuildsJson);
        const { library: same, error } = importLibrary(lib, '{not json');
        expect(error).toMatch(/Invalid JSON/);
        expect(same).toBe(lib);
    });

    it('returns error on invalid shape', () => {
        const lib = seedLibraryFrom(sampleBuildsJson);
        const { error } = importLibrary(lib, JSON.stringify({ version: 99 }));
        expect(error).toMatch(/Invalid library shape/);
    });
});
