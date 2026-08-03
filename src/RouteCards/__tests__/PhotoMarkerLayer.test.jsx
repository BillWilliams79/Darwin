// @vitest-environment jsdom
//
// Req #3159 — PhotoMarkerLayer's prop contract now serves two surfaces: the
// per-ride full map (`run`, internal IndexedDB load) and the aggregator card
// (`runs[]` + parent-supplied `dedupedIndex`). Real Leaflet cannot run in
// jsdom, so Leaflet and its plugins are stubbed just far enough to observe
// which markers land in the cluster group and whether the group is put on the
// map — the derivation itself (dedup + window union) runs the REAL filterUtils.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
    clusterGroups: [],
    easyButtons: [],
    loadIndexResult: null,
    loadIndexCalls: 0,
}));

vi.mock('leaflet', () => {
    const L = {
        marker: (latlng, opts) => ({ __marker: true, latlng, opts }),
        divIcon: (opts) => ({ __divIcon: true, opts }),
        point: (x, y) => ({ x, y }),
        markerClusterGroup: (opts) => {
            const group = {
                opts,
                layers: [],
                handlers: {},
                addLayers(markers) { this.layers.push(...markers); },
                clearLayers() { this.layers = []; },
                on(ev, fn) { this.handlers[ev] = fn; },
            };
            harness.clusterGroups.push(group);
            return group;
        },
        easyButton: (opts) => {
            const btn = {
                opts,
                currentState: opts.states[0].stateName,
                addTo: () => btn,
                remove: () => {},
                state(name) { this.currentState = name; },
                click(stateName) {
                    const s = this.opts.states.find(st => st.stateName === stateName);
                    s.onClick();
                },
            };
            harness.easyButtons.push(btn);
            return btn;
        },
        DomEvent: { disableClickPropagation() {}, disableScrollPropagation() {} },
    };
    return { default: L };
});
vi.mock('leaflet.markercluster', () => ({}));
vi.mock('leaflet-easybutton', () => ({}));
vi.mock('yet-another-react-lightbox', () => ({ default: () => null }));
vi.mock('yet-another-react-lightbox/plugins/video', () => ({ default: {} }));
vi.mock('yet-another-react-lightbox/plugins/zoom', () => ({ default: {} }));

const makeFakeMap = () => ({
    layers: new Set(),
    addLayer(l) { this.layers.add(l); },
    removeLayer(l) { this.layers.delete(l); },
    hasLayer(l) { return this.layers.has(l); },
    on() {}, off() {},
    getSize: () => ({ x: 1280, y: 800 }),
});
let fakeMap;

vi.mock('react-leaflet', () => ({ useMap: () => fakeMap }));

vi.mock('../../photo-browser/handleDB.js', () => ({
    loadIndex: () => {
        harness.loadIndexCalls += 1;
        return Promise.resolve(harness.loadIndexResult);
    },
}));

vi.mock('../../photo-browser/ThumbnailGrid.jsx', () => ({ proxyFileUrl: (p) => p }));

import PhotoMarkerLayer, { gridFitLayout } from '../PhotoMarkerLayer';

// Windows: run 1 [17:00, 18:00], run 2 next day [09:00, 09:40] (UTC).
const RUN_1 = { id: 1, start_time: '2026-03-21T17:00:00', run_time_sec: 3600, stopped_time_sec: 0 };
const RUN_2 = { id: 2, start_time: '2026-03-22T09:00:00', run_time_sec: 1800, stopped_time_sec: 600 };

const photo = (name, dateTaken, gps) => ({
    name, path: `/originals/${name}`, dateTaken,
    ...(gps ? { lat: gps[0], lon: gps[1] } : {}),
});

const P_RUN1_GPS = photo('a1.jpg', '2026-03-21T17:30:00Z', [37.1, -122.1]);
const P_RUN1_NOGPS = photo('b2.jpg', '2026-03-21T17:40:00Z', null);
const P_OUTSIDE = photo('c3.jpg', '2026-03-21T20:00:00Z', [37.2, -122.2]);
const P_RUN2_GPS = photo('d4.jpg', '2026-03-22T09:20:00Z', [38.1, -121.1]);
const INDEX = [P_RUN1_GPS, P_RUN1_NOGPS, P_OUTSIDE, P_RUN2_GPS];

