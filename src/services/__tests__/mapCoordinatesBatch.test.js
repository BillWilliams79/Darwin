// Req #3166 — the batched GET /map_coordinates.
//
// What this file pins down, in the order the module does it:
//   • the URIs are the ones Lambda-Rest's generic GET actually understands —
//     `?col=(1,2,3)` for the IN filter, `map_run_fk` projected so the flat
//     response can be split back, and a TWO-column sort because `seq:asc` alone
//     interleaves runs;
//   • batches are packed against MEASURED row counts, so response size stays
//     under Lambda's 6 MB ceiling no matter which rides the user filtered to —
//     the one real hazard batching introduces (req #3078);
//   • a run with no coordinates costs no request and still gets an entry;
//   • a failure anywhere propagates, so a caller never silently renders fewer
//     tracks than runs.

import { describe, it, expect, vi } from 'vitest';
import {
    COORD_ID_BUDGET,
    COORD_REQUEST_CONCURRENCY,
    COORD_ROW_BUDGET,
    buildCountUri,
    buildRunTrackUri,
    buildTrackUri,
    chunkList,
    fetchCoordinatesForRuns,
    groupTracksByRun,
    packRunsByRowBudget,
    parseRowCounts,
} from '../mapCoordinatesBatch';

const DARWIN_URI = 'https://api.example.com/darwin_dev';

const countsOf = (entries) => new Map(entries);

describe('URI construction', () => {
    it('asks for many runs in one request using the IN-filter grammar', () => {
        expect(buildCountUri(DARWIN_URI, [4, 5, 6])).toBe(
            `${DARWIN_URI}/map_coordinates?map_run_fk=(4,5,6)&fields=count(*),map_run_fk`
        );
    });

    it('projects map_run_fk and sorts by run THEN seq', () => {
        const uri = buildTrackUri(DARWIN_URI, [4, 5]);
        expect(uri).toBe(
            `${DARWIN_URI}/map_coordinates?map_run_fk=(4,5)`
            + '&fields=map_run_fk,latitude,longitude,altitude'
            + '&sort=map_run_fk:asc,seq:asc'
        );
    });

    it('carries a caller-specific field list (the export path needs seq)', () => {
        expect(buildTrackUri(DARWIN_URI, [4], 'seq,latitude,longitude,altitude'))
            .toContain('&fields=map_run_fk,seq,latitude,longitude,altitude');
    });

    it('builds the SINGLE-run read useMapCoordinates uses, so the two cannot drift', () => {
        // Both writers of a mapCoordinateKeys.byRun entry come through here.
        expect(buildRunTrackUri(DARWIN_URI, 4)).toBe(
            `${DARWIN_URI}/map_coordinates?map_run_fk=4`
            + '&fields=latitude,longitude,altitude&sort=seq:asc'
        );
        // ...and the batched projection is the same list plus the discriminator,
        // which groupTracksByRun strips.
        expect(buildTrackUri(DARWIN_URI, [4]))
            .toContain('fields=map_run_fk,latitude,longitude,altitude');
    });
});

describe('parseRowCounts', () => {
    it('reads the grouped-count shape, parentheses and all', () => {
        const counts = parseRowCounts([
            { 'count(*)': 1202, map_run_fk: 36642 },
            { 'count(*)': 287, map_run_fk: 36643 },
        ]);
        expect(counts.get(36642)).toBe(1202);
        expect(counts.get(36643)).toBe(287);
    });

    it('survives a 404-mapped empty response', () => {
        expect(parseRowCounts([]).size).toBe(0);
        expect(parseRowCounts(undefined).size).toBe(0);
    });
});

