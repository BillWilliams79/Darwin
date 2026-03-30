const DRILL_DOWN = { yearly: 'monthly', monthly: 'weekly', weekly: 'weekly' };
const LEVEL = { yearly: 0, monthly: 1, weekly: 2 };
const PARENT = { monthly: 'yearly', weekly: 'monthly' };

/**
 * Computes the next trends state when a timeframe button is clicked.
 *
 * @param {string} clicked - The timeframe button value ('yearly'|'monthly'|'weekly')
 * @param {object|null} timeFilter - Current active time filter (or null)
 * @param {string} effectiveTimeframe - Currently displayed timeframe
 * @returns {{ timeframe: string|null, timeFilter: object|null }}
 *   timeframe is non-null only when the base timeframe should change (no-filter case or clearing filter).
 *   timeFilter is the new filter value (null to clear, object to set/update).
 */
export function navigateTimeframe(clicked, timeFilter, effectiveTimeframe) {
    if (!timeFilter) {
        return { timeframe: clicked, timeFilter: null };
    }

    const currentLevel = LEVEL[effectiveTimeframe];
    const clickedLevel = LEVEL[clicked];

    if (clickedLevel === currentLevel) {
        return null; // no-op
    }

    if (clickedLevel < currentLevel) {
        // Broader — zoom out
        if (clicked === 'yearly') {
            return { timeframe: 'yearly', timeFilter: null };
        }
        // monthly from weekly — zoom out to parent year
        const year = timeFilter.start.getUTCFullYear();
        return {
            timeframe: null,
            timeFilter: {
                label: String(year),
                start: new Date(Date.UTC(year, 0, 1)),
                end: new Date(Date.UTC(year + 1, 0, 1)),
                sourceTimeframe: 'yearly',
            },
        };
    }

    // Narrower — zoom in, keep same time range, finer granularity
    return {
        timeframe: null,
        timeFilter: {
            ...timeFilter,
            sourceTimeframe: PARENT[clicked],
        },
    };
}

export { DRILL_DOWN };
