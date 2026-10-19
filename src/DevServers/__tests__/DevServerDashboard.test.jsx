// @vitest-environment jsdom
//
// Req #3643 — the Dev Servers dashboard: a viewport-docked AnchoredPanel listing
// this machine's dev servers. Moving, reshaping and collapsing are the panel's
// and are tested with it (Components/AnchoredPanel/__tests__); this pins what
// the dashboard puts in it.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AuthContext from '../../Context/AuthContext';

let devServers = [];
const MACHINES = [{ id: 2, title: 'Mac Mini', platform: 'darwin', closed: 0 }];
let machines = MACHINES;
let sessionTerms = [];
let reqTitles = [{ id: 3643, title: 'dev servers as dashboard' }];
const titleReads = [];
vi.mock('../../hooks/useDataQueries', () => ({
    useDevServers: () => ({ data: devServers, isLoading: false, isError: false }),
    useMachines: () => ({ data: machines }),
    useDevServerSessionTerminals: () => ({ data: sessionTerms }),
    useDevServerRequirementTitles: (creator, ids) => { titleReads.push(ids); return { data: reqTitles }; },
}));
let mobile = false;
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => mobile }));

import DevServerDashboard from '../DevServerDashboard';
import { useDevServerDashboardStore } from '../../stores/useDevServerDashboardStore';

const renderDash = (profile = { userName: 'u', app_swarm: 1 }) => render(
    <AuthContext.Provider value={{ idToken: 't', profile }}>
        <DevServerDashboard />
    </AuthContext.Provider>
);
const cells = (key) => [...screen.getByTestId(`devserver-dashboard-item-${key}`).children]
    .map(c => c.textContent);

