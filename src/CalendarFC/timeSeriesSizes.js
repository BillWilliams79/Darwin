// Size tables for Time Series UI Options bar.
// Exported so unit tests can verify the mapping and bounds.

// Hover datacard (tooltip) font size — A is the default / baseline.
export const FONT_SIZES = {
    A: '0.75rem',   // 12px — current MUI Tooltip baseline
    B: '0.875rem',  // 14px
    C: '1rem',      // 16px
    D: '1.125rem',  // 18px
};
export const FONT_SIZE_KEYS = ['A', 'B', 'C', 'D'];
export const DEFAULT_FONT_SIZE = 'B';  // user preference 2026-04-18

// Bead / requirement-circle diameter in pixels — 1 is the default / baseline.
export const CIRCLE_SIZES = {
    1: 12,
    2: 16,
    3: 20,
    4: 24,
};
export const CIRCLE_SIZE_KEYS = [1, 2, 3, 4];
export const DEFAULT_CIRCLE_SIZE = 3;  // user preference 2026-04-18

export function getFontSize(key) {
    return FONT_SIZES[key] || FONT_SIZES[DEFAULT_FONT_SIZE];
}

export function getCircleSize(key) {
    return CIRCLE_SIZES[key] || CIRCLE_SIZES[DEFAULT_CIRCLE_SIZE];
}

// Human-readable coordination labels for the hover datacard.
export const COORDINATION_LABELS = {
    discuss:     'Discuss Req',
    planned:     'Planned',
    implemented: 'Implemented',
    deployed:    'Deployed',
};
export function formatCoordination(coordinationType) {
    if (!coordinationType) return '—';
    return COORDINATION_LABELS[coordinationType] || coordinationType;
}

// ── Swarm Visualizer — parse session.source_ref to link sessions to requirements ──
// Expected format: "requirement:<numeric id>", e.g. "requirement:2251".
// Returns the requirement id (as a string, matching requirement.id stringification) or null.
export function parseSessionRequirementId(sourceRef) {
    if (!sourceRef || typeof sourceRef !== 'string') return null;
    const m = sourceRef.match(/^requirement:(\d+)$/);
    return m ? m[1] : null;
}

// Group sessions by requirement id. Returns a Map<string, Array<session>>.
export function indexSessionsByRequirement(sessions) {
    const map = new Map();
    if (!Array.isArray(sessions)) return map;
    for (const s of sessions) {
        const reqId = parseSessionRequirementId(s?.source_ref);
        if (!reqId) continue;
        if (!map.has(reqId)) map.set(reqId, []);
        map.get(reqId).push(s);
    }
    // Sort each requirement's sessions by started_at ascending for stable stacking.
    for (const list of map.values()) {
        list.sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')));
    }
    return map;
}

// Bubble white-space levels — multiplier applied to row spacing and container height.
// 1 = current baseline; 2/3/4 = progressively roomier. Day view only (Week stays tight).
export const SPACE_KEYS = [1, 2, 3, 4];
export const DEFAULT_SPACE = 2;   // Day-view preference 2026-04-18
export const SPACE_MULTIPLIERS = { 1: 1, 2: 1.35, 3: 1.7, 4: 2.1 };
export function getSpaceMultiplier(key) {
    return SPACE_MULTIPLIERS[key] || SPACE_MULTIPLIERS[DEFAULT_SPACE];
}

// Zoom levels — how wide a time window each Bead/Swarm card spans.
// X is the default (the 24h and 36h windows the user already selected). W zooms
// in (less time visible), Y/Z zoom out (more hours shown per card). Only applies
// when the Sidewalk is OFF — the sidewalk scrubs continuously and is immune.
export const ZOOM_KEYS = ['W', 'X', 'Y', 'Z'];
export const DEFAULT_ZOOM = 'X';
export const ZOOM_HOURS = {
    W: { '24h': 12, '36h': 18 },
    X: { '24h': 24, '36h': 36 },   // default — same as beadWindow selector
    Y: { '24h': 36, '36h': 48 },
    Z: { '24h': 48, '36h': 72 },
};
export function getZoomHours(zoomKey, beadWindow) {
    const row = ZOOM_HOURS[zoomKey] || ZOOM_HOURS[DEFAULT_ZOOM];
    return row[beadWindow] || row['24h'];
}

