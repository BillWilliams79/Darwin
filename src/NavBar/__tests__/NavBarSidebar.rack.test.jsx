// @vitest-environment jsdom
//
// Req #3720 — the navbar is the panel rack's drop zone: it publishes its rack
// slot (below the nav buttons) and width while drawn, and draws the drop zone
// from the drag a rackable panel publishes — dashed while one moves anywhere,
// lit with a placeholder at the landing slot once it is over the navbar.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

vi.mock('../../hooks/useDataQueries', () => ({
    useDevServers: () => ({ data: [] }),
}));
let desktop = true;
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => desktop }));

import NavBarSidebar from '../NavBarSidebar';
import { usePanelRackStore } from '../../stores/usePanelRackStore';
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from '../navConfig';

const renderNav = () => render(
    <AuthContext.Provider value={{ idToken: 't', profile: { userName: 'u', app_swarm: 1 } }}>
        <AppContext.Provider value={{ database: 'darwin_dev' }}>
            <MemoryRouter initialEntries={['/']}>
                <NavBarSidebar />
            </MemoryRouter>
        </AppContext.Provider>
    </AuthContext.Provider>
);

describe('NavBarSidebar panel rack (req #3720)', () => {
    beforeEach(() => {
        desktop = true;
        localStorage.clear();
        usePanelRackStore.setState({ racked: [], slot: null, drag: null });
    });
    afterEach(cleanup);

    it('is the drop zone and publishes its rack slot, below the nav links, at its width', () => {
        renderNav();
        const zone = screen.getByTestId('navbar-rack-zone');
        expect(zone.hasAttribute('data-panel-rack-zone')).toBe(true);
        const { slot } = usePanelRackStore.getState();
        expect(slot.node).toBe(screen.getByTestId('navbar-rack-slot'));
        expect(slot.width).toBe(SIDEBAR_WIDTH);
        // Below the nav buttons: the rack follows the nav list.
        const rack = screen.getByTestId('navbar-rack');
        expect(rack.previousElementSibling.tagName).toBe('UL');
        // Collapsing the sidebar republishes the narrower width.
        fireEvent.click(screen.getByTestId('navbar-collapse-toggle'));
        expect(usePanelRackStore.getState().slot.width).toBe(SIDEBAR_COLLAPSED_WIDTH);
    });

    it('draws the drop zone from the drag: off, armed (dashed), over (lit, with a placeholder)', () => {
        usePanelRackStore.setState({ racked: ['a', 'b'] });
        renderNav();
        const zone = screen.getByTestId('navbar-rack-zone');
        expect(zone.getAttribute('data-rack-drop')).toBe('off');
        expect(screen.queryByTestId('navbar-rack-drop')).toBe(null);

        act(() => usePanelRackStore.getState().setDrag({ id: 'x', over: false, index: null, fromRack: false }));
        expect(zone.getAttribute('data-rack-drop')).toBe('armed');
        expect(getComputedStyle(zone.firstChild).outline).toContain('dashed');
        expect(screen.queryByTestId('navbar-rack-drop')).toBe(null);

        act(() => usePanelRackStore.getState().setDrag({ id: 'x', over: true, index: 1, fromRack: false }));
        expect(zone.getAttribute('data-rack-drop')).toBe('over');
        expect(getComputedStyle(zone.firstChild).outline).toContain('solid');
        const drop = screen.getByTestId('navbar-rack-drop');
        expect(drop.textContent).toBe('Drop to rack');
        // Between a (order 0) and b (order 2).
        expect(getComputedStyle(drop).order).toBe('1');

        act(() => usePanelRackStore.getState().setDrag(null));
        expect(zone.getAttribute('data-rack-drop')).toBe('off');
        expect(screen.queryByTestId('navbar-rack-drop')).toBe(null);
    });

    it('lifts itself above the page while a racked panel is dragged out of it', () => {
        renderNav();
        const zone = screen.getByTestId('navbar-rack-zone');
        act(() => usePanelRackStore.getState().setDrag({ id: 'a', over: false, index: null, fromRack: true }));
        expect(getComputedStyle(zone).zIndex).toBe('1250');
        act(() => usePanelRackStore.getState().setDrag({ id: 'a', over: false, index: null, fromRack: false }));
        expect(getComputedStyle(zone).zIndex).not.toBe('1250');
    });

    it('mobile has no rack: the slot is withdrawn', () => {
        desktop = false;
        renderNav();
        expect(usePanelRackStore.getState().slot).toBe(null);
        expect(screen.queryByTestId('navbar-rack')).toBe(null);
    });

    it('withdraws the slot when the navbar unmounts', () => {
        const { unmount } = renderNav();
        expect(usePanelRackStore.getState().slot).not.toBe(null);
        unmount();
        expect(usePanelRackStore.getState().slot).toBe(null);
    });
});