describe('DevServerDashboard (req #3643)', () => {
    beforeEach(() => {
        mobile = false;
        machines = MACHINES;
        reqTitles = [{ id: 3643, title: 'dev servers as dashboard' }];
        titleReads.length = 0;
        sessionTerms = [];
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
        useDevServerDashboardStore.setState({ show: true, open: true, dock: null });
        vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel', userAgentData: undefined });
        devServers = [
            { id: 7, port: 3002, machine_fk: 2, terminal_number: 3, session_fk: 90,
              workspace_path: '/x/sessions/3643-dev-servers-as-dashboard-1' },
            { id: 5, port: 3000, machine_fk: 2, terminal_number: null,
              workspace_path: '/x/primary' },
        ];
    });
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('home: fixed bottom-right, content-sized on both axes, head on top', () => {
        renderDash();
        const box = screen.getByTestId('devserver-dashboard');
        expect(getComputedStyle(box).position).toBe('fixed');
        expect(box.getAttribute('data-dock')).toBe('r16,b16');
        expect(box.firstChild).toBe(screen.getByTestId('devserver-dashboard-header'));
        expect(box.style.width).toBe('max-content');
        expect(box.style.maxWidth).toContain('420px');
        expect(box.style.height).toBe('');
    });

    it('head row: ▾ · count badge · DEV SERVERS title, then × at the far right', () => {
        renderDash();
        const bar = screen.getByTestId('devserver-dashboard-header');
        expect(bar.children[0].getAttribute('data-testid')).toBe('devserver-dashboard-toggle');
        expect(bar.children[1].getAttribute('data-testid')).toBe('devserver-dashboard-count');
        expect(bar.children[2].getAttribute('data-testid')).toBe('devserver-dashboard-title');
        expect(bar.children[3].contains(screen.getByTestId('devserver-dashboard-close'))).toBe(true);
        expect(screen.getByTestId('devserver-dashboard-toggle').textContent).toBe('▾');
        expect(screen.getByTestId('devserver-dashboard-title').textContent).toBe('Dev Servers');
        expect(screen.getByTestId('devserver-dashboard-count').textContent).toBe('2');
    });

    it('rows in port order: bar · port (the link) · terminal · bug # · requirement title, in columns', () => {
        renderDash();
        const items = screen.getAllByTestId(/^devserver-dashboard-item-/);
        expect(items.map(i => i.getAttribute('data-testid')))
            .toEqual(['devserver-dashboard-item-5', 'devserver-dashboard-item-7']);
        expect(items[1].getAttribute('href')).toBe('https://localhost:3002');
        expect(cells(7)).toEqual(['', '3002', 'T3', '#3643', 'dev servers as dashboard']);
        expect(titleReads.at(-1)).toEqual([3643]);
        // An absent terminal or bug # keeps its slot, so the columns hold.
        expect(cells(5)).toEqual(['', '3000', '', '', 'primary']);
    });

    it('at its smallest, a row is just bar, port and terminal', () => {
        useDevServerDashboardStore.setState({ dock: { h: 'r', x: 16, v: 'b', y: 16, w: 140, ht: null } });
        renderDash();
        expect(cells(7)).toEqual(['', '3002', 'T3']);
        expect(cells(5)).toEqual(['', '3000', '']);
    });

    it('shaped wide, T3 spells out as Term 3; shaped narrower keeps T3 (req #3668)', () => {
        useDevServerDashboardStore.setState({ dock: { h: 'r', x: 16, v: 'b', y: 16, w: 400, ht: null } });
        renderDash();
        expect(cells(7)[2]).toBe('Term 3');
        cleanup();
        useDevServerDashboardStore.setState({ dock: { h: 'r', x: 16, v: 'b', y: 16, w: 300, ht: null } });
        renderDash();
        expect(cells(7)[2]).toBe('T3');
    });

    it('the terminal links to its window when the session has a handle here (req #3668)', () => {
        sessionTerms = [{ id: 90, terminal_window_id: 'w-abc', terminal_number: 3, machine_fk: 2,
                          title: 'dev servers as dashboard' }];
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, port: '', assign });
        renderDash();
        const term = screen.getByTestId('devserver-dashboard-term-7');
        expect(term.getAttribute('data-terminal-href'))
            .toMatch(/^darwin-term:\/\/focus\?window=w-abc&session=90/);
        // fireEvent returns false when the click was default-prevented, i.e. the
        // row's own port link was blocked.
        expect(fireEvent.click(term)).toBe(false);
        expect(assign).toHaveBeenCalledTimes(1);
        expect(assign.mock.calls[0][0]).toMatch(/^darwin-term:/);
        // No handle recorded: plain text, no link.
        expect(screen.getByTestId('devserver-dashboard-term-5').getAttribute('data-terminal-href')).toBeNull();
    });

    it('a terminal on another machine, or with no handle, stays plain text', () => {
        sessionTerms = [{ id: 90, terminal_window_id: null, terminal_number: 3, machine_fk: 2 }];
        renderDash();
        expect(screen.getByTestId('devserver-dashboard-term-7').getAttribute('data-terminal-href')).toBeNull();
        cleanup();
        sessionTerms = [{ id: 90, terminal_window_id: 'w-abc', terminal_number: 3, machine_fk: 9 }];
        renderDash();
        expect(screen.getByTestId('devserver-dashboard-term-7').getAttribute('data-terminal-href')).toBeNull();
    });

    it('shaped really narrow, a row drops its bug #', () => {
        useDevServerDashboardStore.setState({ dock: { h: 'r', x: 16, v: 'b', y: 16, w: 200, ht: null } });
        renderDash();
        expect(cells(7)).toEqual(['', '3002', 'T3', 'dev servers as dashboard']);
        cleanup();
        useDevServerDashboardStore.setState({ dock: { h: 'r', x: 16, v: 'b', y: 16, w: 300, ht: null } });
        renderDash();
        expect(cells(7)).toContain('#3643');
    });

    it('until the title arrives (or for a requirement it cannot find) a row shows its task name', () => {
        reqTitles = undefined;
        renderDash();
        expect(cells(7).at(-1)).toBe('dev-servers-as-dashboard-1');
    });

    it('collapsing folds the list up into the head and keeps its corner', () => {
        renderDash();
        const box = screen.getByTestId('devserver-dashboard');
        box.getBoundingClientRect = () => ({ left: 1200, top: 800, width: 384, height: 184,
            right: 1584, bottom: 984 });
        fireEvent.click(screen.getByTestId('devserver-dashboard-toggle'));
        expect(screen.getByTestId('devserver-dashboard-body').getAttribute('data-folded')).toBe('1');
        // Pinned at its top for the fold, then re-docked where it is drawn.
        expect(useDevServerDashboardStore.getState()).toMatchObject({
            open: false, dock: { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null } });
    });

    it('says so when nothing is running', () => {
        devServers = [];
        renderDash();
        expect(screen.getByTestId('devserver-dashboard-empty').textContent).toBe('None running');
    });

    it('is loading, not "None running", until the machines read settles', () => {
        machines = undefined;
        renderDash();
        expect(screen.getByTestId('devserver-dashboard-count').textContent).toBe('…');
        expect(screen.queryByTestId('devserver-dashboard-empty')).toBeNull();
    });

    it('is not drawn logged out, with the Swarm app off, on a phone, or once hidden', () => {
        renderDash(null);
        expect(screen.queryByTestId('devserver-dashboard')).toBeNull();
        cleanup();
        renderDash({ userName: 'u', app_swarm: 0 });
        expect(screen.queryByTestId('devserver-dashboard')).toBeNull();
        cleanup();
        mobile = true;
        renderDash();
        expect(screen.queryByTestId('devserver-dashboard')).toBeNull();
        cleanup();
        mobile = false;
        renderDash();
        fireEvent.click(screen.getByTestId('devserver-dashboard-close'));
        expect(screen.queryByTestId('devserver-dashboard')).toBeNull();
        expect(useDevServerDashboardStore.getState().show).toBe(false);
    });

    it('a stored spot it could not have written falls back to home', () => {
        useDevServerDashboardStore.setState({ dock: { h: 'l', x: 0, v: 't', y: 0, w: 0 } });
        renderDash();
        expect(screen.getByTestId('devserver-dashboard').getAttribute('data-dock')).toBe('r16,b16');
    });
});
