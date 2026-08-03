// @vitest-environment jsdom
//
// The /maps aggregator card's coordinates hook — req #3158, batched by req #3166.
//
// The pre-#3166 version of this file pinned a per-run fan-out capped at 15 in
// flight. That cap is gone because the fan-out is: the hook now asks Lambda-Rest
// for many runs per request via the `?map_run_fk=(1,2,3)` IN filter
// (services/mapCoordinatesBatch.js). What survives unchanged, and is re-asserted
// here against the new shape:
//   • every fetched run still lands in useMapCoordinates' own cache entry
//     (mapCoordinateKeys.byRun), in the same row shape — the cache-sharing claim
//     with RouteMapThumbnail, which the batched read has to actively preserve
//     since a batch response maps to no single per-run key;
//   • a run ALREADY in that cache costs no request at all, which is the other
//     half of the sharing;
//   • a failed fetch fails the aggregate loudly (isError) rather than quietly
//     rendering fewer tracks than rides;
//   • the client-wide retry does not multiply into the inner fetches;
//   • a filter change keeps the previous tracks on screen.
//
// Unit coverage of the batching itself — row budgets, packing, URI grammar —
// lives in services/__tests__/mapCoordinatesBatch.test.js.

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

const idsIn = (uri) => uri.match(/map_run_fk=\(([^)]*)\)/)[1].split(',').map(Number);

