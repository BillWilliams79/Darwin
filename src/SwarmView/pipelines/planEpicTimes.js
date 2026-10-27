// planEpicTimes.js — an epic card's START and END time (req #3825). Pure: plain
// rows in, stamps and clock strings out. No React, no clock.
//
// AN EPIC HAS NO STATE (req #3750) and no time of its own (req #3752 dropped
// `epics.completed_at`), so both times are DERIVED from the epic's
// GATING requirements on every render — never stored:
//
//   START  the FIRST swarm start of any of them: the earliest `started_at` of a
//          swarm session linked to one (`requirement_sessions`) — across a
//          relaunch, the first launch. A requirement with no linked session
//          falls back to its own `started_at`, which is stamped while it is in
//          `development`. A session that started after its requirement closed
//          is not a start (the Primary's closeout record — see `epicStartAt`).
//   END    the LAST of them to come back closed: the latest `completed_at`
//          (`met`, `wontfix`) or `deferred_at` (`deferred` stamps that one and
//          clears `completed_at`), and only once the epic holds no open work
//          (`open_req_ids` empty) — the moment its dependency gate cleared. A
//          epic with open work has no end yet.
//
// STAMPS ARE COMPARED AS INSTANTS, NEVER AS STRINGS: the session read arrives
// through the generic GET (`JSON_OBJECT`, `2026-10-23 15:00:00.000000`) and
// the requirement stamps through the composed read (`isoformat()`,
// `2026-10-23T09:00:00`), and `' '` sorts before `'T'`.
//
// WHY THE SESSION AND NOT THE REQUIREMENT'S OWN `started_at`: a requirement's
// status transition re-derives all three of its timestamps, so going `met`
// CLEARS `started_at` (darwin-mcp `requirements.py::_STATUS_TIMESTAMP`). A
// finished epic's requirements carry no start at all; the session row keeps it.
// The page already reads both the junction and a light session projection, so
// this costs no fetch.
//
// Tracking CONTAINERS are excluded, as they are from gating (req #3123): a
// container stays `development` for its plan's life and its session is the
// plan's, not the epic's.

import { TERMINAL_REQUIREMENT_STATUSES } from './pipelineModel';

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * A stamp as a `Date`, or null for no stamp or an unparseable one. Stamps are
 * UTC and arrive without a zone suffix (RDS `time_zone = UTC`), so one is
 * added before parsing — the same rule `pipelinePlanTime.localDayOf` applies.
 */
