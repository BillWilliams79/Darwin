// @vitest-environment jsdom
//
// Req #2651 — useViewPreference: per-tab sessionStorage with localStorage fallback.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useViewPreference } from '../useViewPreference';

// React 18 requires this for act() to work outside a real test renderer.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'darwin-test-view';

// Minimal harness — mount a function component that uses the hook into a
// detached jsdom node and capture each render's [view, setView] tuple.
function mountHook(defaultValue) {
    const renders = [];
    const container = document.createElement('div');
    const root = createRoot(container);
    function Probe() {
        const result = useViewPreference(KEY, defaultValue);
        renders.push(result);
        return null;
    }
    act(() => { root.render(React.createElement(Probe)); });
    return {
        renders,
        getView: () => renders[renders.length - 1][0],
        setView: (v) => act(() => { renders[renders.length - 1][1](v); }),
        unmount: () => act(() => { root.unmount(); }),
    };
}

beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
});

describe('useViewPreference', () => {
    it('returns default when both storages are empty and seeds sessionStorage', () => {
        const h = mountHook('cards');
        expect(h.getView()).toBe('cards');
        expect(sessionStorage.getItem(KEY)).toBe('cards');
        expect(localStorage.getItem(KEY)).toBeNull();
        h.unmount();
    });

    it('reads from localStorage on first mount and seeds sessionStorage', () => {
        localStorage.setItem(KEY, 'visualizer');
        const h = mountHook('cards');
        expect(h.getView()).toBe('visualizer');
        expect(sessionStorage.getItem(KEY)).toBe('visualizer');
        h.unmount();
    });

    it('prefers sessionStorage over localStorage (per-tab persistence)', () => {
        sessionStorage.setItem(KEY, 'table');
        localStorage.setItem(KEY, 'visualizer');
        const h = mountHook('cards');
        expect(h.getView()).toBe('table');
        h.unmount();
    });

    it('setView writes to BOTH sessionStorage and localStorage', () => {
        const h = mountHook('cards');
        h.setView('table');
        expect(h.getView()).toBe('table');
        expect(sessionStorage.getItem(KEY)).toBe('table');
        expect(localStorage.getItem(KEY)).toBe('table');
        h.unmount();
    });

    it('setView(null) is a no-op', () => {
        const h = mountHook('cards');
        const before = h.renders.length;
        h.setView(null);
        // No re-render scheduled — state unchanged.
        expect(h.getView()).toBe('cards');
        expect(h.renders.length).toBe(before);
        h.unmount();
    });

    it('setView(currentValue) does not re-write storage', () => {
        const h = mountHook('cards');
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
        h.setView('cards');
        // No new storage writes for an unchanged value.
        expect(setItemSpy).not.toHaveBeenCalled();
        setItemSpy.mockRestore();
        h.unmount();
    });

    it('survives setItem throwing (Safari private mode / quota)', () => {
        const h = mountHook('cards');
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => { throw new Error('QuotaExceededError'); });
        // Must not throw out of changeView; in-memory state still updates.
        expect(() => h.setView('visualizer')).not.toThrow();
        expect(h.getView()).toBe('visualizer');
        setItemSpy.mockRestore();
        h.unmount();
    });
});
