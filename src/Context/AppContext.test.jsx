// @vitest-environment jsdom
//
// Req #2683 — AppContext resolves the active DB name per the dev/prod truth
// table and warns when dev mode is wrong-by-default. Resolution happens at
// module load, so each case uses vi.resetModules() + dynamic import after
// stubbing import.meta.env so the module re-evaluates with the desired env.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function loadAndReadDatabase(envOverrides) {
    vi.resetModules();
    for (const [key, value] of Object.entries(envOverrides)) {
        // Vitest's vi.stubEnv keeps booleans as booleans for DEV/PROD/SSR;
        // VITE_* string values pass through as strings. Mapping undefined to
        // empty string makes import.meta.env.VITE_DARWIN_DATABASE falsy in the
        // same way an unset env var would be at runtime.
        if (value === undefined) {
            vi.stubEnv(key, '');
        } else {
            vi.stubEnv(key, value);
        }
    }
    // Dynamic import so the module sees the stubbed env at evaluation time.
    const mod = await import('./AppContext');
    const { AppContextProvider, default: AppContext, database: exportedDatabase } = mod;

    let captured = null;
    function Probe() {
        const { database } = React.useContext(AppContext);
        captured = database;
        return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
        root.render(React.createElement(AppContextProvider, null, React.createElement(Probe)));
    });
    const fromContext = captured;
    act(() => root.unmount());

    return { fromContext, exported: exportedDatabase };
}

describe('AppContext database resolution (req #2683)', () => {
    let warnSpy;

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
        vi.unstubAllEnvs();
    });

    it('dev mode, no env var → soft-defaults to darwin_dev and warns about the fallback', async () => {
        const { fromContext, exported } = await loadAndReadDatabase({
            DEV: true,
            VITE_DARWIN_DATABASE: undefined,
        });
        expect(fromContext).toBe('darwin_dev');
        expect(exported).toBe('darwin_dev');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toMatch(/VITE_DARWIN_DATABASE unset/);
        expect(warnSpy.mock.calls[0][0]).toMatch(/defaulting to darwin_dev/);
    });

    it('dev mode, explicit darwin_dev → uses darwin_dev with no warning', async () => {
        const { fromContext } = await loadAndReadDatabase({
            DEV: true,
            VITE_DARWIN_DATABASE: 'darwin_dev',
        });
        expect(fromContext).toBe('darwin_dev');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('dev mode, explicit darwin → uses darwin and warns about pointing at production', async () => {
        const { fromContext } = await loadAndReadDatabase({
            DEV: true,
            VITE_DARWIN_DATABASE: 'darwin',
        });
        expect(fromContext).toBe('darwin');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toMatch(/pointing at the production darwin database/);
    });

    it('prod build, no env var → defaults to darwin with no warning', async () => {
        const { fromContext } = await loadAndReadDatabase({
            DEV: false,
            VITE_DARWIN_DATABASE: undefined,
        });
        expect(fromContext).toBe('darwin');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('prod build, explicit darwin_dev → respects the override with no warning', async () => {
        const { fromContext } = await loadAndReadDatabase({
            DEV: false,
            VITE_DARWIN_DATABASE: 'darwin_dev',
        });
        expect(fromContext).toBe('darwin_dev');
        expect(warnSpy).not.toHaveBeenCalled();
    });
});
