import { describe, it, expect } from 'vitest';
import {
    siblingActiveSort,
    STATUS_SORT,
    STATUS_SORT_PROCESS,
    STATUS_SORT_PROCESS_REVERSE,
    siblingProcessSort,
    siblingProcessSortReverse,
} from '../requirementSort';

const r = (id, status, overrides = {}) => ({
    id,
    requirement_status: status,
    completed_at: overrides.completed_at ?? null,
    deferred_at: overrides.deferred_at ?? null,
    started_at: overrides.started_at ?? null,
});

const sortBy = (mode, items) => [...items].sort((a, b) => siblingActiveSort(mode, a, b));

describe('siblingActiveSort', () => {
    it('hand mode: active statuses share one group, ordered by id asc (req #2405)', () => {
        const items = [
            r(10, 'development'),
            r(11, 'authoring'),
            r(12, 'swarm_ready'),
        ];
        const sorted = sortBy('hand', items);
        expect(sorted.map(i => i.id)).toEqual([10, 11, 12]);
    });

    // Regression guard for #2112: status-rank ordering would yield
    // [authoring, swarm_ready, development] = [2, 3, 1]. After req #2405 removed
    // sort_order, the grouped behavior for 'hand' mode falls back to id-ascending
    // (no status rank within the active group, no hand-assigned order).
    it('hand mode: status rank does NOT override id tiebreak within active group', () => {
        const items = [
            r(1, 'development'),
            r(2, 'authoring'),
            r(3, 'swarm_ready'),
        ];
        const sorted = sortBy('hand', items);
        expect(sorted.map(i => i.id)).toEqual([1, 2, 3]);
    });

    it('created mode: active statuses share one group, ordered by id', () => {
        const items = [
            r(30, 'development'),
            r(10, 'approved'),
            r(20, 'swarm_ready'),
        ];
        const sorted = sortBy('created', items);
        expect(sorted.map(i => i.id)).toEqual([10, 20, 30]);
    });

    it('places active ahead of deferred', () => {
        const items = [
            r(1, 'deferred',    { deferred_at: '2026-04-01T00:00:00Z' }),
            r(2, 'development'),
        ];
        const sorted = sortBy('hand', items);
        expect(sorted.map(i => i.id)).toEqual([2, 1]);
    });

    it('places met last, after active and deferred', () => {
        const items = [
            r(1, 'met',       { completed_at: '2026-04-01T00:00:00Z' }),
            r(2, 'deferred',  { deferred_at: '2026-04-01T00:00:00Z' }),
            r(3, 'authoring'),
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

describe('siblingActiveSort — process mode', () => {
    const sortBy = (items) => [...items].sort((a, b) => siblingActiveSort('process', a, b));

    it('STATUS_SORT_PROCESS has correct ranks', () => {
        expect(STATUS_SORT_PROCESS.authoring).toBe(0);
        expect(STATUS_SORT_PROCESS.approved).toBe(1);
        expect(STATUS_SORT_PROCESS.swarm_ready).toBe(2);
        expect(STATUS_SORT_PROCESS.development).toBe(3);
        expect(STATUS_SORT_PROCESS.deferred).toBe(4);
        expect(STATUS_SORT_PROCESS.met).toBe(5);
    });

    it('process order: authoring before approved before swarm_ready before development before deferred before met', () => {
        const items = [
            r(5, 'met',         { completed_at: '2026-04-01T00:00:00Z' }),
            r(4, 'deferred',    { deferred_at:  '2026-04-01T00:00:00Z' }),
            r(3, 'development', { started_at:   '2026-04-01T00:00:00Z' }),
            r(2, 'swarm_ready'),
            r(1, 'approved'),
            r(0, 'authoring'),
        ];
        const sorted = sortBy(items);
        expect(sorted.map(i => i.id)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('development items: oldest started_at first (ascending)', () => {
        const items = [
            r(3, 'development', { started_at: '2026-04-10T00:00:00Z' }),
            r(1, 'development', { started_at: '2026-01-01T00:00:00Z' }),
            r(2, 'development', { started_at: '2026-03-01T00:00:00Z' }),
        ];
        const sorted = sortBy(items);
        expect(sorted.map(i => i.id)).toEqual([1, 2, 3]);
    });

    it('development items: null started_at sorts before items with a date', () => {
        const items = [
            r(2, 'development', { started_at: '2026-04-01T00:00:00Z' }),
            r(1, 'development', { started_at: null }),
        ];
        const sorted = sortBy(items);
        expect(sorted.map(i => i.id)).toEqual([1, 2]);
    });

    it('swarm_ready items: sorted by id asc (req #2405 — sort_order removed)', () => {
        const items = [
            r(12, 'swarm_ready'),
            r(10, 'swarm_ready'),
            r(11, 'swarm_ready'),
        ];
        const sorted = sortBy(items);
        expect(sorted.map(i => i.id)).toEqual([10, 11, 12]);
    });

    it('deferred items: most recently deferred first', () => {
        const items = [
            r(1, 'deferred', { deferred_at: '2026-01-01T00:00:00Z' }),
            r(2, 'deferred', { deferred_at: '2026-04-10T00:00:00Z' }),
            r(3, 'deferred', { deferred_at: '2026-02-15T00:00:00Z' }),
        ];
        const sorted = sortBy(items);
        expect(sorted.map(i => i.id)).toEqual([2, 3, 1]);
    });

    it('met items: most recently completed first', () => {
        const items = [
            r(1, 'met', { completed_at: '2026-01-01T00:00:00Z' }),
            r(2, 'met', { completed_at: '2026-04-10T00:00:00Z' }),
            r(3, 'met', { completed_at: '2026-02-15T00:00:00Z' }),
        ];
        const sorted = sortBy(items);
        expect(sorted.map(i => i.id)).toEqual([2, 3, 1]);
    });

    it('authoring and approved items: oldest id first within each group', () => {
        const items = [
            r(30, 'approved'),
            r(10, 'authoring'),
            r(20, 'authoring'),
            r(40, 'approved'),
        ];
        const sorted = sortBy(items);
        expect(sorted.map(i => i.id)).toEqual([10, 20, 30, 40]);
    });

    it('siblingProcessSort can be called directly', () => {
        const a = r(1, 'authoring');
        const b = r(2, 'met',  { completed_at: '2026-04-01T00:00:00Z' });
        expect(siblingProcessSort(a, b)).toBeLessThan(0);  // authoring before met
    });
});

describe('siblingActiveSort — reverse mode (req #2406)', () => {
    const sortBy = (items) => [...items].sort((a, b) => siblingActiveSort('reverse', a, b));

    it('STATUS_SORT_PROCESS_REVERSE matches the user spec', () => {
        expect(STATUS_SORT_PROCESS_REVERSE).toEqual({
            deferred: 0,
            met: 1,
            development: 2,
            swarm_ready: 3,
            approved: 4,
            authoring: 5,
        });
    });

    it('reverse order: deferred, met, development, swarm_ready, approved, authoring', () => {
        const items = [
            r(0, 'authoring'),
            r(1, 'approved'),
            r(2, 'swarm_ready'),
            r(3, 'development', { started_at: '2026-04-01T00:00:00Z' }),
            r(4, 'deferred',    { deferred_at: '2026-04-01T00:00:00Z' }),
            r(5, 'met',         { completed_at: '2026-04-01T00:00:00Z' }),
        ];
        const sorted = sortBy(items);
        expect(sorted.map(i => i.requirement_status)).toEqual([
            'deferred', 'met', 'development', 'swarm_ready', 'approved', 'authoring',
        ]);
    });

    it('preserves within-group secondary sort (most recently completed met first)', () => {
        const items = [
            r(1, 'met', { completed_at: '2026-01-01T00:00:00Z' }),
            r(2, 'met', { completed_at: '2026-04-10T00:00:00Z' }),
            r(3, 'met', { completed_at: '2026-02-15T00:00:00Z' }),
        ];
        const sorted = sortBy(items);
        expect(sorted.map(i => i.id)).toEqual([2, 3, 1]);
    });

    it('preserves within-group secondary sort (oldest started_at development first)', () => {
        const items = [
            r(3, 'development', { started_at: '2026-04-10T00:00:00Z' }),
            r(1, 'development', { started_at: '2026-01-01T00:00:00Z' }),
            r(2, 'development', { started_at: '2026-03-01T00:00:00Z' }),
        ];
        const sorted = sortBy(items);
        expect(sorted.map(i => i.id)).toEqual([1, 2, 3]);
    });

    it('siblingProcessSortReverse can be called directly', () => {
        const a = r(1, 'authoring');
        const b = r(2, 'met', { completed_at: '2026-04-01T00:00:00Z' });
        expect(siblingProcessSortReverse(a, b)).toBeGreaterThan(0);  // met before authoring in reverse
    });
});