let container;
let root;

const render = (element) => { act(() => root.render(element)); };
const flush = async () => { await act(async () => {}); };

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fakeMap = makeFakeMap();
    harness.clusterGroups.length = 0;
    harness.easyButtons.length = 0;
    harness.loadIndexResult = null;
    harness.loadIndexCalls = 0;
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const markerNames = (group) => group.layers.map(m => {
    for (const item of INDEX) if (m.latlng[0] === item.lat && m.latlng[1] === item.lon) return item.name;
    return '?';
});

describe('PhotoMarkerLayer prop contract (req #3159)', () => {
    it('back-compat: `run` alone loads the index itself and clusters that ride\'s GPS photos', async () => {
        harness.loadIndexResult = INDEX;
        render(<PhotoMarkerLayer run={RUN_1} coordinates={[]} />);
        await flush();
        expect(harness.loadIndexCalls).toBe(1);
        expect(harness.clusterGroups).toHaveLength(1);
        expect(markerNames(harness.clusterGroups[0])).toEqual(['a1.jpg']);
        expect(fakeMap.hasLayer(harness.clusterGroups[0])).toBe(true);
    });

    it('`runs[]` with a parent-supplied index clusters the union and skips the internal load', async () => {
        render(<PhotoMarkerLayer runs={[RUN_1, RUN_2]} coordinates={[]} dedupedIndex={INDEX} />);
        await flush();
        expect(harness.loadIndexCalls).toBe(0);
        expect(harness.clusterGroups).toHaveLength(1);
        expect(markerNames(harness.clusterGroups[0])).toEqual(['a1.jpg', 'd4.jpg']);
    });

    it('an explicit empty `runs` wins over a `run` also passed', async () => {
        render(<PhotoMarkerLayer runs={[]} run={RUN_1} coordinates={[]} dedupedIndex={INDEX} />);
        await flush();
        expect(harness.clusterGroups).toHaveLength(0);
        expect(harness.easyButtons).toHaveLength(0);
    });

    it('a null parent index renders nothing and never falls back to the internal load', async () => {
        render(<PhotoMarkerLayer runs={[RUN_1]} coordinates={[]} dedupedIndex={null} />);
        await flush();
        expect(harness.loadIndexCalls).toBe(0);
        expect(harness.clusterGroups).toHaveLength(0);
    });

    it('does not recompute markers when runs is a new array of identical content', async () => {
        render(<PhotoMarkerLayer runs={[RUN_1]} coordinates={[]} dedupedIndex={INDEX} />);
        await flush();
        expect(harness.clusterGroups).toHaveLength(1);
        render(<PhotoMarkerLayer runs={[{ ...RUN_1 }]} coordinates={[]} dedupedIndex={INDEX} />);
        await flush();
        // Same fingerprint → same gpsPhotos identity → cluster effect not re-run
        expect(harness.clusterGroups).toHaveLength(1);
    });

    it('a filter change while markers are hidden does not re-show them (toggle stays honest)', async () => {
        render(<PhotoMarkerLayer runs={[RUN_1]} coordinates={[]} dedupedIndex={INDEX} />);
        await flush();
        const [group1] = harness.clusterGroups;
        expect(fakeMap.hasLayer(group1)).toBe(true);

        // User hides photos via the toggle
        act(() => harness.easyButtons[0].click('photos-on'));
        expect(fakeMap.hasLayer(group1)).toBe(false);

        // Filter change → new run set → cluster rebuild
        render(<PhotoMarkerLayer runs={[RUN_1, RUN_2]} coordinates={[]} dedupedIndex={INDEX} />);
        await flush();
        const group2 = harness.clusterGroups[harness.clusterGroups.length - 1];
        expect(group2).not.toBe(group1);
        expect(fakeMap.hasLayer(group2)).toBe(false);

        // Show puts the CURRENT group back on the map
        act(() => harness.easyButtons[harness.easyButtons.length - 1].click('photos-off'));
        expect(fakeMap.hasLayer(group2)).toBe(true);
    });

    it('a toggle button recreated while photos are hidden initializes to the hidden state', async () => {
        render(<PhotoMarkerLayer runs={[RUN_1]} coordinates={[]} dedupedIndex={INDEX} />);
        await flush();
        act(() => harness.easyButtons[0].click('photos-on'));

        // Photo set empties (button torn down), then refills (button recreated)
        render(<PhotoMarkerLayer runs={[]} coordinates={[]} dedupedIndex={INDEX} />);
        await flush();
        render(<PhotoMarkerLayer runs={[RUN_1, RUN_2]} coordinates={[]} dedupedIndex={INDEX} />);
        await flush();

        const newButton = harness.easyButtons[harness.easyButtons.length - 1];
        expect(newButton).not.toBe(harness.easyButtons[0]);
        expect(newButton.currentState).toBe('photos-off');
        const group = harness.clusterGroups[harness.clusterGroups.length - 1];
        expect(fakeMap.hasLayer(group)).toBe(false);
    });
});

