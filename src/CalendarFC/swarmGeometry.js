// ─────────── Swarm-visualizer geometry helpers ──────────────────────────────
// Pure, render-agnostic builders for the swarm visualizer's lane/chip/cross-day
// math. Extracted from the retired SVG/DOM TimeSeriesView (req #2844) so the
// Konva canvas (konvaSwarmModel.js + KonvaSwarmCanvas.jsx) — now the only
// substrate — keeps the helpers it depends on. No React, no DOM: everything here
// is a pure function unit-tested in __tests__/swarmGeometry.test.js.
//
// Dependency DAG: this module imports from timeSeriesSizes.js and dateFormat.js;
// neither imports back, so there is no cycle.

import { formatHM12, toLocaleDateString } from '../utils/dateFormat';
import {
    getCoordinationColor,
    indexSessionsByRequirement,
    parseSessionRequirementId,
} from './timeSeriesSizes';

// Session statuses that suppress phantom-chip rendering (req #2650).
// A "phantom" represents the in-progress portion of a session; statuses that
// indicate the session is NOT actively running must not produce one:
//   • null/empty   — session lacks a status, nothing to surface.
//   • 'completed'  — the work is drawn as a real (non-phantom) chip when its
//                    requirement's completed_at lands in the window.
//   • 'paused'     — the user explicitly paused the session; it must not
//                    appear as today's "unfinished business" until resumed.
// Blacklist, not whitelist: any future session status defaults to rendering,
// which is the safer failure mode (callers extend the list as needed).
// Exported for unit-test coverage.
export const isHiddenSwarmStatus = (status) => {
    if (!status) return true;
    return status === 'completed' || status === 'paused';
};

// Outer autonomy ring color for a chip (req #2423 completed chips, req #2755
// phantom/in-progress chips). The ring is only present when the Coordination
// data toggle is on; otherwise there is no ring (null). Shared by both the
// completed-chip and phantom-chip construction paths so they stay in lockstep.
// Exported for unit-test coverage.
export const coordinationRingColor = (dataKey, coordinationType) =>
    dataKey === 'coordination' ? getCoordinationColor(coordinationType) : null;

// Exported for unit-test coverage.
export const computePhantomPlacement = (startPct, nowPct) => {
    const startIn = startPct !== null && startPct !== undefined;
    const nowIn   = nowPct   !== null && nowPct   !== undefined;
    if (startIn && nowIn) {
        return { phantomStartPct: startPct, phantomLeftPct: nowPct, startClamped: false };
    }
    if (startIn && !nowIn) {
        // Start visible but "now" is on a later panel — this is the start (or an
        // intervening) day of a multi-day in-progress session. No bubble belongs
        // here; the cross-day dashed line carries it to the panel edge (req #2798).
        return null;
    }
    if (!startIn && nowIn) {
        return { phantomStartPct: 0, phantomLeftPct: nowPct, startClamped: true };
    }
    return null;
};

