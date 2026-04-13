import { describe, it, expect } from 'vitest';
import { siblingActiveSort, STATUS_SORT } from '../requirementSort';

const r = (id, status, overrides = {}) => ({
    id,
    requirement_status: status,
    sort_order: overrides.sort_order ?? null,
    completed_at: overrides.completed_at ?? null,
    deferred_at: overrides.deferred_at ?? null,
});

const sortBy = (mode, items) => [...items].sort((a, b) => siblingActiveSort(mode, a, b));

describe('siblingActiveSort', () => {
    it('hand mode: active statuses share one group, ordered by sort_order', () => {
        const items = [
            r(10, 'development', { sort_order: 2 }),
            r(11, 'authoring',   { sort_order: 0 }),
            r(12, 'swarm_ready', { sort_order: 1 }),
        ];
        const sorted = sortBy('hand', items);
        expect(sorted.map(i => i.id)).toEqual([11, 12, 10]);
    });

    // Regression guard for #2112: status-rank ordering would yield
    // [authoring, swarm_ready, development] = [2, 3, 1], but the correct
    // (grouped) behavior is hand sort by sort_order = [1, 2, 3].
    it('hand mode: status rank does NOT override sort_order within active group', () => {
        const items = [
            r(1, 'development', { sort_order: 0 }),
            r(2, 'authoring',   { sort_order: 1 }),
            r(3, 'swarm_ready', { sort_order: 2 }),
        ];
        const sorted = sortBy('hand', items);
        expect(sorted.map(i => i.id)).toEqual([1, 2, 3]);
    });

    it('created mode: active statuses share one group, ordered by id', () => {
        const items = [
            r(30, 'development', { sort_order: 0 }),
            r(10, 'approved',    { sort_order: 99 }),
            r(20, 'swarm_ready', { sort_order: 50 }),
        ];
        const sorted = sortBy('created', items);
        expect(sorted.map(i => i.id)).toEqual([10, 20, 30]);
    });

    it('places active ahead of deferred', () => {
        const items = [
            r(1, 'deferred',    { sort_order: 0, deferred_at: '2026-04-01T00:00:00Z' }),
            r(2, 'development', { sort_order: 5 }),
        ];
        const sorted = sortBy('hand', items);
        expect(sorted.map(i => i.id)).toEqual([2, 1]);
    });

    it('places met last, after active and deferred', () => {
        const items = [
            r(1, 'met',         { sort_order: 0, completed_at: '2026-04-01T00:00:00Z' }),
            r(2, 'deferred',    { sort_order: 1, deferred_at: '2026-04-01T00:00:00Z' }),
            r(3, 'authoring',   { sort_order: 2 }),
        ];
        const sorted = sortBy('hand', items);
        expect(sorted.map(i => i.id)).toEqual([3, 2, 1]);
    });

    it('met: most recently completed appears first within the met group', () => {
        const items = [
            r(1, 'met', { completed_at: '2026-01-01T00:00:00Z' }),
            r(2, 'met', { completed_at: '2026-04-10T00:00:00Z' }),
            r(3, 'met', { completed_at: '2026-02-15T00:00:00Z' }),
        ];
        const sorted = sortBy('hand', items);
        expect(sorted.map(i => i.id)).toEqual([2, 3, 1]);
    });

    it('STATUS_SORT groups authoring/approved/swarm_ready/development together', () => {
        expect(STATUS_SORT.authoring).toBe(0);
        expect(STATUS_SORT.approved).toBe(0);
        expect(STATUS_SORT.swarm_ready).toBe(0);
        expect(STATUS_SORT.development).toBe(0);
        expect(STATUS_SORT.deferred).toBe(1);
        expect(STATUS_SORT.met).toBe(2);
    });
});
