// @vitest-environment jsdom
//
// Req #3101, finding 3c — the defect this hook exists to fix is invisible in
// isolation and every one of its four cases is a one-liner, which is exactly why
// it survived a code review as "cosmetic only" and shipped twice.
//
// Both registry pages held `useState(() => new Set())` and add/delete'd a row id
// around each queued membership write. A Set answers "busy?" with a BOOLEAN, and a
// boolean cannot be released twice — so TWO writes queued against the SAME row
// shared one flag and the first to finish cleared it while the second was still in
// flight. The card stopped spinning and re-enabled its ghost chips mid-write.
//
// The old behaviour passes every test that only ever marks one write per row,
// which is the shape every existing test happens to have.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { useBusyCounts } from '../useBusyCounts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Mount a probe that hands the hook's API back through a mutable box. */
function mount(api) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let renders = 0;
    function Probe() {
        api.current = useBusyCounts();
        renders += 1;
        return null;
    }
    act(() => root.render(<Probe />));
    return {
        renderCount: () => renders,
        unmount: () => { act(() => root.unmount()); host.remove(); },
    };
}

describe('useBusyCounts', () => {
    it('starts idle for every row', () => {
        const api = {};
        const h = mount(api);
        expect(api.current.isBusy(1)).toBe(false);
        expect(api.current.isBusy('anything')).toBe(false);
        h.unmount();
    });

    it('marks and releases one write', () => {
        const api = {};
        const h = mount(api);
        act(() => api.current.mark(1, true));
        expect(api.current.isBusy(1)).toBe(true);
        act(() => api.current.mark(1, false));
        expect(api.current.isBusy(1)).toBe(false);
        h.unmount();
    });

    it('STAYS BUSY when the first of two writes on the SAME row finishes', () => {
        // THE DEFECT. With a Set, the release below cleared the only flag and the
        // card reported itself idle with a write still in flight.
        const api = {};
        const h = mount(api);
        act(() => { api.current.mark(1, true); api.current.mark(1, true); });
        expect(api.current.isBusy(1)).toBe(true);

        act(() => api.current.mark(1, false));
        expect(api.current.isBusy(1)).toBe(true);      // second write still running

        act(() => api.current.mark(1, false));
        expect(api.current.isBusy(1)).toBe(false);
        h.unmount();
    });

    it('keeps two rows independent — the reason it was a Set and not one id', () => {
        const api = {};
        const h = mount(api);
        act(() => { api.current.mark(1, true); api.current.mark(2, true); });
        act(() => api.current.mark(1, false));
        expect(api.current.isBusy(1)).toBe(false);
        expect(api.current.isBusy(2)).toBe(true);
        h.unmount();
    });

    it('does not go negative on an unbalanced release', () => {
        // A clamp rather than a stored negative: a deficit would silently suppress
        // the spinner on every LATER write against that row.
        const api = {};
        const h = mount(api);
        act(() => { api.current.mark(1, false); api.current.mark(1, false); });
        expect(api.current.isBusy(1)).toBe(false);
        act(() => api.current.mark(1, true));
        expect(api.current.isBusy(1)).toBe(true);
        h.unmount();
    });

    it('forgets a row once it returns to idle, rather than growing forever', () => {
        const api = {};
        const h = mount(api);
        act(() => api.current.mark(7, true));
        expect(api.current.counts.has(7)).toBe(true);
        act(() => api.current.mark(7, false));
        expect(api.current.counts.has(7)).toBe(false);
        h.unmount();
    });

    it('does not re-render when a release finds nothing to release', () => {
        // The state updater returns the SAME Map, so React bails out. Without it a
        // no-op release would churn every consumer memoized on `isBusy`.
        const api = {};
        const h = mount(api);
        const before = h.renderCount();
        act(() => api.current.mark(99, false));
        expect(h.renderCount()).toBe(before);
        h.unmount();
    });

    it('keeps `mark` stable across renders so callers may hold it', () => {
        const api = {};
        const h = mount(api);
        const first = api.current.mark;
        act(() => api.current.mark(1, true));
        expect(api.current.mark).toBe(first);
        h.unmount();
    });

    it('gives `isBusy` a NEW identity whenever some row moved', () => {
        // InstructionsTableView memoizes its grid rows on this function, so an
        // identity that never changed would freeze every row's spinner.
        const api = {};
        const h = mount(api);
        const first = api.current.isBusy;
        act(() => api.current.mark(1, true));
        expect(api.current.isBusy).not.toBe(first);
        h.unmount();
    });
});
