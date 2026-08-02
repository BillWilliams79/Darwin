// @vitest-environment jsdom
//
// Req #3252 — the LIFECYCLE half of the canvas-camera memory.
//
// `viewportMemory.test.js` pins the storage contract. This pins the three things
// only the hook can get wrong, each of which is silent when it does:
//   · a `record()` with no `commit()` writes NOTHING (the drag that never ends)
//   · unmount commits anyway (the navigation that lands mid-gesture — the main
//     path this feature exists for, not an edge case)
//   · a commit that straddles a geometry change stamps the camera with the
//     geometry it was TAKEN in, not the one that happens to be current

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { useSavedViewport } from '../useSavedViewport';
import { readViewport, viewportStorageKey } from '../../utils/viewportMemory';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = viewportStorageKey('test-canvas', 1);
const FP = '100x100';
const CAM = { x: 5, y: 6, k: 2 };

/** Mount a probe that hands the hook's API back through a mutable box. */
function mount(api, props = { key: KEY, fingerprint: FP }) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    function Probe({ storageKey, fingerprint }) {
        api.current = useSavedViewport(storageKey, fingerprint);
        return null;
    }
    const render = (p) => act(() => {
        root.render(<Probe storageKey={p.key} fingerprint={p.fingerprint} />);
    });
    render(props);
    return {
        rerender: render,
        unmount: () => act(() => root.unmount()),
    };
}

describe('useSavedViewport', () => {
    beforeEach(() => { sessionStorage.clear(); });
    afterEach(() => { sessionStorage.clear(); });

    it('record alone writes nothing; commit writes', () => {
        const api = {};
        const h = mount(api);
        act(() => api.current.record(CAM));
        expect(readViewport(KEY, FP)).toBeNull();
        act(() => api.current.commit());
        expect(readViewport(KEY, FP)).toEqual(CAM);
        h.unmount();
    });

    it('commit with nothing pending is a no-op, not an empty write', () => {
        const api = {};
        const h = mount(api);
        act(() => api.current.commit());
        expect(sessionStorage.getItem(KEY)).toBeNull();
        h.unmount();
    });

    it('only the LAST record of a burst is written — one write per gesture', () => {
        const api = {};
        const h = mount(api);
        act(() => {
            api.current.record({ x: 1, y: 1, k: 1 });
            api.current.record({ x: 2, y: 2, k: 1 });
            api.current.record(CAM);
            api.current.commit();
        });
        expect(readViewport(KEY, FP)).toEqual(CAM);
        h.unmount();
    });

    it('a second commit does not re-write the same camera', () => {
        const api = {};
        const h = mount(api);
        act(() => { api.current.record(CAM); api.current.commit(); });
        sessionStorage.removeItem(KEY);
        act(() => api.current.commit());
        expect(sessionStorage.getItem(KEY)).toBeNull();
        h.unmount();
    });

    // THE MAIN PATH, not an edge case: the reader's last act is a pan and their
    // very next act is a click, so d3 never emits the 'end' that would commit.
    it('unmount commits a pending record', () => {
        const api = {};
        const h = mount(api);
        act(() => api.current.record(CAM));
        expect(readViewport(KEY, FP)).toBeNull();
        h.unmount();
        expect(readViewport(KEY, FP)).toEqual(CAM);
    });

    it('pagehide commits a pending record — reload and tab close never unmount', () => {
        const api = {};
        const h = mount(api);
        act(() => api.current.record(CAM));
        act(() => { window.dispatchEvent(new Event('pagehide')); });
        expect(readViewport(KEY, FP)).toEqual(CAM);
        h.unmount();
    });

    it('stops listening to pagehide after unmount', () => {
        const api = {};
        const h = mount(api);
        const stale = api.current;
        h.unmount();
        sessionStorage.clear();
        act(() => stale.record(CAM));
        window.dispatchEvent(new Event('pagehide'));
        expect(readViewport(KEY, FP)).toBeNull();
    });

    // A transform belongs to the world it was produced in. A commit that lands
    // after a layout toggle — or after an in-place switch from one plan to the
    // next, which the plan page survives without remounting — must not stamp the
    // outgoing camera with the incoming geometry. That is the ONE bad record the
    // fingerprint check cannot catch, because it looks perfectly valid.
    it('commits under the fingerprint the camera was recorded in', () => {
        const api = {};
        const h = mount(api);
        act(() => api.current.record(CAM));
        h.rerender({ key: KEY, fingerprint: 'GEOMETRY-MOVED' });
        act(() => api.current.commit());
        expect(readViewport(KEY, 'GEOMETRY-MOVED')).toBeNull();
        expect(readViewport(KEY, FP)).toEqual(CAM);
        h.unmount();
    });

    it('commits under the key the camera was recorded in', () => {
        const api = {};
        const other = viewportStorageKey('test-canvas', 2);
        const h = mount(api);
        act(() => api.current.record(CAM));
        h.rerender({ key: other, fingerprint: FP });
        act(() => api.current.commit());
        expect(readViewport(other, FP)).toBeNull();
        expect(readViewport(KEY, FP)).toEqual(CAM);
        h.unmount();
    });

    it('read follows the CURRENT key and fingerprint', () => {
        const api = {};
        const h = mount(api);
        act(() => { api.current.record(CAM); api.current.commit(); });
        expect(api.current.read()).toEqual(CAM);
        h.rerender({ key: KEY, fingerprint: 'GEOMETRY-MOVED' });
        expect(api.current.read()).toBeNull();
        h.unmount();
    });

    // A canvas with no identity must not read or write another canvas's camera.
    it('a null key disables persistence in both directions', () => {
        const api = {};
        const h = mount(api, { key: null, fingerprint: FP });
        act(() => { api.current.record(CAM); api.current.commit(); });
        expect(sessionStorage.length).toBe(0);
        expect(api.current.read()).toBeNull();
        h.unmount();
        expect(sessionStorage.length).toBe(0);
    });

    it('clear forgets both the stored camera and a pending one', () => {
        const api = {};
        const h = mount(api);
        act(() => { api.current.record(CAM); api.current.commit(); });
        act(() => { api.current.record({ x: 9, y: 9, k: 9 }); api.current.clear(); });
        expect(api.current.read()).toBeNull();
        h.unmount();
        // The cleared pending record must not be resurrected by the unmount commit.
        expect(readViewport(KEY, FP)).toBeNull();
    });

    // The caller attaches `record`/`commit` inside its d3-zoom effect, so these
    // land in that effect's dependency list. A new identity per render would
    // tear the zoom behaviour down and rebuild it on every pointermove of a drag.
    it('returns a stable API across re-renders, including prop changes', () => {
        const api = {};
        const h = mount(api);
        const first = api.current;
        h.rerender({ key: KEY, fingerprint: FP });
        expect(api.current).toBe(first);
        h.rerender({ key: viewportStorageKey('test-canvas', 2), fingerprint: 'other' });
        expect(api.current).toBe(first);
        h.unmount();
    });
});