describe('packRunsByRowBudget', () => {
    it('fills a batch up to the row budget and then starts another', () => {
        const counts = countsOf([[1, 600], [2, 600], [3, 600], [4, 600]]);
        expect(packRunsByRowBudget([1, 2, 3, 4], counts, { rowBudget: 1200 }))
            .toEqual([[1, 2], [3, 4]]);
    });

    it('never lets one batch exceed the budget when it can be split', () => {
        const counts = countsOf([[1, 900], [2, 900], [3, 900]]);
        const batches = packRunsByRowBudget([1, 2, 3], counts, { rowBudget: 1000 });
        expect(batches).toEqual([[1], [2], [3]]);
    });

    it('gives a run bigger than the whole budget its own request rather than dropping it', () => {
        // No LIMIT/OFFSET exists in this API (req #3078), so one oversized run
        // cannot be split. Alone in a batch it is exactly the request the
        // per-run code already made — never worse than the status quo.
        const counts = countsOf([[1, 50_000], [2, 600]]);
        expect(packRunsByRowBudget([1, 2], counts, { rowBudget: 20_000 }))
            .toEqual([[1], [2]]);
    });

    it('caps ids per request independently of the row budget', () => {
        const ids = Array.from({ length: 5 }, (_, i) => i + 1);
        const counts = countsOf(ids.map(id => [id, 1]));
        expect(packRunsByRowBudget(ids, counts, { rowBudget: 1_000_000, idBudget: 2 }))
            .toEqual([[1, 2], [3, 4], [5]]);
    });

    it('spends no request on a run the probe reported zero rows for', () => {
        const counts = countsOf([[1, 600], [3, 600]]);   // run 2 has no coordinates
        expect(packRunsByRowBudget([1, 2, 3], counts, { rowBudget: 20_000 }))
            .toEqual([[1, 3]]);
    });

    it('produces no batches at all when nothing has coordinates', () => {
        expect(packRunsByRowBudget([1, 2], new Map(), {})).toEqual([]);
    });
});

describe('groupTracksByRun', () => {
    it('splits a flat response per run and drops the discriminator', () => {
        const tracks = groupTracksByRun([
            { map_run_fk: 1, latitude: 37.1, longitude: -122.1, altitude: null },
            { map_run_fk: 1, latitude: 37.2, longitude: -122.2, altitude: null },
            { map_run_fk: 2, latitude: 38.1, longitude: -121.1, altitude: 10 },
        ]);
        // map_run_fk MUST be gone: these rows are written into the
        // mapCoordinateKeys.byRun entries RouteMapThumbnail reads, so they have
        // to match what the per-run read returns key for key.
        expect(tracks.get(1)).toEqual([
            { latitude: 37.1, longitude: -122.1, altitude: null },
            { latitude: 37.2, longitude: -122.2, altitude: null },
        ]);
        expect(tracks.get(2)).toEqual([{ latitude: 38.1, longitude: -121.1, altitude: 10 }]);
    });

    it('preserves the order the response arrived in (seq order per run)', () => {
        const rows = Array.from({ length: 5 }, (_, i) => ({ map_run_fk: 9, latitude: i }));
        expect(groupTracksByRun(rows).get(9).map(r => r.latitude)).toEqual([0, 1, 2, 3, 4]);
    });
});

