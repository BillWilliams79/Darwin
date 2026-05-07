// Req #2494 — derive the list of swarm_sessions linked to a given swarm_start
// via the swarm_start_sessions junction. Pure helper — exported for direct unit
// testing. Inputs may be `undefined` while their TanStack Query hooks load;
// returns `[]` until both arrive so the caller can treat empty-vs-loading
// uniformly (loading state is owned by the component via `isLoading` flags).
//
// Sort: started_at DESC, id DESC as tie-breaker — same ordering the
// SessionsView grid uses by default so users get a consistent newest-first
// experience between the two pages.
export function selectSessionsForSwarmStart(sessions, junction, swarmStartId) {
    if (!Array.isArray(sessions) || !Array.isArray(junction) || !swarmStartId) {
        return [];
    }
    const sessionIds = new Set(
        junction
            .filter(j => j.swarm_start_fk === swarmStartId)
            .map(j => j.session_fk)
    );
    if (sessionIds.size === 0) return [];
    return sessions
        .filter(s => sessionIds.has(s.id))
        .sort((a, b) => {
            const at = a.started_at || '';
            const bt = b.started_at || '';
            if (at !== bt) return bt.localeCompare(at);
            return b.id - a.id;
        });
}
