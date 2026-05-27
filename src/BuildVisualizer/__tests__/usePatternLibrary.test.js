import { describe, it, expect } from 'vitest';
import {
    STORAGE_KEY,
    emptyLibrary,
    isValidLibrary,
    makePattern,
    seedLibraryFrom,
    ensureBuiltinsInLibrary,
    bootstrapLibrary,
    DEFAULT_PATTERN_NAME,
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

describe('ensureBuiltinsInLibrary', () => {
    const FAKE_BUILTINS = [
        { id: 'builtin:test-a', name: 'Test A', generate: () => ({ ...sampleBuildsJson, _gen: 'a' }) },
        { id: 'builtin:test-b', name: 'Test B', generate: () => ({ ...sampleBuildsJson, _gen: 'b' }) },
    ];

    it('adds every missing built-in to an empty library', () => {
        const { library, changed } = ensureBuiltinsInLibrary(emptyLibrary(), FAKE_BUILTINS);
        expect(changed).toBe(true);
        expect(library.patterns['builtin:test-a']).toBeDefined();
        expect(library.patterns['builtin:test-b']).toBeDefined();
        expect(library.activeId).toBe('builtin:test-a');
    });

    it('is idempotent — running twice does not duplicate or rewrite', () => {
        const first = ensureBuiltinsInLibrary(emptyLibrary(), FAKE_BUILTINS).library;
        const firstA = first.patterns['builtin:test-a'];
        const second = ensureBuiltinsInLibrary(first, FAKE_BUILTINS);
        expect(second.changed).toBe(false);
        expect(second.library.patterns['builtin:test-a']).toBe(firstA);
        expect(Object.keys(second.library.patterns)).toHaveLength(2);
    });

    it('preserves an existing built-in entry verbatim — never overwrites user customizations', () => {
        const lib = emptyLibrary();
        const customized = makePattern({
            id: 'builtin:test-a',
            name: 'Test A',
            data: { ...sampleBuildsJson, _gen: 'USER-EDITED' },
        });
        lib.patterns[customized.id] = customized;
        lib.activeId = customized.id;
        const { library, changed } = ensureBuiltinsInLibrary(lib, FAKE_BUILTINS);
        // The user's edited Test A is untouched; Test B is added.
        expect(library.patterns['builtin:test-a'].data._gen).toBe('USER-EDITED');
        expect(library.patterns['builtin:test-b']).toBeDefined();
        expect(changed).toBe(true); // Test B was added
    });

    it('preserves a user-saved (non-builtin) pattern alongside built-ins', () => {
        const lib = emptyLibrary();
        const userPattern = makePattern({ name: 'My Pattern', data: sampleBuildsJson });
        lib.patterns[userPattern.id] = userPattern;
        lib.activeId = userPattern.id;
        const { library } = ensureBuiltinsInLibrary(lib, FAKE_BUILTINS);
        expect(library.patterns[userPattern.id]).toBe(userPattern);
        expect(library.activeId).toBe(userPattern.id); // active preserved
        expect(library.patterns['builtin:test-a']).toBeDefined();
        expect(library.patterns['builtin:test-b']).toBeDefined();
    });

    it('falls back to the first built-in id when activeId points at a deleted pattern', () => {
        const lib = { version: 1, activeId: 'dangling-id', patterns: {} };
        const { library, changed } = ensureBuiltinsInLibrary(lib, FAKE_BUILTINS);
        expect(library.activeId).toBe('builtin:test-a');
        expect(changed).toBe(true);
    });
});

describe('bootstrapLibrary', () => {
    it('includes built-ins AND the Topology Default when the seed is provided', () => {
        const lib = bootstrapLibrary(sampleBuildsJson);
        const names = Object.values(lib.patterns).map(p => p.name).sort();
        expect(names).toContain(DEFAULT_PATTERN_NAME);
        expect(names).toContain('Sprint Cycle');
        expect(lib.patterns['builtin:sprint-cycle']).toBeDefined();
    });

    it('still seeds built-ins when the Topology seed is null', () => {
        const lib = bootstrapLibrary(null);
        expect(lib.patterns['builtin:sprint-cycle']).toBeDefined();
        expect(Object.values(lib.patterns).some(p => p.name === DEFAULT_PATTERN_NAME)).toBe(false);
        expect(lib.activeId).toBe('builtin:sprint-cycle');
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

describe('makeEmptyBuildDoc (req #2614)', () => {
    it('produces a fresh doc with one main branch and one stamped first build', () => {
        const d = makeEmptyBuildDoc({ major: 5, minor: 2, initialBuildNumber: 1 });
        expect(d.version).toBe(1);
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
            currentMajor: 5,
            currentMinor: 2,
            buildCounter: 1,
        });
        expect(d.builds.m1).toMatchObject({
            id: 'm1', number: 1, branchId: 'main', dotColor: null,
            major: 5, minor: 2, build: 1, branchNum: 0,
        });
    });

    it('stamps the initial build with initialBuildNumber so the team anchors at e.g. 5.2.42.0', () => {
        const d = makeEmptyBuildDoc({ major: 5, minor: 2, initialBuildNumber: 42 });
        expect(d.branches[0].buildCounter).toBe(42);
        expect(d.builds.m1).toMatchObject({ major: 5, minor: 2, build: 42, branchNum: 0 });
    });

    it('defaults when called with no args', () => {
        const d = makeEmptyBuildDoc();
        expect(d.branches[0]).toMatchObject({ currentMajor: 1, currentMinor: 0, buildCounter: 1 });
        expect(d.builds.m1).toMatchObject({ major: 1, minor: 0, build: 1, branchNum: 0 });
    });

    it('clamps negative major/minor and non-positive initialBuildNumber to safe defaults', () => {
        const d = makeEmptyBuildDoc({ major: -2, minor: -1, initialBuildNumber: 0 });
        expect(d.branches[0]).toMatchObject({ currentMajor: 1, currentMinor: 0, buildCounter: 1 });
    });

    it('floors non-integer numeric inputs', () => {
        const d = makeEmptyBuildDoc({ major: 5.7, minor: 2.4, initialBuildNumber: 42.9 });
        expect(d.branches[0]).toMatchObject({ currentMajor: 5, currentMinor: 2, buildCounter: 42 });
    });

    it('does NOT emit legacy trunkSegments / root currentMajor / initialBuildNumber', () => {
        const d = makeEmptyBuildDoc({ major: 5, minor: 2, initialBuildNumber: 42 });
        expect(d).not.toHaveProperty('trunkSegments');
        expect(d).not.toHaveProperty('currentMajor');
        expect(d).not.toHaveProperty('currentMinor');
        expect(d).not.toHaveProperty('initialBuildNumber');
    });
});

describe('addEmptyPattern (req #2614)', () => {
    it('adds a fresh pattern, switches active to it, preserves others', () => {
        const lib = seedLibraryFrom(sampleBuildsJson, 'Default');
        const originalId = lib.activeId;
        const next = addEmptyPattern(lib, 'Project X', { major: 2, minor: 1, initialBuildNumber: 10 });
        expect(Object.keys(next.patterns)).toHaveLength(2);
        expect(next.activeId).not.toBe(originalId);
        expect(next.patterns[next.activeId].name).toBe('Project X');
        const data = next.patterns[next.activeId].data;
        expect(data.branches[0]).toMatchObject({ currentMajor: 2, currentMinor: 1, buildCounter: 10 });
        expect(data.builds.m1).toMatchObject({ major: 2, minor: 1, build: 10, branchNum: 0 });
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