// Time Series data-selection mode (req #2382).
// 'category'    — chip color from requirement.category_fk → category.color (default / unchanged).
// 'coordination' — chip color from requirement.coordination_type (red/orange/yellow/green).
export const DATA_KEYS = ['category', 'coordination'];
export const DEFAULT_DATA_KEY = 'category';

// Chip colors when dataKey === 'coordination'. Null / unknown coordination_type
// falls back to red, making "no setting" visible at a glance — matches the spec
// in req #2382 ("red = no setting").
export const COORDINATION_COLORS = {
    discuss:     '#AB47BC',   // purple — needs discussion before any work (req #2745)
    planned:     '#FB8C00',   // orange — planning phase
    implemented: '#FDD835',   // yellow — built but not yet deployed
    deployed:    '#43A047',   // green — shipped
};
export const COORDINATION_FALLBACK_COLOR = '#E53935'; // red — no coordination set
export function getCoordinationColor(coordinationType) {
    return COORDINATION_COLORS[coordinationType] || COORDINATION_FALLBACK_COLOR;
}

// ── Session phase-duration segmentation (req #2823) ─────────────────────────────
// req #2332 records per-phase second-buckets on every instrumented swarm_session.
// The broad visualizer's "Phases" overlay segments each completed session's
// start→complete duration line proportionally so you can see at a glance where
// time went and which side of the agentic/human divide it fell on.
//
//   agentic = Claude working autonomously — starting (machine setup), planning,
//             implementing, completion. Cool hues (blue-grey → indigo → blue → teal).
//   human   = waiting on the user — waiting (discuss idle), review, paused.
//             Warm hues (amber → orange → brown).
//
// Order: the agentic block first, then the human block, so the two families read
// as two contiguous colour runs and the divide is a single boundary. These are
// AGGREGATE buckets, not a literal timeline, so family-grouping (clearest "where
// did time go" read) is preferred over reconstructing lifecycle order.
export const PHASE_SEGMENTS = [
    { key: 'starting_secs',     label: 'Starting',     family: 'agentic', color: '#90A4AE' }, // blue-grey
    { key: 'planning_secs',     label: 'Planning',     family: 'agentic', color: '#5C6BC0' }, // indigo
    { key: 'implementing_secs', label: 'Implementing', family: 'agentic', color: '#1E88E5' }, // blue
    { key: 'completion_secs',   label: 'Completion',   family: 'agentic', color: '#26A69A' }, // teal
    { key: 'waiting_secs',      label: 'Waiting',      family: 'human',   color: '#FFB300' }, // amber
    { key: 'review_secs',       label: 'Review',       family: 'human',   color: '#FB8C00' }, // orange
    { key: 'paused_secs',       label: 'Paused',       family: 'human',   color: '#8D6E63' }, // brown
];

// Pre-instrumentation (instrumented=0) and no-phase-data sessions render a single
// neutral-gray segment — an explicit "unknown split", never mistaken for a phase.
export const PHASE_UNCLASSIFIED_COLOR = '#9E9E9E';

// `instrumented` arrives from the JSON API as 1/0, true/false, or "1"/"0".
const isInstrumented = (v) => v === 1 || v === true || v === '1';