// The photo-grid fit: pure geometry, exported precisely so the overlay's
// highest-risk logic is reachable without a live Leaflet map. GAP=3,
// thumb range [40, 120], margins 16 + 24 controls bar.
describe('gridFitLayout', () => {
    const GAP = 3;
    const gridW = (r) => r.cols * (r.thumb + GAP) - GAP;
    const gridH = (r, n) => Math.ceil(Math.min(n, r.capacity) / r.cols) * (r.thumb + GAP) - GAP;

    it('always fits the available box from the anchor, capping when it must', () => {
        const cases = [];
        for (const size of [{ x: 400, y: 400 }, { x: 440, y: 400 }, { x: 1280, y: 680 }, { x: 100, y: 80 }]) {
            for (const anchor of [{ x: 16, y: 16 }, { x: size.x / 2 + 16, y: size.y / 2 + 16 }]) {
                for (const n of [0, 1, 4, 12, 100, 5500]) cases.push([n, size, anchor]);
            }
        }
        for (const [n, size, anchor] of cases) {
            const r = gridFitLayout(n, size, anchor);
            const availW = Math.max(80, size.x - anchor.x - 16);
            const availH = Math.max(80, size.y - anchor.y - 40);
            expect(gridW(r)).toBeLessThanOrEqual(availW);
            if (n > 0) expect(gridH(r, n)).toBeLessThanOrEqual(availH);
            expect(r.capacity).toBeLessThanOrEqual(n === 0 ? 0 : Math.max(n, 1));
            expect(r.thumb).toBeGreaterThanOrEqual(40);
            expect(r.thumb).toBeLessThanOrEqual(120);
        }
    });

    it('keeps the 120px default when a small set fits', () => {
        const r = gridFitLayout(4, { x: 1280, y: 680 }, { x: 656, y: 356 });
        expect(r).toEqual({ cols: 4, thumb: 120, capacity: 4 });
    });

    it('caps a huge cluster on a card-sized map and reports honest capacity', () => {
        const r = gridFitLayout(5500, { x: 400, y: 400 }, { x: 216, y: 216 });
        expect(r.thumb).toBe(40);
        expect(r.capacity).toBeLessThan(5500);
        expect(r.capacity).toBe(r.cols * Math.ceil(r.capacity / r.cols));
    });

    it('a favorable (top-left) anchor yields several times the worst-quadrant capacity', () => {
        const size = { x: 400, y: 400 };
        const worst = gridFitLayout(5500, size, { x: 216, y: 216 });
        const best = gridFitLayout(5500, size, { x: 16, y: 16 });
        expect(best.capacity).toBeGreaterThanOrEqual(worst.capacity * 4);
    });

    it('n = 0 returns cleanly', () => {
        const r = gridFitLayout(0, { x: 400, y: 400 }, { x: 16, y: 16 });
        expect(r.capacity).toBe(0);
        expect(r.cols).toBe(1);
    });
});
