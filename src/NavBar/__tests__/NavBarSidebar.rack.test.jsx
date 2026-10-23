// @vitest-environment jsdom
//
// Req #3720 — the navbar is the panel rack's drop zone: it publishes its rack
// slot (below the nav buttons) and width while drawn. A rackable panel's drag
// leaves it untouched until the panel is over it; then its edges glow
// in the panel's frame colour — no text, no landing zone, no outline (req #3728).

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

const renderNav = (entry = '/') => render(
    <AuthContext.Provider value={{ idToken: 't', profile: { userName: 'u', app_swarm: 1 } }}>
        <AppContext.Provider value={{ database: 'darwin_dev' }}>
            <MemoryRouter initialEntries={[entry]}>
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

    it('?rack= lands with the named popups docked, in that order, after the ones already there (req #3821)', () => {
        usePanelRackStore.setState({ racked: ['devserver-info', 'active'] });
        renderNav('/swarm?rack=devservers, active,,orchestrables');
        expect(usePanelRackStore.getState().racked)
            .toEqual(['devserver-info', 'devservers', 'active', 'orchestrables']);
    });

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
        // Each racked panel is a grid row sized to its content, never
        // stretched to fill the navbar (req #3747).
        const cs = getComputedStyle(rack);
        expect(cs.display).toBe('grid');
        expect(cs.gridAutoRows).toBe('minmax(auto, max-content)');
        expect(cs.alignContent).toBe('start');
        // Collapsing the sidebar republishes the narrower width.
        fireEvent.click(screen.getByTestId('navbar-collapse-toggle'));
        expect(usePanelRackStore.getState().slot.width).toBe(SIDEBAR_COLLAPSED_WIDTH);
    });

    it('gives the nav list all the height it wants, open racked panel or not; the rack takes the rest (req #3751)', () => {
        usePanelRackStore.setState({ racked: ['a'] });
        renderNav();
        const list = screen.getByTestId('navbar-nav-list');
        const rack = screen.getByTestId('navbar-rack');
        const slot = screen.getByTestId('navbar-rack-slot');
        const check = () => {
            const ls = getComputedStyle(list);
            // Never shrunk, never capped, never scrolled on the rack's account.
            expect(ls.flexShrink).toBe('0');
            expect(['', 'none']).toContain(ls.maxHeight);
            expect(ls.overflowY).not.toBe('auto');
            // The rack alone gives way, down to nothing.
            const rs = getComputedStyle(rack);
            expect(rs.flexShrink).toBe('1');
            expect(['', 'none']).toContain(rs.maxHeight);
            expect(parseFloat(rs.minHeight)).toBe(0);
        };
        check();
        // An open racked panel changes nothing about the nav list.
        const open = document.createElement('div');
        open.setAttribute('data-rack-id', 'a');
        open.setAttribute('data-rack-open', '1');
        act(() => { slot.appendChild(open); });
        check();
        // Nav list and rack share one column below the header.
        expect(list.parentElement).toBe(screen.getByTestId('navbar-body'));
        expect(rack.parentElement).toBe(screen.getByTestId('navbar-body'));
    });

    it('is untouched by a drag until the panel is over it, then only glows in its frame colour (req #3728)', () => {
        usePanelRackStore.setState({ racked: ['a', 'b'] });
        renderNav();
        const zone = screen.getByTestId('navbar-rack-zone');
        const look = () => {
            const cs = getComputedStyle(zone.firstChild);
            return { outline: cs.outline, bg: cs.backgroundColor, glow: cs.boxShadow };
        };
        expect(zone.getAttribute('data-rack-drop')).toBe('off');
        const idle = look();
        const idleText = zone.textContent;

        // Moving anywhere: the navbar does not change in any way.
        act(() => usePanelRackStore.getState().setDrag({ id: 'x', over: false, index: null, fromRack: false, color: '#123456' }));
        expect(zone.getAttribute('data-rack-drop')).toBe('armed');
        expect(look()).toEqual(idle);

        // Over it: no text, no landing zone, no outline or background change —
        // a glow in the dragged panel's frame colour, and nothing else.
        act(() => usePanelRackStore.getState().setDrag({ id: 'x', over: true, index: 1, fromRack: false, color: '#123456' }));
        expect(zone.getAttribute('data-rack-drop')).toBe('over');
        const over = look();
        expect(over.outline).toBe(idle.outline);
        expect(over.bg).toBe(idle.bg);
        expect(over.glow).toContain('#123456');
        expect(zone.textContent).toBe(idleText);
        expect(screen.queryByTestId('navbar-rack-drop')).toBe(null);

        act(() => usePanelRackStore.getState().setDrag(null));
        expect(zone.getAttribute('data-rack-drop')).toBe('off');
        expect(look()).toEqual(idle);
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
