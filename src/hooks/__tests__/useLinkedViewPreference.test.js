// @vitest-environment jsdom
//
// Req #4107 — useLinkedViewPreference: `?view=` is a transient, validated
// override of the persisted view preference, re-seeded when the link changes (R9).

import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useLinkedViewPreference } from '../useLinkedViewPreference';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'darwin-test-linked-view';
const VIEWS = ['table', 'stats'];

function mountHook(url) {
    const renders = [];
    function Probe() {
        renders.push(useLinkedViewPreference(KEY, 'table', VIEWS));
        return null;
    }
    const router = createMemoryRouter(
        [{ path: '/swarm/swarm-starts', element: React.createElement(Probe) }],
        { initialEntries: [url] });
    const root = createRoot(document.createElement('div'));
    act(() => { root.render(React.createElement(RouterProvider, { router })); });
    return {
        getView: () => renders[renders.length - 1][0],
        setView: (v) => act(() => { renders[renders.length - 1][1](v); }),
        // In-place navigation: same route, so Probe stays mounted.
        navigate: (to) => act(() => { router.navigate(to); }),
        unmount: () => act(() => { root.unmount(); }),
    };
}

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

describe('useLinkedViewPreference (req #4107)', () => {
    it('no link: the stored preference, else the default', () => {
        const h = mountHook('/swarm/swarm-starts');
        expect(h.getView()).toBe('table');
        h.unmount();
    });

    it('?view=stats opens Stats without persisting it', () => {
        const h = mountHook('/swarm/swarm-starts?view=stats');
        expect(h.getView()).toBe('stats');
        expect(localStorage.getItem(KEY)).not.toBe('stats');
        h.unmount();
    });

    it('an unknown ?view= is ignored', () => {
        localStorage.setItem(KEY, 'stats');
        const h = mountHook('/swarm/swarm-starts?view=bogus');
        expect(h.getView()).toBe('stats');
        h.unmount();
    });

    it('a stored value outside the page views falls back to the default', () => {
        localStorage.setItem(KEY, 'cards');
        const h = mountHook('/swarm/swarm-starts');
        expect(h.getView()).toBe('table');
        h.unmount();
    });

    it('a manual pick clears the override and persists', () => {
        // Stored Stats, linked Table: picking Stats leaves the link inert.
        localStorage.setItem(KEY, 'stats');
        const h = mountHook('/swarm/swarm-starts?view=table');
        expect(h.getView()).toBe('table');
        h.setView('stats');
        expect(h.getView()).toBe('stats');
        h.setView('table');
        expect(h.getView()).toBe('table');
        expect(localStorage.getItem(KEY)).toBe('table');
        h.setView(null);
        expect(h.getView()).toBe('table');
        h.unmount();
    });

    it('in-place navigation follows the link both ways', () => {
        const h = mountHook('/swarm/swarm-starts?view=stats');
        expect(h.getView()).toBe('stats');
        h.navigate('/swarm/swarm-starts');           // sidebar link to the bare route
        expect(h.getView()).toBe('table');
        h.navigate('/swarm/swarm-starts?view=stats'); // Forward to the link
        expect(h.getView()).toBe('stats');
        h.unmount();
    });
});