// Split the [startPct, endPct] duration span into proportional phase segments.
// Returns:
//   { classified: false, segments: [] }  — session missing, not instrumented, or
//                                           zero total phase time → caller draws a
//                                           single neutral-gray unclassified line.
//   { classified: true, segments: [...] } — one entry per NON-ZERO bucket, in
//                                           PHASE_SEGMENTS order, each
//                                           { key, label, family, color, secs,
//                                             x1Pct, x2Pct } spanning its slice.
// The final segment's x2Pct is pinned exactly to endPct to absorb float drift.
// Pure + exported for unit-test coverage.
export function computePhaseSegments(session, startPct, endPct) {
    if (session == null || startPct == null || endPct == null) {
        return { classified: false, segments: [] };
    }
    if (!isInstrumented(session.instrumented)) {
        return { classified: false, segments: [] };
    }
    const buckets = PHASE_SEGMENTS.map((p) => {
        const v = Number(session[p.key]);
        return { ...p, secs: Number.isFinite(v) && v > 0 ? v : 0 };
    });
    const total = buckets.reduce((sum, b) => sum + b.secs, 0);
    if (total <= 0) return { classified: false, segments: [] };

    const span = endPct - startPct;
    const segments = [];
    let cursor = startPct;
    for (const b of buckets) {
        if (b.secs <= 0) continue;
        const x1Pct = cursor;
        cursor += span * (b.secs / total);
        segments.push({
            key: b.key, label: b.label, family: b.family, color: b.color,
            secs: b.secs, x1Pct, x2Pct: cursor,
        });
    }
    if (segments.length) segments[segments.length - 1].x2Pct = endPct;
    return { classified: true, segments };
}

// ── Swarm start-time clustering (req #2341) ─────────────────────────────────────
// Sessions whose started_at fall within this window are treated as a single swarm
// and share one canonical start X so their vertical start-bars line up.
export const SWARM_CLUSTER_WINDOW_MS = 3 * 60 * 1000;   // 3 minutes

// Parse a started_at/completed_at value the same way the rest of the
// visualizer does (utils/dateFormat.toDate): MySQL-format "YYYY-MM-DD HH:MM:SS"
// is UTC-stored and must be given an explicit `Z`, otherwise `new Date(...)`
// parses it in the browser's local tz — which silently disagrees with
// positionFor/toLocaleDateString and skews relative deltas across DST
// boundaries. Kept local to this module so timeSeriesSizes stays standalone
// (no circular dep with the dateFormat utility).
function parseStartedAtMs(value) {
    if (!value) return NaN;
    if (typeof value === 'string' && value.includes(' ') && !value.includes('T')) {
        return new Date(value.replace(' ', 'T') + 'Z').getTime();
    }
    return new Date(value).getTime();
}

// Group sessions by proximity of started_at. Any two sessions whose starts are
// within `thresholdMs` of each other belong to the same cluster (transitive).
// Returns:
//   canonical    — Map<string sessionId, ISO started_at of earliest in cluster>
//   clusterSize  — Map<string sessionId, number of members in its cluster>
// Sessions with null/invalid started_at are excluded silently.
export function clusterSessionsByStartTime(sessions, thresholdMs = SWARM_CLUSTER_WINDOW_MS) {
    const canonical = new Map();
    const clusterSize = new Map();
    if (!Array.isArray(sessions) || sessions.length === 0) return { canonical, clusterSize };

    const valid = [];
    for (const s of sessions) {
        if (!s || s.id == null || !s.started_at) continue;
        const ms = parseStartedAtMs(s.started_at);
        if (Number.isNaN(ms)) continue;
        valid.push({ id: String(s.id), startedAt: s.started_at, startMs: ms });
    }
    valid.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));

    let cur = null;
    const clusters = [];
    for (const item of valid) {
        if (!cur || item.startMs - cur.lastMs > thresholdMs) {
            cur = { minStartedAt: item.startedAt, lastMs: item.startMs, members: [] };
            clusters.push(cur);
        }
        cur.members.push(item.id);
        cur.lastMs = item.startMs;
    }
    for (const c of clusters) {
        for (const id of c.members) {
            canonical.set(id, c.minStartedAt);
            clusterSize.set(id, c.members.length);
        }
    }
    return { canonical, clusterSize };
}

