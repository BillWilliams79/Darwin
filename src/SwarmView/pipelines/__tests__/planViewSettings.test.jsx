// @vitest-environment jsdom
//
// Req #3651 — the plan page's remembered settings are ONE table. A popout set
// once survives the component re-mounting (every transition is a re-mount), its
// default is the table's, and no file spells a setting's storage key but the
// table itself.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { PLAN_VIEW_SETTINGS, usePlanViewSetting } from '../planViewSettings';
import { normalizeEpicTimeMode } from '../planEpicTimes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;
let container = null;
let api = null;

function Probe({ name }) {
    const [value, set] = usePlanViewSetting(name);
    api = { value, set };
    return null;
}

function mount(name) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root.render(<Probe name={name} />); });
}
function unmount() {
    act(() => { root.unmount(); });
    container.remove();
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); api = null; });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('usePlanViewSetting', () => {
    it('opens a flag at its default — hide-closed off, the unseated list open', () => {
        mount('hideClosed');
        expect(api.value).toBe(false);
        unmount();
        mount('unseatedOpen');
        expect(api.value).toBe(true);
        unmount();
    });

    it('opens the epic-card times at time-only (req #3825, #3963) and remembers the date', () => {
        mount('epicTimes');
        expect(api.value).toBe('time');
        act(() => { api.set('date'); });
        unmount();
        mount('epicTimes');
        expect(api.value).toBe('date');
        unmount();
    });

    it('keeps the two-state chip\'s stored choice under the same key (req #3963)', () => {
        localStorage.setItem(PLAN_VIEW_SETTINGS.epicTimes.storageKey, '0');
        mount('epicTimes');
        expect(normalizeEpicTimeMode(api.value)).toBe('off');
        unmount();
    });

    it('a toggled popout is still toggled after the component re-mounts', () => {
        mount('hideClosed');
        act(() => { api.set((v) => !v); });
        expect(api.value).toBe(true);
        unmount();
        mount('hideClosed');                    // Back, a mode switch, a reload: a mount
        expect(api.value).toBe(true);
        act(() => { api.set(false); });
        unmount();
        mount('hideClosed');
        expect(api.value).toBe(false);
        unmount();
    });

    it('two updaters in one batch compose, as they would with useState', () => {
        mount('hideClosed');
        act(() => { api.set((v) => !v); api.set((v) => !v); });
        expect(api.value).toBe(false);
        unmount();
    });

    it('a NEW TAB inherits the last choice (localStorage seeds sessionStorage)', () => {
        mount('showCost');
        act(() => { api.set(true); });
        unmount();
        sessionStorage.clear();
        mount('showCost');
        expect(api.value).toBe(true);
        unmount();
    });

    it('a value setting keeps the storage key it had before the table existed', () => {
        localStorage.setItem('darwin-pipeline-viz-color-key', 'session');
        mount('colorKey');
        expect(api.value).toBe('session');
        unmount();
    });

    it('refuses a name that is not in the table, rather than inventing a key', () => {
        expect(() => mount('nope')).toThrow(/unknown setting/);
        try { root.unmount(); } catch { /* the render threw */ }
        container.remove();
    });
});

describe('THE GUARD — a setting key is spelled in ONE file', () => {
    const SRC = path.resolve(__dirname, '../../..');
    const files = [];
    (function walk(dir) {
        for (const e of readdirSync(dir)) {
            const p = path.join(dir, e);
            if (statSync(p).isDirectory()) { if (e !== '__tests__') walk(p); }
            else if (/\.(jsx?|tsx?)$/.test(e)) files.push(p);
        }
    })(SRC);

    it.each(Object.entries(PLAN_VIEW_SETTINGS))('%s', (_name, def) => {
        const literal = new RegExp(`['"\`]${def.storageKey}['"\`]`);
        const owners = files.filter((f) => literal.test(readFileSync(f, 'utf8')))
            .map((f) => path.relative(SRC, f));
        expect(owners).toEqual([path.join('SwarmView', 'pipelines', 'planViewSettings.js')]);
    });
});
