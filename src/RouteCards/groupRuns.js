/**
 * Groups runs by a given factor.
 * Returns [{ label: string, runs: array }]
 */
export function groupRuns(runs, routeMap, factor = 'route') {
    const groups = new Map();

    for (const run of runs) {
        let key;
        switch (factor) {
            case 'route':
                key = routeMap.get(run.map_route_fk) || 'Unknown Route';
                break;
            case 'year': {
                const d = new Date(run.start_time);
                key = String(d.getUTCFullYear());
                break;
            }
            case 'month': {
                const d = new Date(run.start_time);
                const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
                key = `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
                break;
            }
            default:
                key = 'All';
        }

        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(run);
    }

    return Array.from(groups.entries()).map(([label, runs]) => ({ label, runs }));
}
