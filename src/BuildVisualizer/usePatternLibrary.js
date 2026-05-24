import { useCallback, useEffect, useState } from 'react';
import { BUILTIN_PATTERNS } from './builtinPatterns';

export const STORAGE_KEY = 'darwin.buildPatterns.v1';
export const SEED_URL = '/build-visualizer/builds.json';
export const DEFAULT_PATTERN_NAME = 'Default';

export function makeId() {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `pat-${Date.now()}-${rand}`;
}

export function nowIso() { return new Date().toISOString(); }

export function makePattern({ id, name, data, createdAt, updatedAt }) {
    const ts = nowIso();
    return {
        id: id || makeId(),
        name,
        createdAt: createdAt || ts,
        updatedAt: updatedAt || ts,
        data,
    };
}

export function emptyLibrary() {
    return { version: 1, activeId: null, patterns: {} };
}

export function isValidLibrary(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.version !== 1) return false;
    if (!obj.patterns || typeof obj.patterns !== 'object') return false;
    for (const id of Object.keys(obj.patterns)) {
        const p = obj.patterns[id];
        if (!p || typeof p !== 'object') return false;
        if (typeof p.id !== 'string' || typeof p.name !== 'string') return false;
        if (typeof p.data !== 'object' || p.data === null) return false;
    }
    return true;
}

export function loadLibraryFromStorage(storage = globalThis.localStorage) {
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!isValidLibrary(parsed)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function saveLibraryToStorage(library, storage = globalThis.localStorage) {
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(library));
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err?.message || 'storage write failed' };
    }
}

export function seedLibraryFrom(data, name = 'Default') {
    const pattern = makePattern({ name, data });
    return { version: 1, activeId: pattern.id, patterns: { [pattern.id]: pattern } };
}

// Merge every entry in `builtins` into `library` by stable id, additively.
//
// - A built-in NOT yet in the library is added (the user sees a new dropdown
//   entry on next load — no localStorage manipulation required).
// - A built-in ALREADY in the library is left untouched (the user may have
//   customized it in place; we never overwrite). To ship updated content for
//   an existing built-in, bump its id in `BUILTIN_PATTERNS` so the new content
//   appears as a new entry.
// - `activeId` is preserved when valid; if missing/dangling it falls back to
//   the first built-in's id.
//
// Returns `{ library, changed }`. Callers persist when `changed` is true.
export function ensureBuiltinsInLibrary(library, builtins = BUILTIN_PATTERNS) {
    const patterns = { ...library.patterns };
    let changed = false;
    for (const builtin of builtins) {
        if (patterns[builtin.id]) continue;
        patterns[builtin.id] = makePattern({
            id: builtin.id,
            name: builtin.name,
            data: builtin.generate(),
        });
        changed = true;
    }
    let activeId = library.activeId;
    if (!activeId || !patterns[activeId]) {
        activeId = builtins[0]?.id || Object.keys(patterns)[0] || null;
        if (activeId !== library.activeId) changed = true;
    }
    return { library: { ...library, activeId, patterns }, changed };
}

// Build the first-ever library for a brand-new user. Merges in every built-in
// and, when the Topology builds.json seed fetch succeeded, attaches it as a
// separate non-builtin "Default" pattern so the exemplar stays one click away.
// Active id is the first built-in.
export function bootstrapLibrary(topologySeed, builtins = BUILTIN_PATTERNS) {
    const base = emptyLibrary();
    if (topologySeed) {
        const topologyPattern = makePattern({ name: DEFAULT_PATTERN_NAME, data: topologySeed });
        base.patterns[topologyPattern.id] = topologyPattern;
    }
    const { library } = ensureBuiltinsInLibrary(base, builtins);
    return library;
}

export function listPatternsSorted(library) {
    return Object.values(library.patterns).sort((a, b) => {
        if (a.updatedAt === b.updatedAt) return a.name.localeCompare(b.name);
        return a.updatedAt < b.updatedAt ? 1 : -1;
    });
}

export function setActive(library, id) {
    if (!library.patterns[id]) return library;
    return { ...library, activeId: id };
}

