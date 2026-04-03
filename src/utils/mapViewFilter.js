/**
 * Apply a saved view's criteria to filter map runs.
 *
 * @param {Array} runs - All map_runs objects from the API
 * @param {Object|null} criteria - Parsed criteria object, or null/empty for no filter
 *   Supported fields (all optional):
 *   - route_ids: number[] — run.map_route_fk must be in this array
 *   - date_start: string — "YYYY-MM-DD", run.start_time must be >= this date
 *   - date_end: string — "YYYY-MM-DD", run.start_time must be <= end of this date
 *   - notes_search: string — case-insensitive substring match on run.notes
 *   - distance_min: number — run.distance_mi must be >= this value
 *   - distance_max: number — run.distance_mi must be <= this value
 *   - partner_ids: number[] — run must have at least one partner in this array
 *   - activity_ids: number[] — run.activity_id must be in this array
 * @param {Map|null} runPartnerMap - Map<runId, partnerIds[]> for partner filtering
 * @returns {Array} Filtered runs (or all runs if no criteria)
 */
export function applyViewFilter(runs, criteria, runPartnerMap = null) {
    if (!criteria || Object.keys(criteria).length === 0) return runs;

    return runs.filter(run => {
        // Activity type filter
        if (criteria.activity_ids?.length > 0) {
            if (!criteria.activity_ids.includes(run.activity_id)) return false;
        }

        // Route filter
        if (criteria.route_ids?.length > 0) {
            if (!criteria.route_ids.includes(run.map_route_fk)) return false;
        }

        // Date range filter (compare against start_time string from DB)
        if (criteria.date_start) {
            if (run.start_time < criteria.date_start) return false;
        }
        if (criteria.date_end) {
            // Include the entire end date day
            if (run.start_time > criteria.date_end + ' 23:59:59') return false;
        }

        // Notes search (case-insensitive substring)
        if (criteria.notes_search) {
            const needle = criteria.notes_search.toLowerCase();
            if (!(run.notes || '').toLowerCase().includes(needle)) return false;
        }

        // Distance range
        if (criteria.distance_min != null) {
            if (Number(run.distance_mi) < criteria.distance_min) return false;
        }
        if (criteria.distance_max != null) {
            if (Number(run.distance_mi) > criteria.distance_max) return false;
        }

        // Partner filter — run must have at least one of the specified partners
        if (criteria.partner_ids?.length > 0 && runPartnerMap) {
            const runPartnerIds = runPartnerMap.get(run.id) || [];
            if (!criteria.partner_ids.some(pid => runPartnerIds.includes(pid))) return false;
        }

        return true;
    });
}
