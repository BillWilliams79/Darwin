/**
 * Aggregates requirement data into chart-ready time-bucketed series for the
 * Requirements Trends view (req #2812).
 *
 * A requirement counts as "closed" when it has a non-null `completed_at` — this
 * captures both `met` (delivered) and `wontfix` (abandoned but completed) since
 * both stamp `completed_at`. The chart plots how many requirements closed in
 * each calendar bucket (day / week / month), optionally split per category.
 *
 * The core is a pure function: no React, no `Date.now()` reads inside the
 * aggregation. The caller passes `nowMs` so the range window is deterministic
 * and the function stays unit-testable.
 *
 * @typedef {Object} ReqRow
 * @property {string|null} completed_at - ISO-ish timestamp, e.g. "2026-06-11T23:15:13"
 * @property {number} category_fk
 *
 * @typedef {Object} CategoryMeta
 * @property {number} id
 * @property {string} name
 * @property {string} [color]
 *
 * @typedef {Object} TrendOptions
 * @property {'day'|'week'|'month'} timeframe
 * @property {number[]} [selectedCategoryIds] - empty/undefined = all categories
 * @property {number[]} [excludeCategoryIds] - category ids whose requirements are
 *                                       dropped entirely (e.g. closed categories);
 *                                       empty/undefined = exclude nothing
 * @property {number|null} [rangeDays] - null = all time; else only buckets whose
 *                                       END is within `rangeDays` of `nowMs`
 * @property {boolean} [cumulative] - running total instead of per-bucket counts
 * @property {number} [nowMs] - clock for range windowing (defaults to Date.now())
 *
 * @returns {{
 *   data: Array<Object>,          // [{ key, label, total, cat_<id>: n, ... }]
 *   categories: CategoryMeta[],   // categories that actually have closed reqs (after filter)
 *   kpis: {
 *     totalClosed: number,        // all-time, ignores rangeDays
 *     closedInRange: number,      // sum within the windowed buckets
 *     avgPerBucket: number,       // closedInRange / windowed bucket count
 *     busiest: { label: string, count: number } | null,  // windowed
 *     topCategory: { name: string, count: number } | null // windowed
 *   }
 * }}
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_MS = 86400000;

/**
 * Resolve a stored timestamp (or a YYYY-MM-DD bucket key) to the Date whose
 * UTC fields equal the VIEWER'S LOCAL calendar day (req #2822).
 *
 * Requirement timestamps are stored in UTC — RDS runs with
 * `@@global.time_zone = @@session.time_zone = UTC` and `completed_at` is stamped
 * via `NOW()` — but serialized without a trailing 'Z'. Bucketing on the raw UTC
 * calendar date drifts a late-evening-local close onto the next, future day for
 * any viewer behind UTC: a "2026-06-12T01:00" UTC close is really Jun 11 evening
 * in US-Pacific, but the UTC date reads Jun 12 ("closed tomorrow"). So we parse
 * the UTC instant and read the LOCAL Y/M/D, then re-encode them as a UTC midnight
 * so the downstream getUTC* / Date.UTC bucket math stays simple and unchanged.
 *
 * A bare date-only string (length <= 10) carries no time-of-day, so it is taken
 * as that calendar day verbatim with no timezone shift — this path also serves
 * the YYYY-MM-DD bucket keys fed back in by fillGaps() / bucketEndMs().
 */
function toBucketDate(ts) {
    if (!ts) return null;
    const s = String(ts);
    if (s.length <= 10) {
        const [y, m, d] = s.slice(0, 10).split('-').map(Number);
        if (!y || !m || !d) return null;
        return new Date(Date.UTC(y, m - 1, d));
    }
    // Full timestamp: ensure it's read as a UTC instant (append 'Z' when the
    // stored value carries no timezone designator), then bucket by the local day.
    const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(s);
    const instant = new Date(hasTz ? s : s + 'Z');
    if (Number.isNaN(instant.getTime())) return null;
    return new Date(Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate()));
}

