// @vitest-environment jsdom
//
// Req #2992 — sessionMachineFilter semantics. Exercises the REAL store action
// (not a simulation) because the null-means-all / collapse-back-to-null
// behavior is the part most likely to regress.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    useShowClosedStore,
    DEFAULT_SESSION_MACHINES,
} from '../useShowClosedStore';

// Machine ids 2 and 3 plus the unassigned sentinel — mirrors the real option
// set built by SessionsView.
const ALL = [2, 3, 'unassigned'];

const filter = () => useShowClosedStore.getState().sessionMachineFilter;
const toggle = (v, all = ALL) => useShowClosedStore.getState().toggleSessionMachine(v, all);

describe('sessionMachineFilter', () => {
    beforeEach(() => {
        useShowClosedStore.setState({ sessionMachineFilter: DEFAULT_SESSION_MACHINES });
    });

    it('defaults to null, meaning all machines', () => {
        expect(DEFAULT_SESSION_MACHINES).toBeNull();
        expect(filter()).toBeNull();
    });

    it('materializes the full set minus the toggled value when starting from null', () => {
        toggle(2);
        expect(filter()).toEqual([3, 'unassigned']);
    });

    it('removes a second value from an already-materialized filter', () => {
        toggle(2);
        toggle('unassigned');
        expect(filter()).toEqual([3]);
    });

    it('adds a value back', () => {
        toggle(2);
        toggle(3);
        expect(filter()).toEqual(['unassigned']);
        toggle(3);
        expect(filter()).toEqual(['unassigned', 3]);
    });

    it('collapses back to null once every known value is selected again', () => {
        toggle(2);
        expect(filter()).not.toBeNull();
        toggle(2);
        // Re-selecting the last missing value restores "all", so machines
        // registered later stay visible by default.
        expect(filter()).toBeNull();
    });

    it('allows deselecting everything — an empty filter is legal, not auto-corrected', () => {
        toggle(2);
        toggle(3);
        toggle('unassigned');
        expect(filter()).toEqual([]);
    });

    it('does not collapse to null when allValues is empty', () => {
        // Guards against the machines query being empty/in-flight: with no
        // known options, "every option is selected" is vacuously true and
        // would wrongly reset a deliberate selection.
        useShowClosedStore.setState({ sessionMachineFilter: [2] });
        toggle(3, []);
        expect(filter()).toEqual([2, 3]);
    });

    it('keeps a selection that omits a machine unknown to allValues', () => {
        useShowClosedStore.setState({ sessionMachineFilter: [2] });
        toggle('unassigned', ALL);
        expect(filter()).toEqual([2, 'unassigned']);
        expect(filter()).not.toBeNull();
    });

    it('is independent of the status filter', () => {
        const statusBefore = useShowClosedStore.getState().sessionStatusFilter;
        toggle(2);
        expect(useShowClosedStore.getState().sessionStatusFilter).toEqual(statusBefore);
    });
});
