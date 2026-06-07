import { describe, it, expect } from 'vitest';
import {
    processSort,
    processSortReverse,
    requirementHandSort,
    STATUS_SORT_PROCESS_REVERSE,
} from '../processSort';

const req = (id, overrides = {}) => ({
    id,
    category_fk: overrides.category_fk ?? 1,
    requirement_status: overrides.requirement_status ?? 'authoring',
    started_at: overrides.started_at ?? null,
    deferred_at: overrides.deferred_at ?? null,
    completed_at: overrides.completed_at ?? null,
    ...overrides,
});

describe('processSort (sanity — imported)', () => {
    it('is a callable comparator', () => {
        expect(typeof processSort).toBe('function');
        const a = req(1, { requirement_status: 'authoring' });
        const b = req(2, { requirement_status: 'approved' });
        expect(processSort(a, b)).toBeLessThan(0);
    });
});

describe('STATUS_SORT_PROCESS_REVERSE', () => {
    it('matches the req #2406 user-specified literal order', () => {
        // deferred, met, development, swarm_ready, approved, authoring
        expect(STATUS_SORT_PROCESS_REVERSE).toEqual({
            deferred: 0,
            met: 1,
            development: 2,
            swarm_ready: 3,
            approved: 4,
            authoring: 5,
        });
    });
});

describe('requirementHandSort (req #2417 — restored)', () => {
    it('orders by sort_order ASC when both rows have a value', () => {
        const a = req(10, { sort_order: 5 });
        const b = req(20, { sort_order: 2 });
        expect(requirementHandSort(a, b)).toBeGreaterThan(0);
        expect(requirementHandSort(b, a)).toBeLessThan(0);
    });

    it('puts NULL/undefined sort_order at the end (treats NULL as +Infinity)', () => {
        const ranked = req(10, { sort_order: 0 });
        const unrankedNull = req(20, { sort_order: null });
        const unrankedUndef = req(30); // sort_order omitted

        expect(requirementHandSort(ranked, unrankedNull)).toBeLessThan(0);
        expect(requirementHandSort(unrankedNull, ranked)).toBeGreaterThan(0);
        expect(requirementHandSort(ranked, unrankedUndef)).toBeLessThan(0);
    });

    it('falls back to id ASC when both rows are unranked (NULL == NULL)', () => {
        const a = req(20, { sort_order: null });
        const b = req(10, { sort_order: null });
        // both NULL → tiebreak by id
        expect(requirementHandSort(a, b)).toBeGreaterThan(0);
        expect(requirementHandSort(b, a)).toBeLessThan(0);
    });

    it('falls back to id ASC when sort_order is equal', () => {
        const a = req(20, { sort_order: 3 });
        const b = req(10, { sort_order: 3 });
        expect(requirementHandSort(a, b)).toBeGreaterThan(0);
        expect(requirementHandSort(b, a)).toBeLessThan(0);
    });

    it('always sorts the template row (id === "") last', () => {
        const template = { id: '', sort_order: 0 };
        const real = req(50, { sort_order: 99 });
        expect(requirementHandSort(template, real)).toBeGreaterThan(0);
        expect(requirementHandSort(real, template)).toBeLessThan(0);
    });

    it('produces a stable sort when applied to a typical mixed array', () => {
        const requirements = [
            req(30, { sort_order: 2 }),
            req(10, { sort_order: 0 }),
            req(40, { sort_order: null }),  // unranked → end
            req(20, { sort_order: 1 }),
            { id: '' },                      // template → very end
            req(50, { sort_order: null }),   // unranked, larger id → after 40
        ];
        const sorted = [...requirements].sort(requirementHandSort);
        expect(sorted.map(r => r.id)).toEqual([10, 20, 30, 40, 50, '']);
    });
});

