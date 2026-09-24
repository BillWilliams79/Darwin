import { describe, it, expect, beforeEach, vi } from 'vitest';

// req #3515 — the data hook carries builds.built_at into the model as
// `builtAt`, distinct from `createdAt` (create_ts, the row-write audit time).
// Same harness as the placeholder test: React hooks stubbed, useQuery returns
// canned rows per query key.

const ROWS = {
    'bv-d3-branches': [
        { id: 24, external_id: 'main', branch_type: 'main', name: 'Main', major: 6, minor: 2 },
    ],
    'bv-d3-builds': [
        { id: 38, branch_fk: 24, position: 0, build_number: 1, branch_number: 0, major: 6, minor: 2,
          external_id: 'm1', create_ts: '2026-09-13 06:19:06.000000', built_at: null },
        { id: 39, branch_fk: 24, position: 1, build_number: 2, branch_number: 0, major: 6, minor: 2,
          external_id: '24-b2', create_ts: '2026-09-13 06:31:33.000000',
          built_at: '2026-09-14 14:00:00.000000' },
    ],
    'bv-d3-customer-releases': [],
    'bv-d3-customers': [],
};

vi.mock('@tanstack/react-query', () => ({
    keepPreviousData: Symbol('keepPreviousData'),
    useQuery: (opts) => ({
        data: ROWS[opts.queryKey[0]] || [], isLoading: false, error: null, isSuccess: true,
    }),
}));

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, useMemo: (fn) => fn(), useContext: (ctx) => ctx.__testValue };
});

const { useBuildVisualizerData } = await import('../useBuildVisualizerData');
const AppContext = (await import('../../Context/AppContext')).default;
const AuthContext = (await import('../../Context/AuthContext')).default;

describe('useBuildVisualizerData — built_at (req #3515)', () => {
    beforeEach(() => {
        AppContext.__testValue = { darwinBuildVizUri: 'https://api.test' };
        AuthContext.__testValue = { idToken: 'tok', profile: { id: 'creator-1' } };
    });

    it('maps built_at to builtAt, keeping createdAt as the audit time', () => {
        const { model } = useBuildVisualizerData(14);
        expect(model.builds['24-b2'].builtAt).toBe('2026-09-14 14:00:00.000000');
        expect(model.builds['24-b2'].createdAt).toBe('2026-09-13 06:31:33.000000');
    });

    it('a NULL built_at stays null (blank date line)', () => {
        const { model } = useBuildVisualizerData(14);
        expect(model.builds.m1.builtAt).toBeNull();
    });
});