describe('chunkList', () => {
    it('splits evenly and keeps the remainder', () => {
        expect(chunkList([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunkList([], 2)).toEqual([]);
    });
});

describe('fetchCoordinatesForRuns', () => {
    // A fetchJson that answers both the probe and the track read from a
    // {runId: rowCount} description, and records every URI it was asked for.
    const makeFetch = (rowsByRun, { failOn } = {}) => {
        const uris = [];
        const fetchJson = vi.fn(async (uri) => {
            uris.push(uri);
            if (failOn && failOn(uri)) throw new Error('boom');
            const ids = uri.match(/map_run_fk=\(([^)]*)\)/)[1].split(',').map(Number);
            if (uri.includes('count(*)')) {
                return ids
                    .filter(id => (rowsByRun[id] || 0) > 0)
                    .map(id => ({ 'count(*)': rowsByRun[id], map_run_fk: id }));
            }
            return ids.flatMap(id => Array.from({ length: rowsByRun[id] || 0 }, (_, i) => ({
                map_run_fk: id, latitude: id + i / 1000, longitude: -122, altitude: null,
            })));
        });
        return { fetchJson, uris };
    };

    it('collapses 200 per-run requests into a probe plus a handful of batches', async () => {
        // The production shape: 200 runs at the measured 600-row average.
        const runIds = Array.from({ length: 200 }, (_, i) => i + 1);
        const rowsByRun = Object.fromEntries(runIds.map(id => [id, 600]));
        const { fetchJson, uris } = makeFetch(rowsByRun);

        const tracks = await fetchCoordinatesForRuns({ fetchJson, darwinUri: DARWIN_URI, runIds });

        expect(tracks.size).toBe(200);
        expect(tracks.get(1)).toHaveLength(600);
        expect(tracks.get(200)).toHaveLength(600);

        const probes = uris.filter(u => u.includes('count(*)'));
        const reads = uris.filter(u => !u.includes('count(*)'));
        // 200 ids / 150 per URL = 2 probes. Reads: packing is GREEDY, so a batch
        // takes 33 runs (33 x 600 = 19,800; a 34th would overrun 20,000) and 200
        // runs need 7 — one more than the 6 perfect packing would give. Greedy
        // is the right trade: it is single-pass and keeps batches contiguous in
        // id order, and the extra request is one in seven against a saving of
        // 200 to 9.
        expect(probes).toHaveLength(Math.ceil(200 / COORD_ID_BUDGET));
        expect(reads).toHaveLength(7);
        expect(uris.length).toBe(9);
    });

    it('keeps every batch under the row budget', async () => {
        const runIds = Array.from({ length: 40 }, (_, i) => i + 1);
        // Wildly uneven, the way real rides are: a few long tours among short rides.
        const rowsByRun = Object.fromEntries(runIds.map(id => [id, id % 10 === 0 ? 9000 : 400]));
        const { fetchJson, uris } = makeFetch(rowsByRun);

        await fetchCoordinatesForRuns({ fetchJson, darwinUri: DARWIN_URI, runIds });

        for (const uri of uris.filter(u => !u.includes('count(*)'))) {
            const ids = uri.match(/map_run_fk=\(([^)]*)\)/)[1].split(',').map(Number);
            const rows = ids.reduce((sum, id) => sum + rowsByRun[id], 0);
            // Single-run batches are the documented escape; multi-run ones are bound.
            if (ids.length > 1) expect(rows).toBeLessThanOrEqual(COORD_ROW_BUDGET);
        }
    });

    it('returns an empty track for a run with no coordinates, and asks for it once', async () => {
        const { fetchJson, uris } = makeFetch({ 1: 600, 2: 0, 3: 600 });

        const tracks = await fetchCoordinatesForRuns({
            fetchJson, darwinUri: DARWIN_URI, runIds: [1, 2, 3],
        });

        expect(tracks.get(2)).toEqual([]);
        expect(tracks.get(1)).toHaveLength(600);
        // Run 2 appears in the probe (it has to, to be counted) but in no read.
        const reads = uris.filter(u => !u.includes('count(*)'));
        expect(reads).toHaveLength(1);
        expect(reads[0]).toContain('map_run_fk=(1,3)');
    });

    it('makes no request at all when nothing has coordinates', async () => {
        const { fetchJson, uris } = makeFetch({ 1: 0, 2: 0 });

        const tracks = await fetchCoordinatesForRuns({
            fetchJson, darwinUri: DARWIN_URI, runIds: [1, 2],
        });

        expect(tracks.get(1)).toEqual([]);
        expect(tracks.get(2)).toEqual([]);
        expect(uris.filter(u => !u.includes('count(*)'))).toHaveLength(0);
    });

    it('makes no request at all for an empty run set', async () => {
        const { fetchJson } = makeFetch({});
        const tracks = await fetchCoordinatesForRuns({
            fetchJson, darwinUri: DARWIN_URI, runIds: [],
        });
        expect(tracks.size).toBe(0);
        expect(fetchJson).not.toHaveBeenCalled();
    });

    it('deduplicates and orders run ids', async () => {
        const { fetchJson, uris } = makeFetch({ 5: 10, 7: 10 });
        await fetchCoordinatesForRuns({ fetchJson, darwinUri: DARWIN_URI, runIds: [7, 5, 7] });
        expect(uris[0]).toContain('map_run_fk=(5,7)');
    });

    it('propagates a failed batch instead of returning fewer tracks than runs', async () => {
        const { fetchJson } = makeFetch(
            { 1: 600, 2: 600 },
            { failOn: (uri) => !uri.includes('count(*)') },
        );
        await expect(fetchCoordinatesForRuns({
            fetchJson, darwinUri: DARWIN_URI, runIds: [1, 2],
        })).rejects.toThrow('boom');
    });

    it('fails loudly when a caller resolves a non-array (call_rest_api 503 shape)', async () => {
        // call_rest_api RETURNS {data: {}, httpStatus: 503} on a transport
        // failure instead of throwing, and the export wrappers forward
        // `result.data`. Silently treating that as "no coordinates" would export
        // a ride with no track and say nothing.
        const fetchJson = async () => ({});
        await expect(fetchCoordinatesForRuns({
            fetchJson, darwinUri: DARWIN_URI, runIds: [1],
        })).rejects.toThrow(/did not return rows/);
    });

    it('propagates a failed probe rather than reading an unbounded batch', async () => {
        const { fetchJson } = makeFetch(
            { 1: 600 },
            { failOn: (uri) => uri.includes('count(*)') },
        );
        await expect(fetchCoordinatesForRuns({
            fetchJson, darwinUri: DARWIN_URI, runIds: [1],
        })).rejects.toThrow('boom');
    });

    it('holds concurrency down at its DEFAULT — one request is one Lambda invocation and one DB connection', async () => {
        // Asserted against COORD_REQUEST_CONCURRENCY rather than an explicit
        // argument: passing `concurrency: 4` here would let the exported default
        // drift to any value with this test still green.
        const runIds = Array.from({ length: 60 }, (_, i) => i + 1);
        const rowsByRun = Object.fromEntries(runIds.map(id => [id, COORD_ROW_BUDGET]));
        let active = 0;
        let maxActive = 0;
        const fetchJson = async (uri) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(r => setTimeout(r, 1));
            active -= 1;
            const ids = uri.match(/map_run_fk=\(([^)]*)\)/)[1].split(',').map(Number);
            if (uri.includes('count(*)')) {
                return ids.map(id => ({ 'count(*)': rowsByRun[id], map_run_fk: id }));
            }
            return ids.map(id => ({ map_run_fk: id, latitude: 1, longitude: 2, altitude: null }));
        };

        await fetchCoordinatesForRuns({ fetchJson, darwinUri: DARWIN_URI, runIds });

        expect(COORD_REQUEST_CONCURRENCY).toBeLessThanOrEqual(8);
        expect(maxActive).toBeGreaterThan(1);
        expect(maxActive).toBeLessThanOrEqual(COORD_REQUEST_CONCURRENCY);
    });

    it('hands each batch over AS IT LANDS, so a later failure cannot discard it', async () => {
        // The per-run fan-out this replaced was incrementally durable for free.
        // Without onTracks firing per batch, one rejection throws away every
        // completed batch and the client-wide retry: 2 re-reads everything 3x.
        const runIds = Array.from({ length: 40 }, (_, i) => i + 1);
        const rowsByRun = Object.fromEntries(runIds.map(id => [id, 15_000]));
        const delivered = new Set();
        const { fetchJson } = makeFetch(rowsByRun, {
            // Fail only the batch containing the very last run.
            failOn: (uri) => !uri.includes('count(*)')
                && uri.match(/map_run_fk=\(([^)]*)\)/)[1].split(',').map(Number).includes(40),
        });

        await expect(fetchCoordinatesForRuns({
            fetchJson,
            darwinUri: DARWIN_URI,
            runIds,
            concurrency: 1,
            onTracks: (tracks) => { for (const id of tracks.keys()) delivered.add(id); },
        })).rejects.toThrow('boom');

        // Everything before the failing batch survived the rejection.
        expect(delivered.size).toBeGreaterThan(0);
        expect(delivered.has(1)).toBe(true);
        expect(delivered.has(40)).toBe(false);
    });

    it('settles zero-coordinate runs through onTracks too, so a retry never re-probes them', async () => {
        const delivered = new Map();
        const { fetchJson } = makeFetch({ 1: 600, 2: 0 });

        await fetchCoordinatesForRuns({
            fetchJson,
            darwinUri: DARWIN_URI,
            runIds: [1, 2],
            onTracks: (tracks) => { for (const [id, t] of tracks) delivered.set(id, t); },
        });

        expect(delivered.get(2)).toEqual([]);
        expect(delivered.get(1)).toHaveLength(600);
    });
});
