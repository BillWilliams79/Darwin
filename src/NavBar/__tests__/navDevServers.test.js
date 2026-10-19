// Req #3642 — the Dev Servers nav item's pills: one per running dev server,
// labelled by port, in port order, scoped to this browser's machine.

import { describe, it, expect } from 'vitest';
import { devServerNavPills } from '../navDevServers';
import { NAV_LINKS } from '../navConfig';

const mac = { id: 2, title: 'Mac Mini', hostname: 'mini', platform: 'darwin', closed: 0 };
const win = { id: 3, title: 'MCHP', hostname: 'mchp', platform: 'wsl', closed: 0 };
const macNav = { platform: 'MacIntel' };
const unknownNav = { platform: 'FreeBSD' };

const servers = [
    { id: 11, port: 3003, machine_fk: 2, terminal_number: 4 },
    { id: 12, port: 3000, machine_fk: 2, terminal_number: 1 },
    { id: 13, port: 3001, machine_fk: 3, terminal_number: 2 },
    { id: 14, port: 3001, machine_fk: 2, terminal_number: null },
];

describe('devServerNavPills', () => {
    it('labels each pill with its port, in port order, on this machine only', () => {
        const pills = devServerNavPills(servers, [mac, win], macNav);
        expect(pills.map(p => p.label)).toEqual(['3000', '3001', '3003']);
        expect(pills.map(p => p.key)).toEqual([12, 14, 11]);
    });

    it('links a local pill to its localhost port and names the terminal', () => {
        const [first] = devServerNavPills(servers, [mac, win], macNav);
        expect(first.href).toBe('https://localhost:3000');
        expect(first.title).toBe('Open https://localhost:3000 · Terminal 1');
    });

    it('omits the terminal from the title when the claim has none', () => {
        const pill = devServerNavPills(servers, [mac, win], macNav).find(p => p.key === 14);
        expect(pill.title).toBe('Open https://localhost:3001');
    });

    it('shows every server, unlinked, when this machine cannot be resolved', () => {
        const pills = devServerNavPills(servers, [mac, win], unknownNav);
        expect(pills.map(p => `${p.label}@${p.key}`)).toEqual(['3000@12', '3001@14', '3001@13', '3003@11']);
        expect(pills.every(p => p.href === null)).toBe(true);
        expect(pills[0].title).toBe('Port 3000 on Mac Mini · Terminal 1');
        expect(pills[2].title).toBe('Port 3001 on MCHP · Terminal 2');
    });

    it('shows every server, unlinked, when the machines read failed (passed as [])', () => {
        const pills = devServerNavPills(servers, [], macNav);
        expect(pills).toHaveLength(4);
        expect(pills.every(p => p.href === null)).toBe(true);
        expect(pills[0].title).toBe('Port 3000 on machine 2 · Terminal 1');
    });

    it('shows no pills while machines are still loading', () => {
        expect(devServerNavPills(servers, undefined, macNav)).toEqual([]);
    });

    it('is empty for no servers, and skips rows with no port', () => {
        expect(devServerNavPills(undefined, [mac], macNav)).toEqual([]);
        expect(devServerNavPills([{ id: 1, port: null, machine_fk: 2 }], [mac], macNav)).toEqual([]);
    });

    it('does not reorder the caller\'s array', () => {
        const input = [...servers];
        devServerNavPills(input, [mac, win], macNav);
        expect(input).toEqual(servers);
    });
});

describe('navConfig — Dev Servers expands to pills (req #3642)', () => {
    it('declares the devServers pill source and no L3 children', () => {
        const link = NAV_LINKS.find(l => l.path === '/devservers');
        expect(link.pills).toBe('devServers');
        expect(link.children).toBeUndefined();
    });
});
