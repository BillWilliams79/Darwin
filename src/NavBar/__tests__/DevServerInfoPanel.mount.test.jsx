// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://localhost:3000/"}
//
// Req #3727 — the navbar's Dev Server panel: an AnchoredPanel racked in the
// navbar BY DEFAULT (seeded once per browser), floating once the reader takes
// it off the rack, drawn only in a dev build.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

vi.mock('../../hooks/useDataQueries', () => ({
    useDevServers: () => ({ data: [{ port: 3000, terminal_number: 7 }] }),
}));
let desktop = true;
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => desktop }));

import { prodRequirementUrl } from '../../utils/prodUrl';

let DevServerInfoPanel, DEV_INFO_RACK_ID, usePanelRackStore, AuthContext, AppContext;
async function load(mode) {
    vi.resetModules();
    vi.stubEnv('MODE', mode);
    vi.stubEnv('VITE_DEV_REQ_ID', '3727');
    vi.stubEnv('VITE_DEV_REQ_TITLE', 'Dev Server bar dockable');
    ({ default: DevServerInfoPanel, DEV_INFO_RACK_ID } = await import('../DevServerInfoPanel'));
    ({ usePanelRackStore } = await import('../../stores/usePanelRackStore'));
    // resetModules gives the panel fresh context objects: provide those.
    ({ default: AuthContext } = await import('../../Context/AuthContext'));
    ({ default: AppContext } = await import('../../Context/AppContext'));
}

let slotNode;
const renderPanel = (database = 'darwin_dev') => render(
    <AuthContext.Provider value={{ profile: { userName: 'u' } }}>
        <AppContext.Provider value={{ database }}>
            <DevServerInfoPanel />
        </AppContext.Provider>
    </AuthContext.Provider>
);

describe('DevServerInfoPanel (req #3727)', () => {
    beforeEach(() => {
        desktop = true;
        localStorage.clear();
        slotNode = document.createElement('div');
        slotNode.setAttribute('data-testid', 'slot');
        document.body.appendChild(slotNode);
    });
    afterEach(() => { cleanup(); slotNode.remove(); vi.unstubAllEnvs(); });

    it('is racked in the navbar by default, with this server\'s details', async () => {
        await load('development');
        usePanelRackStore.setState({ racked: ['devservers'], seeded: [], slot: { node: slotNode, width: 180 } });
        renderPanel();
        const panel = screen.getByTestId('devserver-info');
        expect(usePanelRackStore.getState().racked).toEqual(['devservers', DEV_INFO_RACK_ID]);
        expect(slotNode.contains(panel)).toBe(true);
        expect(panel.getAttribute('data-racked')).toBe('1');
        expect(screen.getByTestId('devserver-info-title').textContent).toBe('Dev Server');
        expect(screen.getByTestId('devserver-info-port').textContent).toBe('3000');
        expect(screen.getByTestId('navbar-dev-terminal').textContent).toBe('Terminal - 7');
        expect(screen.getByTestId('navbar-dev-database').textContent).toBe('DB - darwin_dev');
        expect(screen.getByTestId('navbar-dev-req-link').textContent).toBe('Req - 3727');
        expect(screen.getByTestId('navbar-dev-req-link').getAttribute('href')).toBe(prodRequirementUrl('3727'));
        expect(screen.getByTestId('navbar-dev-req-title').textContent).toBe('Dev Server bar dockable');
        // req #3739 — the original badge's port line, not just the head badge.
        expect(screen.getByTestId('navbar-dev-port').textContent).toBe('Port - 3000');
    });

    it('floats once taken off the rack, and stays off on the next mount', async () => {
        await load('development');
        usePanelRackStore.setState({ racked: [], seeded: [], slot: { node: slotNode, width: 180 } });
        renderPanel('darwin');
        act(() => usePanelRackStore.getState().unrack(DEV_INFO_RACK_ID));
        let panel = screen.getByTestId('devserver-info');
        expect(slotNode.contains(panel)).toBe(false);
        expect(panel.getAttribute('data-racked')).toBe('0');
        expect(screen.getByTestId('navbar-dev-database').textContent).toBe('DB - darwin (PROD)');
        cleanup();
        renderPanel();
        panel = screen.getByTestId('devserver-info');
        expect(slotNode.contains(panel)).toBe(false);
        expect(usePanelRackStore.getState().racked).toEqual([]);
    });

    it('keeps every field in the icon-only navbar (req #3739)', async () => {
        await load('development');
        usePanelRackStore.setState({ racked: [], seeded: [], slot: { node: slotNode, width: 64 } });
        renderPanel('darwin');
        const compact = screen.getByTestId('devserver-info-compact');
        expect(compact.contains(screen.getByTestId('navbar-dev-terminal'))).toBe(true);
        expect(screen.getByTestId('navbar-dev-terminal').textContent).toBe('T7');
        expect(screen.getByTestId('navbar-dev-database').textContent).toBe('darwin PROD');
        expect(screen.getByTestId('navbar-dev-req-link').textContent).toBe('#3727');
        expect(screen.getByTestId('navbar-dev-req-link').getAttribute('href')).toBe(prodRequirementUrl('3727'));
        expect(screen.getByTestId('navbar-dev-req-title').textContent).toBe('Dev Server bar dockable');
        expect(screen.getByTestId('navbar-dev-port').textContent).toBe(':3000');
        expect(screen.queryByTestId('devserver-info-title')).toBe(null);
        expect(screen.getByTestId('devserver-info-port').textContent).toBe('3000');
    });

    it('is never drawn outside a dev build, nor on mobile', async () => {
        await load('production');
        renderPanel();
        expect(screen.queryByTestId('devserver-info')).toBe(null);
        expect(usePanelRackStore.getState().seeded).toEqual([]);
        cleanup();
        await load('development');
        desktop = false;
        renderPanel();
        expect(screen.queryByTestId('devserver-info')).toBe(null);
    });
});