export function parseStamp(at) {
    if (at == null || at === '') return null;
    if (at instanceof Date) return Number.isNaN(at.getTime()) ? null : at;
    const str = String(at).trim().replace(' ', 'T');
    const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(str) ? str : `${str}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** The later (or earlier) of two stamps, compared as instants; an unparseable
 *  stamp never wins. */
const pick = (a, b, takeB) => {
    const ta = parseStamp(a)?.getTime();
    const tb = parseStamp(b)?.getTime();
    if (tb == null) return ta == null ? null : a;
    if (ta == null) return b;
    return takeB(ta, tb) ? b : a;
};
const later = (a, b) => pick(a, b, (ta, tb) => tb > ta);
const earlier = (a, b) => pick(a, b, (ta, tb) => tb < ta);

/**
 * Each requirement's FIRST swarm start: requirement id -> the earliest
 * `started_at` among the sessions linked to it.
 *
 * @param {Object} args
 * @param {Object[]} args.requirementSessions  requirement_sessions junction rows
 * @param {Object[]} args.sessions             swarm_sessions {id, started_at}
 * @returns {Map<number, string>}
 */
export function buildFirstStartIndex({ requirementSessions, sessions } = {}) {
    const startBySession = new Map();
    for (const s of asArray(sessions)) {
        if (s == null || s.id == null || !s.started_at) continue;
        startBySession.set(Number(s.id), String(s.started_at));
    }
    const first = new Map();
    for (const link of asArray(requirementSessions)) {
        if (link == null) continue;
        const rid = Number(link.requirement_fk);
        const at = startBySession.get(Number(link.session_fk));
        if (!Number.isFinite(rid) || at == null) continue;
        first.set(rid, earlier(first.get(rid), at));
    }
    return first;
}

/**
 * The epic's START, or null when none of its gating work has a start.
 *
 * @param {number[]} gatingIds
 * @param {Map<number, Object>} reqsById
 * @param {?Map<number, string>} firstStarts  `buildFirstStartIndex` output
 * @returns {?string}
 */
export function epicStartAt(gatingIds, reqsById, firstStarts) {
    let at = null;
    for (const rid of asArray(gatingIds)) {
        const req = reqsById.get(rid);
        let own = firstStarts?.get(Number(rid)) ?? null;
        // A session that STARTED AFTER its requirement closed did not start the
        // work: it is the Primary's closeout record, written already
        // `completed` seconds after it closed the requirement it executed
        // itself (measured in production: epic 160, req #3097, session 2490
        // started 30s after `completed_at`). Counting it would put the card's
        // start after its end.
        const closed = parseStamp(req?.completed_at || req?.deferred_at);
        if (own != null && closed != null && parseStamp(own)?.getTime() > closed.getTime()) {
            own = null;
        }
        if (own == null && req?.started_at) own = String(req.started_at);
        at = earlier(at, own);
    }
    return at;
}

/**
 * The epic's END, or null while it holds open work (or holds no gating work,
 * or none of its closed work carries a `completed_at` / `deferred_at`).
 *
 * @param {number[]} gatingIds
 * @param {number[]} openReqIds  the derivation's `open_req_ids`
 * @param {Map<number, Object>} reqsById
 * @returns {?string}
 */
export function epicEndAt(gatingIds, openReqIds, reqsById) {
    const ids = asArray(gatingIds);
    if (ids.length === 0 || asArray(openReqIds).length > 0) return null;
    let at = null;
    for (const rid of ids) {
        const req = reqsById.get(rid);
        const closed = req?.completed_at || req?.deferred_at;
        if (closed) at = later(at, String(closed));
    }
    return at;
}

/**
 * Has any of the epic's gating work BEGUN — in flight or closed? Answered from
 * the composed read alone, so the card reserves its time line before the
 * session read lands rather than growing under the reader when it does.
 *
 * @param {number[]} gatingIds
 * @param {Map<number, Object>} reqsById
 * @returns {boolean}
 */
export function epicWorkBegun(gatingIds, reqsById) {
    return asArray(gatingIds).some((rid) => {
        const status = reqsById.get(rid)?.requirement_status;
        return status === 'development' || TERMINAL_REQUIREMENT_STATUSES.includes(status);
    });
}

/**
 * A stamp as the reader's LOCAL wall-clock time, `hh:mmAM` / `hh:mmPM`
 * (`09:05AM`, `12:40PM`), or null for no stamp or an unparseable one. Local
 * like the plan's day columns (`localDayOf`), so a card's times and the ruler
 * above it always agree on the day.
 *
 * @param {?(string|Date)} at
 * @returns {?string}
 */
export function formatClock(at) {
    const d = parseStamp(at);
    if (d == null) return null;
    const h24 = d.getHours();
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h12)}:${pad(d.getMinutes())}${h24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * Whole LOCAL calendar days from `from` to `to` (0 on the same day), or 0 when
 * either is missing or unparseable. Days, not 24-hour periods: 11PM to 1AM is
 * one day later.
 *
 * @param {?(string|Date)} from
 * @param {?(string|Date)} to
 * @returns {number}
 */
export function localDaysBetween(from, to) {
    const a = parseStamp(from);
    const b = parseStamp(to);
    if (a == null || b == null) return 0;
    const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.round((midnight(b) - midnight(a)) / 86400000);
}

/**
 * The END as the card writes it: `formatClock`, plus `+Nd` when it falls N
 * local days after the START — so an epic that ran overnight reads `11:23PM …
 * 01:53AM+1d`, never as an end that came before its start (production holds 11
 * finished epics that spanned more than a day). No start, no suffix.
 *
 * @param {?string} startAt
 * @param {?string} endAt
 * @returns {?string}
 */
export function formatEndClock(startAt, endAt) {
    const clock = formatClock(endAt);
    if (clock == null) return null;
    const days = localDaysBetween(startAt, endAt);
    return days > 0 ? `${clock}+${days}d` : clock;
}

// ── THE TIME CHIP'S THREE STATES (req #3963) ────────────────────────────────
// The toolbar's Time chip cycles off → time → date → off. `time` is the
// card's line as req #3825 drew it (`hh:mmAM`, `+Nd` on a later day); `date`
// puts the local date in front of each (`Oct 26 09:05AM`), in the ruler's own
// month-day form (`slotTickText`), and drops `+Nd`, which the date makes
// redundant. Two stamps of that width fit the narrowest card rung.
export const EPIC_TIME_MODES = Object.freeze(['off', 'time', 'date']);
export const DEFAULT_EPIC_TIME_MODE = 'time';

/**
 * A stored mode, normalized. The setting kept its req #3825 storage key, which
 * held a flag ('1' on / '0' off), so those two still read as `time` / `off`;
 * anything unrecognised reads as the default.
 *
 * @param {*} raw
 * @returns {'off'|'time'|'date'}
 */
export function normalizeEpicTimeMode(raw) {
    if (EPIC_TIME_MODES.includes(raw)) return raw;
    if (raw === '0' || raw === false) return 'off';
    if (raw === '1' || raw === true) return 'time';
    return DEFAULT_EPIC_TIME_MODE;
}

/** The mode the Time chip moves to from `mode`. */
export function nextEpicTimeMode(mode) {
    const i = EPIC_TIME_MODES.indexOf(normalizeEpicTimeMode(mode));
    return EPIC_TIME_MODES[(i + 1) % EPIC_TIME_MODES.length];
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A stamp's LOCAL date as `Oct 26`, or null for no stamp or an unparseable
 * one. Local for the same reason `formatClock` is.
 *
 * @param {?(string|Date)} at
 * @returns {?string}
 */
export function formatDate(at) {
    const d = parseStamp(at);
    if (d == null) return null;
    return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

/**
 * The START as the card writes it in `mode`: `formatClock`, with the date in
 * front in `date` mode. Null in `off` mode or for no stamp.
 *
 * @param {?string} at
 * @param {'off'|'time'|'date'} mode
 * @returns {?string}
 */
export function formatStartStamp(at, mode) {
    if (mode === 'off') return null;
    const clock = formatClock(at);
    if (clock == null) return null;
    return mode === 'date' ? `${formatDate(at)} ${clock}` : clock;
}

/**
 * The END as the card writes it in `mode`: `formatEndClock` (with `+Nd`), or
 * the date and the clock in `date` mode. Null in `off` mode or for no stamp.
 *
 * @param {?string} startAt
 * @param {?string} endAt
 * @param {'off'|'time'|'date'} mode
 * @returns {?string}
 */
export function formatEndStamp(startAt, endAt, mode) {
    if (mode === 'off') return null;
    if (mode === 'date') return formatStartStamp(endAt, 'date');
    return formatEndClock(startAt, endAt);
}
