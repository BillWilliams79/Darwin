import { describe, it, expect } from 'vitest';
import { computeCategoryRankMap, processSort, OPEN_STATUSES_FOR_RANK } from '../processSort';

const req = (id, overrides = {}) => ({
    id,
    category_fk: overrides.category_fk ?? 1,
    requirement_status: overrides.requirement_status ?? 'authoring',
    sort_order: overrides.sort_order ?? null,
    started_at: overrides.started_at ?? null,
    deferred_at: overrides.deferred_at ?? null,
    completed_at: overrides.completed_at ?? null,
    ...overrides,
});

describe('OPEN_STATUSES_FOR_RANK', () => {
    it('includes the four open statuses and excludes deferred/met', () => {
        expect(OPEN_STATUSES_FOR_RANK.has('authoring')).toBe(true);
        expect(OPEN_STATUSES_FOR_RANK.has('approved')).toBe(true);
        expect(OPEN_STATUSES_FOR_RANK.has('swarm_ready')).toBe(true);
        expect(OPEN_STATUSES_FOR_RANK.has('development')).toBe(true);
        expect(OPEN_STATUSES_FOR_RANK.has('deferred')).toBe(false);
        expect(OPEN_STATUSES_FOR_RANK.has('met')).toBe(false);
    });
});

describe('computeCategoryRankMap', () => {
    it('returns {} for empty input', () => {
        expect(computeCategoryRankMap([])).toEqual({});
    });

    it('returns {} for null/undefined input', () => {
        expect(computeCategoryRankMap(null)).toEqual({});
        expect(computeCategoryRankMap(undefined)).toEqual({});
    });

    it('assigns 1-based ranks following processSort within a single category', () => {
        const requirements = [
            req(20, { requirement_status: 'approved' }),
            req(10, { requirement_status: 'authoring' }),
            req(30, { requirement_status: 'swarm_ready', sort_order: 0 }),
        ];
        const map = computeCategoryRankMap(requirements);
        // processSort: authoring(0) < approved(1) < swarm_ready(2)
        expect(map).toEqual({ 10: 1, 20: 2, 30: 3 });
    });

    it('excludes deferred and met from the rank pool', () => {
        const requirements = [
            req(10, { requirement_status: 'authoring' }),
            req(20, { requirement_status: 'deferred' }),
            req(30, { requirement_status: 'met' }),
            req(40, { requirement_status: 'approved' }),
        ];
        const map = computeCategoryRankMap(requirements);
        expect(map).toEqual({ 10: 1, 40: 2 });
        expect(map[20]).toBeUndefined();
        expect(map[30]).toBeUndefined();
    });

    it('ranks each category independently', () => {
        const requirements = [
            req(1, { category_fk: 100, requirement_status: 'authoring' }),
            req(2, { category_fk: 100, requirement_status: 'approved' }),
            req(3, { category_fk: 200, requirement_status: 'authoring' }),
            req(4, { category_fk: 200, requirement_status: 'authoring' }),
        ];
        const map = computeCategoryRankMap(requirements);
        expect(map).toEqual({ 1: 1, 2: 2, 3: 1, 4: 2 });
    });

    it('orders development items by started_at ascending', () => {
        const requirements = [
            req(10, { requirement_status: 'development', started_at: '2026-04-15T10:00:00Z' }),
            req(20, { requirement_status: 'development', started_at: '2026-04-10T10:00:00Z' }),
            req(30, { requirement_status: 'development', started_at: '2026-04-17T10:00:00Z' }),
        ];
        const map = computeCategoryRankMap(requirements);
        // oldest started_at first
        expect(map).toEqual({ 20: 1, 10: 2, 30: 3 });
    });

    it('orders swarm_ready items by sort_order asc, NULLs last, id tiebreaker', () => {
        const requirements = [
            req(10, { requirement_status: 'swarm_ready', sort_order: null }),
            req(20, { requirement_status: 'swarm_ready', sort_order: 5 }),
            req(30, { requirement_status: 'swarm_ready', sort_order: 1 }),
            req(40, { requirement_status: 'swarm_ready', sort_order: null }),
        ];
        const map = computeCategoryRankMap(requirements);
        // sort_order 1, 5, then NULLs by id asc
        expect(map).toEqual({ 30: 1, 20: 2, 10: 3, 40: 4 });
    });

    it('skips requirements missing id or category_fk', () => {
        const requirements = [
            req(10, { requirement_status: 'authoring' }),
            { id: '', requirement_status: 'authoring', category_fk: 1 },
            { id: 20, requirement_status: 'authoring', category_fk: null },
            { id: 30, requirement_status: 'authoring', category_fk: undefined },
        ];
        const map = computeCategoryRankMap(requirements);
        expect(map).toEqual({ 10: 1 });
    });

    it('does not mutate the input array', () => {
        const requirements = [
            req(20, { requirement_status: 'approved' }),
            req(10, { requirement_status: 'authoring' }),
        ];
        const originalOrder = requirements.map(r => r.id);
        computeCategoryRankMap(requirements);
        expect(requirements.map(r => r.id)).toEqual(originalOrder);
    });
});

describe('processSort (sanity — imported)', () => {
    it('is a callable comparator', () => {
        expect(typeof processSort).toBe('function');
        const a = req(1, { requirement_status: 'authoring' });
        const b = req(2, { requirement_status: 'approved' });
        expect(processSort(a, b)).toBeLessThan(0);
    });
});