// Req #2719 — undone-session chip builder. Pure function so it's testable in
// isolation; the renderer wrapping it just supplies the live data + the
// xPctFn closure.
//
// Math invariants: startPct from swarm_start.started_at, leftPct from
// undo.undone_at, markerMode resolves normal/clamped/left exactly like a
// completed chip. Returns [] when no undos in window.
//
// Exported for unit-test coverage.
export const buildUndoneChips = ({
    swarmUndos,
    swarmStarts,
    xPctFn,
    timezone,
    selectedDate,
    requirementById,
    categoryList,
    // 1.5 default mirrors the BeadRow-local CLOSE_THRESHOLD_PCT — kept in sync
    // by the unit test (any divergence shows up as a chip markerMode mismatch).
    closeThresholdPct = 1.5,
    formatHHMM = formatHM12,
}) => {
    if (!Array.isArray(swarmUndos) || swarmUndos.length === 0) return [];

    const startById = new Map();
    for (const ss of (swarmStarts || [])) {
        if (ss && ss.id != null) startById.set(String(ss.id), ss);
    }

    const out = [];
    for (const undo of swarmUndos) {
        if (!undo || !undo.undone_at) continue;
        const leftPct = xPctFn(undo.undone_at, timezone, selectedDate);
        if (leftPct === null) continue;

        const ss = undo.swarm_start_fk_at_undo != null
            ? startById.get(String(undo.swarm_start_fk_at_undo))
            : null;
        const canonicalStartedAt = ss?.started_at || undo.undone_at;
        const rawStart = canonicalStartedAt
            ? xPctFn(canonicalStartedAt, timezone, selectedDate)
            : null;
        let startPct = rawStart;
        let startClamped = false;
        let markerMode = 'normal';
        if (startPct === null && canonicalStartedAt) {
            startPct = 0;
            startClamped = true;
            markerMode = 'clamped';
        } else if (
            startPct !== null &&
            Math.abs(leftPct - startPct) < closeThresholdPct
        ) {
            markerMode = 'left';
        }

        const reqId = undo.req_id_at_undo != null ? String(undo.req_id_at_undo) : null;
        const r = reqId && requirementById ? requirementById.get(reqId) : null;
        const cat = r ? categoryList.find(c => c.id === r.category_fk) : null;

        out.push({
            id: r ? r.id : (undo.req_id_at_undo ?? null),
            chipKey: `undone-${undo.id}`,
            title: r?.title || undo.task_name || '(undone)',
            completed_at: undo.undone_at,
            category_fk: r?.category_fk ?? null,
            requirement_status: r?.requirement_status ?? null,
            coordination_type: r?.coordination_type
                || undo.coordination_type
                || null,
            categoryName: cat?.category_name || null,
            color: '#9E9E9E',
            ringColor: null,
            timeHHMM: formatHHMM(undo.undone_at, timezone),
            leftPct,
            startPct,
            startClamped,
            markerMode,
            session: null,
            swarmStartId: ss ? ss.id : null,
            swarmStart: ss || null,
            groupKey: canonicalStartedAt || '',
            timezone,
            isUndone: true,
            undo,
        });
    }
    return out;
};

// ─────────── Swarm-lane layout (Swarm mode) ───────────────────────────────────
// Each (requirement, session) pair — or bare requirement with no session — gets
// its own row. Sort order (req #2504 swarm-start grouping):
//   1. `groupKey` — canonical cluster start (real swarm_start.started_at or
//      the time-window cluster's earliest started_at). Chips that launched
//      together share one groupKey, so they sit in contiguous rows ("clumps"
//      of parallel autonomy) rather than scattered through the lane stack.
//   2. Within a group, `completed_at` — requirement closure time.
//   3. `chipKey` tiebreak for deterministic ordering.
// Direction:
//   topDown=false — ascending: row 0 = earliest group + earliest completion.
//   topDown=true  — descending: row 0 = latest group + latest completion.
// Chips missing a groupKey (singletons with no canonical attached) sort to
// one end of the stack — away from the grouped clusters.
// Exported for unit-test coverage.
export const assignSwarmLanes = (chips, topDown = false) => {
    const sorted = [...chips].sort((a, b) => {
        // Primary: groupKey (canonical cluster start) — keeps co-launched
        // sessions contiguous in the lane stack.
        const aG = a.groupKey || '';
        const bG = b.groupKey || '';
        if (aG !== bG) {
            const cmp = aG.localeCompare(bG);
            return topDown ? -cmp : cmp;
        }
        // Secondary: completion time within the group.
        const aT = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bT = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        if (aT !== bT) return topDown ? bT - aT : aT - bT;
        // Tiebreak: stable by chipKey / id for deterministic ordering, mirroring
        // the primary sort direction so ties flow the same way as the time sort.
        const key = String(a.chipKey || a.id).localeCompare(String(b.chipKey || b.id));
        return topDown ? -key : key;
    });
    return sorted.map((chip, idx) => ({ ...chip, row: idx }));
};

