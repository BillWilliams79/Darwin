import { describe, it, expect } from 'vitest';
import { aggregateTrends, getISOWeek, bucketDateRange } from '../aggregateTrends';

const run = (overrides) => ({
    start_time: '2024-06-15 10:00:00',
    distance_mi: '10.5',
    run_time_sec: '3600',
    ascent_ft: '500',
    activity_name: 'Ride',
    ...overrides,
});

describe('aggregateTrends', () => {
    it('returns empty array for empty input', () => {
        expect(aggregateTrends([], 'distance', 'monthly')).toEqual([]);
    });

    it('returns empty array for null input', () => {
        expect(aggregateTrends(null, 'distance', 'monthly')).toEqual([]);
    });

    it('aggregates a single run with distance metric', () => {
        const result = aggregateTrends([run()], 'distance', 'monthly');
        expect(result[0]).toMatchObject({ label: 'Jun 2024', value: 10.5 });
    });

    it('includes key field in output for click-to-filter', () => {
        const result = aggregateTrends([run()], 'distance', 'monthly');
        expect(result[0].key).toBe('2024-06');
    });

    it('sums distance for multiple runs in same month', () => {
        const runs = [
            run({ distance_mi: '10.0' }),
            run({ start_time: '2024-06-20 08:00:00', distance_mi: '5.5' }),
        ];
        const result = aggregateTrends(runs, 'distance', 'monthly');
        expect(result[0]).toMatchObject({ label: 'Jun 2024', value: 15.5 });
    });

    it('fills gaps between months with zero values', () => {
        const runs = [
            run({ start_time: '2024-01-15 10:00:00', distance_mi: '10.0' }),
            run({ start_time: '2024-03-20 10:00:00', distance_mi: '5.0' }),
        ];
        const result = aggregateTrends(runs, 'distance', 'monthly');
        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({ label: 'Jan 2024', value: 10 });
        expect(result[1]).toMatchObject({ label: 'Feb 2024', value: 0 });
        expect(result[2]).toMatchObject({ label: 'Mar 2024', value: 5 });
    });

    it('converts time metric from seconds to hours', () => {
        const runs = [run({ run_time_sec: '7200' })]; // 2 hours
        const result = aggregateTrends(runs, 'time', 'monthly');
        expect(result[0].value).toBe(2);
    });

    it('treats null ascent_ft as 0 for elevation metric', () => {
        const runs = [
            run({ ascent_ft: '500' }),
            run({ start_time: '2024-06-20 08:00:00', ascent_ft: null }),
        ];
        const result = aggregateTrends(runs, 'elevation', 'monthly');
        expect(result[0].value).toBe(500);
    });

    it('counts activities for count metric', () => {
        const runs = [
            run(),
            run({ start_time: '2024-06-20 08:00:00' }),
            run({ start_time: '2024-06-25 08:00:00' }),
        ];
        const result = aggregateTrends(runs, 'count', 'monthly');
        expect(result[0].value).toBe(3);
    });

    it('groups by year and sorts chronologically', () => {
        const runs = [
            run({ start_time: '2023-03-15 10:00:00', distance_mi: '8.0' }),
            run({ start_time: '2025-07-20 10:00:00', distance_mi: '12.0' }),
        ];
        const result = aggregateTrends(runs, 'distance', 'yearly');
        expect(result).toHaveLength(3); // 2023, 2024 (gap), 2025
        expect(result[0]).toMatchObject({ label: '2023', value: 8 });
        expect(result[1]).toMatchObject({ label: '2024', value: 0 });
        expect(result[2]).toMatchObject({ label: '2025', value: 12 });
    });

    it('assigns correct ISO week for weekly grouping', () => {
        // 2024-01-08 is a Monday, ISO week 2
        const runs = [run({ start_time: '2024-01-08 10:00:00' })];
        const result = aggregateTrends(runs, 'count', 'weekly');
        expect(result[0].label).toBe('W02 2024');
        expect(result[0].value).toBe(1);
    });

    it('handles ISO week year boundary (Dec 30 can be W01 of next year)', () => {
        // 2024-12-30 is a Monday → ISO week 1 of 2025
        const { year, week } = getISOWeek(new Date(Date.UTC(2024, 11, 30)));
        expect(year).toBe(2025);
        expect(week).toBe(1);
    });

    it('fills weekly gaps between non-consecutive weeks', () => {
        const runs = [
            run({ start_time: '2024-03-04 10:00:00' }), // W10
            run({ start_time: '2024-03-18 10:00:00' }), // W12
        ];
        const result = aggregateTrends(runs, 'count', 'weekly');
        expect(result).toHaveLength(3); // W10, W11, W12
        expect(result[0].label).toBe('W10 2024');
        expect(result[1].label).toBe('W11 2024');
        expect(result[1].value).toBe(0);
        expect(result[2].label).toBe('W12 2024');
    });

    it('handles start_time with trailing Z', () => {
        const runs = [run({ start_time: '2024-06-15T10:00:00Z', distance_mi: '7.0' })];
        const result = aggregateTrends(runs, 'distance', 'monthly');
        expect(result[0].value).toBe(7);
    });
});

describe('bucketDateRange', () => {
    it('yearly: returns Jan 1 to Jan 1 of next year', () => {
        const { start, end } = bucketDateRange('2024', 'yearly');
        expect(start.toISOString()).toBe('2024-01-01T00:00:00.000Z');
        expect(end.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    });

    it('monthly: returns first of month to first of next month', () => {
        const { start, end } = bucketDateRange('2024-06', 'monthly');
        expect(start.toISOString()).toBe('2024-06-01T00:00:00.000Z');
        expect(end.toISOString()).toBe('2024-07-01T00:00:00.000Z');
    });

    it('monthly: December rolls over to next year', () => {
        const { start, end } = bucketDateRange('2024-12', 'monthly');
        expect(start.toISOString()).toBe('2024-12-01T00:00:00.000Z');
        expect(end.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    });

    it('weekly: returns Monday to next Monday', () => {
        // W10 2024: March 4 (Monday) to March 11 (Monday)
        const { start, end } = bucketDateRange('2024-W10', 'weekly');
        expect(start.toISOString()).toBe('2024-03-04T00:00:00.000Z');
        expect(end.toISOString()).toBe('2024-03-11T00:00:00.000Z');
    });

    it('weekly: W01 of 2025 starts on Dec 30 2024', () => {
        const { start, end } = bucketDateRange('2025-W01', 'weekly');
        expect(start.toISOString()).toBe('2024-12-30T00:00:00.000Z');
        expect(end.toISOString()).toBe('2025-01-06T00:00:00.000Z');
    });
});