export function updateActiveData(library, data) {
    const id = library.activeId;
    if (!id || !library.patterns[id]) return library;
    return {
        ...library,
        patterns: {
            ...library.patterns,
            [id]: { ...library.patterns[id], data, updatedAt: nowIso() },
        },
    };
}

export function addPatternFromActive(library, name) {
    const active = library.patterns[library.activeId];
    if (!active) return library;
    const pattern = makePattern({ name, data: active.data });
    return {
        ...library,
        activeId: pattern.id,
        patterns: { ...library.patterns, [pattern.id]: pattern },
    };
}

// Builds a fresh builds.json-shaped object representing a brand-new build doc with
// a single main branch and its first build already run (req #2597). Inputs:
//   - major / minor: open-segment Major.Minor (drives currentMajor/currentMinor)
//   - initialBuildNumber: starting Build# of segment 1 — lets the team anchor the
//     first build at e.g. 5.2.42.0 instead of 5.2.1.0. Defaults to 1.
// Output mirrors what app.js's BuildModel.toJSON() produces, so it round-trips
// through the iframe's BuildModel constructor without any normalization.
export function makeEmptyBuildDoc({ major = 1, minor = 0, initialBuildNumber = 1 } = {}) {
    const safeMajor = Number.isFinite(major) && major >= 0 ? Math.floor(major) : 1;
    const safeMinor = Number.isFinite(minor) && minor >= 0 ? Math.floor(minor) : 0;
    const safeInitial =
        Number.isFinite(initialBuildNumber) && initialBuildNumber > 0
            ? Math.floor(initialBuildNumber) : 1;
    return {
        version: 1,
        currentMajor: safeMajor,
        currentMinor: safeMinor,
        nextBuildNumber: 2,
        nextBranchNumber: 2,
        initialBuildNumber: safeInitial,
        // First trunk segment — captures the New-doc dialog's M.m + starting Build#.
        // Subsequent segments are added by the iframe when a Release branch is created.
        trunkSegments: [{
            startIdx: 0,
            major: safeMajor,
            minor: safeMinor,
            initialBuildNumber: safeInitial,
        }],
        branches: [
            {
                id: 'main',
                type: 'main',
                name: 'Main',
                parentBranchId: null,
                parentBuildId: null,
                side: 'center',
                buildIds: ['m1'],
            },
        ],
        builds: {
            m1: { id: 'm1', number: 1, branchId: 'main', dotColor: null },
        },
    };
}

export function addEmptyPattern(library, name, opts) {
    const pattern = makePattern({ name, data: makeEmptyBuildDoc(opts) });
    return {
        ...library,
        activeId: pattern.id,
        patterns: { ...library.patterns, [pattern.id]: pattern },
    };
}

export function renamePattern(library, id, name) {
    if (!library.patterns[id]) return library;
    return {
        ...library,
        patterns: {
            ...library.patterns,
            [id]: { ...library.patterns[id], name, updatedAt: nowIso() },
        },
    };
}

export function removePattern(library, id) {
    if (!library.patterns[id]) return { library, error: 'pattern not found' };
    if (Object.keys(library.patterns).length <= 1) {
        return { library, error: "Can't delete the last pattern" };
    }
    const { [id]: _drop, ...rest } = library.patterns;
    let activeId = library.activeId;
    if (activeId === id) {
        const sorted = Object.values(rest).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1);
        activeId = sorted[0]?.id || null;
    }
    return { library: { ...library, activeId, patterns: rest } };
}

export function libraryToJson(library) {
    return JSON.stringify(library, null, 2);
}

function dedupeName(name, namesInUse) {
    if (!namesInUse.has(name)) return name;
    let i = 1;
    let candidate;
    do {
        candidate = i === 1 ? `${name} (imported)` : `${name} (imported ${i})`;
        i += 1;
    } while (namesInUse.has(candidate));
    return candidate;
}

