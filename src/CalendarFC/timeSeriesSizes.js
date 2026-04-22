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

// Visualization mode — Bead Necklace (default) or Swarm Visualizer.
export const VIZ_KEYS = ['bead', 'swarm'];
export const VIZ_LABELS = { bead: 'Bead', swarm: 'Swarm' };
export const DEFAULT_VIZ = 'bead';

// Time Series data-selection mode (req #2382).
// 'category'    — chip color from requirement.category_fk → category.color (default / unchanged).
// 'coordination' — chip color from requirement.coordination_type (red/orange/yellow/green).
export const DATA_KEYS = ['category', 'coordination'];
export const DEFAULT_DATA_KEY = 'category';

// Chip colors when dataKey === 'coordination'. Null / unknown coordination_type
// falls back to red, making "no setting" visible at a glance — matches the spec
// in req #2382 ("red = no setting").
export const COORDINATION_COLORS = {
    planned:     '#FB8C00',   // orange — planning phase
    implemented: '#FDD835',   // yellow — built but not yet deployed
    deployed:    '#43A047',   // green — shipped
};
export const COORDINATION_FALLBACK_COLOR = '#E53935'; // red — no coordination set
export function getCoordinationColor(coordinationType) {
    return COORDINATION_COLORS[coordinationType] || COORDINATION_FALLBACK_COLOR;
}

// ── Swarm start-time clustering (req #2341) ─────────────────────────────────────
// Sessions whose started_at fall within this window are treated as a single swarm
// and share one canonical start X so their vertical start-bars line up.
export const SWARM_CLUSTER_WINDOW_MS = 3 * 60 * 1000;   // 3 minutes

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
        const ms = new Date(s.started_at).getTime();
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