// ─────────── Cross-day ghost occupants ───────────────────────────────────────
// Cross-day pass-through lines join a day's lane assignment as "ghost"
// occupants so same-day bubbles pack around them instead of sharing a lane
// (req #2747 — fixes a dashed line drawn over an unrelated bubble that closed on
// an intermediate day). Each ghost carries the cluster `groupKey` + the
// requirement's end-day `completed_at`, so assignSwarmLanes seats it contiguously
// with its cluster-mates. The original `crossDay` entry rides along so the
// renderer can read role/pct/card after the lane is resolved. Returns [] for
// empty input. Exported for unit-test coverage of the field mapping.
export const buildCrossDayGhosts = (crossDays) => {
    if (!Array.isArray(crossDays) || crossDays.length === 0) return [];
    return crossDays.map((cd, i) => ({
        chipKey: `xdghost-${cd.sessionId}-${cd.role}-${i}`,
        id: cd.card?.id ?? null,
        groupKey: cd.groupKey || '',
        completed_at: cd.completedAt || null,
        isCrossDayGhost: true,
        crossDay: cd,
    }));
};

// ─────────── Cross-day pass-through map ───────────────────────────────────────
// Build Map<YYYY-MM-DD, crossDayEntry[]> for every multi-day session span that
// touches one of `dates`. A "span" is a (session, requirement) pair whose
// started_at day differs from its end day:
//   • completed requirement → end day = completion day (the met bubble draws it)
//   • in-progress session    → end day = today (the phantom draws today's bubble)
// On each day strictly between start and end a full-width 'middle' dashed line is
// emitted; on the start day a 'start' entry (partial dashed tail + swarm-start
// bar) is emitted. The end day itself gets NO entry — its own bubble terminates
// the line (req #2798).
//
// Two span SOURCES, mirroring the two bubble paths so the lines and bubbles
// always agree on which sessions are multi-day:
//   A. Completed — iterate `requirements` (completed-in-window) × linked sessions.
//   B. In-progress — iterate `swarmStarts` × junction sessions whose requirement
//      (looked up in `requirementById`, sourced from allRequirements) is NOT yet
//      completed and whose status is not hidden.
//
// `startXPct(t, tz, day)` positions the start bar in the panel's own coordinate
// system. Returns null off-window; such 'start' entries are skipped.
// Exported for unit-test coverage.
export const buildCrossDayMap = (dates, {
    requirements = [],
    sessions = [],
    swarmStarts = [],
    swarmStartSessions = [],
    requirementById = null,
    categoryList = [],
    canonicalStartById = null,
    swarmStartIdById = null,
    swarmStartById = null,
    timezone,
    startXPct,
    today = null,
} = {}) => {
    const map = new Map();
    if (!Array.isArray(dates) || dates.length === 0) return map;
    const dateSet = new Set(dates);
    const todayStr = today || toLocaleDateString(new Date().toISOString(), timezone);
    const catById = new Map((categoryList || []).map(c => [c.id, c]));

    const push = (d, entry) => {
        const arr = map.get(d);
        if (arr) arr.push(entry); else map.set(d, [entry]);
    };

    // Emit start/middle entries for one multi-day span across the visible dates.
    const emitSpan = (s, r, endDay, inProgress) => {
        if (!s || !s.started_at || !endDay) return;
        const startDay = toLocaleDateString(s.started_at, timezone);
        if (!startDay || startDay >= endDay) return;   // single-day / nonsensical
        const sKey = String(s.id);
        const canonicalStart = canonicalStartById?.get(sKey) ?? s.started_at;
        const swarmStartId  = swarmStartIdById?.get(sKey) ?? null;
        const swarmStartRow = swarmStartById?.get(sKey) ?? null;
        const cat = r ? catById.get(r.category_fk) : null;
        const card = {
            id: r ? r.id : null,
            title: r?.title || '',
            categoryName: cat?.category_name || null,
            color: cat?.color || null,
            requirement_status: r?.requirement_status || null,
            coordination_type: r?.coordination_type || null,
            completed_at: r?.completed_at || null,
            inProgress,
            timezone,
            session: s,
            swarmStartId,
            swarmStart: swarmStartRow,
        };
        const occupant = {
            sessionId: s.id,
            // groupKey clusters the ghost with its swarm-start mates; completedAt
            // orders it within that cluster (in-progress uses the session start,
            // mirroring the phantom's within-group sort key).
            groupKey: canonicalStart || '',
            completedAt: inProgress ? s.started_at : (r?.completed_at || null),
            inProgress,
            card,
        };
        for (const d of dates) {
            if (d === startDay) {
                const startPct = startXPct ? startXPct(canonicalStart, timezone, d) : null;
                if (startPct === null || startPct === undefined) continue;
                push(d, { ...occupant, role: 'start', pct: startPct });
            } else if (d > startDay && d < endDay) {
                push(d, { ...occupant, role: 'middle' });
            }
        }
    };

    // A. Completed spans — completion bubble draws the end day; cross-day lines
    // carry the earlier days. Skip when the completion day is off-window (the
    // dangling-line guard the week stack always used).
    const sessionsByReq = indexSessionsByRequirement(sessions);
    for (const r of (requirements || [])) {
        if (!r || !r.completed_at) continue;
        const completedDay = toLocaleDateString(r.completed_at, timezone);
        if (!completedDay || !dateSet.has(completedDay)) continue;
        const linked = sessionsByReq.get(String(r.id)) || [];
        for (const s of linked) emitSpan(s, r, completedDay, false);
    }

    // B. In-progress spans — swarm-start linked, mirroring the phantom bubble
    // path so the dashed line and today's phantom bubble agree on which open
    // sessions are multi-day.
    if (Array.isArray(swarmStarts) && swarmStarts.length) {
        const sessionsByStartFk = new Map();
        for (const j of (swarmStartSessions || [])) {
            if (!j || j.swarm_start_fk == null || j.session_fk == null) continue;
            const k = String(j.swarm_start_fk);
            if (!sessionsByStartFk.has(k)) sessionsByStartFk.set(k, []);
            sessionsByStartFk.get(k).push(String(j.session_fk));
        }
        const sessionById = new Map();
        for (const s of (sessions || [])) {
            if (s && s.id != null) sessionById.set(String(s.id), s);
        }
        const seen = new Set();   // a session linked to >1 start draws one line
        for (const ss of swarmStarts) {
            if (!ss || ss.id == null) continue;
            const linked = sessionsByStartFk.get(String(ss.id)) || [];
            for (const sid of linked) {
                if (seen.has(sid)) continue;
                const s = sessionById.get(sid);
                if (!s) continue;
                if (isHiddenSwarmStatus(s.swarm_status)) continue;
                const reqId = parseSessionRequirementId(s.source_ref);
                const r = reqId && requirementById ? requirementById.get(reqId) : null;
                if (r && r.completed_at) continue;   // completed → path A / met bubble
                seen.add(sid);
                emitSpan(s, r, todayStr, true);
            }
        }
    }
    return map;
};

// req #2828 — per-date lane parity for alternating day-lane backgrounds. Keyed
// off the date (days-since-epoch parity), so adjacent calendar days ALWAYS
// alternate and a given day keeps its shade as the canvas pans. Returns
// 'even' | 'odd'. Unit-tested in __tests__/swarmGeometry.test.js.
export const laneParityFor = (s) => {
    if (!s) return 'even';
    const ms = Date.parse(`${s}T00:00:00Z`);
    if (Number.isNaN(ms)) return 'even';
    const dayNum = Math.floor(ms / 86400000);
    // dates are post-epoch in practice; the +2 guard keeps it correct anyway.
    return (((dayNum % 2) + 2) % 2) === 0 ? 'even' : 'odd';
};
