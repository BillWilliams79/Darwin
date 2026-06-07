// Req #2685 — derive the list of requirements launched by a given swarm_start.
// For each swarm_session linked via swarm_start_sessions, we expose:
//   { reqId, title, sessionId, startedAt }
// where reqId is parsed from session.source_ref ("requirement:<n>") and is
// `null` when the source_ref is missing or not a parseable requirement
// reference (e.g. legacy direct sessions). Pure helper — exported for unit
// testing. Returns `[]` until both `sessions` and `junction` arrive so the
// caller can treat empty-vs-loading uniformly.
//
// Sort: started_at ASC, id ASC as tie-breaker. The on-screen cell stacks
// lines top-down in launch order (oldest first), matching the way the user
// thinks of a swarm-start ("session 1, session 2, …"). Sessions with null
// started_at sort last so they don't push real data off the visible area.

import { parseSessionRequirementId } from '../CalendarFC/timeSeriesSizes';

export function selectRequirementsForSwarmStart(sessions, junction, swarmStartId) {
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
        .map(s => ({
            reqId: parseSessionRequirementId(s.source_ref),
            title: s.title || '',
            sessionId: s.id,
            startedAt: s.started_at || null,
        }))
        .sort((a, b) => {
            const at = a.startedAt;
            const bt = b.startedAt;
            // null started_at sorts last (treat as +infinity)
            if (at === bt) return a.sessionId - b.sessionId;
            if (at === null) return 1;
            if (bt === null) return -1;
            return at.localeCompare(bt);
        });
}
