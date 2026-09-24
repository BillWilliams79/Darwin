// @vitest-environment jsdom
//
// req #3515 — creating a new build project is a live event: the trunk is cut
// and its first build (m1) runs NOW. useBuildPatterns.createNew must stamp
// branches.branched_at on the trunk and builds.built_at on m1 with the SAME
// UTC instant. This is the one POST site outside BuildVisualizerPage, so the
// page test cannot reach it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn() }));
vi.mock('../../hooks/factory/createEntityQueries', () => ({ fetchEntity: vi.fn(async () => []) }));

import { useBuildPatterns } from '../useBuildPatterns';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import call_rest_api from '../../RestApi/RestApi';

const URI = 'https://api.test/darwin_dev';

function wrapper({ children }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
        <QueryClientProvider client={client}>
            <AppContext.Provider value={{ darwinBuildVizUri: URI }}>
                <AuthContext.Provider value={{ idToken: 'tok', profile: { id: 'creator-1' } }}>
                    {children}
                </AuthContext.Provider>
            </AppContext.Provider>
        </QueryClientProvider>
    );
}

const posts = (table) => call_rest_api.mock.calls
    .filter(([url, method]) => method === 'POST' && url === `${URI}/${table}`)
    .map(([, , body]) => body);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 11:30 PM Pacific on Sep 21 = 06:30 UTC on Sep 22 — the stamp must be UTC.
    vi.setSystemTime(new Date('2026-09-22T06:30:00.000Z'));
    localStorage.clear();
    call_rest_api.mockReset();
    call_rest_api.mockImplementation(async (url, method) => {
        const ok = { httpStatus: { httpStatus: 200 } };
        if (method === 'POST' && url === `${URI}/build_projects`) return { ...ok, data: [{ id: 501 }] };
        if (method === 'POST' && url === `${URI}/branches`) return { ...ok, data: [{ id: 601 }] };
        return { ...ok, data: [] };
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useBuildPatterns.createNew — event times (req #3515)', () => {
    it('stamps the trunk\'s branched_at and m1\'s built_at with one UTC instant', async () => {
        const { result } = renderHook(() => useBuildPatterns(), { wrapper });
        let outcome;
        await act(async () => { outcome = await result.current.createNew('Exemplar', { major: 6, minor: 2 }); });
        expect(outcome).toEqual({ ok: true });

        const [trunk] = posts('branches');
        const [m1] = posts('builds');
        expect(trunk).toMatchObject({ project_fk: 501, external_id: 'main', branched_at: '2026-09-22 06:30:00' });
        expect(m1).toMatchObject({ branch_fk: 601, external_id: 'm1', built_at: '2026-09-22 06:30:00' });
    });

    it('does not stamp anything onto the project row itself', async () => {
        const { result } = renderHook(() => useBuildPatterns(), { wrapper });
        await act(async () => { await result.current.createNew('Exemplar'); });
        const [project] = posts('build_projects');
        expect(Object.keys(project).sort()).toEqual(['description', 'project_status', 'title']);
    });
});
