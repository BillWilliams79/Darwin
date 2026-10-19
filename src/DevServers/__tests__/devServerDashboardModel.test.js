// Req #3643 — the Dev Servers dashboard's rows and its home.

import { describe, it, expect } from 'vitest';
import {
    DASH_HOME, devServerDashboardRows, withRequirementTitles, workspaceLabel,
} from '../devServerDashboardModel';

const mac = { id: 2, title: 'Mac Mini', platform: 'darwin', closed: 0 };
const win = { id: 3, title: 'MCHP', platform: 'wsl', closed: 0 };
const macNav = { platform: 'MacIntel' };
const unknownNav = { platform: 'FreeBSD' };

const servers = [
    { id: 11, port: 3003, machine_fk: 2, terminal_number: 6,
      workspace_path: '/Users/b/darwin/sessions/3651-pipeline-back-1' },
    { id: 12, port: 3000, machine_fk: 2, terminal_number: null,
      workspace_path: '/Users/b/darwin/primary' },
    { id: 13, port: 3000, machine_fk: 3, terminal_number: null,
      workspace_path: '/home/c/Darwin/DarwinAI-Config' },
];

describe('workspaceLabel', () => {
    it('reads a session directory as its requirement and task name', () => {
        expect(workspaceLabel('/x/sessions/3643-dev-servers-as-dashboard-1'))
            .toEqual({ reqId: 3643, label: 'dev-servers-as-dashboard-1' });
    });
    it('names any other workspace by its directory', () => {
        expect(workspaceLabel('/Users/b/darwin/primary/')).toEqual({ reqId: null, label: 'primary' });
        expect(workspaceLabel('C:\\w\\DarwinAI-Config')).toEqual({ reqId: null, label: 'DarwinAI-Config' });
    });
    it('says — for a claim with no path', () => {
        expect(workspaceLabel(null)).toEqual({ reqId: null, label: '—' });
    });
});

describe('devServerDashboardRows', () => {
    it("lists this machine's servers in port order, with workspace and terminal", () => {
        const rows = devServerDashboardRows(servers, [mac, win], macNav, null);
        expect(rows.map(r => r.key)).toEqual([12, 11]);
        expect(rows[1]).toMatchObject({
            port: 3003, href: 'https://localhost:3003', machineId: 2, terminal: 6,
            reqId: 3651, label: 'pipeline-back-1', current: false,
        });
        expect(rows[1].title).toContain('/Users/b/darwin/sessions/3651-pipeline-back-1');
    });
    it('marks the server this page is served from', () => {
        const rows = devServerDashboardRows(servers, [mac, win], macNav, 3003);
        expect(rows.map(r => r.current)).toEqual([false, true]);
    });
    it('never marks an unlinked row, even on the same port number', () => {
        const rows = devServerDashboardRows(servers, [mac, win], unknownNav, 3000);
        expect(rows).toHaveLength(3);
        expect(rows.every(r => r.href === null && r.current === false)).toBe(true);
    });
    it('has no rows until the machines read settles', () => {
        expect(devServerDashboardRows(servers, undefined, macNav)).toEqual([]);
    });
    it('titles a local row with its link and terminal, and omits a terminal it has none of', () => {
        const rows = devServerDashboardRows(servers, [mac, win], macNav);
        expect(rows[1].title.split('\n')[0]).toBe('Open https://localhost:3003 · Terminal 6');
        expect(rows[0].title.split('\n')[0]).toBe('Open https://localhost:3000');
    });
    it('shows every server, unlinked and naming its machine, when this machine cannot be resolved', () => {
        const rows = devServerDashboardRows(servers, [mac, win], unknownNav);
        expect(rows.map(r => r.key)).toEqual([12, 13, 11]);
        expect(rows[1].title.split('\n')[0]).toBe('Port 3000 on MCHP');
    });
    it('shows every server, unlinked, when the machines read failed (passed as [])', () => {
        const rows = devServerDashboardRows(servers, [], macNav);
        expect(rows).toHaveLength(3);
        expect(rows.every(r => r.href === null)).toBe(true);
        expect(rows[0].title.split('\n')[0]).toBe('Port 3000 on machine 2');
    });
    it('is empty for no servers, and skips rows with no port', () => {
        expect(devServerDashboardRows(undefined, [mac], macNav)).toEqual([]);
        expect(devServerDashboardRows([{ id: 1, port: null, machine_fk: 2 }], [mac], macNav)).toEqual([]);
    });
    it("does not reorder the caller's array", () => {
        const input = [...servers];
        devServerDashboardRows(input, [mac, win], macNav);
        expect(input).toEqual(servers);
    });
});

describe('DASH_HOME', () => {
    it('is content-sized on both axes — the minimum — in the bottom-right corner', () => {
        expect(DASH_HOME).toEqual({ h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null });
    });
});

describe('withRequirementTitles', () => {
    const rows = devServerDashboardRows(servers, [mac, win], macNav, null);
    it("sets a row's description to its requirement's title, keeping the task name in the hover", () => {
        const [primary, session] = withRequirementTitles(rows, [{ id: 3651, title: 'Pipeline back nav' }]);
        expect(session.label).toBe('Pipeline back nav');
        expect(session.title).toContain('pipeline-back-1');
        expect(primary.label).toBe('primary');
    });
    it('keeps the task name until the titles arrive, or for an id they do not have', () => {
        expect(withRequirementTitles(rows, undefined)[1].label).toBe('pipeline-back-1');
        expect(withRequirementTitles(rows, [{ id: 1, title: 'other' }])[1].label).toBe('pipeline-back-1');
    });
});
