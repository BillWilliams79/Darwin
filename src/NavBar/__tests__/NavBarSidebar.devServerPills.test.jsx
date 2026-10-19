// @vitest-environment jsdom
//
// Req #3642 — the Dev Servers nav item carries the boxed "+" and, expanded,
// shows one muted pill per running dev server, labelled by port, in port order.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

let devServers = [];
vi.mock('../../hooks/useDataQueries', () => ({
    useDevServers: () => ({ data: devServers }),
    useMachines: () => ({
        data: [{ id: 2, title: 'Mac Mini', platform: 'darwin', closed: 0 }],
    }),
}));
vi.mock('../ProfileDialog', () => ({ default: () => null }));
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => true }));

import NavBarSidebar from '../NavBarSidebar';

const renderSidebar = () => render(
    <AuthContext.Provider value={{ idToken: 't', profile: { userName: 'u', app_swarm: 1 } }}>
        <AppContext.Provider value={{ database: 'darwin_dev' }}>
            <MemoryRouter initialEntries={['/swarm']}>
                <NavBarSidebar />
            </MemoryRouter>
        </AppContext.Provider>
    </AuthContext.Provider>
);

describe('NavBarSidebar — Dev Servers pills (req #3642)', () => {
    beforeEach(() => {
        localStorage.clear();
        // Every group open, whatever the dev-server seed would be.
        localStorage.setItem('darwin-navbar-collapsed-groups', '{}');
        vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel', userAgentData: undefined });
    });
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('has no toggle when no dev server is running', () => {
        devServers = [];
        renderSidebar();
        expect(screen.getByText('Dev Servers')).toBeTruthy();
        expect(screen.queryByTestId('nav-expand-toggle-devservers')).toBeNull();
    });

    it('expands to one pill per dev server, in port order', () => {
        devServers = [
            { id: 7, port: 3002, machine_fk: 2, terminal_number: 3 },
            { id: 5, port: 3000, machine_fk: 2, terminal_number: 1 },
        ];
        renderSidebar();
        const toggle = screen.getByTestId('nav-expand-toggle-devservers');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('nav-pills-devservers')).toBeNull();

        fireEvent.click(toggle);
        const row = screen.getByTestId('nav-pills-devservers');
        const labels = within(row).getAllByTestId(/^nav-dev-server-pill-/).map(p => p.textContent);
        expect(labels).toEqual(['3000', '3002']);
        expect(screen.getByTestId('nav-dev-server-pill-5').getAttribute('href'))
            .toBe('https://localhost:3000');
    });
});
