// @vitest-environment jsdom
//
// Req #3556 — the pill selector on the Dev Servers page: default is this
// browser's machine only, pills carry per-machine counts, toggling reveals more.
import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const machines = [
    { id: 2, title: 'Mac Mini', hostname: 'mini', platform: 'darwin', closed: 0 },
    { id: 3, title: 'MCHP', hostname: 'mchp', platform: 'wsl', closed: 0 },
];
const servers = [
    { id: 11, port: 3000, machine_fk: 2 }, { id: 12, port: 3001, machine_fk: 2 },
    { id: 13, port: 3000, machine_fk: 3 },
];

vi.mock('../../hooks/useDataQueries', () => ({
    useDevServers: () => ({ data: servers }),
    useSessions: () => ({ data: [] }),
    useAllRequirements: () => ({ data: [] }),
    useMachines: () => ({ data: machines }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));
vi.mock('@mui/x-data-grid', () => ({
    GridToolbar: () => null,
    DataGrid: ({ rows }) => <div data-testid="grid">{rows.map(r => <span key={r.id} data-testid="row">{r.id}</span>)}</div>,
}));

import DevServersView from '../DevServersView';

const rowIds = () => screen.getAllByTestId('row').map(n => n.textContent);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('DevServersView machine pills', () => {
    it('defaults to this machine only and shows per-machine counts', () => {
        vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
        render(<DevServersView />);
        expect(rowIds()).toEqual(['11', '12']);
        expect(screen.getByTestId('dev-server-machine-badge-2').textContent).toContain('2');
        expect(screen.getByTestId('dev-server-machine-badge-3').textContent).toContain('1');
    });

    it('toggling another machine pill adds its servers; deselecting removes', () => {
        vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
        render(<DevServersView />);
        fireEvent.click(screen.getByTestId('dev-server-machine-chip-3'));
        expect(rowIds().sort()).toEqual(['11', '12', '13']);
        fireEvent.click(screen.getByTestId('dev-server-machine-chip-2'));
        expect(rowIds()).toEqual(['13']);
    });

    it('shows every machine when the browser machine cannot be resolved', () => {
        vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('FreeBSD');
        render(<DevServersView />);
        expect(rowIds().sort()).toEqual(['11', '12', '13']);
    });
});

// Req #3643 — the page's Dashboard chip shows and hides the viewport-docked
// Dev Servers dashboard; it is the way back after the dashboard's own ×.
describe('DevServersView dashboard chip', () => {
    it('toggles the dashboard and says which way it is', async () => {
        const { useDevServerDashboardStore } = await import('../../stores/useDevServerDashboardStore');
        useDevServerDashboardStore.setState({ show: false });
        render(<DevServersView />);
        const chip = screen.getByTestId('dev-servers-page-dashboard-chip');
        expect(chip.textContent).toBe('Show dashboard');
        expect(chip.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(chip);
        expect(useDevServerDashboardStore.getState().show).toBe(true);
        expect(screen.getByTestId('dev-servers-page-dashboard-chip').getAttribute('aria-pressed')).toBe('true');
    });
});
