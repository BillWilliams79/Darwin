// Req #3556 — selection rules of the Dev Servers machine pill selector.
import { describe, it, expect } from 'vitest';
import {
    buildMachineOptions, effectiveSelection, toggleSelection, filterServersByMachine, machineKeyFor,
} from '../devServerMachineFilter';
import { UNASSIGNED_MACHINE } from '../../SwarmView/machineChipStyles';

const mac = { id: 2, title: 'Mac Mini', hostname: 'mini', platform: 'darwin', closed: 0 };
const win = { id: 3, title: 'MCHP', hostname: 'mchp', platform: 'wsl', closed: 0 };
const old = { id: 4, title: 'Retired', hostname: 'old', platform: 'darwin', closed: 1 };
const machines = [win, mac, old];
const servers = [
    { id: 1, machine_fk: 2 }, { id: 2, machine_fk: 2 }, { id: 3, machine_fk: 3 },
    { id: 4, machine_fk: null }, { id: 5, machine_fk: 4 },
];
const macNav = { platform: 'MacIntel' };
const unknownNav = { platform: 'FreeBSD' };

describe('buildMachineOptions', () => {
    it('one option per open machine sorted by id, with counts; closed machine rows fold into Unassigned', () => {
        expect(buildMachineOptions(machines, servers)).toEqual([
            { value: 2, label: 'Mac Mini', count: 2 },
            { value: 3, label: 'MCHP', count: 1 },
            { value: UNASSIGNED_MACHINE, label: 'Unassigned', count: 2 },
        ]);
    });
    it('omits Unassigned when nothing falls under it, and shows zero-count machines', () => {
        expect(buildMachineOptions(machines, [{ id: 1, machine_fk: 2 }])).toEqual([
            { value: 2, label: 'Mac Mini', count: 1 },
            { value: 3, label: 'MCHP', count: 0 },
        ]);
    });
});

describe('effectiveSelection', () => {
    const vals = [2, 3, UNASSIGNED_MACHINE];
    it('defaults to this browser\'s machine only', () => {
        expect(effectiveSelection(null, machines, vals, macNav)).toEqual([2]);
    });
    it('defaults to every machine when the browser machine cannot be resolved', () => {
        expect(effectiveSelection(null, machines, vals, unknownNav)).toEqual(vals);
    });
    it('an explicit selection (even empty) wins over the default', () => {
        expect(effectiveSelection([3], machines, vals, macNav)).toEqual([3]);
        expect(effectiveSelection([], machines, vals, macNav)).toEqual([]);
    });
});

describe('toggle + filter', () => {
    it('toggles a value in and out', () => {
        expect(toggleSelection([2], 3)).toEqual([2, 3]);
        expect(toggleSelection([2, 3], 2)).toEqual([3]);
    });
    it('filters servers by selection, treating retired/NULL machines as Unassigned', () => {
        const open = [2, 3];
        expect(machineKeyFor(servers[4], open)).toBe(UNASSIGNED_MACHINE);
        expect(filterServersByMachine(servers, [2], open).map(s => s.id)).toEqual([1, 2]);
        expect(filterServersByMachine(servers, [3, UNASSIGNED_MACHINE], open).map(s => s.id)).toEqual([3, 4, 5]);
        expect(filterServersByMachine(servers, [], open)).toEqual([]);
    });
});
