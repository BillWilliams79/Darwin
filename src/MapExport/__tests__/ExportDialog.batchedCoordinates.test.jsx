// @vitest-environment jsdom
//
// ExportDialog's coordinate fetch — req #3166.
//
// This is the THIRD caller of services/mapCoordinatesBatch.js and the one whose
// rewrite carried the most risk: it went from a SERIAL per-run loop (200 rides =
// 200 sequential round trips before the first byte of KML) to a prefetched Map
// lookup. Two properties had to survive that, and neither is visible by reading:
//
//   • `allCoords` and `totalCoords` are still built by iterating `runs` IN
//     ORDER, so the KML preview's polylines and the stats panel's coordinate
//     count still correspond to the rides the user filtered to. The batch
//     returns a Map keyed by run id, in id order — a different order.
//   • its `fetchJson` wrapper differs from the other two callers': it maps 404
//     to [] itself, and `call_rest_api` RETURNS rather than throws on a
//     transport failure.
//
// ExportMapPreview is stubbed — it mounts Leaflet, which needs a real layout
// engine. It is not what this file is about.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn() }));
vi.mock('../ExportMapPreview', () => ({
    default: ({ routeCoordinates }) => (
        <div data-testid="preview-stub">{routeCoordinates.map(t => t.length).join(',')}</div>
    ),
}));

import call_rest_api from '../../RestApi/RestApi';
import ExportDialog from '../ExportDialog';

const DARWIN_URI = 'https://api.example.com/darwin_dev';

const makeRun = (id) => ({
    id,
    run_id: 900 + id,
    map_route_fk: null,
    activity_id: 4,
    activity_name: 'Ride',
    start_time: `2026-01-0${id} 08:00:00`,
    run_time_sec: 3600,
    stopped_time_sec: 0,
    distance_mi: 10,
    ascent_ft: 100,
    descent_ft: 100,
    calories: 300,
    max_speed_mph: 20,
    avg_speed_mph: 10,
    notes: null,
    source: 'cyclemeter',
});

// Answers the count probe and the batched read from a {runId: rowCount} map,
// recording every URI. Coordinates encode their run id in the latitude so a
// track can be traced back to the ride it belongs to.
const serve = (rowsByRun, { failReads = false } = {}) => {
    const uris = [];
    call_rest_api.mockImplementation(async (uri) => {
        uris.push(uri);
        const ids = uri.match(/map_run_fk=\(([^)]*)\)/)[1].split(',').map(Number);
        if (uri.includes('count(*)')) {
            const rows = ids.filter(id => rowsByRun[id] > 0)
                .map(id => ({ 'count(*)': rowsByRun[id], map_run_fk: id }));
            if (rows.length === 0) {
                const err = new Error('Not found');
                err.httpStatus = { httpStatus: 404 };
                throw err;
            }
            return { data: rows, httpStatus: { httpStatus: 200 } };
        }
        if (failReads) return { data: {}, httpStatus: { httpStatus: 503 } };
        return {
            data: ids.flatMap(id => Array.from({ length: rowsByRun[id] || 0 }, (_, i) => ({
                map_run_fk: id,
                latitude: 37 + id / 100,
                longitude: -122 - i / 1000,
                altitude: 10,
            }))),
            httpStatus: { httpStatus: 200 },
        };
    });
    return uris;
};

let container;
let root;

const renderDialog = (runs) => {
    act(() => {
        root.render(
            <ExportDialog
                open
                onClose={() => {}}
                runs={runs}
                routes={[]}
                darwinUri={DARWIN_URI}
                idToken="token-1"
                filterDescription="All activities"
            />
        );
    });
};

// The dialog renders into a MUI portal, so query the document, not the container.
const byTestId = (id) => document.body.querySelector(`[data-testid="${id}"]`);

const generate = () => act(() => {
    byTestId('generate-kml-button').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
    );
});

const waitUntil = async (cond) => {
    for (let i = 0; i < 200; i++) {
        if (cond()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error('timed out waiting for condition');
};

beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('ExportDialog — batched coordinate fetch (req #3166)', () => {
    it('fetches three rides in ONE batched read, not three serial ones', async () => {
        const uris = serve({ 1: 4, 2: 2, 3: 3 });
        renderDialog([makeRun(1), makeRun(2), makeRun(3)]);
        generate();

        await waitUntil(() => byTestId('export-stats-panel'));

        const reads = uris.filter(u => !u.includes('count(*)'));
        expect(uris).toHaveLength(2);          // one probe + one read
        expect(reads[0]).toContain('map_run_fk=(1,2,3)');
        expect(reads[0]).toContain('&sort=map_run_fk:asc,seq:asc');
        // The KML path asks for the DEFAULT track fields — no `seq`, matching
        // what it requested before req #3166 (reconstructRun never reads it).
        // exportService, which writes seq into the export file, passes its own
        // list; that divergence is deliberate and is asserted in its own test.
        expect(reads[0]).toContain('&fields=map_run_fk,latitude,longitude,altitude');
    });

    it('counts every coordinate exactly once across all rides', async () => {
        serve({ 1: 4, 2: 2, 3: 3 });
        renderDialog([makeRun(1), makeRun(2), makeRun(3)]);
        generate();

        await waitUntil(() => byTestId('export-stats-panel'));

        const text = byTestId('export-stats-panel').textContent;
        expect(text).toContain('9');   // 4 + 2 + 3 GPS coordinates
        expect(text).toContain('3');   // total activities
    });

    it('keeps each track attached to its own ride, in `runs` order', async () => {
        // Distinct lengths per run, and the runs are passed OUT of id order. The
        // batch returns them keyed and sorted by id — a different order — so the
        // preview receiving 3,4,2 is the evidence the mapping did not shift.
        serve({ 1: 4, 2: 2, 3: 3 });
        renderDialog([makeRun(3), makeRun(1), makeRun(2)]);
        generate();

        await waitUntil(() => byTestId('preview-stub'));
        expect(byTestId('preview-stub').textContent).toBe('3,4,2');
    });

    it('exports a ride with no GPS as an empty track rather than failing', async () => {
        serve({ 1: 4, 2: 0 });
        renderDialog([makeRun(1), makeRun(2)]);
        generate();

        await waitUntil(() => byTestId('preview-stub'));
        expect(byTestId('preview-stub').textContent).toBe('4,0');
        expect(byTestId('export-stats-panel').textContent).toContain('4');
    });

    it('generates from an empty result when NO ride has coordinates (probe 404s)', async () => {
        const uris = serve({ 1: 0, 2: 0 });
        renderDialog([makeRun(1), makeRun(2)]);
        generate();

        await waitUntil(() => byTestId('preview-stub'));
        expect(byTestId('preview-stub').textContent).toBe('0,0');
        // The probe said there is nothing; no track read was issued.
        expect(uris.filter(u => !u.includes('count(*)'))).toHaveLength(0);
    });

    it('surfaces a transport failure instead of exporting rides with no tracks', async () => {
        // call_rest_api RETURNS {data: {}, httpStatus: 503} rather than throwing.
        // Before req #3166's assertRows guard that `{}` would have flowed through
        // as "no coordinates" and produced a silently empty KML.
        serve({ 1: 4 }, { failReads: true });
        renderDialog([makeRun(1)]);
        generate();

        await waitUntil(() => document.body.textContent.includes('did not return rows'));
        expect(byTestId('export-stats-panel')).toBeNull();
        // ...and the message names run counts, never the API URL.
        expect(document.body.textContent).not.toContain(DARWIN_URI);
    });
});