/** ISO 8601 week number; Monday is day 1, week 1 contains the first Thursday. */
export function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / DAY_MS) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
}

function bucketKey(date, timeframe) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    switch (timeframe) {
        case 'day':
            return `${y}-${String(m + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
        case 'month':
            return `${y}-${String(m + 1).padStart(2, '0')}`;
        case 'week': {
            const { year, week } = getISOWeek(date);
            return `${year}-W${String(week).padStart(2, '0')}`;
        }
        default:
            return `${y}`;
    }
}

function keyToLabel(key, timeframe) {
    switch (timeframe) {
        case 'day': {
            const [y, m, d] = key.split('-');
            return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
        }
        case 'month': {
            const [y, m] = key.split('-');
            return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
        }
        case 'week': {
            // Show the week by its start date (the Monday) rather than the ISO
            // week number — "W17 2026" tells a user nothing about which calendar
            // week it is, whereas the start date is immediately legible (req #2826).
            const monday = isoWeekToDate(key);
            return `${MONTH_NAMES[monday.getUTCMonth()]} ${monday.getUTCDate()} ${monday.getUTCFullYear()}`;
        }
        default:
            return key;
    }
}

/** Convert an ISO week key like "2026-W12" to the Monday of that week (UTC). */
function isoWeekToDate(key) {
    const [yearStr, weekStr] = key.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfWeek = jan4.getUTCDay() || 7;
    const mondayW1 = new Date(jan4);
    mondayW1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
    const target = new Date(mondayW1);
    target.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7);
    return target;
}

/** Inclusive list of every bucket key between first and last so gaps render flat. */
function fillGaps(keys, timeframe) {
    if (keys.length === 0) return [];
    const sorted = [...keys].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const all = [];

    switch (timeframe) {
        case 'day': {
            const start = toBucketDate(first);
            const end = toBucketDate(last);
            for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
                all.push(bucketKey(d, 'day'));
            }
            break;
        }
        case 'month': {
            let [y, m] = first.split('-').map(Number);
            const [ey, em] = last.split('-').map(Number);
            while (y < ey || (y === ey && m <= em)) {
                all.push(`${y}-${String(m).padStart(2, '0')}`);
                m++;
                if (m > 12) { m = 1; y++; }
            }
            break;
        }
        case 'week': {
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
        default:
            return sorted;
    }
    return all;
}

/** Exclusive end-of-bucket UTC timestamp (ms) — used to window by range. */
function bucketEndMs(key, timeframe) {
    switch (timeframe) {
        case 'day': {
            const d = toBucketDate(key);
            return d.getTime() + DAY_MS;
        }
        case 'month': {
            const [y, m] = key.split('-').map(Number);
            return Date.UTC(y, m, 1); // first of next month
        }
        case 'week': {
            const monday = isoWeekToDate(key);
            return monday.getTime() + 7 * DAY_MS;
        }
        default:
            return Number.POSITIVE_INFINITY;
    }
}

export function aggregateRequirementTrends(rows, categoryMetas, options = {}) {
    const {
        timeframe = 'week',
        selectedCategoryIds = [],
        excludeCategoryIds = [],
        rangeDays = null,
        cumulative = false,
        nowMs = Date.now(),
    } = options;

    const catById = new Map();
    for (const c of (categoryMetas || [])) catById.set(c.id, c);

    const selectedSet = selectedCategoryIds.length > 0 ? new Set(selectedCategoryIds) : null;
    const excludeSet = excludeCategoryIds.length > 0 ? new Set(excludeCategoryIds) : null;

    // Filter to closed requirements (have completed_at) in the selected categories,
    // dropping any whose category is excluded (e.g. closed categories — req #2821).
    const closed = (rows || []).filter(r => {
        if (!r || !r.completed_at) return false;
        if (excludeSet && excludeSet.has(r.category_fk)) return false;
        if (selectedSet && !selectedSet.has(r.category_fk)) return false;
        return true;
    });

    const totalClosed = closed.length;

    // bucketKey -> { total, perCat: Map<catId, count> }
    const buckets = new Map();
    // catId -> total closed count (for KPI + which series to draw)
    const catTotals = new Map();

    for (const r of closed) {
        const d = toBucketDate(r.completed_at);
        if (!d) continue;
        const key = bucketKey(d, timeframe);
        let b = buckets.get(key);
        if (!b) {
            b = { total: 0, perCat: new Map() };
            buckets.set(key, b);
        }
        b.total += 1;
        b.perCat.set(r.category_fk, (b.perCat.get(r.category_fk) || 0) + 1);
        catTotals.set(r.category_fk, (catTotals.get(r.category_fk) || 0) + 1);
    }

    // Categories that actually have closed reqs, ordered by their meta order then id.
    const activeCategories = Array.from(catTotals.keys())
        .map(id => {
            const meta = catById.get(id);
            return {
                id,
                name: meta?.category_name ?? meta?.name ?? `Category ${id}`,
                color: meta?.color || null,
            };
        })
        .sort((a, b) => a.id - b.id);

    // Full gap-filled key list, then window by range (relative to nowMs).
    let allKeys = fillGaps(Array.from(buckets.keys()), timeframe);
    if (rangeDays != null) {
        const cutoff = nowMs - rangeDays * DAY_MS;
        allKeys = allKeys.filter(key => bucketEndMs(key, timeframe) > cutoff);
    }

    let runningTotal = 0;
    const runningPerCat = new Map();

    const data = allKeys.map(key => {
        const b = buckets.get(key);
        const point = { key, label: keyToLabel(key, timeframe) };

        if (cumulative) {
            runningTotal += b ? b.total : 0;
            point.total = runningTotal;
            for (const c of activeCategories) {
                const inc = b ? (b.perCat.get(c.id) || 0) : 0;
                runningPerCat.set(c.id, (runningPerCat.get(c.id) || 0) + inc);
                point[`cat_${c.id}`] = runningPerCat.get(c.id);
            }
        } else {
            point.total = b ? b.total : 0;
            for (const c of activeCategories) {
                point[`cat_${c.id}`] = b ? (b.perCat.get(c.id) || 0) : 0;
            }
        }
        return point;
    });

    // KPIs — busiest bucket is over per-bucket (non-cumulative) totals.
    let busiest = null;
    for (const key of allKeys) {
        const b = buckets.get(key);
        const count = b ? b.total : 0;
        if (busiest === null || count > busiest.count) {
            busiest = { label: keyToLabel(key, timeframe), count };
        }
    }

    // closedInRange = sum of per-bucket totals inside the windowed key set.
    // topCategory is computed over the SAME windowed buckets so it stays
    // consistent with closedInRange/busiest (a category that closed nothing in
    // the visible window must not win "Top Category").
    let closedInRange = 0;
    const windowedCatTotals = new Map();
    for (const key of allKeys) {
        const b = buckets.get(key);
        if (!b) continue;
        closedInRange += b.total;
        for (const [cid, n] of b.perCat) {
            windowedCatTotals.set(cid, (windowedCatTotals.get(cid) || 0) + n);
        }
    }

    let topCategory = null;
    for (const c of activeCategories) {
        const count = windowedCatTotals.get(c.id) || 0;
        if (count <= 0) continue;
        if (topCategory === null || count > topCategory.count) {
            topCategory = { name: c.name, count };
        }
    }

    return {
        data,
        categories: activeCategories,
        kpis: {
            totalClosed,
            closedInRange,
            avgPerBucket: allKeys.length > 0 ? closedInRange / allKeys.length : 0,
            busiest: busiest && busiest.count > 0 ? busiest : null,
            topCategory,
        },
    };
}
