// Req #2497 — derive the list of swarm_sessions linked to a given
// swarm_complete via the swarm_complete_sessions junction. Mirrors
// selectSessionsForSwarmStart in ../SwarmStarts/sessionFilter.js — pure
// helper, exported for direct unit testing. Returns [] until both inputs
// arrive so callers can treat empty-vs-loading uniformly.
//
// Sort: started_at DESC, id DESC tie-breaker — consistent with the
// SessionsView grid and the swarm_starts detail page.
export function selectSessionsForSwarmComplete(sessions, junction, swarmCompleteId) {
    if (!Array.isArray(sessions) || !Array.isArray(junction) || !swarmCompleteId) {
        return [];
    }
    const sessionIds = new Set(
        junction
            .filter(j => j.swarm_complete_fk === swarmCompleteId)
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