// ── Swarm-start-aware clustering (req #2504) ──────────────────────────────────
// Prefer real `swarm_starts` data: when a session is linked to a swarm_start row
// via the swarm_start_sessions junction, group by swarm_start_id (authoritative)
// and use swarm_starts.started_at as the canonical alignment X. Fall back to the
// time-window heuristic from clusterSessionsByStartTime() only for sessions
// without a junction row, or whose junction row points at a missing swarm_start.
//
// Returns:
//   canonical          — Map<sessionId, ISO started_at> (swarm_start.started_at when real,
//                         else the cluster's earliest session start).
//   clusterSize        — Map<sessionId, count>.
//   swarmStartIdById   — Map<sessionId, swarm_start_id | null>. null = estimated.
//   swarmStartById     — Map<sessionId, swarm_start_row | null>. The full row, for
//                         tooltip rendering (id, session_count, wall_seconds, args, …).
//
// Rationale: req #2504 — the visualizer must use real swarm_start data when
// available. Old sessions without a junction row continue to render via the
// time-window heuristic so historical data still produces aligned clusters.
export function clusterSessionsBySwarmStart(
    sessions,
    swarmStartSessions,
    swarmStarts,
    thresholdMs = SWARM_CLUSTER_WINDOW_MS,
) {
    const canonical = new Map();
    const clusterSize = new Map();
    const swarmStartIdById = new Map();
    const swarmStartById = new Map();
    if (!Array.isArray(sessions) || sessions.length === 0) {
        return { canonical, clusterSize, swarmStartIdById, swarmStartById };
    }

    // Junction lookup: sessionId → swarm_start_fk.
    const sessionToStartFk = new Map();
    if (Array.isArray(swarmStartSessions)) {
        for (const j of swarmStartSessions) {
            if (j == null) continue;
            const sid = j.session_fk;
            const fk  = j.swarm_start_fk;
            if (sid == null || fk == null) continue;
            sessionToStartFk.set(String(sid), String(fk));
        }
    }

    // swarm_start_id → swarm_start row.
    const startById = new Map();
    if (Array.isArray(swarmStarts)) {
        for (const ss of swarmStarts) {
            if (ss == null || ss.id == null) continue;
            startById.set(String(ss.id), ss);
        }
    }

    // Partition sessions: those that have a usable swarm_start (junction + row +
    // started_at) cluster by swarm_start_fk; everything else falls through to
    // the legacy time-window estimator.
    const realByFk = new Map();          // swarm_start_fk → [session]
    const fallbackSessions = [];
    for (const s of sessions) {
        if (!s || s.id == null) continue;
        const sid = String(s.id);
        const fk  = sessionToStartFk.get(sid);
        if (fk != null) {
            const row = startById.get(fk);
            if (row && row.started_at) {
                if (!realByFk.has(fk)) realByFk.set(fk, []);
                realByFk.get(fk).push(s);
                continue;
            }
        }
        fallbackSessions.push(s);
    }

    // Real clusters — canonical is the swarm_start row's started_at.
    for (const [fk, members] of realByFk.entries()) {
        const row = startById.get(fk);
        const startedAt = row.started_at;
        for (const s of members) {
            const sid = String(s.id);
            canonical.set(sid, startedAt);
            clusterSize.set(sid, members.length);
            swarmStartIdById.set(sid, row.id);
            swarmStartById.set(sid, row);
        }
    }

    // Fallback — legacy time-window clustering on the un-linked remainder.
    const { canonical: estCanonical, clusterSize: estSize } =
        clusterSessionsByStartTime(fallbackSessions, thresholdMs);
    for (const [sid, t] of estCanonical) {
        canonical.set(sid, t);
        clusterSize.set(sid, estSize.get(sid) || 1);
        swarmStartIdById.set(sid, null);
        swarmStartById.set(sid, null);
    }

    return { canonical, clusterSize, swarmStartIdById, swarmStartById };
}