// Serves both the count probe and the batched track read from a
// {runId: rowCount} description, mirroring what rest_get_table.py returns.
const serveRuns = (rowsByRun, { failOn } = {}) => {
    const uris = [];
    mockFetchEntity = async (uri) => {
        uris.push(uri);
        if (failOn && failOn(uri)) throw new Error('boom');
        const ids = idsIn(uri);
        if (uri.includes('count(*)')) {
            return ids.filter(id => (rowsByRun[id] || 0) > 0)
                .map(id => ({ 'count(*)': rowsByRun[id], map_run_fk: id }));
        }
        return ids.flatMap(id => Array.from({ length: rowsByRun[id] || 0 }, () => ({
            map_run_fk: id, latitude: '37.1', longitude: '-122.1', altitude: null,
        })));
    };
    return uris;
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

describe('useMapCoordinatesForRuns (req #3158, batched by req #3166)', () => {
    it('fetches 20 runs in two requests, not twenty', async () => {
        const runIds = Array.from({ length: 20 }, (_, i) => i + 1);
        const uris = serveRuns(Object.fromEntries(runIds.map(id => [id, 3])));

        renderProbe(runIds);
        await waitUntil(() => latest?.isSuccess);

        expect(latest.data).toHaveLength(20);
        expect(latest.data.every(track => track.length === 3)).toBe(true);
        // One grouped-count probe + one batched read covering every run.
        expect(uris).toHaveLength(2);
        expect(uris[0]).toContain('fields=count(*),map_run_fk');
        expect(idsIn(uris[1])).toEqual(runIds);
        expect(uris[1]).toContain('&fields=map_run_fk,latitude,longitude,altitude');
        expect(uris[1]).toContain('&sort=map_run_fk:asc,seq:asc');
    });

    it('returns tracks in run-id order regardless of response order', async () => {
        serveRuns({ 3: 1, 9: 2, 5: 3 });

        renderProbe([9, 3, 5]);
        await waitUntil(() => latest?.isSuccess);

        // sorted ids are [3, 5, 9] -> lengths [1, 3, 2]
        expect(latest.data.map(t => t.length)).toEqual([1, 3, 2]);
    });

    it('populates the per-run cache entries the thumbnails read, without map_run_fk', async () => {
        serveRuns({ 7: 1, 8: 1 });

        renderProbe([7, 8]);
        await waitUntil(() => latest?.isSuccess);

        const expected = [{ latitude: '37.1', longitude: '-122.1', altitude: null }];
        expect(client.getQueryData(mapCoordinateKeys.byRun(7))).toEqual(expected);
        expect(client.getQueryData(mapCoordinateKeys.byRun(8))).toEqual(expected);
    });

    it('spends no request on a run a thumbnail already cached', async () => {
        const cached = [{ latitude: '40.0', longitude: '-120.0', altitude: null }];
        client.setQueryData(mapCoordinateKeys.byRun(7), cached);
        const uris = serveRuns({ 7: 5, 8: 1 });

        renderProbe([7, 8]);
        await waitUntil(() => latest?.isSuccess);

        expect(latest.data[0]).toBe(cached);
        for (const uri of uris) expect(idsIn(uri)).toEqual([8]);
    });

    it('JOINS a thumbnail fetch already in flight instead of batching that run again', async () => {
        // RouteCardView mounts MapAggregatorCard and the RouteCards in the same
        // commit, so on a cold cache the thumbnails are mid-fetch when this hook
        // runs. getQueryData cannot see that — it returns undefined for a query
        // fetching for the first time, identical to an absent one — and treating
        // it as absent fetches every visible run's rows TWICE.
        let releaseThumb;
        const thumbTrack = [{ latitude: '41.0', longitude: '-119.0', altitude: null }];
        let thumbFetches = 0;

        // Stand in for RouteMapThumbnail's own useMapCoordinates query on run 7.
        client.fetchQuery({
            queryKey: mapCoordinateKeys.byRun(7),
            queryFn: () => new Promise(resolve => {
                thumbFetches += 1;
                releaseThumb = () => resolve(thumbTrack);
            }),
            staleTime: Infinity,
        });

        const uris = serveRuns({ 7: 500, 8: 1 });
        renderProbe([7, 8]);
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
        releaseThumb();
        await waitUntil(() => latest?.isSuccess);

        expect(latest.data[0]).toEqual(thumbTrack);
        expect(thumbFetches).toBe(1);
        // Run 7 appears in NO batched request — only run 8 was ever asked for.
        for (const uri of uris) expect(idsIn(uri)).toEqual([8]);
    });

    it('keeps batches that succeeded when a later one fails, so a retry is cheap', async () => {
        // Without per-batch seeding, one rejection discards every completed
        // batch and the client-wide retry: 2 re-reads the whole set three times.
        client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 1 } } });
        const runIds = Array.from({ length: 40 }, (_, i) => i + 1);
        const rowsByRun = Object.fromEntries(runIds.map(id => [id, 15_000]));
        const readIds = [];
        mockFetchEntity = async (uri) => {
            const ids = idsIn(uri);
            if (uri.includes('count(*)')) {
                return ids.map(id => ({ 'count(*)': rowsByRun[id], map_run_fk: id }));
            }
            readIds.push(ids);
            if (ids.includes(40)) throw new Error('boom');
            return ids.flatMap(id => [{ map_run_fk: id, latitude: '37.1', longitude: '-122.1' }]);
        };

        renderProbe(runIds);
        await waitUntil(() => latest?.isError);

        // Run 1 landed on the first attempt and was seeded, so the retry never
        // asked for it again.
        expect(readIds[0]).toContain(1);
        expect(readIds.slice(1).flat()).not.toContain(1);
        expect(client.getQueryData(mapCoordinateKeys.byRun(1))).toHaveLength(1);
    });

    it('gives a run with no coordinates an empty track rather than failing', async () => {
        serveRuns({ 1: 2, 2: 0 });

        renderProbe([1, 2]);
        await waitUntil(() => latest?.isSuccess);

        expect(latest.data[0]).toHaveLength(2);
        expect(latest.data[1]).toEqual([]);
    });

    it('reports isError when a batched fetch fails', async () => {
        serveRuns({ 1: 1, 2: 1, 3: 1 }, { failOn: (uri) => !uri.includes('count(*)') });

        renderProbe([1, 2, 3]);
        await waitUntil(() => latest?.isError);

        expect(latest.isError).toBe(true);
        expect(latest.data).toBeUndefined();
    });

    it('does not multiply the client-wide retry into the inner fetches', async () => {
        // Production defaults: retry 2 on the client. The inner reads are plain
        // fetchEntity calls with no query of their own, so a persistently
        // failing read costs exactly one request per outer attempt — 3, never 9.
        client = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 1 } } });
        let readAttempts = 0;
        serveRuns({ 1: 1, 2: 1 }, {
            failOn: (uri) => {
                if (uri.includes('count(*)')) return false;
                readAttempts += 1;
                return true;
            },
        });

        renderProbe([1, 2]);
        await waitUntil(() => latest?.isError);

        expect(readAttempts).toBe(3);
    });

    it('keeps the previous tracks on screen while a new run set loads', async () => {
        serveRuns({ 1: 1, 2: 1 });

        renderProbe([1, 2]);
        await waitUntil(() => latest?.isSuccess);
        expect(latest.data).toHaveLength(2);

        // Run 3 is the only uncached id, so exactly one probe + one read remain
        // outstanding while the placeholder holds.
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        mockFetchEntity = async (uri) => {
            await pending;
            const ids = idsIn(uri);
            if (uri.includes('count(*)')) return ids.map(id => ({ 'count(*)': 1, map_run_fk: id }));
            return ids.map(id => ({ map_run_fk: id, latitude: '38.1', longitude: '-121.1' }));
        };
        renderProbe([1, 2, 3]);

        expect(latest.isPlaceholderData).toBe(true);
        expect(latest.data).toHaveLength(2);

        release();
        await waitUntil(() => latest?.data?.length === 3);
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
