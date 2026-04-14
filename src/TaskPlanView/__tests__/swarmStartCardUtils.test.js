import { describe, it, expect } from 'vitest';
import { sortSwarmReadyItems, getCoordLabel } from '../swarmStartCardUtils';

const req = (id, overrides = {}) => ({
    id,
    title: `Requirement ${id}`,
    requirement_status: 'swarm_ready',
    coordination_type: overrides.coordination_type ?? null,
    ...overrides,
});

describe('sortSwarmReadyItems', () => {
    it('sorts by id ascending (chronological)', () => {
        const items = [req(30), req(10), req(20)];
        const sorted = sortSwarmReadyItems(items);
        expect(sorted.map(i => i.id)).toEqual([10, 20, 30]);
    });

    it('returns empty array when input is empty', () => {
        expect(sortSwarmReadyItems([])).toEqual([]);
    });

    it('returns single-element array unchanged', () => {
        const items = [req(42)];
        const sorted = sortSwarmReadyItems(items);
        expect(sorted.map(i => i.id)).toEqual([42]);
    });

    it('does not mutate the original array', () => {
        const items = [req(3), req(1), req(2)];
        const original = [...items];
        sortSwarmReadyItems(items);
        expect(items.map(i => i.id)).toEqual(original.map(i => i.id));
    });

    it('handles already-sorted input', () => {
        const items = [req(1), req(2), req(3)];
        const sorted = sortSwarmReadyItems(items);
        expect(sorted.map(i => i.id)).toEqual([1, 2, 3]);
    });
});

describe('getCoordLabel', () => {
    it('returns Planned for planned', () => {
        expect(getCoordLabel('planned')).toBe('Planned');
    });

    it('returns Implemented for implemented', () => {
        expect(getCoordLabel('implemented')).toBe('Implemented');
    });

    it('returns Deployed for deployed', () => {
        expect(getCoordLabel('deployed')).toBe('Deployed');
    });

    it('returns No coordination for null', () => {
        expect(getCoordLabel(null)).toBe('No coordination');
    });

    it('returns No coordination for undefined', () => {
        expect(getCoordLabel(undefined)).toBe('No coordination');
    });

    it('returns No coordination for unknown value', () => {
        expect(getCoordLabel('unknown')).toBe('No coordination');
    });
});