export function importLibrary(library, incomingJson, { onCollision = 'rename' } = {}) {
    let incoming;
    try {
        incoming = JSON.parse(incomingJson);
    } catch (e) {
        return { library, error: `Invalid JSON: ${e.message}` };
    }
    if (!isValidLibrary(incoming)) {
        return { library, error: 'Invalid library shape (expected version=1)' };
    }
    const merged = { ...library.patterns };
    const namesInUse = new Set(Object.values(library.patterns).map(p => p.name));
    for (const p of Object.values(incoming.patterns)) {
        const idCollision = !!merged[p.id];
        const nameCollision = namesInUse.has(p.name);
        if ((idCollision || nameCollision) && onCollision !== 'overwrite') {
            const fresh = makePattern({
                name: dedupeName(p.name, namesInUse),
                data: p.data,
                createdAt: p.createdAt,
            });
            merged[fresh.id] = fresh;
            namesInUse.add(fresh.name);
        } else {
            merged[p.id] = p;
            namesInUse.add(p.name);
        }
    }
    let activeId = library.activeId;
    if (!activeId || !merged[activeId]) {
        activeId = Object.keys(merged)[0] || null;
    }
    return { library: { ...library, activeId, patterns: merged } };
}

export function usePatternLibrary({ fetchSeed } = {}) {
    const [library, setLibrary] = useState(emptyLibrary);
    const [isReady, setIsReady] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const existing = loadLibraryFromStorage();
            if (existing) {
                // Merge built-ins into the existing library on every mount so
                // new code-provided patterns appear in the dropdown without
                // requiring the user to clear localStorage.
                const { library: merged, changed } = ensureBuiltinsInLibrary(existing);
                if (cancelled) return;
                setLibrary(merged);
                if (changed) {
                    const result = saveLibraryToStorage(merged);
                    if (!result.ok) setError(result.error);
                }
                setIsReady(true);
                return;
            }
            let topologySeed = null;
            let fetchError = null;
            try {
                topologySeed = fetchSeed
                    ? await fetchSeed()
                    : await fetch(SEED_URL, { cache: 'no-store' }).then(r => {
                        if (!r.ok) throw new Error(`seed fetch failed: ${r.status}`);
                        return r.json();
                    });
            } catch (e) {
                fetchError = e?.message || 'seed fetch failed';
            }
            if (cancelled) return;
            const seeded = bootstrapLibrary(topologySeed);
            const result = saveLibraryToStorage(seeded);
            setLibrary(seeded);
            if (!result.ok) setError(result.error);
            else if (fetchError) setError(fetchError);
            setIsReady(true);
        })();
        return () => { cancelled = true; };
    }, [fetchSeed]);

    const commit = useCallback((next) => {
        setLibrary(next);
        const result = saveLibraryToStorage(next);
        if (!result.ok) setError(result.error);
    }, []);

    const patterns = listPatternsSorted(library);
    const activeId = library.activeId;
    const activePattern = activeId ? (library.patterns[activeId] || null) : null;

    return {
        isReady,
        error,
        clearError: useCallback(() => setError(null), []),
        library,
        patterns,
        activeId,
        activePattern,
        selectPattern: useCallback((id) => commit(setActive(library, id)), [library, commit]),
        saveActiveData: useCallback((data) => commit(updateActiveData(library, data)), [library, commit]),
        saveAs: useCallback((name) => commit(addPatternFromActive(library, name)), [library, commit]),
        createNew: useCallback((name, opts) => commit(addEmptyPattern(library, name, opts)), [library, commit]),
        rename: useCallback((id, name) => commit(renamePattern(library, id, name)), [library, commit]),
        remove: useCallback((id) => {
            const { library: next, error: removeError } = removePattern(library, id);
            if (removeError) return { ok: false, error: removeError };
            commit(next);
            return { ok: true };
        }, [library, commit]),
        exportAll: useCallback(
            () => new Blob([libraryToJson(library)], { type: 'application/json' }),
            [library],
        ),
        importAll: useCallback(async (file, opts) => {
            const text = await file.text();
            const { library: next, error: importError } = importLibrary(library, text, opts);
            if (importError) return { ok: false, error: importError };
            commit(next);
            return { ok: true };
        }, [library, commit]),
    };
}
