import { describe, it, expect } from 'vitest';
import { navigateTimeframe } from '../trendsNavigation';

// Helper to build a timeFilter object
const filter = (label, startISO, endISO, sourceTimeframe) => ({
    label,
    start: new Date(startISO),
    end: new Date(endISO),
    sourceTimeframe,
});

describe('navigateTimeframe', () => {
    describe('no active filter', () => {
        it('sets timeframe to clicked value', () => {
            const result = navigateTimeframe('monthly', null, 'yearly');
            expect(result).toEqual({ timeframe: 'monthly', timeFilter: null });
        });

        it('returns yearly when clicking yearly', () => {
            const result = navigateTimeframe('yearly', null, 'monthly');
            expect(result).toEqual({ timeframe: 'yearly', timeFilter: null });
        });

        it('returns weekly when clicking weekly', () => {
            const result = navigateTimeframe('weekly', null, 'yearly');
            expect(result).toEqual({ timeframe: 'weekly', timeFilter: null });
        });
    });

    describe('same level (no-op)', () => {
        it('returns null when clicking current effective timeframe', () => {
            const tf = filter('2024', '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'yearly');
            // effectiveTimeframe = DRILL_DOWN['yearly'] = 'monthly'
            const result = navigateTimeframe('monthly', tf, 'monthly');
            expect(result).toBeNull();
        });

        it('returns null for weekly-on-weekly', () => {
            const tf = filter('Jun 2024', '2024-06-01T00:00:00Z', '2024-07-01T00:00:00Z', 'monthly');
            // effectiveTimeframe = DRILL_DOWN['monthly'] = 'weekly'
            const result = navigateTimeframe('weekly', tf, 'weekly');
            expect(result).toBeNull();
        });
    });

    describe('broader — zoom out', () => {
        it('clicking Year from monthly drill clears filter', () => {
            const tf = filter('2024', '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'yearly');
            const result = navigateTimeframe('yearly', tf, 'monthly');
            expect(result).toEqual({ timeframe: 'yearly', timeFilter: null });
        });

        it('clicking Year from weekly drill clears filter', () => {
            const tf = filter('Jun 2024', '2024-06-01T00:00:00Z', '2024-07-01T00:00:00Z', 'monthly');
            const result = navigateTimeframe('yearly', tf, 'weekly');
            expect(result).toEqual({ timeframe: 'yearly', timeFilter: null });
        });

        it('clicking Month from weekly drill zooms out to parent year', () => {
            const tf = filter('Jun 2024', '2024-06-01T00:00:00Z', '2024-07-01T00:00:00Z', 'monthly');
            const result = navigateTimeframe('monthly', tf, 'weekly');
            expect(result.timeframe).toBeNull();
            expect(result.timeFilter).toEqual({
                label: '2024',
                start: new Date('2024-01-01T00:00:00Z'),
                end: new Date('2025-01-01T00:00:00Z'),
                sourceTimeframe: 'yearly',
            });
        });

        it('parent year is derived from filter start date', () => {
            // December 2023 — parent year is 2023
            const tf = filter('Dec 2023', '2023-12-01T00:00:00Z', '2024-01-01T00:00:00Z', 'monthly');
            const result = navigateTimeframe('monthly', tf, 'weekly');
            expect(result.timeFilter.label).toBe('2023');
            expect(result.timeFilter.start).toEqual(new Date('2023-01-01T00:00:00Z'));
            expect(result.timeFilter.end).toEqual(new Date('2024-01-01T00:00:00Z'));
        });
    });

    describe('narrower — zoom in', () => {
        it('clicking Week from monthly drill keeps range and goes weekly', () => {
            const tf = filter('2024', '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'yearly');
            // effectiveTimeframe = 'monthly', clicking 'weekly'
            const result = navigateTimeframe('weekly', tf, 'monthly');
            expect(result.timeframe).toBeNull();
            expect(result.timeFilter.start).toEqual(tf.start);
            expect(result.timeFilter.end).toEqual(tf.end);
            expect(result.timeFilter.label).toBe('2024');
            expect(result.timeFilter.sourceTimeframe).toBe('monthly');
        });
    });

    describe('round-trip navigation', () => {
        it('drill yearly→monthly→weekly→monthly→yearly returns to unfiltered', () => {
            // Start: no filter, yearly view
            // Click a year bar → monthly drill of 2024
            const step1 = filter('2024', '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'yearly');

            // Click Week button → weekly within 2024
            const step2result = navigateTimeframe('weekly', step1, 'monthly');
            expect(step2result.timeFilter.sourceTimeframe).toBe('monthly');

            // Click Month button → back to monthly of 2024
            const step3result = navigateTimeframe('monthly', step2result.timeFilter, 'weekly');
            expect(step3result.timeFilter.sourceTimeframe).toBe('yearly');
            expect(step3result.timeFilter.label).toBe('2024');

            // Click Year button → clears filter entirely
            const step4result = navigateTimeframe('yearly', step3result.timeFilter, 'monthly');
            expect(step4result).toEqual({ timeframe: 'yearly', timeFilter: null });
        });
    });
});
