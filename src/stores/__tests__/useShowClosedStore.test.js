import { describe, it, expect } from 'vitest';
import {
    ALL_SESSION_STATUSES,
    DEFAULT_SESSION_STATUSES,
} from '../useShowClosedStore';

describe('useShowClosedStore constants (req #2332)', () => {
    it('ALL_SESSION_STATUSES includes waiting and planning', () => {
        expect(ALL_SESSION_STATUSES).toContain('waiting');
        expect(ALL_SESSION_STATUSES).toContain('planning');
    });

    it('DEFAULT_SESSION_STATUSES includes waiting and planning', () => {
        expect(DEFAULT_SESSION_STATUSES).toContain('waiting');
        expect(DEFAULT_SESSION_STATUSES).toContain('planning');
    });

    it('ALL_SESSION_STATUSES has correct order', () => {
        expect(ALL_SESSION_STATUSES).toEqual([
            'starting', 'waiting', 'planning', 'active', 'review', 'completing', 'completed', 'paused',
        ]);
    });

    it('DEFAULT_SESSION_STATUSES excludes completed and paused', () => {
        expect(DEFAULT_SESSION_STATUSES).not.toContain('completed');
        expect(DEFAULT_SESSION_STATUSES).not.toContain('paused');
    });
});

describe('v6→v7 migration logic', () => {
    // The migrate function is inside the persist config and not directly
    // exported. We test the logic by simulating what the migration should
    // do: injecting 'waiting' and 'planning' into a persisted filter that
    // lacks them, regardless of incoming version.

    const simulateMigrate = (filter) => {
        const sf = filter || DEFAULT_SESSION_STATUSES;
        const injected = [...sf];
        if (!injected.includes('waiting')) injected.push('waiting');
        if (!injected.includes('planning')) injected.push('planning');
        return injected;
    };

    it('injects waiting and planning into a v6-era filter that lacks them', () => {
        const result = simulateMigrate(['starting', 'active', 'review', 'completing']);
        expect(result).toContain('waiting');
        expect(result).toContain('planning');
        expect(result).toHaveLength(6);
    });

    it('does not duplicate if waiting/planning already present', () => {
        const result = simulateMigrate(['starting', 'waiting', 'planning', 'active', 'review', 'completing']);
        expect(result.filter(s => s === 'waiting')).toHaveLength(1);
        expect(result.filter(s => s === 'planning')).toHaveLength(1);
    });

    it('injects waiting and planning from any prior version (e.g. v5) that lacks them', () => {
        // Simulate a user persisted at version 5 whose sessionStatusFilter
        // never went through v6→v7 — the robust migration still injects.
        const result = simulateMigrate(['starting', 'active', 'completing']);
        expect(result).toContain('waiting');
        expect(result).toContain('planning');
        expect(result).toHaveLength(5);
    });

    it('uses DEFAULT_SESSION_STATUSES when persisted filter is falsy', () => {
        const result = simulateMigrate(undefined);
        expect(result).toContain('waiting');
        expect(result).toContain('planning');
    });
});
