import { describe, it, expect } from 'vitest';

import {
    parseHiddenMachines, toggleHiddenMachine, isMachineHidden, hideMachineReqs, ANY_MACHINE,
    machineChipLabel, orderMachineChips,
} from '../planMachineFilter';
import { orderEpicReqs } from '../pipelinePlanLayout';

describe('planMachineFilter (req #3708)', () => {
    it('parses the stored string into a set of machine ids, ignoring junk', () => {
        expect(parseHiddenMachines('')).toEqual(new Set());
        expect(parseHiddenMachines('2 3')).toEqual(new Set([2, 3]));
        expect(parseHiddenMachines('2 x -1 0 3.5 3')).toEqual(new Set([0, 2, 3]));
        expect(parseHiddenMachines(null)).toEqual(new Set());
    });

    it('toggles a machine in and out, keeping the string canonical', () => {
        expect(toggleHiddenMachine('', 3)).toBe('3');
        expect(toggleHiddenMachine('3', 2)).toBe('2 3');
        expect(toggleHiddenMachine('2 3', 3)).toBe('2');
        expect(toggleHiddenMachine('2', 2)).toBe('');
    });

    it('keeps Any in the same set: id 0 hides requirements pinned to no machine', () => {
        expect(ANY_MACHINE).toBe(0);
        expect(parseHiddenMachines('0 3')).toEqual(new Set([0, 3]));
        expect(toggleHiddenMachine('3', ANY_MACHINE)).toBe('0 3');
        expect(toggleHiddenMachine('0 3', ANY_MACHINE)).toBe('3');
        expect(isMachineHidden(null, new Set([0]))).toBe(true);
        expect(isMachineHidden(undefined, new Set([0]))).toBe(true);
        expect(isMachineHidden(3, new Set([0]))).toBe(false);
    });

    it('does not hide Any-pinned requirements unless Any is deselected', () => {
        const hidden = new Set([2, 3]);
        expect(isMachineHidden(null, hidden)).toBe(false);
        expect(isMachineHidden(undefined, hidden)).toBe(false);
        expect(isMachineHidden(3, hidden)).toBe(true);
        expect(isMachineHidden(4, hidden)).toBe(false);
        expect(isMachineHidden(3, new Set())).toBe(false);
    });

    describe('hideMachineReqs', () => {
        const status = { 1: 'approved', 2: 'development', 3: 'met', 4: 'met', 5: 'approved' };
        const machine = { 1: 2, 2: 3, 3: 3, 4: null, 5: null };
        const ordered = orderEpicReqs([
            { id: 10, reqIds: [1, 2, 3, 4] },
            { id: 11, reqIds: [4, 5] },
            { id: 12, reqIds: [] },
        ], { statusOf: (id) => status[id] });
        const machineOf = (id) => machine[id];

        it('returns the same rows when nothing is deselected', () => {
            expect(hideMachineReqs(ordered, new Set(), machineOf)).toBe(ordered);
        });

        it('drops the deselected machine\'s requirements and shifts the complete line', () => {
            // Row 10 is ordered open [1,2] then closed [3,4]; machine 3 owns 2 and 3.
            expect(ordered[0].reqIds).toEqual([1, 2, 3, 4]);
            expect(ordered[0].reqDoneFrom).toBe(2);
            const out = hideMachineReqs(ordered, new Set([3]), machineOf);
            expect(out[0].reqIds).toEqual([1, 4]);
            expect(out[0].reqDoneFrom).toBe(1);
        });

        it('passes rows with nothing to drop through untouched', () => {
            const out = hideMachineReqs(ordered, new Set([3]), machineOf);
            expect(out[1]).toBe(ordered[1]);
            expect(out[2]).toBe(ordered[2]);
        });

        it('hides Any-pinned requirements when Any is deselected', () => {
            // 4 and 5 are Any; row 10's closed tail is [3,4], row 11 is [4,5].
            const out = hideMachineReqs(ordered, new Set([ANY_MACHINE]), machineOf);
            expect(out[0].reqIds).toEqual([1, 2, 3]);
            expect(out[0].reqDoneFrom).toBe(2);
            expect(out[1].reqIds).toEqual([]);
        });

        it('can empty a row entirely', () => {
            const out = hideMachineReqs(ordered, new Set([2, 3]), machineOf);
            expect(out[0].reqIds).toEqual([4]);
            expect(out[0].reqDoneFrom).toBe(0);
        });
    });
});

describe('chip order and labels (req #3806)', () => {
    const mac = { id: 2, title: 'Mac Mini', platform: 'darwin' };
    const wsl = { id: 3, title: 'MCHP Windows', platform: 'wsl' };

    it('leads with Any, then the current machine, then the rest', () => {
        expect(orderMachineChips([mac, wsl], 3).map((m) => m.id)).toEqual([ANY_MACHINE, 3, 2]);
        expect(orderMachineChips([mac, wsl], 2).map((m) => m.id)).toEqual([ANY_MACHINE, 2, 3]);
    });

    it('keeps dictionary order when the current machine is unknown', () => {
        expect(orderMachineChips([mac, wsl], null).map((m) => m.id)).toEqual([ANY_MACHINE, 2, 3]);
    });

    it('labels the wsl platform "WSL" and any other machine by its title', () => {
        expect(machineChipLabel(wsl)).toBe('WSL');
        expect(machineChipLabel(mac)).toBe('Mac Mini');
    });
});
