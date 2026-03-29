/**
 * Aggregates ride data into chart-ready time-bucketed data points.
 *
 * @param {Array} runs - Array of map_run objects from useMapRuns
 * @param {'distance'|'time'|'elevation'|'count'} metric
 * @param {'yearly'|'monthly'|'weekly'} timeframe
 * @returns {Array<{label: string, value: number}>} Sorted chronologically, gaps filled with 0
 */
export function aggregateTrends(runs, metric, timeframe) {
    if (!runs || runs.length === 0) return [];

    const buckets = new Map();

    for (const run of runs) {
        const d = new Date(run.start_time.endsWith?.('Z') ? run.start_time : run.start_time + 'Z');
        const key = bucketKey(d, timeframe);
        const prev = buckets.get(key) || 0;
        buckets.set(key, prev + metricValue(run, metric));
    }

    const allKeys = fillGaps(Array.from(buckets.keys()), timeframe);

    return allKeys.map(key => ({
        key,
        label: keyToLabel(key, timeframe),
        value: round(buckets.get(key) || 0, metric),
    }));
}

function bucketKey(date, timeframe) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth(); // 0-based
    switch (timeframe) {
        case 'yearly':
            return `${y}`;
        case 'monthly':
            return `${y}-${String(m + 1).padStart(2, '0')}`;
        case 'weekly': {
            const { year, week } = getISOWeek(date);
            return `${year}-W${String(week).padStart(2, '0')}`;
        }
        default:
            return `${y}`;
    }
}

function metricValue(run, metric) {
    switch (metric) {
        case 'distance':
            return Number(run.distance_mi) || 0;
        case 'time':
            return (Number(run.run_time_sec) || 0) / 3600;
        case 'elevation':
            return Number(run.ascent_ft) || 0;
        case 'count':
            return 1;
        default:
            return 0;
    }
}

function round(value, metric) {
    if (metric === 'count' || metric === 'elevation') return Math.round(value);
    return Math.round(value * 10) / 10; // 1 decimal for distance/time
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function keyToLabel(key, timeframe) {
    switch (timeframe) {
        case 'yearly':
            return key;
        case 'monthly': {
            const [y, m] = key.split('-');
            return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
        }
        case 'weekly': {
            // "2024-W12" → "W12 2024"
            const [y, w] = key.split('-');
            return `${w} ${y}`;
        }
        default:
            return key;
    }
}

/**
 * ISO 8601 week number. Week 1 contains the first Thursday of the year.
 * Monday is day 1.
 */
export function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    // Set to nearest Thursday: current date + 4 - current day number (Monday=1, Sunday=7)
    const dayNum = d.getUTCDay() || 7; // Convert Sunday(0) to 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
}

function fillGaps(keys, timeframe) {
    if (keys.length === 0) return [];
    const sorted = [...keys].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const all = [];

    switch (timeframe) {
        case 'yearly': {
            const start = parseInt(first, 10);
            const end = parseInt(last, 10);
            for (let y = start; y <= end; y++) all.push(`${y}`);
            break;
        }
        case 'monthly': {
            let [y, m] = first.split('-').map(Number);
            const [ey, em] = last.split('-').map(Number);
            while (y < ey || (y === ey && m <= em)) {
                all.push(`${y}-${String(m).padStart(2, '0')}`);
                m++;
                if (m > 12) { m = 1; y++; }
            }
            break;
        }
        case 'weekly': {
            // Generate all ISO weeks between first and last
            // Parse first key to a date, walk week by week
            const startDate = isoWeekToDate(first);
            const endDate = isoWeekToDate(last);
            const seen = new Set();
            for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 7)) {
                const { year, week } = getISOWeek(d);
                const key = `${year}-W${String(week).padStart(2, '0')}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    all.push(key);
                }
            }
            break;
        }
    }

    return all;
}

/**
 * Returns the UTC start (inclusive) and end (exclusive) dates for a bucket key.
 * Used by click-to-filter: clicking a chart bar drills into that time range.
 *
 * @param {string} key - Internal bucket key (e.g., "2024", "2024-06", "2024-W12")
 * @param {'yearly'|'monthly'|'weekly'} timeframe
 * @returns {{ start: Date, end: Date }}
 */
export function bucketDateRange(key, timeframe) {
    switch (timeframe) {
        case 'yearly': {
            const y = parseInt(key, 10);
            return {
                start: new Date(Date.UTC(y, 0, 1)),
                end: new Date(Date.UTC(y + 1, 0, 1)),
            };
        }
        case 'monthly': {
            const [y, m] = key.split('-').map(Number);
            return {
                start: new Date(Date.UTC(y, m - 1, 1)),
                end: new Date(Date.UTC(y, m, 1)), // first of next month
            };
        }
        case 'weekly': {
            const monday = isoWeekToDate(key);
            const nextMonday = new Date(monday);
            nextMonday.setUTCDate(monday.getUTCDate() + 7);
            return { start: monday, end: nextMonday };
        }
        default:
            return { start: new Date(0), end: new Date() };
    }
}

/**
 * Convert an ISO week key like "2024-W12" to the Monday of that week.
 */
function isoWeekToDate(key) {
    const [yearStr, weekStr] = key.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);
    // Jan 4 is always in week 1
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfWeek = jan4.getUTCDay() || 7; // Monday=1..Sunday=7
    // Monday of week 1
    const mondayW1 = new Date(jan4);
    mondayW1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
    // Monday of target week
    const target = new Date(mondayW1);
    target.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7);
    return target;
}
