import {
    describe, it, expect, vi, beforeEach,
} from 'vitest';

// req #2895 — assert the data hook wires `placeholderData: keepPreviousData` on
// every query. That option is what keeps the prior result on screen while a
// key-changing refetch (e.g. running a build changes the build-id CSV embedded
// in the releases query key) resolves — so the aggregate isLoading never spikes
// and KonvaBuildCanvas is never unmounted / re-framed.
//
// The hook is exercised as a plain function: React's useMemo/useContext are
// stubbed (no render harness in this repo) and useQuery is captured so we can
// inspect the option objects the hook builds.

const KEEP_PREV = Symbol('keepPreviousData');
const captured = [];

vi.mock('@tanstack/react-query', () => ({
    keepPreviousData: KEEP_PREV,
    useQuery: (opts) => {
        captured.push(opts);
        return {
            data: [], isLoading: false, error: null, isSuccess: true,
        };
    },
}));

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useMemo: (fn) => fn(),
        useContext: (ctx) => ctx.__testValue,
    };
});

// Import AFTER the mocks so the hook binds to the stubbed react/useQuery.
const { useBuildVisualizerData } = await import('../useBuildVisualizerData');
const AppContext = (await import('../../Context/AppContext')).default;
const AuthContext = (await import('../../Context/AuthContext')).default;

describe('useBuildVisualizerData — keepPreviousData wiring', () => {
    beforeEach(() => {
        captured.length = 0;
        AppContext.__testValue = { darwinBuildVizUri: 'https://api.test' };
        AuthContext.__testValue = { idToken: 'tok', profile: { id: 'creator-1' } };
    });

    it('passes placeholderData: keepPreviousData on every query', () => {
        useBuildVisualizerData(42);
        // branches, builds, releases, customers.
        expect(captured.length).toBe(4);
        for (const opts of captured) {
            expect(opts.placeholderData).toBe(KEEP_PREV);
        }
    });

    it('keys the releases query on the build-id CSV (the key that changes on a build add)', () => {
        useBuildVisualizerData(42);
        const releases = captured.find(o => Array.isArray(o.queryKey)
            && o.queryKey[0] === 'bv-d3-customer-releases');
        expect(releases).toBeTruthy();
        // 4th key segment is the build-id CSV — it changing is exactly why
        // keepPreviousData is required here.
        expect(releases.queryKey).toHaveLength(4);
        expect(releases.placeholderData).toBe(KEEP_PREV);
    });
});
