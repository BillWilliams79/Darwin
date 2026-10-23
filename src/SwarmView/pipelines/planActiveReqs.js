// planActiveReqs.js — which of a plan's requirements the Plan visualizer's
// "Active" box lists (req #3721). Pure: plain objects in, a list out.
//
// ACTIVE is a fact about the requirement's LATEST session (the page's own
// `buildSessionStatusIndex`, already attached to every plan requirement as
// `session_status` — no new read): a session somewhere between `starting` and
// `completing` (user directive: "starting to completing is active and not
// complete … or paused"). A requirement closed `deferred` or `wontfix` is not
// active whatever its last session says. `no_session`, a missing status and a
// status this build does not know are not active either — the box lists what
// is known to be running, never a guess.
//
// THE PLAN'S OWN ORDER. The box replicates rows already drawn on the epic
// cards, so it lists them the way the canvas does: epics in display order,
// and each epic's requirements in the card's own (orchestration) order. A
// requirement seated on two epics is listed once, at its first. A requirement
// pinned to a machine the toolbar's filter hides (req #3708) is drawn nowhere,
// so not here either.

import { isMachineHidden } from './planMachineFilter';

/** Latest-session statuses that make a requirement ACTIVE, in lifecycle order. */
export const ACTIVE_SESSION_STATUSES = Object.freeze([
    'starting', 'waiting', 'planning', 'active', 'review', 'completing',
]);

/** Requirement statuses that close it out of the box whatever its session says. */
export const INACTIVE_REQUIREMENT_STATUSES = Object.freeze(['deferred', 'wontfix']);

/**
 * @param {{rows?: Array<{reqIds?: number[]}>,
 *          requirements?: Array<Object>,
 *          hiddenMachines?: Set}} sources
 *   `rows` in display order (the visualizer's own); `requirements` the plan's
 *   requirement projection carrying `session_status`.
 * @returns {Array<{id: number, title: string, sessionStatus: string,
 *                  status: string, machineFk: ?number}>}
 */
export function activePlanRequirements({ rows, requirements, hiddenMachines } = {}) {
    const byId = new Map();
    for (const r of (requirements || [])) {
        if (r && r.id != null) byId.set(Number(r.id), r);
    }
    const out = [];
    const seen = new Set();
    for (const row of (rows || [])) {
        for (const raw of (row?.reqIds || [])) {
            const id = Number(raw);
            if (seen.has(id)) continue;
            const r = byId.get(id);
            if (!r || !isActiveRequirement(r)) continue;
            if (isMachineHidden(r.machine_fk, hiddenMachines)) continue;
            seen.add(id);
            out.push({
                id, title: r.title ?? '', sessionStatus: r.session_status,
                status: r.requirement_status, machineFk: r.machine_fk ?? null,
            });
        }
    }
    return out;
}

/** True when the requirement's latest session is active and it is not closed out. */
export function isActiveRequirement(r) {
    if (!r) return false;
    if (INACTIVE_REQUIREMENT_STATUSES.includes(r.requirement_status)) return false;
    return ACTIVE_SESSION_STATUSES.includes(r.session_status);
}
