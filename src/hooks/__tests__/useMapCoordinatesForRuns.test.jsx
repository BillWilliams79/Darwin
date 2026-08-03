// @vitest-environment jsdom
//
// Req #3158 — the aggregator card's coordinates hook. The review findings this
// file pins down mechanically:
//   • the per-run fetches are CAPPED at 15 in flight (exportService parity),
//     never one unbounded burst per filtered ride;
//   • every per-run result lands in useMapCoordinates' own cache entry
//     (mapCoordinateKeys.byRun, identical fields+sort in the URI), which is
//     the cache-sharing claim with RouteMapThumbnail;
//   • a failed per-run fetch fails the aggregate loudly (isError), instead of
//     quietly rendering fewer tracks than rides.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockFetchEntity;

vi.mock('../factory/createEntityQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, fetchEntity: (...args) => mockFetchEntity(...args) };
});

import { useMapCoordinatesForRuns } from '../useDataQueries';
import { mapCoordinateKeys } from '../useQueryKeys';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';

let latest;
const Probe = ({ runIds }) => {
    latest = useMapCoordinatesForRuns(runIds);
    return null;
};

let container;
let root;
let client;

const renderProbe = (runIds) => {
    act(() => {
        root.render(
            <QueryClientProvider client={client}>
                <AppContext.Provider value={{ darwinUri: 'https://api.test' }}>
                    <AuthContext.Provider value={{ idToken: 'token-1' }}>
                        <Probe runIds={runIds} />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
};

const waitUntil = async (cond) => {
    for (let i = 0; i < 200; i++) {
        if (cond()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error('timed out waiting for condition');
};

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    latest = undefined;
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    client.clear();
});

describe('useMapCoordinatesForRuns (req #3158)', () => {
    it('fetches one track per run with at most 15 requests in flight', async () => {
        const runIds = Array.from({ length: 20 }, (_, i) => i + 1);
        const uris = [];
        let active = 0;
        let maxActive = 0;
        mockFetchEntity = async (uri) => {
            uris.push(uri);
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(r => setTimeout(r, 5));
            active -= 1;
            return [{ latitude: '37.1', longitude: '-122.1' }];
        };

        renderProbe(runIds);
        await waitUntil(() => latest?.isSuccess);

        expect(uris.length).toBe(20);
        expect(maxActive).toBeLessThanOrEqual(15);
        expect(latest.data.length).toBe(20);
        expect(uris[0]).toContain('/map_coordinates?map_run_fk=');
        expect(uris[0]).toContain('fields=latitude,longitude,altitude');
        expect(uris[0]).toContain('sort=seq:asc');
    });

    it('populates the per-run cache entries the thumbnails read', async () => {
        const track = [{ latitude: '37.1', longitude: '-122.1' }];
        mockFetchEntity = async () => track;

        renderProbe([7, 8]);
        await waitUntil(() => latest?.isSuccess);

        expect(client.getQueryData(mapCoordinateKeys.byRun(7))).toEqual(track);
        expect(client.getQueryData(mapCoordinateKeys.byRun(8))).toEqual(track);
    });

    it('reports isError when any per-run fetch fails', async () => {
        mockFetchEntity = async (uri) => {
            if (uri.includes('map_run_fk=2')) throw new Error('boom');
            return [{ latitude: '37.1', longitude: '-122.1' }];
        };

        renderProbe([1, 2, 3]);
        await waitUntil(() => latest?.isError);

        expect(latest.isError).toBe(true);
        expect(latest.data).toBeUndefined();
    });

    it('does not multiply the client-wide retry into the per-run fetches', async () => {
        // Production defaults: retry 2 on the client. Without retry: false on
        // the inner fetchQuery, a persistently failing run costs 3 inner × 3
        // outer = 9 requests before isError. With it: one per outer attempt.
        client = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 1 } } });
        let failingCalls = 0;
        mockFetchEntity = async (uri) => {
            if (uri.includes('map_run_fk=2')) { failingCalls += 1; throw new Error('boom'); }
            return [{ latitude: '37.1', longitude: '-122.1' }];
        };

        renderProbe([1, 2, 3]);
        await waitUntil(() => latest?.isError);

        expect(failingCalls).toBe(3);
    });

    it('keeps the previous tracks on screen while a new run set loads', async () => {
        mockFetchEntity = async () => [{ latitude: '37.1', longitude: '-122.1' }];

        renderProbe([1, 2]);
        await waitUntil(() => latest?.isSuccess);
        expect(latest.data).toHaveLength(2);

        let release;
        mockFetchEntity = () => new Promise(resolve => {
            release = () => resolve([{ latitude: '38.1', longitude: '-121.1' }]);
        });
        renderProbe([1, 2, 3]);

        // New key, fetch in flight — previous data still served as placeholder.
        expect(latest.isPlaceholderData).toBe(true);
        expect(latest.data).toHaveLength(2);

        await waitUntil(() => { release?.(); return latest?.data?.length === 3; });
        expect(latest.isPlaceholderData).toBe(false);
    });

    it('fetches nothing for an empty run set', async () => {
        let calls = 0;
        mockFetchEntity = async () => { calls += 1; return []; };

        renderProbe([]);
        await act(async () => { await new Promise(r => setTimeout(r, 20)); });

        expect(calls).toBe(0);
        expect(latest.isLoading).toBe(false);
    });
});