describe('processSortReverse', () => {
    it('orders six statuses per the user spec: deferred, met, development, swarm_ready, approved, authoring', () => {
        const requirements = [
            req(1, { requirement_status: 'authoring' }),
            req(2, { requirement_status: 'approved' }),
            req(3, { requirement_status: 'swarm_ready' }),
            req(4, { requirement_status: 'development', started_at: '2026-04-15T10:00:00Z' }),
            req(5, { requirement_status: 'deferred', deferred_at: '2026-04-15T10:00:00Z' }),
            req(6, { requirement_status: 'met', completed_at: '2026-04-15T10:00:00Z' }),
        ];
        const sorted = [...requirements].sort(processSortReverse);
        expect(sorted.map(r => r.requirement_status)).toEqual([
            'deferred', 'met', 'development', 'swarm_ready', 'approved', 'authoring',
        ]);
    });

    it('preserves within-group secondary sort — met ordered by most recently completed', () => {
        const requirements = [
            req(10, { requirement_status: 'met', completed_at: '2026-04-10T10:00:00Z' }),
            req(20, { requirement_status: 'met', completed_at: '2026-04-17T10:00:00Z' }),
            req(30, { requirement_status: 'met', completed_at: '2026-04-12T10:00:00Z' }),
        ];
        const sorted = [...requirements].sort(processSortReverse);
        // most recently completed first (same as processSort)
        expect(sorted.map(r => r.id)).toEqual([20, 30, 10]);
    });

    it('preserves within-group secondary sort — deferred ordered by most recently deferred', () => {
        const requirements = [
            req(10, { requirement_status: 'deferred', deferred_at: '2026-04-10T10:00:00Z' }),
            req(20, { requirement_status: 'deferred', deferred_at: '2026-04-17T10:00:00Z' }),
            req(30, { requirement_status: 'deferred', deferred_at: '2026-04-12T10:00:00Z' }),
        ];
        const sorted = [...requirements].sort(processSortReverse);
        expect(sorted.map(r => r.id)).toEqual([20, 30, 10]);
    });

    it('preserves within-group secondary sort — development ordered by oldest started_at', () => {
        const requirements = [
            req(10, { requirement_status: 'development', started_at: '2026-04-15T10:00:00Z' }),
            req(20, { requirement_status: 'development', started_at: '2026-04-10T10:00:00Z' }),
            req(30, { requirement_status: 'development', started_at: '2026-04-17T10:00:00Z' }),
        ];
        const sorted = [...requirements].sort(processSortReverse);
        // oldest started first (same as processSort)
        expect(sorted.map(r => r.id)).toEqual([20, 10, 30]);
    });

    it('preserves within-group secondary sort — swarm_ready ordered by id asc (req #2405)', () => {
        const requirements = [
            req(30, { requirement_status: 'swarm_ready' }),
            req(10, { requirement_status: 'swarm_ready' }),
            req(20, { requirement_status: 'swarm_ready' }),
        ];
        const sorted = [...requirements].sort(processSortReverse);
        expect(sorted.map(r => r.id)).toEqual([10, 20, 30]);
    });

    it('preserves within-group secondary sort — authoring/approved by smallest id', () => {
        const requirements = [
            req(30, { requirement_status: 'authoring' }),
            req(10, { requirement_status: 'authoring' }),
            req(20, { requirement_status: 'authoring' }),
        ];
        const sorted = [...requirements].sort(processSortReverse);
        expect(sorted.map(r => r.id)).toEqual([10, 20, 30]);
    });

    it('always sorts the template row (id === "") last', () => {
        const requirements = [
            { id: '', requirement_status: 'authoring' },
            req(1, { requirement_status: 'met', completed_at: '2026-04-15T10:00:00Z' }),
            req(2, { requirement_status: 'deferred', deferred_at: '2026-04-15T10:00:00Z' }),
        ];
        const sorted = [...requirements].sort(processSortReverse);
        expect(sorted[sorted.length - 1].id).toBe('');
        expect(sorted[0].requirement_status).toBe('deferred');
        expect(sorted[1].requirement_status).toBe('met');
    });

    it('unknown status falls back to rank 0 (sorts with deferred group)', () => {
        const a = req(1, { requirement_status: 'bogus' });
        const b = req(2, { requirement_status: 'met' });
        // a has rank 0 (fallback), b has rank 1 → a first
        expect(processSortReverse(a, b)).toBeLessThan(0);
    });

    it('is the inverse of processSort for statuses of distinct rank (excluding deferred/met swap)', () => {
        // authoring(fwd=0, rev=5) vs development(fwd=3, rev=2):
        // processSort(authoring, development) < 0 (authoring first)
        // processSortReverse(authoring, development) > 0 (development first)
        const a = req(1, { requirement_status: 'authoring' });
        const b = req(2, { requirement_status: 'development', started_at: '2026-04-15T10:00:00Z' });
        expect(processSort(a, b)).toBeLessThan(0);
        expect(processSortReverse(a, b)).toBeGreaterThan(0);
    });
});
