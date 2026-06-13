import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { toLocaleDateString, getTimeOfDayFraction, formatCardDateTime, formatHM12, localDateStr } from '../utils/dateFormat';
import {
    DEFAULT_FONT_SIZE,
    getFontSize, getCircleSize, formatCoordination, getCoordinationColor,
    DEFAULT_DATA_KEY,
    DEFAULT_SPACE, getSpaceMultiplier,
    DEFAULT_ZOOM, getZoomHours, ZOOM_HOURS,
    indexSessionsByRequirement,
    parseSessionRequirementId,
    clusterSessionsByStartTime,
    clusterSessionsBySwarmStart,
    computePhaseSegments,
    PHASE_UNCLASSIFIED_COLOR,
} from './timeSeriesSizes';
import './TimeSeriesView.css';

// ─────────── Chip-count helpers (used by Sidewalk height precomputation) ─────
// Bucket chips by their tz-local date string: one chip per (requirement, session)
// pair, or a single bare-requirement chip when a requirement has no linked
// session.
//
// Single pass over `requirements` and `sessions` so the Sidewalk parent can
// size 21 panels without 21 × O(R+S) work (was the 100-200ms stall on scroll
// that made the strip feel frozen — req #2334 follow-up). Callers that want a
// specific date's count can use `countChipsForDate`, which just delegates here.
// Exported for unit-test coverage.
export const indexChipsByDate = (requirements, sessions, timezone) => {
    const map = new Map();
    if (!Array.isArray(requirements)) return map;
    const sessionsByReq = indexSessionsByRequirement(sessions);
    for (const r of requirements) {
        if (!r?.completed_at) continue;
        const d = toLocaleDateString(r.completed_at, timezone);
        if (!d) continue;
        const linked = sessionsByReq.get(String(r.id)) || [];
        const n = linked.length > 0 ? linked.length : 1;
        map.set(d, (map.get(d) || 0) + n);
    }
    return map;
};

export const countChipsForDate = (requirements, sessions, date, timezone) => {
    if (!date) return 0;
    return indexChipsByDate(requirements, sessions, timezone).get(date) || 0;
};

// Stable empty array (req #2800) — the per-day fallback for Sidewalk/Elevator
// panels whose day has no completions. Sharing ONE reference across every empty
// panel keeps their `requirements` prop referentially stable across a window
// refetch, so BeadRow's React.memo (req #2796) skips them instead of re-rendering
// all ≤60 panels at once (the long-task violation storm in req #2800).
export const EMPTY_REQS = [];

// Bucket completed requirements by their tz-local completion date (req #2800).
// The Sidewalk/Elevator strips render one 24h panel per day, and a 24h panel
// only ever shows its own day's chips — `positionFor` rejects anything outside
// ±12h of noon. So each panel needs only its own day's slice, not the whole
// `requirements` array. Handing each panel a per-day slice (with EMPTY_REQS for
// empty days) lets BeadRow's memo engage: a window refetch then re-renders only
// the handful of panels whose day-data actually changed. Exported for tests.
export const bucketByDate = (requirements, timezone) => {
    const map = new Map();
    if (!Array.isArray(requirements)) return map;
    for (const r of requirements) {
        if (!r?.completed_at) continue;
        const d = toLocaleDateString(r.completed_at, timezone);
        if (!d) continue;
        let arr = map.get(d);
        if (!arr) { arr = []; map.set(d, arr); }
        arr.push(r);
    }
    return map;
};

// req #2805 — rendered pixel height of a `.ts-bead-label` title (CSS line-height
// 16px + 1px padding top/bottom). Kept in sync with TimeSeriesView.css so the
// Week-stack row-spacing buffer reserves exactly enough room for a title.
const TITLE_LABEL_HEIGHT = 18;
// Stable empty array (req #2796) — used as the week-stack `crossDays` fallback so
// a day with no cross-day entries passes the SAME reference every parent render
// instead of a fresh `[]` literal, which would defeat BeadRow's React.memo.
const EMPTY_CROSS_DAYS = [];

// ─────────── Single shared hover tooltip (req #2840) ─────────────────────────
// Replaces the per-chip / per-anchor / per-cross-day-start-bar MUI <Tooltip>
// instances (600+ Popper portals + listeners across a busy strip — the single
// heaviest cost on the visualizer). One context-provided box, rendered ONCE via
// a portal to document.body (so the strips' overflow:hidden never clips it — the
// same reason MUI used a portal), repositioned on each hover. BeadRow's chips
// call show(content, anchorEl) on mouseenter and hide() on mouseleave; the
// datacard JSX is built lazily (only on hover) so the necklace render no longer
// constructs 3×N React element trees per panel up front.
const TooltipContext = React.createContext(null);
// No-op fallback so a BeadRow rendered outside the provider (e.g. an isolated
// unit test) never throws on hover.
const NOOP_TOOLTIP = { show() {}, hide() {} };

const SHARED_TT_GAP = 8;   // px gap between the anchor and the tooltip box

// Positioned tooltip box. Measures itself in a layout effect, then places itself
// above the anchor (or below when there isn't room), horizontally centered and
// clamped to the viewport. Starts hidden to avoid a one-frame flash at (0,0).
const SharedTooltipBox = ({ content, rect, fontSize }) => {
    const ref = React.useRef(null);
    const [pos, setPos] = React.useState({ left: 0, top: 0, visible: false });
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const tw = el.offsetWidth;
        const th = el.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const cx = rect.left + rect.width / 2;
        let left = cx - tw / 2;
        left = Math.max(4, Math.min(left, vw - tw - 4));
        let top;
        if (rect.top - th - SHARED_TT_GAP >= 4) {
            top = rect.top - th - SHARED_TT_GAP;          // above
        } else {
            top = rect.bottom + SHARED_TT_GAP;            // below
            if (top + th > vh - 4) top = Math.max(4, vh - th - 4);
        }
        setPos({ left, top, visible: true });
    }, [rect, content]);
    return (
        <div
            ref={ref}
            className="ts-shared-tooltip"
            role="tooltip"
            style={{
                position: 'fixed',
                left: pos.left,
                top: pos.top,
                fontSize,
                maxWidth: 360,
                zIndex: 1600,
                pointerEvents: 'none',
                visibility: pos.visible ? 'visible' : 'hidden',
            }}
        >
            {content}
        </div>
    );
};

// Provider — owns the single tooltip's open state and the show/hide API. The API
// object is referentially stable (memo, empty deps) so consuming BeadRows are NOT
// re-rendered when the tooltip opens/closes — only this layer + the portal box re-render.
const SharedTooltipLayer = ({ fontSize, children }) => {
    const [tip, setTip] = useState(null);   // { content, rect } | null
    const showTimer = React.useRef(null);
    const hideTimer = React.useRef(null);
    const api = useMemo(() => ({
        show(content, anchorEl) {
            if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return;
            const rect = anchorEl.getBoundingClientRect();
            if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
            if (showTimer.current) clearTimeout(showTimer.current);
            // Small enter delay so dragging the pointer across many chips doesn't
            // flash a tooltip on each one (mirrors MUI's enterDelay feel).
            showTimer.current = setTimeout(() => { setTip({ content, rect }); }, 60);
        },
        hide() {
            if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
            if (hideTimer.current) clearTimeout(hideTimer.current);
            hideTimer.current = setTimeout(() => { setTip(null); }, 50);
        },
    }), []);
    useEffect(() => () => {
        if (showTimer.current) clearTimeout(showTimer.current);
        if (hideTimer.current) clearTimeout(hideTimer.current);
    }, []);
    return (
        <TooltipContext.Provider value={api}>
            {children}
            {tip && typeof document !== 'undefined' && createPortal(
                <SharedTooltipBox content={tip.content} rect={tip.rect} fontSize={fontSize} />,
                document.body,
            )}
        </TooltipContext.Provider>
    );
};

// ─────────── Strip virtualization (req #2840) ────────────────────────────────
// The Sidewalk/Elevator keep up to SIDEWALK_MAX_PANELS/ELEVATOR_MAX_PANELS day
// panels in their `dates` array, but only a handful are ever on screen. Mounting
// all of them produced 1400–6000 DOM nodes and busted scroll. These pure helpers
// return the [start, end] index window that intersects the viewport (plus a
// buffer); panels outside it render as zero-content placeholders of identical
// size, so every offset/cumulative scroll calculation is unchanged. Exported for
// unit-test coverage.

// Uniform-width strip (Sidewalk). `offset` is the inner strip's translateX
// (negative = scrolled right/forward). A panel occupies [i*panelWidth,
// (i+1)*panelWidth); the viewport spans [-offset, -offset+frameWidth).
export const sidewalkVisibleRange = (offset, panelWidth, frameWidth, count, buffer = 4) => {
    if (count <= 0) return { start: 0, end: 0 };
    if (!(panelWidth > 0) || !(frameWidth > 0)) return { start: 0, end: count - 1 };
    const first = Math.floor(-offset / panelWidth);
    const last  = Math.floor((-offset + frameWidth - 1) / panelWidth);
    const start = Math.max(0, Math.min(count - 1, first - buffer));
    const end   = Math.max(0, Math.min(count - 1, last + buffer));
    return { start, end };
};

// Variable-height strip (Elevator). `cumulative[i]` is the top of panel i within
// the strip and `heights[i]` its height; `offset` is the translateY (negative =
// scrolled down). The viewport spans [-offset, -offset+viewportH).
export const elevatorVisibleRange = (offset, cumulative, heights, viewportH, count, buffer = 4) => {
    if (count <= 0) return { start: 0, end: 0 };
    if (!cumulative || cumulative.length !== count || !(viewportH > 0)) {
        return { start: 0, end: count - 1 };
    }
    const top = -offset;
    const bottom = -offset + viewportH;
    let first = -1;
    let last = -1;
    for (let i = 0; i < count; i++) {
        const a = cumulative[i];
        const b = a + heights[i];
        if (b > top && a < bottom) {
            if (first === -1) first = i;
            last = i;
        }
    }
    if (first === -1) {            // nothing intersects (degenerate) — keep the first panel
        return { start: 0, end: 0 };
    }
    const start = Math.max(0, first - buffer);
    const end   = Math.min(count - 1, last + buffer);
    return { start, end };
};

// ─────────── Stable per-day bucket reconciliation (req #2840) ────────────────
// req #2800 sliced the broad `requirements` array into one per-day bucket so each
// 24h panel got only its own day's chips, letting BeadRow's React.memo skip
// unchanged panels. But `bucketByDate` allocates a FRESH array for every non-empty
// day on every call, so a single window refetch handed all ≤60 panels new array
// references and busted the memo for all of them at once. reconcileBuckets keeps a
// per-date signature and reuses the prior array reference when a day's requirement
// content is unchanged, so a refetch only re-renders the panels whose day actually
// changed. Pure (cache passed in, new cache returned) → exported for unit tests.
export const bucketSignature = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return '';
    // Every field BeadRow reads off a requirement, so a change to any of them
    // produces a new signature and a genuine re-render.
    return arr
        .map(r => `${r.id}${r.completed_at}${r.requirement_status}${r.coordination_type}${r.category_fk}${r.title}`)
        .join('');
};

export const reconcileBuckets = (prevCache, freshMap) => {
    const cache = new Map();
    const map = new Map();
    for (const [date, arr] of freshMap) {
        const sig = bucketSignature(arr);
        const prev = prevCache && prevCache.get(date);
        if (prev && prev.sig === sig) {
            cache.set(date, prev);
            map.set(date, prev.arr);
        } else {
            const entry = { sig, arr };
            cache.set(date, entry);
            map.set(date, arr);
        }
    }
    return { map, cache };
};

// ─────────── Vertical start-bar x-position (Swarm mode) ─────────────────────
// Returns the SVG x-coordinate string for the vertical start tick, or null
// when the tick should not render for this chip. The tick is the thin bar
// that marks when a session started.
//
// Rules:
//   • 'clamped'                  → null (tick skipped; horizontal dashed line conveys it).
//   • 'left'                     → one gap left of bubble center (no duration line
//                                   is drawn in this mode — the bar IS the visual).
//   • 'normal', startPct valid   → at startPct (left edge of the horizontal line;
//                                   aligns vertically with cluster-mates per req
//                                   #2341). The bar must coincide with the line's
//                                   left end — reqs #2398/#2399 fixed the old
//                                   gap-shift branch that bubble-hugged the tick
//                                   when aligned-cluster gap was < 1.5%, leaving
//                                   the duration line dangling past the bar. The
//                                   non-aligned close-start case is handled
//                                   upstream in drawChips (markerMode='left'), so
//                                   this branch never needs a bubble-hug fallback.
//   • 'normal', startPct null    → null (no session start to mark).
//   • 'inprogress' (req #2504)   → at startPct, same placement as 'normal'. Used
//                                   by phantom chips for in-progress swarm-starts.
//   • unknown markerMode         → null.
// Exported for unit-test coverage.
export const swarmStartBarX = (markerMode, leftPct, startPct, gapPx) => {
    if (markerMode === 'clamped') return null;
    if (markerMode === 'left') return `calc(${leftPct}% - ${gapPx}px)`;
    if ((markerMode === 'normal' || markerMode === 'inprogress')
        && startPct !== null && startPct !== undefined) {
        return `${startPct}%`;
    }
    return null;
};

// Phantom placement decision (req #2649). For each in-progress (swarm-start,
// session) pair, decide where the phantom bubble sits on a given panel and
// whether its trailing line should be dashed-clamped to the panel's left
// edge. Returns null when neither the start nor "now" falls in the panel
// window — phantom is not rendered on that panel.
//
//   startPct → x% of the swarm_start.started_at on this panel, or null when
//              the start falls outside the visible window.
//   nowPct   → x% of "now" on this panel, or null when "now" falls outside
//              the visible window (panels in the past relative to the wall
//              clock).
//
// The phantom BUBBLE is the "in progress, right now" marker, so it renders
// ONLY on the panel that contains "now" (the current day). On the start day and
// any intervening day of a multi-day session the line must continue to the panel
// edge with NO bubble — that pass-through is drawn by the cross-day line path
// (`crossDayMap`, req #2798), not the phantom. Hence the `in / null` case below
// returns null instead of parking a bubble at the right edge (req #2798 — was
// the "bubble at midnight" bug).
//
// | startPct | nowPct   | Behaviour                                       |
// |----------|----------|-------------------------------------------------|
// | in       | in       | start at startPct, head at nowPct (same day)    |
// | in       | null     | null — not the current day; cross-day line draws|
// |          |          |   the pass-through to the edge, no bubble here   |
// |          |          |   (req #2798)                                    |
// | null     | in       | start at 0% (clamped), head at nowPct           |
// |          |          |   (today's panel; session opened earlier and    |
// |          |          |   is still in progress) — dashed line trails    |
// |          |          |   off the left edge, no vertical start bar     |
// | null     | null     | skip — neither end visible on this panel        |
//
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
// isolation; the BeadRow memo wrapping it just supplies the live data + the
// xPctFn closure.
//
// Math invariants (per memo comment above): startPct from swarm_start.started_at,
// leftPct from undo.undone_at, markerMode resolves normal/clamped/left exactly
// like a completed chip. Returns [] when no undos in window.
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
//   topDown=false (Day / Week) — ascending: row 0 = earliest group + earliest
//                                            completion (wire is at bottom).
//   topDown=true  (Sidewalk)   — descending: row 0 = latest group + latest
//                                            completion (wire is at top).
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

// ─────────── Cross-day ghost occupants (Week stack) ──────────────────────────
// Cross-day pass-through lines join THIS day's lane assignment as "ghost"
// occupants so same-day bubbles pack around them instead of sharing a lane
// (req #2747 — fixes a dashed line drawn over an unrelated bubble that closed on
// an intermediate day). Each ghost carries the cluster `groupKey` + the
// requirement's end-day `completed_at`, so assignSwarmLanes seats it contiguously
// with its cluster-mates. The original `crossDay` entry rides along so the SVG
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

// ─────────── Extra swarm chips per date (Elevator per-day sizing) ────────────
// `indexChipsByDate` only buckets COMPLETED-requirement chips. But a swarm
// BeadRow's lane stack (`placedAll`) also seats two other chip kinds that the
// Elevator must size for, or a panel that carries them is too short and its
// bottom bubbles bleed into the next day's header (req #2797):
//
//   • In-progress PHANTOM chips (req #2504). Mirrors BeadRow.phantomChips +
//     computePhantomPlacement: each not-hidden session linked to a swarm_start
//     whose requirement is NOT yet completed shows a phantom on the
//     swarm-start's start-day panel (startPct in window) AND — clamped — on
//     TODAY's panel (nowPct in window). The two coincide when the start day is
//     today, so it contributes a single lane there.
//   • UNDONE tombstone chips (req #2719). Mirrors BeadRow.undoneChips: one chip
//     on the undo's `undone_at` day.
//
// A 24h sidewalk/elevator panel's window IS its calendar day, so membership is
// a `toLocaleDateString` bucket — the same shortcut `indexChipsByDate` uses for
// completed chips. Returns Map<YYYY-MM-DD, count>. Exported for unit-test
// coverage. `today` is passed in (not read from the wall clock) so the helper
// stays pure/testable.
export const indexSwarmExtraChipsByDate = ({
    swarmStarts = [],
    swarmStartSessions = [],
    swarmUndos = [],
    requirementById = null,
    sessions = [],
    timezone,
    today = null,
}) => {
    const out = new Map();
    const bump = (d) => { if (d) out.set(d, (out.get(d) || 0) + 1); };

    // Phantom chips — one per (in-progress session, swarm-start) on the start
    // day, plus a clamped copy on today's panel (when today differs).
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
        for (const ss of swarmStarts) {
            if (!ss || ss.id == null || !ss.started_at) continue;
            const startDay = toLocaleDateString(ss.started_at, timezone);
            const linked = sessionsByStartFk.get(String(ss.id)) || [];
            for (const sid of linked) {
                const s = sessionById.get(sid);
                if (!s) continue;
                if (isHiddenSwarmStatus(s.swarm_status)) continue;
                const reqId = parseSessionRequirementId(s.source_ref);
                const r = reqId && requirementById ? requirementById.get(reqId) : null;
                if (r && r.completed_at) continue;   // completed → real chip handles it
                bump(startDay);
                if (today && today !== startDay) bump(today);
            }
        }
    }

    // Undone tombstone chips — one on the undone_at day.
    for (const undo of (swarmUndos || [])) {
        if (!undo || !undo.undone_at) continue;
        bump(toLocaleDateString(undo.undone_at, timezone));
    }
    return out;
};

// ─────────── Max-stack-row index (Elevator per-day sizing) ───────────────────
// Return Map<YYYY-MM-DD, maxRow> where maxRow is the row index BeadRow will
// assign to its tallest chip on that date. Elevator uses this to size each day
// panel to its actual rendered content instead of the worst case:
//
//   • Every chip (req + per-session fan-out, plus in-progress phantom and undone
//     tombstone chips) gets its own lane via `assignSwarmLanes`, so
//     maxRow = (completedChips + extraSwarmChips)(date) - 1. The `extras` arg
//     supplies the swarm-start / undo data needed to count the phantom/undone
//     lanes (req #2797); omit it (3-arg call) and only completed chips count,
//     preserving the original behavior for non-Elevator callers + unit tests.
//
// Exported for unit-test coverage.
export const indexMaxStackByDate = (requirements, sessions, timezone, extras = {}) => {
    const out = new Map();
    if (!Array.isArray(requirements)) return out;

    const totals = new Map(indexChipsByDate(requirements, sessions, timezone));
    const extraByDate = indexSwarmExtraChipsByDate({ ...extras, sessions, timezone });
    for (const [date, n] of extraByDate) {
        totals.set(date, (totals.get(date) || 0) + n);
    }
    // Req #2798 — cross-day pass-through "ghost" lanes also occupy a row in
    // the swarm lane stack (BeadRow folds them into assignSwarmLanes). The
    // Elevator/Sidewalk pass a Map<date, ghostCount> so start/interim days
    // size for the dashed lines and their bubbles don't clip. Absent →
    // no-op (preserves the original 3/4-arg behavior + unit tests).
    const xdCounts = extras.crossDayCountByDate;
    if (xdCounts instanceof Map) {
        for (const [date, n] of xdCounts) {
            totals.set(date, (totals.get(date) || 0) + n);
        }
    }
    for (const [date, n] of totals) {
        out.set(date, Math.max(0, n - 1));
    }
    return out;
};

// req #2823 follow-up — Sidewalk sub-day horizontal zoom. Maps the toolbar
// window value to the per-panel pixel-width multiplier: a day panel always holds
// a full 24h, so to show only `n` hours in one viewport-width we render the panel
// 24/n times as wide and let the strip scroll through it. '6h' → 4×, '12h' → 2×,
// everything else (incl. '24h'/'36h') → 1× (unchanged). Exported for unit tests.
export const sidewalkPanelScale = (beadWindow) =>
    beadWindow === '6h' ? 4 : beadWindow === '12h' ? 2 : 1;

// ─────────── Date helpers ─────────────────────────────────────────────────────
const shiftDateStr = (dateStr, delta) => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    // Use local-calendar date parts to avoid UTC rollover when west of UTC.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

// Build N day strings centered on `centerDate` (half before, half after).
export const centeredDateRange = (centerDate, halfWidth = 10) => {
    if (!centerDate) return [];
    const out = [];
    for (let i = -halfWidth; i <= halfWidth; i++) {
        out.push(shiftDateStr(centerDate, i));
    }
    return out;
};

// ─────────── Infinite-scroll dates helpers (Sidewalk) ────────────────────────
// extendDates — return a new dates array with `n` contiguous days added to one
// end, derived via shiftDateStr from the existing first/last entry. Pure so the
// Sidewalk effects can extend without rebuilding the strip from scratch.
// direction: 'left' prepends earlier days; 'right' appends later days.
export const extendDates = (dates, direction, n) => {
    if (!Array.isArray(dates) || dates.length === 0) return dates || [];
    if (!Number.isFinite(n) || n <= 0) return dates;
    if (direction === 'left') {
        const first = dates[0];
        const newDays = [];
        for (let i = n; i >= 1; i--) newDays.push(shiftDateStr(first, -i));
        return [...newDays, ...dates];
    }
    if (direction === 'right') {
        const last = dates[dates.length - 1];
        const newDays = [];
        for (let i = 1; i <= n; i++) newDays.push(shiftDateStr(last, i));
        return [...dates, ...newDays];
    }
    return dates;
};

// pruneDates — trim `dates` down to at most `max` entries by removing from one
// end. Returns the trimmed array plus how many entries were dropped, so the
// caller can shift its translateX by removedCount * frameWidth when pruning
// from the left (keeps the visible panel stationary).
export const pruneDates = (dates, max, fromSide) => {
    if (!Array.isArray(dates) || dates.length === 0) return { dates: dates || [], removedCount: 0 };
    if (!Number.isFinite(max) || dates.length <= max) return { dates, removedCount: 0 };
    const removedCount = dates.length - max;
    if (fromSide === 'left') return { dates: dates.slice(removedCount), removedCount };
    if (fromSide === 'right') return { dates: dates.slice(0, dates.length - removedCount), removedCount };
    return { dates, removedCount: 0 };
};

// Return the 7 YYYY-MM-DD dates of the ISO week (Mon first) that contains `dateStr`.
// Output order: Mon, Tue, Wed, Thu, Fri, Sat, Sun (ascending).
// Uses local calendar parts (not toISOString()) so extreme east-of-UTC
// timezones don't roll the dates back by one day.
export const weekDates = (dateStr) => {
    if (!dateStr) return [];
    const d = new Date(dateStr + 'T12:00:00');
    const mondayOffset = (d.getDay() + 6) % 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - mondayOffset);
    const out = [];
    for (let i = 0; i < 7; i++) {
        const di = new Date(monday);
        di.setDate(monday.getDate() + i);
        const y = di.getFullYear();
        const m = String(di.getMonth() + 1).padStart(2, '0');
        const day = String(di.getDate()).padStart(2, '0');
        out.push(`${y}-${m}-${day}`);
    }
    return out;
};

// req #2779 follow-up — the elevator's FUTURE scroll is capped at the end of the
// current ISO week (this week's Sunday); the past stays infinite. endOfWeek
// returns the Sunday (local calendar) of the week containing `dateStr`.
export const endOfWeek = (dateStr) => {
    const wk = weekDates(dateStr);
    return wk.length ? wk[wk.length - 1] : dateStr;
};

// Build a centered range, then drop any day after `maxFutureDate` (inclusive cap).
// Used for the elevator's initial strip + chevron rebuilds so the future side
// never renders past the cap. A falsy maxFutureDate → no cap (full range). If the
// whole range is past the cap, fall back to a single capped day so the strip is
// never empty.
export const cappedCenteredRange = (centerDate, halfWidth, maxFutureDate) => {
    const range = centeredDateRange(centerDate, halfWidth);
    if (!maxFutureDate) return range;
    const capped = range.filter(d => d <= maxFutureDate);
    return capped.length ? capped : [maxFutureDate];
};

// Unified window-aware positioning. Anchors on noon of selectedDate in user tz.
// baseHours    — total horizontal span (0..100% across it). Use ZOOM_HOURS[zoom]['36h'].
// visibleHours — only chips whose offset from noon is ≤ visibleHours/2 render;
//                anything outside is returned null (rendered beyond the band).
//
// All zoom levels position the same chips at the same % within their base
// window, so switching 24h ↔ 36h never moves a chip — the 24h view just
// rejects anything that falls in the hidden outer bands.
// Exported for unit-test coverage of the 24h↔36h transition.
export const positionFor = (completedAt, timezone, selectedDate, baseHours, visibleHours) => {
    const chipDay  = toLocaleDateString(completedAt, timezone);
    const chipFrac = getTimeOfDayFraction(completedAt, timezone);
    if (chipDay === null || chipFrac === null) return null;
    const selAnchor  = new Date(selectedDate + 'T12:00:00');
    const chipAnchor = new Date(chipDay + 'T12:00:00');
    const dayOffset  = Math.round((chipAnchor - selAnchor) / 86400000);
    const hoursFromNoon = dayOffset * 24 + chipFrac * 24 - 12;
    if (Math.abs(hoursFromNoon) > visibleHours / 2) return null;
    return (hoursFromNoon + baseHours / 2) / baseHours * 100;
};

// Legacy alias — cross-day map still calls this for 'start' partial pct. Uses
// the X-zoom 36h base (same as prior behaviour) so historical positions don't
// shift when zoom is X.
const bead36hXPct = (completedAt, timezone, selectedDate) =>
    positionFor(completedAt, timezone, selectedDate, 36, 36);

// 24h coordinate — the Sidewalk + Elevator render one 24h day panel per date, so
// a cross-day 'start' bar on those panels must be positioned in the panel's own
// 24h window, not the 36h Week bead. Mirror of bead36hXPct for the 24h base.
const bead24hXPct = (completedAt, timezone, selectedDate) =>
    positionFor(completedAt, timezone, selectedDate, 24, 24);

// ─────────── Cross-day pass-through map (Week stack + Sidewalk + Elevator) ────
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
//      completed and whose status is not hidden. THIS is the path the old
//      single-source map missed: `requirements` only ever holds COMPLETED rows
//      (it is `useRequirementsDone`), so the in-progress branch there was dead and
//      open multi-day sessions drew no pass-through line on any day (req #2798
//      re-open, item 1).
//
// `startXPct(t, tz, day)` positions the start bar in the panel's own coordinate
// system — bead36hXPct for the 36h Week bead, bead24hXPct for the 24h Sidewalk/
// Elevator panels. Returns null off-window; such 'start' entries are skipped.
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

    // B. In-progress spans — swarm-start linked, mirroring BeadRow.phantomChips +
    // indexSwarmExtraChipsByDate so the dashed line and today's phantom bubble
    // agree on which open sessions are multi-day.
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

// ─────────── Tick / day-label builders (zoom-aware) ───────────────────────────
// Tick interval depends on visible span: dense for small windows, coarser for
// larger ones, so the label bar never looks crowded.
const tickStepHoursFor = (visibleHours) => {
    if (visibleHours <= 24) return 3;
    if (visibleHours <= 48) return 6;
    return 12;
};

const buildTicks = (baseHours, visibleHours) => {
    const step = tickStepHoursFor(visibleHours);
    const ticks = [];
    for (let h = -baseHours / 2; h <= baseHours / 2 + 0.0001; h += step) {
        if (Math.abs(h) > visibleHours / 2 + 0.0001) continue;  // in hidden band
        const pct = (h + baseHours / 2) / baseHours * 100;
        let hourOfDay = ((Math.round(h) + 12) % 24 + 24) % 24;
        const label = hourOfDay === 0 ? '12am'
            : hourOfDay === 12 ? '12pm'
            : hourOfDay < 12 ? `${hourOfDay}am`
            : `${hourOfDay - 12}pm`;
        const kind = hourOfDay % 12 === 0 ? 'major' : 'minor';
        ticks.push({ pct, label, kind });
    }
    return ticks;
};

// Day labels for each calendar day whose NOON is within the visible window.
// The selected day is always the center; outer days appear as the window widens.
const buildDayLabels = (selectedDate, timezone, baseHours, visibleHours) => {
    const labels = [];
    const halfV = visibleHours / 2;
    const maxOffset = Math.ceil(halfV / 24);
    for (let d = -maxOffset; d <= maxOffset; d++) {
        const dayCenterH = d * 24;
        if (Math.abs(dayCenterH) > halfV) continue;          // noon outside visible band
        const pct = (dayCenterH + baseHours / 2) / baseHours * 100;
        const dateStr = shiftDateStr(selectedDate, d);
        labels.push({ pct, dateStr, isSelected: d === 0 });
    }
    return labels;
};

const BeadTimeline = ({ ticks }) => (
    <Box className="ts-bead-timeline" aria-hidden="true">
        {ticks.map((t, i) => (
            <Box key={i} className={`ts-bead-tick ts-bead-tick-${t.kind}`} style={{ left: `${t.pct}%` }}>
                <span className="ts-bead-tick-line" />
                <span className="ts-bead-tick-label">{t.label}</span>
            </Box>
        ))}
    </Box>
);

// req #2744 — single shared time axis rendered once at the top of the view
// instead of once per day. Used by the Week stack (variant="week": sticky bar
// above the 7 rows) and the Elevator (variant="elevator": bar pinned to the top
// of the scrolling frame). Ticks are computed by the parent with the SAME
// baseHours/visibleHours the rows use, so the labels line up with the per-row
// vertical hour dividers that remain below. Labels sit above the tick lines,
// which point down toward the rows (see .ts-shared-timeline CSS).
const SharedTimeline = ({ ticks, variant }) => (
    <Box className={`ts-shared-timeline ts-shared-timeline-${variant}`} aria-hidden="true">
        <BeadTimeline ticks={ticks} />
    </Box>
);

// req #2828 — per-date lane parity for alternating day-lane backgrounds in the
// Week stack and Week/Elevator. Keyed off the date (days-since-epoch parity), so
// adjacent calendar days ALWAYS alternate and a given day keeps its shade as the
// elevator scrolls — unlike :nth-child, whose parity would flip as windowed
// panels load/unload. Returns 'even' | 'odd'. Unit-tested in
// __tests__/laneParity.test.js.
export const laneParityFor = (s) => {
    if (!s) return 'even';
    const ms = Date.parse(`${s}T00:00:00Z`);
    if (Number.isNaN(ms)) return 'even';
    const dayNum = Math.floor(ms / 86400000);
    // dates are post-epoch in practice; the +2 guard keeps it correct anyway.
    return (((dayNum % 2) + 2) % 2) === 0 ? 'even' : 'odd';
};

const formatDayLabel = (s, tz) => {
    if (!s) return '';
    const d = new Date(s + 'T12:00:00');
    return d.toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        ...(tz && { timeZone: tz }),
    });
};

// Generic day-label strip — builds labels dynamically from buildDayLabels().
// When `inlineCount` is provided, the selected day's label shows the count
// pill inline (to its right), on the same line — used by Sidewalk panels
// where the standalone top-left count badge is hidden in favour of this.
const DayLabels = ({ labels, timezone, inlineCount = null }) => (
    <Box className="ts-bead-days" aria-hidden="true">
        {labels.map(l => (
            <span key={l.dateStr}
                  className={`ts-bead-day-label ${l.isSelected ? 'ts-bead-day-label-sel' : ''}`}
                  style={{ left: `${l.pct}%` }}>
                {/* Count pill renders to the LEFT of the date (req #2747), matching
                    the Week-stack sticky header. */}
                {l.isSelected && inlineCount !== null && (
                    <span className="ts-bead-day-count-inline" data-testid="ts-bead-day-count-inline">
                        {inlineCount}
                    </span>
                )}
                {formatDayLabel(l.dateStr, timezone)}
            </span>
        ))}
    </Box>
);

// ─────────── Per-day bead row (reusable — 1 instance for day, 7 for week) ─────
// React.memo (req #2796) — the visualizer strip (Sidewalk/Elevator) maps this
// component once per day panel (up to 60). Every scroll tick updates state
// (infinite-scroll `setDates` + debounced `setCurrentDate`), re-running the
// parent `dates.map(...)`. Without memo, ALL panels re-render and reconcile
// thousands of SVG nodes even when their date/data are unchanged — the
// 300–1000ms long-task violations. With memo + the stable refs feeding
// {...rowProps} (memoized Maps, useCallback'd handlers, week-quantized query
// data per req #2777), only the 1–2 panels whose props actually change re-render.
const BeadRow = React.memo(({
    requirements, sessions, categoryList, selectedDate, timezone,
    // tooltipFontSize is no longer consumed here (req #2840 — the single shared
    // tooltip at the TimeSeriesView root owns the font size); call sites may still
    // pass it harmlessly.
    beadWindow, circleDiameter, spaceKey = 1,
    zoomKey = DEFAULT_ZOOM,
    dataKey = DEFAULT_DATA_KEY,   // 'category' | 'coordination' — req #2382
    titlesOn = false,             // req #2556 — render req title to right of bubble
    completesOn = false,          // req #2790 — show completion-terminus badge (off by default)
    phasesOn = false,             // req #2823 — segment duration line by phase buckets (off by default)
    crossDays = [], onChipClick, onSwarmStartClick, onUndoClick, isWeekView = false,
    sidewalkPanel = false,   // when true → top-down layout + seamless 24h panel
    hideTimeline = false,    // req #2744 — suppress the per-row time axis; a single
                             // shared axis is rendered once at the top of the view
                             // (Week stack + Elevator). Compacts the freed chrome.
    sidewalkHeight,
    canonicalStartById,      // Map<string sessionId, ISO started_at> — swarm alignment
    clusterSizeById,         // Map<string sessionId, n members in its cluster>
    swarmStartIdById,        // Map<string sessionId, swarm_start_id | null> — req #2504
    swarmStartById,          // Map<string sessionId, swarm_start_row | null> — req #2504
    swarmStarts = [],        // req #2504 — for in-progress phantom chip rendering
    swarmStartSessions = [], // req #2504 — junction for in-progress detection
    swarmUndos = [],         // req #2719 — undo log rows for tombstone overlay
    swarmCompleteBySession,  // req #2497 — Map<string sessionId, swarm_complete row>
    onCompleteClick,         // req #2497 — open the swarm-complete detail
    requirementById,         // req #2504 — Map<string reqId, requirement> for phantom tooltips
}) => {
    // Single shared hover tooltip (req #2840) — replaces the per-chip / per-anchor
    // / per-cross-day MUI <Tooltip> Poppers. Chips below call tt.show/tt.hide.
    const tt = React.useContext(TooltipContext) || NOOP_TOOLTIP;
    const window36h = beadWindow === '36h';
    // Week stack (req #2747) — the only mode with a single shared sticky time
    // axis at top:0 AND stacked day panels in page flow. Its per-panel date/count
    // row becomes a sticky section header (top:38, under the axis) so the current
    // day's header sticks and the next day pushes it out as you scroll. Day view,
    // Sidewalk and Elevator keep the absolute date band + count badge.
    const weekStack = isWeekView && !sidewalkPanel;
    // Orientation (req #2780). Top-anchored = wire/time-axis/date pinned at the
    // TOP, bubbles stream DOWN with the latest chip (row 0) closest to the wire.
    // This is the Sidewalk design rule, now unified onto EVERY day-granularity
    // layout: the Sidewalk strip, the Elevator panels, AND the plain single Day
    // view (which used to be bottom-anchored). Only the Week stack stays
    // bottom-anchored (wire at the row's floor, earliest chip just above it).
    // Decoupled from `sidewalkPanel` so the single Day view flips orientation
    // while keeping its own window (24h/36h), card background, side padding, and
    // larger bubble size — `sidewalkPanel` still gates those panel specifics.
    const topAnchored = sidewalkPanel || !isWeekView;
    // Sidewalk panels: each panel shows exactly the 24h day, no hidden outer
    // bands — so adjacent panels flow together without visible seams.
    const baseHours    = sidewalkPanel ? 24 : (ZOOM_HOURS[zoomKey]?.['36h'] ?? 36);
    const visibleHours = sidewalkPanel ? 24 : getZoomHours(zoomKey, beadWindow);
    const ticks        = useMemo(() => buildTicks(baseHours, visibleHours), [baseHours, visibleHours]);
    const dayLabels    = useMemo(() => buildDayLabels(selectedDate, timezone, baseHours, visibleHours),
                                 [selectedDate, timezone, baseHours, visibleHours]);
    const xPctFn       = useMemo(
        () => (t, tz, d) => positionFor(t, tz, d, baseHours, visibleHours),
        [baseHours, visibleHours]
    );

    // Layout constants:
    //   Day view     — roomy; top-anchored (req #2780) so the wire/X-axis sit at
    //                  the top and bubbles stream down, matching the Sidewalk.
    //   Week view    — compressed so 7 rows fit; bottom-anchored.
    //   Sidewalk     — top-down flow: wire/timeline pinned at top, bubbles stream
    //                  down from there with the LATEST chip at row 0 just below
    //                  the wire.
    // bubbleOffset is the CSS bottom for row 0 in the bottom-anchored Week
    // layout. In the top-anchored layouts (Day / Sidewalk) bubbles are placed
    // from the top (see bubbleYCss below), so bubbleOffset is just the panel's
    // bottom padding — kept only so the height formula computes a sane lower
    // bound (req #2780 dropped Day's 86 → 20 to match the Sidewalk).
    const LAYOUT_DAY      = { bubbleOffset: 20, baseHeight: 172 };
    const LAYOUT_WEEK     = { bubbleOffset: 68, baseHeight: 116 };
    // req #2744 — when the per-row time axis is suppressed (Week stack), the
    // bottom chrome that held the timeline (wire 64 + axis 10..54) collapses to
    // just the wire near the row's bottom, so bubbles ride lower and the row is
    // shorter. The matching CSS (.ts-bead-week.ts-bead-no-timeline) pins the
    // wire to bottom:20 and extends the divider layer down to it.
    const LAYOUT_WEEK_NOTL = { bubbleOffset: 24, baseHeight: 80 };
    const LAYOUT_SIDEWALK = { bubbleOffset: 20, baseHeight: sidewalkHeight || 400 };
    const { bubbleOffset, baseHeight } =
        sidewalkPanel ? LAYOUT_SIDEWALK
        : isWeekView   ? (hideTimeline ? LAYOUT_WEEK_NOTL : LAYOUT_WEEK)
        :                LAYOUT_DAY;

    const sessionsByReq = useMemo(() => indexSessionsByRequirement(sessions), [sessions]);

    const windowChips = useMemo(() => {
        if (!selectedDate) return [];
        const out = [];
        for (const r of requirements) {
            if (!r.completed_at) continue;
            const xPct = xPctFn(r.completed_at, timezone, selectedDate);
            if (xPct === null) continue;
            const cat = categoryList.find(c => c.id === r.category_fk);
            // Bubble fill is always the category color (req #2423). The coordination
            // toggle now layers an outer ring on top instead of replacing the fill,
            // so both encodings remain visible simultaneously.
            const color = cat?.color || null;
            const ringColor = coordinationRingColor(dataKey, r.coordination_type);
            out.push({
                id: r.id,
                title: r.title || '',
                completed_at: r.completed_at,
                category_fk: r.category_fk,
                requirement_status: r.requirement_status || null,
                coordination_type: r.coordination_type || null,
                categoryName: cat?.category_name || null,
                color,
                ringColor,
                timeHHMM: formatHM12(r.completed_at, timezone),
                leftPct: xPct,
                timezone,
            });
        }
        return out;
    }, [requirements, categoryList, selectedDate, timezone, xPctFn, dataKey]);

    // One chip per (requirement, session) pair; requirements with zero sessions
    // get a lone chip with markerMode='left' — rendered as a short vertical bar
    // immediately left of the met bubble.
    //
    // markerMode values:
    //   'normal'  — session fully inside window; horizontal line + vertical tick at started_at
    //   'clamped' — session started before window; dashed horizontal line from left edge
    //   'left'    — no session at all OR started_at ≈ completed_at; vertical bar
    //               immediately left of bubble (sessions always start before they end)
    const CLOSE_THRESHOLD_PCT = 1.5;
    // Below this horizontal-gap %, the drawable line is shorter than the 7px
    // arrowhead — the arrow overlaps / swamps the bubble. Drop markerEnd and
    // render a plain line instead. Must be ≥ CLOSE_THRESHOLD_PCT so aligned-cluster
    // chips (which force 'normal' even at tiny gaps) still skip the arrow.
    const ARROW_OMIT_THRESHOLD_PCT = 2.5;
    const drawChips = useMemo(() => {
        const out = [];
        for (const chip of windowChips) {
            const sess = sessionsByReq.get(String(chip.id)) || [];
            if (sess.length === 0) {
                // No session — keep chipKey equal to the requirement id so E2E
                // tests and anything else that looks up `ts-chip-${id}` still works.
                out.push({
                    ...chip,
                    chipKey: String(chip.id),
                    startPct: null,
                    startClamped: false,
                    markerMode: 'left',
                    session: null,
                });
                continue;
            }
            for (const s of sess) {
                // Swarm alignment (req #2341 + req #2504): if this session is part
                // of a multi-member cluster — real (swarm_start junction) or
                // estimated (3-min time window) — every member uses the cluster's
                // canonical started_at so vertical start-bars line up. Singletons
                // keep their own started_at and the existing 'left' heuristic.
                const sKey = String(s.id);
                const canonicalStartedAt =
                    canonicalStartById?.get(sKey) ?? s.started_at;
                const clusterN = clusterSizeById?.get(sKey) ?? 1;
                const isAligned = clusterN > 1;
                const swarmStartId  = swarmStartIdById?.get(sKey) ?? null;
                const swarmStartRow = swarmStartById?.get(sKey) ?? null;

                const rawStart = xPctFn(canonicalStartedAt, timezone, selectedDate);
                let startPct = rawStart;
                let startClamped = false;
                let markerMode = 'normal';
                if (startPct === null && canonicalStartedAt) {
                    startPct = 0;
                    startClamped = true;
                    markerMode = 'clamped';
                } else if (
                    startPct !== null &&
                    !isAligned &&
                    Math.abs(chip.leftPct - startPct) < CLOSE_THRESHOLD_PCT
                ) {
                    markerMode = 'left';   // start ≈ met → bar hugs the bubble's left side
                }
                out.push({
                    ...chip,
                    chipKey: `${chip.id}-s${s.id}`,
                    startPct,
                    startClamped,
                    markerMode,
                    session: s,
                    swarmStartId,
                    swarmStart: swarmStartRow,
                    swarmComplete: swarmCompleteBySession?.get(sKey) ?? null, // req #2497
                    // groupKey = canonical cluster start (req #2504 grouping).
                    // All chips that launched together share one key so
                    // assignSwarmLanes stacks them in contiguous rows.
                    groupKey: canonicalStartedAt || '',
                });
            }
        }
        return out;
    }, [windowChips, sessionsByReq, xPctFn, timezone, selectedDate,
        canonicalStartById, clusterSizeById, swarmStartIdById, swarmStartById,
        swarmCompleteBySession]);

    // "Now" position — used for in-progress phantom rendering AND the live-time
    // marker line below. Computed once per render (nowPct moves continuously by
    // wall clock, but the inputs that determine its existence are stable).
    const nowPct = useMemo(() => {
        const now = new Date().toISOString();
        return xPctFn(now, timezone, selectedDate);
    }, [timezone, selectedDate, xPctFn]);

    // In-progress phantom chips (req #2504). One phantom per (in-progress
    // session, its requirement) pair where:
    //   • the session is linked to a swarm_start via the junction
    //   • the swarm_start has a started_at that falls in this panel's window
    //   • the session's swarm_status is not "hidden" — see
    //     isHiddenSwarmStatus (null/'completed'/'paused' per req #2650).
    //
    // Each phantom carries the FULL requirement datacard payload (title,
    // category, coordination, etc.) so its hover tooltip is identical in shape
    // to a completed chip's tooltip — only the trailing rows differ
    // (Status: in progress instead of Closed).
    //
    // Phantoms participate in the swarm-lane stack via assignSwarmLanes — they
    // sort by the swarm_start.started_at (used as the surrogate completed_at)
    // so they interleave with completed chips in time order.
    const phantomChips = useMemo(() => {
        if (!Array.isArray(swarmStarts) || swarmStarts.length === 0) return [];
        if (!Array.isArray(sessions)) return [];

        // Junction: swarm_start_id → [session_fk]
        const sessionsByStartFk = new Map();
        for (const j of (swarmStartSessions || [])) {
            if (!j || j.swarm_start_fk == null || j.session_fk == null) continue;
            const k = String(j.swarm_start_fk);
            if (!sessionsByStartFk.has(k)) sessionsByStartFk.set(k, []);
            sessionsByStartFk.get(k).push(String(j.session_fk));
        }
        // sessions by id
        const sessionById = new Map();
        for (const s of sessions) {
            if (s && s.id != null) sessionById.set(String(s.id), s);
        }

        const out = [];
        for (const ss of swarmStarts) {
            if (!ss || ss.id == null || !ss.started_at) continue;
            const startPct = xPctFn(ss.started_at, timezone, selectedDate);
            // req #2649: replace the old "drop phantom when startPct is null"
            // short-circuit with a four-case placement helper. The phantom
            // appears on today's panel for sessions opened earlier — the line
            // is dashed-clamped to the left edge in that case.
            const placement = computePhantomPlacement(startPct, nowPct);
            if (placement === null) continue;            // neither end in window
            const { phantomStartPct, phantomLeftPct, startClamped } = placement;
            const linked = sessionsByStartFk.get(String(ss.id)) || [];
            for (const sid of linked) {
                const s = sessionById.get(sid);
                if (!s) continue;
                if (isHiddenSwarmStatus(s.swarm_status)) continue;
                const reqId = parseSessionRequirementId(s.source_ref);
                const r = reqId && requirementById ? requirementById.get(reqId) : null;
                // If the session's requirement has already completed_at set
                // and is in the visible-window completed set, the regular
                // chip path will render it — skip the phantom to avoid a
                // double bubble.
                if (r && r.completed_at) continue;
                const cat = r ? categoryList.find(c => c.id === r.category_fk) : null;
                out.push({
                    id: r ? r.id : (reqId ? Number(reqId) : null),
                    chipKey: `phantom-${reqId || 's'+s.id}-s${s.id}`,
                    isPhantom: true,
                    title: r?.title || ss.arguments || '(in progress)',
                    completed_at: s.started_at || ss.started_at, // within-group sort
                    category_fk: r?.category_fk ?? null,
                    requirement_status: r?.requirement_status ?? null,
                    coordination_type: r?.coordination_type ?? null,
                    categoryName: cat?.category_name || null,
                    color: cat?.color || '#43A047',
                    // Autonomy ring — same derivation as completed chips (req #2755).
                    // In-progress phantoms must show the coordination ring too when
                    // the Coordination toggle is on; previously hard-coded null.
                    ringColor: coordinationRingColor(dataKey, r?.coordination_type),
                    timeHHMM: null,
                    leftPct: phantomLeftPct,
                    timezone,
                    session: s,
                    startPct: phantomStartPct,
                    startClamped,
                    markerMode: 'inprogress',
                    swarmStartId: ss.id,
                    swarmStart: ss,
                    // Group with all other (in-progress + completed) chips
                    // launched by the same swarm-start (req #2504).
                    groupKey: ss.started_at,
                });
            }
        }
        return out;
    }, [swarmStarts, swarmStartSessions, sessions, xPctFn, timezone,
        selectedDate, nowPct, requirementById, categoryList, dataKey]);

    // Undone session chips (req #2719). One chip per `swarm_undos` row —
    // driven directly by the undo log + the `swarm_starts` row it snapshots
    // (`swarm_start_fk_at_undo`) rather than the live `swarm_sessions` row.
    //
    // Why undo-driven, not session-driven: the undo row + swarm_start row are
    // enough to render the chip without touching the live `swarm_sessions` row
    // at all. As of req #2827/#2829 all operational reads (swarm_undos,
    // swarm_starts, swarm_sessions) follow the dev/prod split via `darwinUri`,
    // so dev-seeded `darwin_dev` data renders in the dev server and production
    // data in prod. As a bonus this also works in the historical `/swarm-undo`
    // model where the session row was deleted.
    //
    // Math is identical to a completed chip: startPct comes from the
    // swarm_start.started_at (same source the green anchor uses); leftPct
    // comes from undo.undone_at (treated as the session's completed_at).
    // `markerMode` resolves to 'normal' / 'clamped' / 'left' via the same
    // formula `drawChips` uses for completed chips.
    const undoneChips = useMemo(
        () => buildUndoneChips({
            swarmUndos, swarmStarts, xPctFn, timezone, selectedDate,
            requirementById, categoryList,
            closeThresholdPct: CLOSE_THRESHOLD_PCT,
        }),
        [swarmUndos, swarmStarts, xPctFn, timezone, selectedDate,
         requirementById, categoryList],
    );

    // Placement: every chip gets its own swarm lane.
    //
    // In every top-anchored layout (Day / Sidewalk / Elevator) the wire is at
    // the TOP of the panel, so row 0 — the row rendered closest to the wire —
    // must hold the LATEST chip. Thread `topDown = topAnchored` through both
    // assigners so they emit rows in the direction the layout below wants.
    const topDown = topAnchored;
    const allSwarmChips = (phantomChips.length || undoneChips.length)
        ? [...drawChips, ...phantomChips, ...undoneChips]
        : drawChips;

    // Ghosts are filtered out of `placed` (so no bubble / start-bar / anchor
    // renders for them); their assigned row drives the cross-day line Y via
    // `crossDayPlaced` below. See buildCrossDayGhosts (module scope) for the
    // field mapping + rationale (req #2747).
    const crossDayGhosts = buildCrossDayGhosts(crossDays);

    const placedAll = assignSwarmLanes(
        crossDayGhosts.length ? [...allSwarmChips, ...crossDayGhosts] : allSwarmChips,
        topDown,
    );
    const placed = crossDayGhosts.length
        ? placedAll.filter(c => !c.isCrossDayGhost)
        : placedAll;
    // Cross-day lines, now lane-assigned by the joint pass above. Spread the
    // original entry (sessionId/role/pct/card) and attach the resolved `lane`.
    const crossDayPlaced = crossDayGhosts.length
        ? placedAll.filter(c => c.isCrossDayGhost).map(g => ({ ...g.crossDay, lane: g.row }))
        : [];
    const maxStackRow = placedAll.length ? Math.max(...placedAll.map(c => c.row)) : 0;

    // Space multiplier (Day view only — Week stays tight so 7 rows still fit).
    const spaceMul = isWeekView ? 1 : getSpaceMultiplier(spaceKey);
    let rowSpacing = Math.max(16, Math.round((circleDiameter + 4) * spaceMul));
    // req #2805 — the Week stack forces spaceMul=1 (tightest) so 7 rows fit, which
    // leaves only ~24px between rows. With the "Title" toggle on, the title label
    // (TITLE_LABEL_HEIGHT px, rendered to the right of the bubble and vertically
    // centered on it) then overlaps both the neighbouring row's title AND the
    // bubble directly below it. Day view (roomy spaceMul) and the Elevator panels
    // (rendered with isWeekView=false → user space preference) already have room,
    // which is why the overlap only shows in the Week stack. Raise rowSpacing to a
    // label-aware minimum so every item gets a common vertical slot that fully
    // clears the title: half the bubble + the full label height + a small gap.
    // Scoped to the Week stack — the Elevator/Sidewalk size their panels through a
    // separate helper, so widening here would drift from that math.
    if (titlesOn && isWeekView && !sidewalkPanel) {
        rowSpacing = Math.max(rowSpacing, Math.ceil(circleDiameter / 2) + TITLE_LABEL_HEIGHT + 4);
    }

    // Vertical height — must clear the top chrome by at least half a bubble so
    // the tallest bubble never crowds the date / time-axis header. Same formula
    // for every layout; only the chrome offset changes:
    //   Day / Sidewalk → 80 (top-anchored; wire at CSS top:68 after whitespace
    //                    expansion for req #2331/#2364/#2780, plus ~12px
    //                    breathing room before row 0).
    //   Week           → 26 (bottom-anchored; no date chrome above the row).
    // Panel uniformity in the Sidewalk strip is handled by the parent, which
    // passes a precomputed `sidewalkHeight` sized to the busiest day's lanes.
    // req #2744 — Elevator panels (sidewalkPanel) with the time axis suppressed
    // drop the time row (top:46..64), so the wire moves up to top:34 and row 0
    // starts at 46 instead of 80. Matching CSS: .ts-bead-sidewalk.ts-bead-no-timeline.
    const chromeOffset  = topAnchored
        ? (hideTimeline ? 46 : 80)
        : 26;
    const dateClearance = Math.ceil(circleDiameter / 2) + 4;
    const height = Math.max(baseHeight,
                            maxStackRow * rowSpacing + bubbleOffset + circleDiameter
                            + chromeOffset + dateClearance);

    // Bubble positioning — top-anchored in Day/Sidewalk/Elevator (wire at top,
    // row 0 = latest right below it) and bottom-anchored in the Week stack
    // (wire at bottom, row 0 = earliest right above it). Either way row 0
    // renders closest to the wire; the row-assignment direction above decides
    // which chip lands there (req #2780 unified Day onto the top-anchored rule).
    const bubbleYCss      = topAnchored
        ? (row) => ({ top:    `${chromeOffset + row * rowSpacing}px` })
        : (row) => ({ bottom: `${bubbleOffset + row * rowSpacing}px` });
    const bubbleCenterCss = topAnchored
        ? (row) => `${chromeOffset + row * rowSpacing + circleDiameter / 2}px`
        : (row) => `calc(100% - ${row * rowSpacing + bubbleOffset + circleDiameter / 2}px)`;

    return (
        <Box className={`ts-bead ts-bead-${window36h ? '36h' : '24h'} ts-bead-${isWeekView ? 'week' : 'day'} ts-bead-lane-${laneParityFor(selectedDate)} ${sidewalkPanel ? 'ts-bead-sidewalk' : ''} ${hideTimeline ? 'ts-bead-no-timeline' : ''}`}
             data-testid="ts-bead"
             data-date={selectedDate}
             style={{ height: `${height}px` }}>

            {/* Week stack: sticky section header (date + count) that pins under
                the shared time axis and is pushed out by the next day (req #2747). */}
            {weekStack && (
                <Box className="ts-bead-sticky-head" data-testid="ts-bead-sticky-head">
                    <Box className="ts-bead-sticky-count" data-testid="ts-bead-count"
                         title={`${windowChips.length} requirements met on ${formatDayLabel(selectedDate, timezone)}`}>
                        {windowChips.length}
                    </Box>
                    <span className="ts-bead-sticky-date">
                        {formatDayLabel(selectedDate, timezone)}
                    </span>
                </Box>
            )}

            {!weekStack && (
                <DayLabels
                    labels={dayLabels}
                    timezone={timezone}
                    inlineCount={windowChips.length}
                />
            )}

            {/* Midnight/noon divider layer — mirrors the timeline's horizontal
                anchoring so dividers share the tick coordinate system and the
                1px lines center on their pct via translateX(-50%). */}
            <Box className="ts-bead-divider-layer" aria-hidden="true">
                {ticks.filter(t => t.kind === 'major').map((t, i) => (
                    <Box key={i} className="ts-bead-divider" style={{ left: `${t.pct}%` }} />
                ))}
            </Box>

            {nowPct !== null && (
                <Box className="ts-now-marker" data-testid="ts-now-marker" style={{ left: `${nowPct}%` }} />
            )}

            <Box className="ts-bead-wire" />
            {/* req #2744 — the per-row time axis is hidden in Week/Elevator
                where a single shared axis renders at the top of the view. */}
            {!hideTimeline && <BeadTimeline ticks={ticks} />}

            {/* Swarm duration lines + start bars (req #2806 — the only render
                mode now that the bead necklace is gone). */}
            <svg className="ts-swarm-lines" data-testid="ts-swarm-lines"
                 aria-hidden="true" preserveAspectRatio="none"
                 width="100%" height="100%">
                    <defs>
                        <marker id={`ts-swarm-arrow-${selectedDate}`} viewBox="0 0 10 10"
                                refX="9" refY="5" markerWidth="7" markerHeight="7"
                                orient="auto-start-reverse">
                            <path d="M0,0 L10,5 L0,10 z" fill="rgba(96,125,139,0.85)" />
                        </marker>
                    </defs>
                    {/* Cross-day (multi-day) pass-through lines. Y lane is assigned
                        by THIS day's own assignSwarmLanes pass (req #2747 — the
                        ghost-occupant merge above), so the dashed line never lands
                        on a lane already held by a bubble that closed this day.
                        Each 'start' entry also carries a vertical start bar with a
                        datacard tooltip — gives starts without a same-day bubble
                        the same context the met bubble provides. */}
                    {crossDayPlaced.map((cd, i) => {
                        const yBottom = bubbleCenterCss(cd.lane);
                        const key = `xd-${cd.sessionId}-${cd.role}-${i}`;
                        // Req #2798 — an in-progress session's pass-through reads as
                        // one live line across every day: green (#43A047, 2px) to
                        // match today's phantom line + ring. Completed sessions keep
                        // the grey-blue tail. Both stay dashed (ts-swarm-line-clamped).
                        const hLine = {
                            className: 'ts-swarm-line ts-swarm-line-clamped',
                            stroke: cd.inProgress ? '#43A047' : 'rgba(96,125,139,0.85)',
                            strokeWidth: cd.inProgress ? 2 : 1.5,
                            y1: yBottom,
                            y2: yBottom,
                        };
                        if (cd.role === 'middle') {
                            return <line key={key} {...hLine} x1="0%" x2="100%" />;
                        }
                        if (cd.role === 'start') {
                            const barHalf = Math.max(6, circleDiameter / 2);
                            // Vertical start bar straddles the lane's bubble center
                            // by ±barHalf. yTop is the upper (smaller-y) endpoint.
                            // Anchoring must match the panel: top-anchored (Day /
                            // Sidewalk / Elevator) measures from the top; the Week
                            // stack measures from the bottom (req #2798 — the
                            // hard-coded calc(100% - …) put the bar off-lane in the
                            // top-anchored Elevator/Sidewalk panels).
                            const laneCenter = cd.lane * rowSpacing + circleDiameter / 2;
                            const yTop = topAnchored
                                ? `${chromeOffset + laneCenter - barHalf}px`
                                : `calc(100% - ${cd.lane * rowSpacing + bubbleOffset + circleDiameter / 2 + barHalf}px)`;
                            const yBot = topAnchored
                                ? `${chromeOffset + laneCenter + barHalf}px`
                                : `calc(100% - ${cd.lane * rowSpacing + bubbleOffset + circleDiameter / 2 - barHalf}px)`;
                            const card = cd.card;
                            // Datacard built lazily — only constructed when the bar
                            // is actually hovered (req #2840), not for every panel up
                            // front. Fed to the single shared tooltip.
                            const renderXdCard = () => (
                                <Box className="ts-datacard" data-testid={`ts-datacard-xd-${card.id}-${cd.sessionId}`}>
                                    <div className="ts-datacard-title">#{card.id} {card.title}</div>
                                    <div className="ts-datacard-row">
                                        <span className="ts-datacard-key">Category</span>
                                        <span>{card.categoryName || '—'}</span>
                                    </div>
                                    <div className="ts-datacard-row">
                                        <span className="ts-datacard-key">Autonomy</span>
                                        <span>{formatCoordination(card.coordination_type)}</span>
                                    </div>
                                    {card.session && (
                                        <div className="ts-datacard-row">
                                            <span className="ts-datacard-key">Started</span>
                                            <span>{formatCardDateTime(card.session.started_at, card.timezone)}</span>
                                        </div>
                                    )}
                                    <div className="ts-datacard-row">
                                        <span className="ts-datacard-key">{card.inProgress ? 'Status' : 'Closed'}</span>
                                        <span>{card.inProgress ? 'in progress' : formatCardDateTime(card.completed_at, card.timezone)}</span>
                                    </div>
                                    {card.swarmStart && (
                                        <div className="ts-datacard-row">
                                            <span className="ts-datacard-key">Swarm-Start</span>
                                            <span>
                                                #{card.swarmStart.id}
                                                {card.swarmStart.session_count != null
                                                    ? ` · ${card.swarmStart.session_count} session${card.swarmStart.session_count === 1 ? '' : 's'}`
                                                    : ''}
                                                {card.swarmStart.wall_seconds != null
                                                    ? ` · ${card.swarmStart.wall_seconds < 60
                                                        ? `${card.swarmStart.wall_seconds}s`
                                                        : `${Math.floor(card.swarmStart.wall_seconds / 60)}m ${card.swarmStart.wall_seconds % 60}s`}`
                                                    : ''}
                                            </span>
                                        </div>
                                    )}
                                    {card.session && (
                                        <div className="ts-datacard-row">
                                            <span className="ts-datacard-key">Session</span>
                                            <span>#{card.session.id} · {card.session.swarm_status || '—'}</span>
                                        </div>
                                    )}
                                </Box>
                            );
                            return (
                                    <g key={key}
                                       data-testid={`ts-swarm-start-xd-${cd.sessionId}`}
                                       data-real={card?.swarmStartId ? '1' : '0'}
                                       style={{ cursor: card?.swarmStartId ? 'pointer' : 'default' }}
                                       onMouseEnter={card ? (e) => tt.show(renderXdCard(), e.currentTarget) : undefined}
                                       onMouseLeave={card ? tt.hide : undefined}
                                       onClick={card?.swarmStartId != null
                                           ? () => onSwarmStartClick && onSwarmStartClick(card.swarmStartId)
                                           : undefined}>
                                        {/* dashed horizontal tail from start to right edge */}
                                        <line {...hLine} x1={`${cd.pct}%`} x2="100%" />
                                        {/* solid vertical start bar at startPct.
                                            Color contract (req #2504): real → green,
                                            estimated → red. Anchor dot on both. */}
                                        <line
                                            className={`ts-swarm-start-tick ts-swarm-start-tick-xstart ${card?.swarmStartId ? 'ts-swarm-start-tick-real' : 'ts-swarm-start-tick-estimated'}`}
                                            stroke={card?.swarmStartId ? '#43A047' : '#E53935'}
                                            strokeWidth={2.5}
                                            strokeLinecap="round"
                                            x1={`${cd.pct}%`} x2={`${cd.pct}%`}
                                            y1={yTop} y2={yBot}
                                        />
                                        <circle
                                            className={`ts-swarm-start-anchor ${card?.swarmStartId ? 'ts-swarm-start-anchor-real' : 'ts-swarm-start-anchor-estimated'}`}
                                            cx={`${cd.pct}%`} cy={yTop} r="3"
                                            fill={card?.swarmStartId ? '#43A047' : '#E53935'}
                                        />
                                        {/* invisible wider hit zone for tooltip reliability */}
                                        <rect
                                            x={`calc(${cd.pct}% - 8px)`} y={yTop}
                                            width="16" height={`${barHalf * 2}`}
                                            fill="transparent" pointerEvents="all"
                                        />
                                    </g>
                            );
                        }
                        return null;
                    })}

                    {/* Horizontal line — for 'normal', 'clamped', and (req #2504)
                        'inprogress'. Line y is the bubble CENTER (bubbleBottom +
                        radius) so the arrowhead lands on the middle of the circle
                        for completed chips. Phantom 'inprogress' lines are solid
                        green and end with a small ring (no arrow) at "now". */}
                    {placed.map(chip => {
                        if (chip.markerMode !== 'normal'
                            && chip.markerMode !== 'clamped'
                            && chip.markerMode !== 'inprogress') return null;
                        const yCenter = bubbleCenterCss(chip.row);
                        const isInProgress = chip.markerMode === 'inprogress';
                        // Phantom-clamped (req #2649): when the real swarm-start
                        // sits before the visible window, the phantom rides at
                        // nowPct with startPct artificially pinned to 0. The
                        // line gets the dashed `ts-swarm-line-clamped` styling
                        // to convey "extends off the left edge."
                        const isClamped    = chip.markerMode === 'clamped' || chip.startClamped === true;
                        // Omit the arrowhead when the line would be shorter than
                        // the arrow itself — happens for cluster-aligned chips
                        // whose canonical start sits close to the met bubble.
                        // Phantom in-progress lines never carry an arrow (the
                        // ring at the now-end is the terminator).
                        const gapPct = chip.leftPct - chip.startPct;
                        const showArrow = !isInProgress && gapPct >= ARROW_OMIT_THRESHOLD_PCT;
                        // Phantom lines back off by the same bubble-radius as
                        // completed chips — the phantom now renders an open
                        // ring at leftPct (same diameter as a regular bubble),
                        // so the line should stop at the ring's left edge.
                        const x2 = `calc(${chip.leftPct}% - ${circleDiameter / 2 + 2}px)`;
                        // req #2823 — phase-duration segmentation. Only completed,
                        // in-window 'normal' chips (full start→complete duration
                        // visible, real session) are eligible: clamped lines run
                        // off-window so their proportions would be wrong, and
                        // in-progress phantoms are still mid-flight. When the
                        // session is instrumented with phase time, replace the
                        // single grey line with proportional coloured segments;
                        // an instrumented==0 / no-data session falls through to a
                        // single neutral-gray "unclassified" line.
                        const phase = (phasesOn && chip.markerMode === 'normal' && !isInProgress)
                            ? computePhaseSegments(chip.session, chip.startPct, chip.leftPct)
                            : null;
                        if (phase && phase.classified) {
                            return (
                                <g key={`line-${chip.chipKey}`}
                                   data-testid={`ts-swarm-phases-${chip.chipKey}`}>
                                    {phase.segments.map((seg, i) => {
                                        const last = i === phase.segments.length - 1;
                                        // NB: deliberately NOT `ts-swarm-line` — that
                                        // class carries a dark-mode `stroke: …
                                        // !important` override (TimeSeriesView.css)
                                        // that would force every segment to one grey,
                                        // beating the inline per-phase colour. The
                                        // thick colour bar also needs no arrowhead —
                                        // the bubble is its terminus (an arrow here
                                        // would just scale up with strokeWidth=3).
                                        return (
                                            <line
                                                key={seg.key}
                                                data-testid={`ts-swarm-phase-${chip.chipKey}-${seg.key}`}
                                                className={`ts-swarm-phase ts-swarm-phase-${seg.family}`}
                                                x1={`${seg.x1Pct}%`}
                                                y1={yCenter}
                                                x2={last ? x2 : `${seg.x2Pct}%`}
                                                y2={yCenter}
                                                stroke={seg.color}
                                                strokeWidth={3}
                                            />
                                        );
                                    })}
                                </g>
                            );
                        }
                        const stroke = isInProgress
                            ? '#43A047'
                            // Phases on + this normal chip carries no usable phase
                            // split → flat neutral gray = explicit "unknown split".
                            : (phase ? PHASE_UNCLASSIFIED_COLOR : 'rgba(96,125,139,0.85)');
                        const strokeWidth = isInProgress ? 2 : 1.5;
                        return (
                            <line
                                key={`line-${chip.chipKey}`}
                                data-testid={`ts-swarm-line-${chip.chipKey}`}
                                className={`ts-swarm-line ${isClamped ? 'ts-swarm-line-clamped' : ''} ${isInProgress ? 'ts-swarm-line-inprogress' : ''} ${phase ? 'ts-swarm-line-unclassified' : ''}`}
                                x1={`${chip.startPct}%`}
                                y1={yCenter}
                                x2={x2}
                                y2={yCenter}
                                stroke={stroke}
                                strokeWidth={strokeWidth}
                                markerEnd={showArrow ? `url(#ts-swarm-arrow-${selectedDate})` : undefined}
                            />
                        );
                    })}
                    {/* Vertical start bar — position depends on markerMode:
                        'normal'  → at startPct (left end of the duration line;
                                    aligns cluster-mates vertically, req #2341/#2398/#2399)
                        'left'    → immediately left of bubble (no session OR start ≈ met
                                    on a non-aligned chip — no duration line drawn)
                        'clamped' → skipped (horizontal dashed line already conveys it)
                        Real swarm-starts (req #2504) — distinct deep-purple stroke +
                        a small anchor dot at the start so the user can tell real-data
                        clusters apart from estimated time-window clusters. */}
                    {placed.map(chip => {
                        // Phantom-clamped (req #2649): startPct is artificially
                        // 0 because the real swarm-start sits before the visible
                        // window. Drawing a bar at the panel's left edge would
                        // misrepresent the start location — skip both the bar
                        // and the anchor; the dashed line already conveys
                        // "extends off the left edge."
                        if (chip.startClamped === true) return null;
                        const halfBar = Math.max(6, circleDiameter / 2);
                        // Bar endpoints are bubble-center ± halfBar. The center
                        // is already expressed in the active anchoring by
                        // bubbleCenterCss — top-anchored `${N}px` for
                        // Day/Sidewalk/Elevator, `calc(100% - ${N}px)` for the
                        // Week stack — so the bar follows row 0 to whichever
                        // edge the wire is on (req #2780).
                        const yStride = chip.row * rowSpacing + circleDiameter / 2;
                        const y1 = topAnchored
                            ? `${chromeOffset + yStride - halfBar}px`
                            : `calc(100% - ${bubbleOffset + yStride - halfBar}px)`;
                        const y2 = topAnchored
                            ? `${chromeOffset + yStride + halfBar}px`
                            : `calc(100% - ${bubbleOffset + yStride + halfBar}px)`;
                        const gap = circleDiameter / 2 + 3;
                        const x = swarmStartBarX(chip.markerMode, chip.leftPct, chip.startPct, gap);
                        if (x === null) return null;
                        // Color contract (req #2504): real swarm-start data → green
                        // (#43A047), estimated/legacy clusters with no real data → red
                        // (#E53935). Both get the same anchor-dot treatment so the only
                        // visual difference is hue — a stable cue that survives data
                        // refetches and cluster recomputations.
                        const isReal = !!chip.swarmStartId;
                        const stroke = isReal ? '#43A047' : '#E53935';
                        const strokeWidth = 2.5;
                        // Anchor dot — outboard end (away from bubble).
                        // 'normal' → top end; 'left' → wire-side end.
                        const anchorY = chip.markerMode === 'left' ? y2 : y1;
                        return (
                            <g key={`tick-${chip.chipKey}`}
                               data-marker-mode={chip.markerMode}
                               data-real={isReal ? '1' : '0'}>
                                <line
                                    data-testid={`ts-swarm-start-${chip.chipKey}`}
                                    className={`ts-swarm-start-tick ts-swarm-start-tick-${chip.markerMode} ${isReal ? 'ts-swarm-start-tick-real' : 'ts-swarm-start-tick-estimated'}`}
                                    x1={x} y1={y1}
                                    x2={x} y2={y2}
                                    stroke={stroke}
                                    strokeWidth={strokeWidth}
                                    strokeLinecap="round"
                                />
                                <circle
                                    data-testid={`ts-swarm-start-anchor-${chip.chipKey}`}
                                    className={`ts-swarm-start-anchor ${isReal ? 'ts-swarm-start-anchor-real' : 'ts-swarm-start-anchor-estimated'}`}
                                    cx={x} cy={anchorY} r="3"
                                    fill={stroke}
                                />
                            </g>
                        );
                    })}
            </svg>

            {/* Swarm-start anchor hover targets — invisible HTML boxes overlay
                each SVG anchor circle. Hover shows a "Swarm-Start #N" datacard:
                started_at, sessions, wall, turns, autonomy, auto-start, args.
                Real (green) anchors get the full swarm_starts data; estimated
                (red) anchors get a brief "no swarm-start data" note instead.
                The hover is needed because the SVG layer has pointer-events:
                none (lines and circles are decorative); this overlay restores
                hover affordance for the anchor specifically. Req #2504. */}
            {placed.map(chip => {
                // Phantom-clamped (req #2649) — no SVG anchor was rendered for
                // this chip, so there's nothing to overlay a hover target on.
                if (chip.startClamped === true) return null;
                const halfBar = Math.max(6, circleDiameter / 2);
                const yStride = chip.row * rowSpacing + circleDiameter / 2;
                const gap = circleDiameter / 2 + 3;
                const xCss = swarmStartBarX(chip.markerMode, chip.leftPct, chip.startPct, gap);
                if (xCss === null) return null;   // clamped — no anchor to hover
                const hitPx = 18;
                const halfHit = hitPx / 2;
                // anchor y mirrors the SVG circle's anchorY: 'left' mode → y2
                // (wire-side end), other modes → y1 (outboard end).
                const anchorAtWire = chip.markerMode === 'left';
                const anchorYpx = topAnchored
                    ? chromeOffset + yStride + (anchorAtWire ? halfBar : -halfBar)
                    : bubbleOffset + yStride + (anchorAtWire ? halfBar : -halfBar);
                const yStyle = topAnchored
                    ? { top:    `${anchorYpx - halfHit}px` }
                    : { bottom: `${anchorYpx - halfHit}px` };
                const isReal = !!chip.swarmStartId;
                const ss = chip.swarmStart;
                const wall = ss && ss.wall_seconds != null
                    ? (ss.wall_seconds < 60
                        ? `${ss.wall_seconds}s`
                        : `${Math.floor(ss.wall_seconds / 60)}m ${ss.wall_seconds % 60}s`)
                    : null;
                // Built lazily — only on hover (req #2840), consistent with the
                // chip and cross-day datacards.
                const renderAnchorCard = () => (isReal && ss ? (
                    <Box className="ts-datacard" data-testid={`ts-datacard-swarm-start-hit-${chip.chipKey}`}>
                        <div className="ts-datacard-title">Swarm-Start #{ss.id}</div>
                        <div className="ts-datacard-row">
                            <span className="ts-datacard-key">Started</span>
                            <span>{formatCardDateTime(ss.started_at, timezone)}</span>
                        </div>
                        {ss.session_count != null && (
                            <div className="ts-datacard-row">
                                <span className="ts-datacard-key">Sessions</span>
                                <span>{ss.session_count}</span>
                            </div>
                        )}
                        {wall && (
                            <div className="ts-datacard-row">
                                <span className="ts-datacard-key">Wall</span>
                                <span>{wall}</span>
                            </div>
                        )}
                        {ss.turn_count != null && (
                            <div className="ts-datacard-row">
                                <span className="ts-datacard-key">Turns</span>
                                <span>{ss.turn_count}</span>
                            </div>
                        )}
                        {ss.auto_start ? (
                            <div className="ts-datacard-row">
                                <span className="ts-datacard-key">Auto-Start</span>
                                <span>yes</span>
                            </div>
                        ) : null}
                        <div className="ts-datacard-row">
                            <span className="ts-datacard-key">Command</span>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                /swarm-start{ss.arguments ? ` ${ss.arguments}` : ''}
                            </span>
                        </div>
                    </Box>
                ) : (
                    <Box className="ts-datacard">
                        <div className="ts-datacard-title">Estimated swarm-start</div>
                        <div className="ts-datacard-row">
                            <span className="ts-datacard-key">Started</span>
                            <span>{formatCardDateTime(chip.groupKey || chip.session?.started_at, timezone)}</span>
                        </div>
                    </Box>
                ));
                return (
                        <Box
                            key={`anchor-hit-${chip.chipKey}`}
                            data-testid={`ts-swarm-start-hit-${chip.chipKey}`}
                            data-real={isReal ? '1' : '0'}
                            onMouseEnter={(e) => tt.show(renderAnchorCard(), e.currentTarget)}
                            onMouseLeave={tt.hide}
                            // Real anchors open the single swarm-start detail
                            // (req #2747); estimated anchors have no row to open.
                            onClick={isReal && chip.swarmStartId != null
                                ? () => onSwarmStartClick && onSwarmStartClick(chip.swarmStartId)
                                : undefined}
                            style={{
                                position: 'absolute',
                                left: `calc(${xCss} - ${halfHit}px)`,
                                width:  `${hitPx}px`,
                                height: `${hitPx}px`,
                                cursor: isReal ? 'pointer' : 'default',
                                zIndex: 1,             // below bubble (z:2), above SVG (z:1 visually)
                                ...yStyle,
                            }}
                        />
                );
            })}

            {/* Tombstone overlay removed (req #2719 v2) — undone sessions now
                render as regular chips through the normal placed[] pipeline
                with a tombstone bubble swap in the chip render below. The
                session row is preserved by /swarm-undo so the chip lives,
                pays the same lane/cluster math, and inherits hover/datacard
                identically. */}

            {placed.map(chip => {
                // Datacard built lazily — constructed only when this chip is
                // hovered (req #2840), then handed to the single shared tooltip.
                const renderChipCard = () => (
                        <Box className="ts-datacard" data-testid={`ts-datacard-${chip.chipKey || chip.id}`}>
                            <div className="ts-datacard-title">
                                {chip.id != null ? `#${chip.id} ` : ''}{chip.title}
                            </div>
                            <div className="ts-datacard-row">
                                <span className="ts-datacard-key">Category</span>
                                <span>{chip.categoryName || '—'}</span>
                            </div>
                            <div className="ts-datacard-row">
                                <span className="ts-datacard-key">Autonomy</span>
                                <span data-testid={`ts-datacard-autonomy-${chip.chipKey || chip.id}`}>
                                    {formatCoordination(chip.coordination_type)}
                                </span>
                            </div>
                            {chip.isPhantom && (
                                <div className="ts-datacard-row" data-testid={`ts-datacard-status-${chip.chipKey}`}>
                                    <span className="ts-datacard-key">Status</span>
                                    <span style={{ color: '#43A047', fontWeight: 600 }}>
                                        in progress{chip.requirement_status ? ` · ${chip.requirement_status}` : ''}
                                    </span>
                                </div>
                            )}
                            {chip.session && (
                                <div className="ts-datacard-row">
                                    <span className="ts-datacard-key">Started</span>
                                    <span>
                                        {chip.session.started_at
                                            ? formatCardDateTime(chip.session.started_at, chip.timezone)
                                            : '—'}
                                        {chip.startClamped ? ' (before window)' : ''}
                                    </span>
                                </div>
                            )}
                            {!chip.session && chip.isUndone && chip.swarmStart?.started_at && (
                                <div className="ts-datacard-row">
                                    <span className="ts-datacard-key">Started</span>
                                    <span>
                                        {formatCardDateTime(chip.swarmStart.started_at, chip.timezone)}
                                        {chip.startClamped ? ' (before window)' : ''}
                                    </span>
                                </div>
                            )}
                            {!chip.isPhantom && !chip.isUndone && (
                                <div className="ts-datacard-row">
                                    <span className="ts-datacard-key">Closed</span>
                                    <span>{formatCardDateTime(chip.completed_at, chip.timezone)}</span>
                                </div>
                            )}
                            {chip.isUndone && (
                                <>
                                    <div className="ts-datacard-row" data-testid={`ts-datacard-status-${chip.chipKey}`}>
                                        <span className="ts-datacard-key">Status</span>
                                        <span style={{ color: '#616161', fontWeight: 600 }}>
                                            undone
                                        </span>
                                    </div>
                                    <div className="ts-datacard-row">
                                        <span className="ts-datacard-key">Undone</span>
                                        <span>{formatCardDateTime(chip.completed_at, chip.timezone)}</span>
                                    </div>
                                    {chip.undo?.reason && (
                                        <div className="ts-datacard-row">
                                            <span className="ts-datacard-key">Reason</span>
                                            <span style={{ whiteSpace: 'pre-wrap' }}>
                                                {chip.undo.reason}
                                            </span>
                                        </div>
                                    )}
                                </>
                            )}
                            {chip.swarmStart && (
                                <div className="ts-datacard-row" data-testid={`ts-datacard-swarm-start-${chip.chipKey || chip.id}`}>
                                    <span className="ts-datacard-key">Swarm-Start</span>
                                    <span>
                                        #{chip.swarmStart.id}
                                        {chip.swarmStart.session_count != null
                                            ? ` · ${chip.swarmStart.session_count} session${chip.swarmStart.session_count === 1 ? '' : 's'}`
                                            : ''}
                                        {chip.swarmStart.wall_seconds != null
                                            ? ` · ${chip.swarmStart.wall_seconds < 60
                                                ? `${chip.swarmStart.wall_seconds}s`
                                                : `${Math.floor(chip.swarmStart.wall_seconds / 60)}m ${chip.swarmStart.wall_seconds % 60}s`}`
                                            : ''}
                                    </span>
                                </div>
                            )}
                            {chip.session && (
                                <div className="ts-datacard-row">
                                    <span className="ts-datacard-key">Session</span>
                                    <span>#{chip.session.id} · {chip.session.swarm_status || '—'}</span>
                                </div>
                            )}
                            {chip.swarmComplete && (
                                <div className="ts-datacard-row" data-testid={`ts-datacard-swarm-complete-${chip.chipKey || chip.id}`}>
                                    <span className="ts-datacard-key">Closed by</span>
                                    <span>
                                        #{chip.swarmComplete.id}
                                        {` · ${chip.swarmComplete.status}`}
                                        {chip.swarmComplete.skill_name === 'primary-ai-swarm-complete' ? ' · primary' : ''}
                                        {chip.swarmComplete.wall_seconds != null
                                            ? ` · ${chip.swarmComplete.wall_seconds < 60
                                                ? `${chip.swarmComplete.wall_seconds}s`
                                                : `${Math.floor(chip.swarmComplete.wall_seconds / 60)}m ${chip.swarmComplete.wall_seconds % 60}s`}`
                                            : ''}
                                    </span>
                                </div>
                            )}
                        </Box>
                );
                return (
                    <Box
                        key={chip.chipKey || chip.id}
                        className={`ts-bead-group${chip.isPhantom ? ' ts-bead-group-phantom' : ''}`}
                        data-testid={`ts-chip-${chip.chipKey || chip.id}`}
                        data-reqid={chip.id ?? undefined}
                        data-phantom={chip.isPhantom ? '1' : undefined}
                        onMouseEnter={(e) => tt.show(renderChipCard(), e.currentTarget)}
                        onMouseLeave={tt.hide}
                        style={{
                            // Clamp the X position so chips at panel edges (00:00 /
                            // 23:59 day boundaries) never half-clip into the chrome
                            // (req #2504 follow-up — May 6 midnight clipping report).
                            // Margin = halfBubble + 2px halo on each side.
                            left: `clamp(${(circleDiameter / 2) + 2}px, ${chip.leftPct}%, calc(100% - ${(circleDiameter / 2) + 2}px))`,
                            ...bubbleYCss(chip.row),
                        }}
                        onClick={() => {
                            if (chip.isPhantom) return;
                            // Tombstone (req #2747) → swarm-undo detail, not the
                            // requirement. The undo data is the pertinent context
                            // for an undone session; the requirement is one hop away.
                            if (chip.isUndone) {
                                onUndoClick && onUndoClick(chip.undo?.id);
                                return;
                            }
                            if (chip.id == null) return;
                            onChipClick && onChipClick(chip.id);
                        }}
                    >
                        {/* Req #2497 — completion terminus badge. Restores the
                            lifecycle symmetry rocket(start) → … → ✓(complete).
                            Status-coloured (green ok / amber error); a flag glyph
                            distinguishes a primary-ai closeout. Clickable through
                            to the swarm-complete detail (stopPropagation so the
                            bubble's own requirement click doesn't also fire). */}
                        {completesOn && chip.swarmComplete && !chip.isUndone && !chip.isPhantom && (() => {
                            const sc = chip.swarmComplete;
                            const ok = sc.status === 'ok';
                            const bg = ok ? '#4caf50' : (sc.status === 'error' ? '#ffa726' : '#90a4ae');
                            const isPrimary = sc.skill_name === 'primary-ai-swarm-complete';
                            const glyph = isPrimary ? '⚑' : (ok ? '✓' : '!');
                            const B = Math.max(12, Math.round(circleDiameter * 0.55));
                            return (
                                <span
                                    className="ts-bead-complete-badge"
                                    data-testid={`ts-complete-badge-${chip.chipKey || chip.id}`}
                                    title={`Closed by complete #${sc.id} — ${sc.status}${isPrimary ? ' · primary' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCompleteClick && onCompleteClick(sc.id);
                                    }}
                                    style={{
                                        position: 'absolute',
                                        top: -4, right: -4,
                                        width: `${B}px`, height: `${B}px`,
                                        borderRadius: '50%',
                                        backgroundColor: bg,
                                        color: ok ? '#fff' : '#000',
                                        fontSize: `${Math.round(B * 0.62)}px`,
                                        lineHeight: `${B}px`,
                                        textAlign: 'center',
                                        fontWeight: 700,
                                        boxShadow: '0 0 0 1.5px var(--ts-bg, #fff)',
                                        cursor: 'pointer',
                                        zIndex: 3,
                                        userSelect: 'none',
                                    }}
                                >
                                    {glyph}
                                </span>
                            );
                        })()}
                        {chip.isUndone ? (
                            // Req #2719 — undone session bubble: textless
                            // tombstone glyph sized to fill the same bubble
                            // slot. Same diameter+halo+hover behavior as a
                            // regular dot so lane/cluster math stays untouched.
                            //
                            // No "RIP" text — at 12-16px the text was illegible
                            // in both light and dark mode. Replaced with a
                            // mid-grey rounded-top stone + a thin etched cross
                            // that holds shape at any size and contrasts
                            // against both backgrounds. CSS class
                            // `ts-bead-dot-tombstone` carries the theme-aware
                            // outline color (see TimeSeriesView.css).
                            (() => {
                                const SZ = circleDiameter + 6;
                                const cx = SZ / 2;
                                const topR = SZ * 0.45;
                                // Cross dimensions — traditional Latin-cross
                                // (1:2) proportions per the spec the user
                                // supplied: total height = 2 × total width,
                                // arm thickness = arm-width / 3, horizontal
                                // arm attached 1/4 down from the top.
                                //
                                // Driven by a single `crossH` knob (~66% of
                                // the stone height); everything else falls
                                // out of the ratio. The prior version used
                                // equal stem-height and beam-width which
                                // produced a Greek-cross (1:1) silhouette
                                // — wrong shape for a tombstone glyph.
                                const crossH = SZ * 0.66;
                                const crossW = crossH / 2;
                                const thick  = Math.max(2, Math.round(crossW / 3));
                                const crossTop = SZ * 0.18;

                                const stemW = thick;
                                const stemH = Math.round(crossH);
                                const beamW = Math.round(crossW);
                                const beamH = thick;
                                const stemY = Math.round(crossTop);
                                const beamY = Math.round(crossTop + crossH / 4);
                                return (
                                    <span
                                        className="ts-bead-dot ts-bead-dot-tombstone"
                                        data-testid={`ts-bead-dot-${chip.chipKey || chip.id}`}
                                        style={{
                                            backgroundColor: 'transparent',
                                            boxShadow: 'none',
                                            width: `${SZ}px`,
                                            height: `${SZ}px`,
                                            display: 'inline-block',
                                            position: 'relative',
                                        }}
                                    >
                                        <svg
                                            width={SZ}
                                            height={SZ}
                                            viewBox={`0 0 ${SZ} ${SZ}`}
                                            style={{ display: 'block' }}
                                            aria-label="tombstone"
                                        >
                                            {/* Stone body — near-black fill
                                                + mid-grey outline. Reads as
                                                a silhouette against both
                                                light and dark backgrounds
                                                without needing a theme
                                                override. */}
                                            <path
                                                d={`M 2 ${SZ - 1}
                                                    L 2 ${topR}
                                                    Q 2 1 ${cx} 1
                                                    Q ${SZ - 2} 1 ${SZ - 2} ${topR}
                                                    L ${SZ - 2} ${SZ - 1}
                                                    Z`}
                                                fill="#424242"
                                                stroke="#9E9E9E"
                                                strokeWidth="1"
                                                strokeLinejoin="round"
                                            />
                                            {/* Etched cross — pure white on
                                                near-black stone for maximum
                                                internal contrast (~17:1).
                                                Stem (vertical) drawn first,
                                                beam (horizontal) drawn on
                                                top so the joint reads as a
                                                clean cross at any size. */}
                                            <rect
                                                x={cx - stemW / 2}
                                                y={stemY}
                                                width={stemW}
                                                height={stemH}
                                                fill="#FFFFFF"
                                                rx="0.5"
                                            />
                                            <rect
                                                x={cx - beamW / 2}
                                                y={beamY}
                                                width={beamW}
                                                height={beamH}
                                                fill="#FFFFFF"
                                                rx="0.5"
                                            />
                                        </svg>
                                    </span>
                                );
                            })()
                        ) : (
                            <span
                                className={`ts-bead-dot${chip.ringColor ? ' ts-bead-dot-ringed' : ''}${chip.isPhantom ? ' ts-bead-dot-phantom' : ''}`}
                                data-testid={`ts-bead-dot-${chip.chipKey || chip.id}`}
                                style={chip.isPhantom ? {
                                    // Phantom (unfinished requirement): white core + a coloured
                                    // inner ring at the line's "now" end. Same diameter as a regular
                                    // bubble so layout is stable. req #2807 — the inner ring is the
                                    // requirement's own colour (category colour, `chip.color`) rather
                                    // than a fixed green, so an in-progress bead echoes the colour its
                                    // finished (solid-fill) counterpart will take. Green stays as the
                                    // no-category-colour fallback (matches the phantom chip default).
                                    backgroundColor: '#ffffff',
                                    border: `2px solid ${chip.color || '#43A047'}`,
                                    boxSizing: 'border-box',
                                    borderRadius: '50%',
                                    width:  `${circleDiameter}px`,
                                    height: `${circleDiameter}px`,
                                    // req #2755 — when the Coordination toggle is on, layer the
                                    // autonomy ring (6px coordination-color band) into the inline
                                    // box-shadow. The inline value overrides the .ts-bead-dot-ringed
                                    // CSS rule, so the ring must be emitted here to render on phantoms.
                                    boxShadow: chip.ringColor
                                        ? `0 0 0 2px #fff, 0 0 0 6px ${chip.ringColor}, 0 1px 3px rgba(0, 0, 0, 0.2)`
                                        : '0 0 0 2px #fff, 0 1px 3px rgba(0, 0, 0, 0.2)',
                                    ...(chip.ringColor ? { '--ts-ring-color': chip.ringColor } : null),
                                } : {
                                    backgroundColor: chip.color || '#90a4ae',
                                    width:  `${circleDiameter}px`,
                                    height: `${circleDiameter}px`,
                                    ...(chip.ringColor ? { '--ts-ring-color': chip.ringColor } : null),
                                }}
                            />
                        )}
                        {/* req #2556 — title to right of bubble when toolbar Title toggle on. */}
                        {titlesOn && chip.title && (
                            <span
                                className="ts-bead-label"
                                data-testid={`ts-bead-label-${chip.chipKey || chip.id}`}
                            >
                                {chip.title}
                            </span>
                        )}
                    </Box>
                );
            })}

            {/* Count pill is carried by the sticky header (Week stack) or inline to
                the left of the date in DayLabels (Day / Sidewalk / Elevator) — the
                standalone absolute badge was retired in req #2747. */}
        </Box>
    );
});
BeadRow.displayName = 'BeadRow';

// ─────────── Sidewalk — transform-based pure-drag horizontal scroller ─────────
// The outer frame is fixed (width: 100%, overflow: hidden). The inner flex strip
// contains a sliding window of day panels (initially 21 centered on centerDate),
// each exactly one frame wide. Dragging the inner strip horizontally changes its
// translateX; release applies a momentum decay then snaps to the nearest panel.
//
// Infinite scroll (req #2396): when the visible panel index gets within
// SIDEWALK_BUFFER_THRESHOLD of either edge of `dates`, we extend that side by
// SIDEWALK_EXTEND_BY days (and shift translateX for left extensions so the
// visible panel stays put). Once the array exceeds SIDEWALK_MAX_PANELS we
// prune the opposite side to keep memory bounded. There's no offset clamp —
// the strip is effectively endless in both directions.
const SIDEWALK_BUFFER_THRESHOLD = 5;
const SIDEWALK_EXTEND_BY = 10;
const SIDEWALK_MAX_PANELS = 60;
// req #2840 — virtualization buffer: how many off-screen panels to keep mounted
// on each side of the visible window so a fast fling never reveals a blank panel
// before the range update lands.
const SIDEWALK_VIS_BUFFER = 4;

const Sidewalk = ({ centerDate, onCenterDateChange, requirementsByDate, ...rowProps }) => {
    const { requirements, sessions, timezone, circleDiameter, spaceKey, beadWindow,
            swarmStarts, swarmStartSessions, swarmUndos, requirementById,
            categoryList, canonicalStartById, swarmStartIdById, swarmStartById } = rowProps;
    // Today (local) — stable per mount; drives in-progress cross-day spans + the
    // clamped phantom lane sizing, same convention as the Elevator (req #2798).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const todayStr = useMemo(() => localDateStr(new Date()), []);
    const frameRef = React.useRef(null);
    const innerRef = React.useRef(null);
    const offsetRef = React.useRef(0);      // current translateX in px (negative = panels to the left)
    const velocityRef = React.useRef(0);    // px / frame
    const rafRef = React.useRef(null);
    const lastReported = React.useRef(centerDate);
    const reportTimeoutRef = React.useRef(null);   // trailing debounce of onCenterDateChange
    const pendingDateRef   = React.useRef(null);   // most-recent candidate waiting to flush
    const hasDragged = React.useRef(false);
    const [dates, setDates] = React.useState(() => centeredDateRange(centerDate, 10));
    // Mirror of `dates` for synchronous reads inside drag/wheel handlers — lets
    // maybeExtend check current length without re-binding the drag effect on
    // every extension (which would trash in-progress drag state).
    const datesRef = React.useRef(dates);
    const [frameWidth, setFrameWidth] = React.useState(0);
    // req #2840 — virtualization window: indices into `dates` that are mounted as
    // real BeadRows; everything else renders a same-width empty placeholder. The
    // initial strip is centeredDateRange(centerDate, 10) → 21 panels with the
    // focus day at index 10, so seed a window around it; the scroll handlers and
    // the geometry effect keep it current from there.
    const [visRange, setVisRange] = React.useState(() => ({
        start: Math.max(0, 10 - SIDEWALK_VIS_BUFFER),
        end: 10 + SIDEWALK_VIS_BUFFER,
    }));

    // req #2823 follow-up — sub-day horizontal zoom. A day panel still represents
    // a full 24h (BeadRow's sidewalkPanel path is unconditionally 24h, and every
    // chip/tick/line positions in % within the panel), but we render the panel
    // WIDER than the viewport so the day spreads across multiple screen-widths and
    // the strip — which already hand-scrolls horizontally — reveals only a slice at
    // a time. panelScale = 24 / visibleHours:
    //   '6h'  → 4× (viewport shows ~6h)   '12h' → 2× (~12h)   else → 1× (full 24h,
    //   byte-identical to the original behaviour). panelWidth is the per-panel
    //   pixel STRIDE the infinite-scroll / centring math runs on; frameWidth stays
    //   the measured viewport width.
    const panelScale = sidewalkPanelScale(beadWindow);
    const panelWidth = frameWidth * panelScale;

    // Req #2798 — cross-day pass-through lines for multi-day sessions, keyed by
    // each day panel in the strip, with the 24h start-bar coordinate.
    const crossDayMap = useMemo(() => {
        return buildCrossDayMap(dates, {
            requirements, sessions, swarmStarts, swarmStartSessions,
            requirementById, categoryList,
            canonicalStartById, swarmStartIdById, swarmStartById,
            timezone, startXPct: bead24hXPct, today: todayStr,
        });
    }, [dates, requirements, sessions, swarmStarts, swarmStartSessions,
        requirementById, categoryList, canonicalStartById, swarmStartIdById,
        swarmStartById, timezone, todayStr]);

    // Uniform panel height — sized to the busiest day in the visible strip so
    // every panel shows all its lanes below the top chrome. Mirrors BeadRow's
    // height formula (sidewalk branch: chromeOffset=80, bubbleOffset=20).
    // Single-pass bucket via indexChipsByDate so 21-day strips stay O(R+S+D)
    // instead of O(D × (R+S)) — matters during scroll, when requirements
    // refetches churn this memo. Also folds in the phantom/undone (req #2797)
    // and cross-day pass-through (req #2798) lanes so a busy day's dashed lines
    // don't clip below the uniform height.
    const sidewalkHeight = useMemo(() => {
        const BASE_HEIGHT   = 400;
        const bubbleOffset  = 20;
        const chromeOffset  = 80;   // matches BeadRow's sidewalk chromeOffset (wire top:68 + padding)
        const dateClearance = Math.ceil(circleDiameter / 2) + 4;
        const spaceMul      = getSpaceMultiplier(spaceKey);
        const rowSpacing    = Math.max(16, Math.round((circleDiameter + 4) * spaceMul));
        const chipsByDate   = indexChipsByDate(requirements, sessions, timezone);
        const extraByDate   = indexSwarmExtraChipsByDate({
            swarmStarts, swarmStartSessions, swarmUndos, requirementById,
            sessions, timezone, today: todayStr,
        });
        let maxChips = 0;
        for (const d of dates) {
            const n = (chipsByDate.get(d) || 0)
                + (extraByDate.get(d) || 0)
                + (crossDayMap.get(d)?.length || 0);
            if (n > maxChips) maxChips = n;
        }
        const maxStackRow = Math.max(0, maxChips - 1);
        return Math.max(
            BASE_HEIGHT,
            maxStackRow * rowSpacing + bubbleOffset + circleDiameter + chromeOffset + dateClearance,
        );
    }, [dates, requirements, sessions, timezone, circleDiameter, spaceKey,
        crossDayMap, swarmStarts, swarmStartSessions, swarmUndos, requirementById, todayStr]);

    // Measure frame width; re-measure on resize. `layoutEffect` so initial paint has a width.
    React.useLayoutEffect(() => {
        const measure = () => {
            const w = frameRef.current?.clientWidth || 0;
            setFrameWidth(w);
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    // Cancel any pending debounced onCenterDateChange on unmount.
    React.useEffect(() => () => {
        if (reportTimeoutRef.current) {
            clearTimeout(reportTimeoutRef.current);
            reportTimeoutRef.current = null;
            pendingDateRef.current = null;
        }
    }, []);

    // Keep datesRef in sync with React state. maybeExtend writes to datesRef
    // synchronously to avoid same-frame re-extension; this effect covers
    // anything else that calls setDates (e.g., the centerDate rebuild path).
    React.useLayoutEffect(() => { datesRef.current = dates; }, [dates]);

    // req #2840 — recompute the mounted-panel window from the live offset and
    // only re-render when it actually shifts (functional update returns the prior
    // object reference to bail out). Called from applyOffset (once per scroll
    // frame, O(1)) and from the geometry effect below. Reads refs/state so the
    // captured copy inside the drag effect always sees current values.
    const updateVisibleRange = () => {
        const cur = datesRef.current;
        const r = sidewalkVisibleRange(
            offsetRef.current, panelWidth, frameWidth, cur.length, SIDEWALK_VIS_BUFFER,
        );
        setVisRange(prev => (prev.start === r.start && prev.end === r.end) ? prev : r);
    };

    // Apply a translateX to the inner strip without triggering React re-renders
    // — keeps drag at native-refresh smoothness.
    const applyOffset = (x) => {
        offsetRef.current = x;
        if (innerRef.current) innerRef.current.style.transform = `translate3d(${x}px,0,0)`;
        updateVisibleRange();
    };

    // req #2840 — recompute the window after a non-scroll geometry change
    // (extend/prune changes `dates`; a measure/zoom changes panelWidth/frameWidth).
    // Scroll itself is handled by applyOffset.
    React.useEffect(() => {
        updateVisibleRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dates, panelWidth, frameWidth]);

    const stopAnim = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
    };

    const animateTo = (target) => {
        stopAnim();
        const start = offsetRef.current;
        const delta = target - start;
        if (Math.abs(delta) < 1) { applyOffset(target); maybeExtend(); return; }
        const duration = Math.min(450, 180 + Math.abs(delta) * 0.4);
        const t0 = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - t0) / duration);
            const eased = 1 - (1 - t) ** 3;   // ease-out cubic
            applyOffset(start + delta * eased);
            if (t < 1) rafRef.current = requestAnimationFrame(step);
            else { rafRef.current = null; maybeExtend(); reportCenterIfChanged(); }
        };
        rafRef.current = requestAnimationFrame(step);
    };

    const indexForOffset = () => {
        if (panelWidth === 0) return 0;
        const cur = datesRef.current;
        const raw = -offsetRef.current / panelWidth;
        return Math.max(0, Math.min(cur.length - 1, Math.round(raw)));
    };

    // Infinite-scroll buffer maintenance. When the visible panel approaches
    // either edge, prepend / append SIDEWALK_EXTEND_BY days. Left extension
    // shifts translateX by -extend*panelWidth so the visible panel stays put;
    // when the array overflows SIDEWALK_MAX_PANELS, we prune the opposite end
    // (with a matching +removed*panelWidth shift if pruning the left side).
    // panelWidth is the zoom-aware per-panel stride (frameWidth × scale).
    //
    // datesRef is updated synchronously so a follow-up call within the same
    // frame doesn't see the pre-extension array and re-extend.
    const maybeExtend = () => {
        if (panelWidth === 0) return;
        const cur = datesRef.current;
        if (!cur || cur.length === 0) return;
        const raw = -offsetRef.current / panelWidth;
        const idx = Math.round(raw);
        const distLeft  = idx;
        const distRight = cur.length - 1 - idx;

        if (distLeft <= SIDEWALK_BUFFER_THRESHOLD) {
            // Extend left, then shift translateX so the visible panel stays put.
            applyOffset(offsetRef.current - SIDEWALK_EXTEND_BY * panelWidth);
            let next = extendDates(cur, 'left', SIDEWALK_EXTEND_BY);
            const pruned = pruneDates(next, SIDEWALK_MAX_PANELS, 'right');
            next = pruned.dates;
            datesRef.current = next;
            setDates(next);
        } else if (distRight <= SIDEWALK_BUFFER_THRESHOLD) {
            let next = extendDates(cur, 'right', SIDEWALK_EXTEND_BY);
            const pruned = pruneDates(next, SIDEWALK_MAX_PANELS, 'left');
            next = pruned.dates;
            // Pruning the left side shifts every remaining panel's index down
            // by `removedCount`; compensate translateX so the visible panel
            // stays put.
            if (pruned.removedCount > 0) {
                applyOffset(offsetRef.current + pruned.removedCount * panelWidth);
            }
            datesRef.current = next;
            setDates(next);
        }
    };

    // Trailing-debounce onCenterDateChange so a scroll sweep through N panels
    // doesn't fire N setCalendarView → requirements refetch → re-render cycles.
    // lastReported updates synchronously so the centerDate useEffect's
    // re-entrance guard still works when the debounced callback finally flushes.
    const REPORT_DEBOUNCE_MS = 150;
    const reportCenterIfChanged = () => {
        // Read from datesRef so a same-frame maybeExtend() that already
        // updated the array (synchronously) is reflected here too.
        const cur = datesRef.current;
        const d = cur[indexForOffset()];
        if (!d || d === lastReported.current) return;
        lastReported.current = d;
        pendingDateRef.current = d;
        if (reportTimeoutRef.current) clearTimeout(reportTimeoutRef.current);
        reportTimeoutRef.current = setTimeout(() => {
            const pending = pendingDateRef.current;
            reportTimeoutRef.current = null;
            pendingDateRef.current = null;
            if (pending) onCenterDateChange(pending);
        }, REPORT_DEBOUNCE_MS);
    };

    // Re-centre when parent changes centerDate (e.g. top prev/next chevrons).
    // If centerDate is outside the current 21-day strip (user jumped far via
    // chevrons), rebuild the strip around the new centerDate so the Sidewalk
    // stays coherent with the rest of the calendar state.
    React.useEffect(() => {
        if (panelWidth === 0) return;
        if (centerDate === lastReported.current) return;
        // Parent drove the change (e.g. a chevron click). Cancel any pending
        // debounced scroll report so a stale scroll date doesn't fire after
        // this effect and revert the new centerDate.
        if (reportTimeoutRef.current) {
            clearTimeout(reportTimeoutRef.current);
            reportTimeoutRef.current = null;
            pendingDateRef.current = null;
        }
        const cur = datesRef.current;
        const idx = cur.indexOf(centerDate);
        if (idx < 0) {
            // Rebuild strip around the new centerDate and snap to its center.
            const rebuilt = centeredDateRange(centerDate, 10);
            datesRef.current = rebuilt;
            setDates(rebuilt);
            lastReported.current = centerDate;
            // req #2840 — seed the virtualization window on the new center index
            // synchronously so the focus panel mounts in the same commit as the
            // rebuilt dates (the rAF below then corrects the offset + range).
            const newIdx = rebuilt.indexOf(centerDate);
            setVisRange({ start: Math.max(0, newIdx - SIDEWALK_VIS_BUFFER), end: newIdx + SIDEWALK_VIS_BUFFER });
            requestAnimationFrame(() => applyOffset(-newIdx * panelWidth));
            return;
        }
        lastReported.current = centerDate;
        animateTo(-idx * panelWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [centerDate, panelWidth]);

    // Initial placement on mount AND re-snap on zoom change — put the focused
    // panel's left edge at the viewport left. Depending on panelWidth means a
    // zoom toggle (which changes the per-panel stride) re-centres the same day
    // instead of leaving the strip parked at a stale pixel offset.
    React.useEffect(() => {
        if (panelWidth === 0) return;
        const cur = datesRef.current;
        const idx = cur.indexOf(lastReported.current) >= 0
            ? cur.indexOf(lastReported.current)
            : cur.indexOf(centerDate);
        if (idx >= 0) applyOffset(-idx * panelWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [panelWidth]);

    // Drag + momentum. Bind once per panelWidth (the zoom-aware stride) —
    // `dates.length` is read via
    // `datesRef` inside maybeExtend so we can extend the strip without
    // re-binding (which would lose in-progress drag state). onMove uses
    // delta-from-last instead of cumulative-from-startOffset because
    // maybeExtend can shift offsetRef mid-drag (left-extension); a delta
    // formulation stays correct after that shift.
    React.useEffect(() => {
        const frame = frameRef.current;
        if (!frame || frameWidth === 0) return;
        let isDown = false;
        let startPageX = 0;
        let lastPageX = 0;
        let lastT = 0;

        const onDown = (e) => {
            if (e.button !== 0) return;
            isDown = true;
            hasDragged.current = false;
            startPageX = e.pageX;
            lastPageX = e.pageX;
            lastT = performance.now();
            velocityRef.current = 0;
            stopAnim();
            frame.style.cursor = 'grabbing';
            // Mouse: suppress text/image drag. Touch/pen (req #2802): do NOT
            // preventDefault — `touch-action: pan-y` (CSS) already arbitrates the
            // gesture (horizontal → us, vertical → page), and preventing default
            // would swallow the tap-`click` that selects a chip.
            if (e.pointerType === 'mouse') e.preventDefault();
        };
        const onMove = (e) => {
            if (!isDown) return;
            const totalDx = e.pageX - startPageX;
            if (Math.abs(totalDx) > 4) hasDragged.current = true;
            const deltaX = e.pageX - lastPageX;
            applyOffset(offsetRef.current + deltaX);
            maybeExtend();
            const now = performance.now();
            const dt = Math.max(1, now - lastT);
            velocityRef.current = ((e.pageX - lastPageX) / dt) * 16;
            lastPageX = e.pageX;
            lastT = now;
        };
        const onUp = () => {
            if (!isDown) return;
            isDown = false;
            frame.style.cursor = '';
            if (!hasDragged.current) { return; }    // treat as click
            const decay = () => {
                if (Math.abs(velocityRef.current) < 0.4) {
                    rafRef.current = null;
                    reportCenterIfChanged();       // no snap — stop wherever momentum ends
                    return;
                }
                applyOffset(offsetRef.current + velocityRef.current);
                maybeExtend();
                velocityRef.current *= 0.93;
                rafRef.current = requestAnimationFrame(decay);
            };
            rafRef.current = requestAnimationFrame(decay);
        };
        // Suppress bubble clicks that would fire at the end of a drag.
        const onClickCapture = (e) => {
            if (hasDragged.current) {
                e.stopPropagation();
                e.preventDefault();
                hasDragged.current = false;
            }
        };
        // Trackpad / mouse wheel: horizontal scroll translates to offset.
        const onWheel = (e) => {
            const dxRaw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (!dxRaw) return;
            e.preventDefault();
            stopAnim();
            applyOffset(offsetRef.current - dxRaw);
            maybeExtend();
            reportCenterIfChanged();
        };

        // Pointer events (req #2802) unify mouse + touch + pen, so the strip
        // hand-scrolls on mobile (mouse-only listeners never fired for touch).
        // `pointercancel` ends a drag the browser reclaims (e.g. it decides the
        // gesture is a vertical page-pan under touch-action:pan-y).
        frame.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        frame.addEventListener('click', onClickCapture, true);
        frame.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            frame.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            frame.removeEventListener('click', onClickCapture, true);
            frame.removeEventListener('wheel', onWheel);
            stopAnim();
        };
    // Re-bind on panelWidth (not just frameWidth) so the drag/wheel handlers
    // capture a maybeExtend closure that uses the current zoom's stride.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [panelWidth]);

    return (
        <Box className="ts-sidewalk" data-testid="ts-sidewalk" ref={frameRef}>
            <Box className="ts-sidewalk-inner" ref={innerRef}>
                {dates.map((d, i) => {
                    const panelStyle = { width: panelWidth || '100%', flex: `0 0 ${panelWidth || 1}px` };
                    // req #2840 — virtualization: only mount a real BeadRow for
                    // panels inside the visible window; the rest are same-width
                    // empty placeholders so the offset/stride scroll math is
                    // byte-for-byte unchanged but the off-screen SVG trees (and
                    // their 1400–6000 DOM nodes) never mount.
                    if (i < visRange.start || i > visRange.end) {
                        return <Box key={d} className="ts-sidewalk-panel" data-date={d} style={panelStyle} />;
                    }
                    return (
                        <Box key={d} className="ts-sidewalk-panel" data-date={d} style={panelStyle}>
                            {/* Per-day slice (req #2800) — overrides the full
                                `requirements` carried in rowProps so unchanged/empty
                                panels keep a stable prop reference and BeadRow's memo
                                engages across a window refetch. */}
                            <BeadRow selectedDate={d}
                                     sidewalkPanel={true}
                                     sidewalkHeight={sidewalkHeight}
                                     {...rowProps}
                                     crossDays={crossDayMap.get(d) || EMPTY_CROSS_DAYS}
                                     requirements={requirementsByDate?.get(d) || EMPTY_REQS} />
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
};

// ─────────── Elevator — vertical analog of Sidewalk (Week view only) ─────────
// The outer frame is fixed-height with overflow hidden. The inner flex strip
// stacks 21 day panels (centered on centerDate) vertically. Dragging the inner
// strip vertically changes its translateY; release applies momentum decay and
// stops where momentum ends (no snap-to-panel, matching Sidewalk). Adjacent
// day panels butt up with no seam, so bubbles that straddle Sun→Mon feel
// continuous (req #2383).
//
// req #2744 — the frame reserves a top band (`padding-top`) for the single
// shared time axis pinned at its top. `frameHeight` (clientHeight) still
// includes that padding, so the scroll math must subtract it to get the real
// visible content height — otherwise the bottom of the last panel is clipped
// and centering is biased upward. `clientHeight - padding` equals the content
// height regardless of box-sizing, so this correction is box-model-agnostic.
const ELEVATOR_TOP_AXIS_PX = 34;
// Small bias (px) for top-edge index detection so a panel that has just crossed
// the viewport top is reported, not the one a hair above it (req #2781).
const ELEVATOR_TOP_EPS = 2;

// Scroll-anchor offset delta (req #2800). When the per-day panel geometry changes
// because a data refetch landed (NOT an extend/prune — those change the dates
// array and self-compensate), the panels above the viewport top grow or shrink.
// Since the scroll position is a fixed-pixel translateY, that height change
// shoves the visible content up or down — the "jump" reported in req #2800,
// worst when a far window's `met` rows 404 → resolve to [] and every panel
// collapses to the base height at once.
//
// Re-pin the panel currently at the viewport top: find it under the OLD geometry,
// then return the offset delta that keeps its top exactly the same distance below
// the viewport top under the NEW geometry. delta = oldCumulative[i] -
// newCumulative[i] for that panel i; adding it to the offset preserves
// `cumulative[i] + offset` (the panel-top-to-viewport-top distance) exactly,
// regardless of how the panel's own height changed. Returns 0 (no shift) when the
// geometries are incomparable (different panel counts, empty, or same ref).
// Exported for unit-test coverage.
export const anchorDelta = (prev, next, currentOffset, topEps = ELEVATOR_TOP_EPS) => {
    if (!prev || !next || prev === next) return 0;
    if (prev.heights.length !== next.heights.length || prev.heights.length === 0) return 0;
    const frameTopInStrip = -currentOffset + topEps;
    let anchorIdx = prev.heights.length - 1;
    for (let i = 0; i < prev.heights.length; i++) {
        if (frameTopInStrip < prev.cumulative[i] + prev.heights[i]) { anchorIdx = i; break; }
    }
    return prev.cumulative[anchorIdx] - next.cumulative[anchorIdx];
};

// req #2779 — Elevator infinite scroll. Vertical analog of Sidewalk's
// SIDEWALK_* buffer constants (same values): when the centered panel comes
// within ELEVATOR_BUFFER_THRESHOLD of either end of `dates`, prepend/append
// ELEVATOR_EXTEND_BY days; once the array exceeds ELEVATOR_MAX_PANELS, prune
// the opposite end. There is no offset clamp — the strip is endless in both
// directions, so the user can scroll arbitrarily far into past or future.
const ELEVATOR_BUFFER_THRESHOLD = 5;
const ELEVATOR_EXTEND_BY = 10;
const ELEVATOR_MAX_PANELS = 60;
// req #2840 — virtualization buffer (vertical analog of SIDEWALK_VIS_BUFFER).
const ELEVATOR_VIS_BUFFER = 4;

// Base floor height for an Elevator day panel (px). Intentionally low — comfortably
// clears the compact top chrome (req #2744: date row + wire ≈ 46px) plus breathing room.
const ELEVATOR_PANEL_BASE_HEIGHT = 140;

// Pixel height of one Elevator day panel, sized to THAT day's chip density.
// Mirrors BeadRow's sidewalk + hideTimeline height formula so DOM heights match
// what BeadRow lays out. Extracted to module scope (req #2779) so the
// infinite-scroll extender can size freshly-prepended panels SYNCHRONOUSLY —
// it must shift translateY by the new panels' summed height in the same task it
// calls setDates, otherwise the visible panel would jump for one frame. Both the
// panelHeights memo and maybeExtend call this, so the two can never drift.
export const elevatorPanelHeight = (maxStackRow, circleDiameter, spaceKey) => {
    const bubbleOffset  = 20;
    const chromeBottom  = 46;   // matches BeadRow `chromeOffset = sidewalkPanel && hideTimeline ? 46`
    const dateClearance = Math.ceil(circleDiameter / 2) + 4;
    const spaceMul      = getSpaceMultiplier(spaceKey);
    const rowSpacing    = Math.max(16, Math.round((circleDiameter + 4) * spaceMul));
    return Math.max(
        ELEVATOR_PANEL_BASE_HEIGHT,
        Math.max(0, maxStackRow) * rowSpacing + bubbleOffset + circleDiameter + chromeBottom + dateClearance,
    );
};
const Elevator = ({ centerDate, onCenterDateChange, sharedTicks, requirementsByDate, ...rowProps }) => {
    // `requirementsByDate` (req #2800) is pulled out as a named param so it is NOT
    // spread into each BeadRow (it changes ref on every refetch and would bust the
    // memo); the per-panel `requirements` slice is applied explicitly in the map
    // below. The swarm extras are a read-only destructure (rowProps is still spread
    // to each BeadRow, so naming them here does NOT remove them from the spread);
    // they feed per-day phantom/undone lane counts into the panel sizing (req #2797).
    const { requirements, sessions, timezone, circleDiameter, spaceKey,
            swarmStarts, swarmStartSessions, swarmUndos, requirementById,
            categoryList, canonicalStartById, swarmStartIdById, swarmStartById } = rowProps;
    const frameRef = React.useRef(null);
    const innerRef = React.useRef(null);
    const offsetRef = React.useRef(0);      // current translateY in px (negative = panels above)
    const velocityRef = React.useRef(0);    // px / frame
    const rafRef = React.useRef(null);
    const lastReported = React.useRef(centerDate);
    const reportTimeoutRef = React.useRef(null);   // trailing debounce of onCenterDateChange
    const pendingDateRef   = React.useRef(null);
    const hasDragged = React.useRef(false);
    // Future cap (req #2779 follow-up) — the end of the current ISO week (this
    // week's Sunday, local). The elevator scrolls infinitely into the PAST but
    // never past this day into the future. Computed once per mount; "today" is
    // read from the wall clock so the deliberately-empty dep array is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const maxFutureDate = useMemo(() => endOfWeek(localDateStr(new Date())), []);
    // Today (local) — drives the clamped in-progress phantom lane that BeadRow
    // seats on today's panel for every still-open session (req #2797). Stable
    // per mount, same as maxFutureDate; the empty dep array is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const todayStr = useMemo(() => localDateStr(new Date()), []);
    const [dates, setDates] = React.useState(() => cappedCenteredRange(centerDate, 10, maxFutureDate));
    // Mirror of `dates` for synchronous reads inside drag/wheel/momentum handlers —
    // lets maybeExtend check current length / size new panels without re-binding the
    // drag effect on every extension (req #2779, mirrors Sidewalk's datesRef).
    const datesRef = React.useRef(dates);
    const [frameHeight, setFrameHeight] = React.useState(0);
    // req #2840 — virtualization window (mirrors the Sidewalk). cappedCenteredRange
    // keeps the 10 days BEFORE centerDate (the past is never capped), so the focus
    // day always lands at index 10; future-capping only trims the tail. Seed a
    // window covering the focus panel and several below it (the focus sits at the
    // top of the frame, so the visible panels run downward from it); the placement
    // + geometry effects correct it once frameHeight is measured.
    const [visRange, setVisRange] = React.useState(() => ({
        start: Math.max(0, 10 - ELEVATOR_VIS_BUFFER),
        end: 10 + ELEVATOR_VIS_BUFFER + 6,
    }));

    // Per-date max stack row — reproduces BeadRow's placement: one-lane-per-chip
    // (maxRow = chips − 1). The chip count must include the in-progress phantom
    // and undone tombstone lanes BeadRow also stacks, or a panel carrying them
    // is too short and its bottom bubbles bleed into the next day's header
    // (req #2797) — hence the swarm-extras passed through. Lifted to its own
    // memo (req #2779) so maybeExtend can size freshly-prepended panels from the
    // same source the render uses.
    // Req #2798 — cross-day pass-through lines for multi-day sessions, keyed by
    // each loaded panel date. Built over the FULL elevator `dates` strip (not a
    // single 7-day week) with the 24h start-bar coordinate. Per-panel slices are
    // handed to each BeadRow below; the per-date ghost counts feed panel sizing
    // so start/interim dashed lines don't clip their day's bubbles.
    const crossDayMap = useMemo(() => {
        return buildCrossDayMap(dates, {
            requirements, sessions, swarmStarts, swarmStartSessions,
            requirementById, categoryList,
            canonicalStartById, swarmStartIdById, swarmStartById,
            timezone, startXPct: bead24hXPct, today: todayStr,
        });
    }, [dates, requirements, sessions, swarmStarts, swarmStartSessions,
        requirementById, categoryList, canonicalStartById, swarmStartIdById,
        swarmStartById, timezone, todayStr]);
    const crossDayCountByDate = useMemo(() => {
        const m = new Map();
        for (const [d, arr] of crossDayMap) m.set(d, arr.length);
        return m;
    }, [crossDayMap]);

    const maxRowByDate = useMemo(
        () => indexMaxStackByDate(requirements, sessions, timezone, {
            swarmStarts, swarmStartSessions, swarmUndos, requirementById, today: todayStr,
            crossDayCountByDate,
        }),
        [requirements, sessions, timezone, swarmStarts, swarmStartSessions,
         swarmUndos, requirementById, todayStr, crossDayCountByDate],
    );

    // Per-panel heights — one entry per date, sized to THAT day's chip density via
    // the shared elevatorPanelHeight helper. Sidewalk uniforms every panel to the
    // busiest day; Elevator lets light days stay short so a strip with one 12-chip
    // day and 20 single-chip days isn't 21× the 12-chip height tall (req #2383).
    const panelHeights = useMemo(
        () => dates.map(d => elevatorPanelHeight(maxRowByDate.get(d) || 0, circleDiameter, spaceKey)),
        [dates, maxRowByDate, circleDiameter, spaceKey],
    );

    // Cumulative offsets + total strip height — precomputed so indexForOffset /
    // offsetForIndex don't re-scan on every frame.
    const panelGeom = useMemo(() => {
        const cumulative = new Array(panelHeights.length);
        let acc = 0;
        for (let i = 0; i < panelHeights.length; i++) {
            cumulative[i] = acc;
            acc += panelHeights[i];
        }
        return { heights: panelHeights, cumulative, stripHeight: acc };
    }, [panelHeights]);

    // Ref-mirror of panelGeom so offsetForIndex / maybeExtend called from a
    // rebuild-path requestAnimationFrame always see the LATEST geometry — not
    // the panelHeights captured when the centerDate effect ran. Without this, a
    // rebuild that also shifts per-panel density would position the first frame
    // using the old geometry and the strip would briefly sit at the wrong offset.
    // useLayoutEffect so the ref is current before any rAF fires.
    const panelGeomRef = React.useRef(panelGeom);
    // Scroll anchoring (req #2800). On a panel-geometry change that is NOT an
    // extend/prune — i.e. a data refetch re-sized the per-day panels while the
    // `dates` array is unchanged — re-pin the panel at the viewport top so the
    // day the user is reading stays put while the data fills in (see anchorDelta).
    // Guarded to data-only changes: extend/prune already compensate the offset
    // synchronously before setDates AND change the `dates` ref, so skipping those
    // here avoids double-compensation.
    const anchorDatesRef = React.useRef(dates);
    React.useLayoutEffect(() => {
        const prev = panelGeomRef.current;
        if (anchorDatesRef.current === dates) {          // data-only change
            const delta = anchorDelta(prev, panelGeom, offsetRef.current);
            if (delta) applyOffset(offsetRef.current + delta);
        }
        panelGeomRef.current = panelGeom;
        anchorDatesRef.current = dates;
    // applyOffset only closes over refs; including it would refire every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [panelGeom, dates]);

    // Ref-mirrors so maybeExtend (captured once by the drag effect) reads the
    // LATEST data when sizing freshly-prepended panels (req #2779). datesRef is
    // also written synchronously inside maybeExtend so a same-frame re-entry
    // doesn't see the pre-extension array and re-extend.
    React.useLayoutEffect(() => { datesRef.current = dates; }, [dates]);
    const maxRowByDateRef = React.useRef(maxRowByDate);
    React.useLayoutEffect(() => { maxRowByDateRef.current = maxRowByDate; }, [maxRowByDate]);
    const sizingRef = React.useRef({ circleDiameter, spaceKey });
    React.useLayoutEffect(() => { sizingRef.current = { circleDiameter, spaceKey }; }, [circleDiameter, spaceKey]);

    React.useLayoutEffect(() => {
        const measure = () => {
            const h = frameRef.current?.clientHeight || 0;
            setFrameHeight(h);
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    React.useEffect(() => () => {
        if (reportTimeoutRef.current) {
            clearTimeout(reportTimeoutRef.current);
            reportTimeoutRef.current = null;
            pendingDateRef.current = null;
        }
    }, []);

    // req #2840 — recompute the mounted-panel window from the live offset +
    // current panel geometry; only re-render when it shifts. Reads panelGeomRef
    // (always latest) so the copy captured by the drag effect stays correct after
    // an extend/prune/refetch resizes panels.
    const updateVisibleRange = () => {
        if (frameHeight === 0) return;                 // keep the seed until measured
        const g = panelGeomRef.current;
        const cur = datesRef.current;
        if (!g || g.heights.length !== cur.length) return;   // geometry not yet synced
        const viewportH = Math.max(0, frameHeight - ELEVATOR_TOP_AXIS_PX);
        const r = elevatorVisibleRange(
            offsetRef.current, g.cumulative, g.heights, viewportH, cur.length, ELEVATOR_VIS_BUFFER,
        );
        setVisRange(prev => (prev.start === r.start && prev.end === r.end) ? prev : r);
    };

    const applyOffset = (y) => {
        offsetRef.current = y;
        if (innerRef.current) innerRef.current.style.transform = `translate3d(0,${y}px,0)`;
        updateVisibleRange();
    };

    // req #2840 — recompute after a non-scroll geometry change: extend/prune
    // changes `dates`→`panelGeom`; a data refetch resizes panels (panelGeom);
    // the first measure sets frameHeight. Scroll itself is handled by applyOffset.
    React.useEffect(() => {
        updateVisibleRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [panelGeom, frameHeight]);

    const stopAnim = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
    };

    const animateTo = (target) => {
        stopAnim();
        const start = offsetRef.current;
        const delta = target - start;
        if (Math.abs(delta) < 1) { applyOffset(target); maybeExtend(); return; }
        const duration = Math.min(450, 180 + Math.abs(delta) * 0.4);
        const t0 = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - t0) / duration);
            const eased = 1 - (1 - t) ** 3;
            applyOffset(start + delta * eased);
            if (t < 1) rafRef.current = requestAnimationFrame(step);
            else { rafRef.current = null; maybeExtend(); reportCenterIfChanged(); }
        };
        rafRef.current = requestAnimationFrame(step);
    };

    // Map current translateY to the panel whose [top, bottom] range contains
    // the TOP of the viewport — the focus day sits at the top of the frame
    // (req #2781), so the day reported up as `currentDate` is the one the user
    // reads at the top, matching the non-elevator week stack. Linear scan over
    // cumulative offsets — N≤21, no need for binary search. The small epsilon
    // biases the boundary toward the panel that has actually crossed the top
    // edge so a pixel-perfect alignment doesn't flicker between two days.
    const indexForOffset = () => {
        const g = panelGeomRef.current;
        if (!g || g.heights.length === 0 || g.stripHeight === 0) return 0;
        const frameTopInStrip = -offsetRef.current + ELEVATOR_TOP_EPS;
        for (let i = 0; i < g.heights.length; i++) {
            const bottom = g.cumulative[i] + g.heights[i];
            if (frameTopInStrip < bottom) return i;
        }
        return g.heights.length - 1;
    };

    // Offset that places the panel at `idx` flush against the TOP of the frame
    // (req #2781 — focus day at the top of the view, not centered), then clamped
    // by the one-sided future-cap clampOffset (req #2779 — a no-op until the
    // strip reaches the cap; the past stays endless).
    const offsetForIndex = (idx) => {
        const g = panelGeomRef.current;
        if (!g || g.heights.length === 0) return 0;
        const i = Math.max(0, Math.min(g.heights.length - 1, idx));
        return clampOffset(-g.cumulative[i]);
    };

    // One-sided scroll clamp for the FUTURE cap (req #2779 follow-up). The past
    // is infinite, so there is NO upper (more-positive-offset) bound. The lower
    // (more-negative) bound only engages once the strip's last day has reached
    // maxFutureDate — until then the view scrolls freely and maybeExtend grows
    // the strip toward the cap. At the cap, the strip's bottom is pinned to the
    // viewport bottom so no empty space shows below the final day.
    const clampOffset = (y) => {
        const g = panelGeomRef.current;
        if (!g) return y;
        const cur = datesRef.current;
        const atCap = maxFutureDate && cur.length > 0 && cur[cur.length - 1] >= maxFutureDate;
        if (!atCap) return y;
        const viewportH = Math.max(0, frameHeight - ELEVATOR_TOP_AXIS_PX);
        if (g.stripHeight <= viewportH) return y;   // strip shorter than viewport → don't fight past extension
        const minOffset = viewportH - g.stripHeight;
        return Math.max(minOffset, y);
    };

    // Infinite-scroll buffer maintenance (req #2779) — vertical analog of
    // Sidewalk's maybeExtend, adapted for variable panel heights. When the
    // centered panel approaches either end, prepend/append ELEVATOR_EXTEND_BY
    // days and prune the opposite end past ELEVATOR_MAX_PANELS.
    //
    // The translateY compensation is the only place that differs from Sidewalk's
    // uniform-width math: prepending days grows the strip at the top by the new
    // panels' summed height, so we subtract that from the offset BEFORE setDates
    // (same synchronous task → no paint between, so the visible panel never
    // jumps). New top panels are sized via the shared elevatorPanelHeight helper
    // so the prediction matches what the panelHeights memo renders. When pruning
    // the top (during a downward extend) we add the removed panels' height —
    // read from the current geometry — back to the offset.
    //
    // datesRef is updated synchronously so a follow-up call within the same frame
    // doesn't see the pre-extension array and re-extend.
    const maybeExtend = () => {
        if (frameHeight === 0) return;
        const cur = datesRef.current;
        if (!cur || cur.length === 0) return;
        const g = panelGeomRef.current;
        if (!g || g.heights.length !== cur.length) return;   // geometry not yet synced
        const idx = indexForOffset();
        const distTop    = idx;
        const distBottom = cur.length - 1 - idx;
        const { circleDiameter: cd, spaceKey: sk } = sizingRef.current;
        const rowMap = maxRowByDateRef.current;

        if (distTop <= ELEVATOR_BUFFER_THRESHOLD) {
            const extended = extendDates(cur, 'left', ELEVATOR_EXTEND_BY);
            let addedTopHeight = 0;
            for (let i = 0; i < ELEVATOR_EXTEND_BY; i++) {
                addedTopHeight += elevatorPanelHeight(rowMap.get(extended[i]) || 0, cd, sk);
            }
            // Top growth pushes existing panels down; shift up to stay put.
            applyOffset(offsetRef.current - addedTopHeight);
            const pruned = pruneDates(extended, ELEVATOR_MAX_PANELS, 'right');
            datesRef.current = pruned.dates;
            setDates(pruned.dates);
        } else if (distBottom <= ELEVATOR_BUFFER_THRESHOLD) {
            // Future is capped at maxFutureDate (req #2779 follow-up): only add as
            // many days as remain up to the cap. At/over the cap → add nothing
            // (clampOffset holds the bottom wall).
            const last = cur[cur.length - 1];
            let addN = ELEVATOR_EXTEND_BY;
            if (maxFutureDate) {
                const room = Math.round(
                    (new Date(maxFutureDate + 'T12:00:00') - new Date(last + 'T12:00:00')) / 86400000,
                );
                addN = Math.min(ELEVATOR_EXTEND_BY, Math.max(0, room));
            }
            if (addN === 0) return;   // already at the future cap
            const extended = extendDates(cur, 'right', addN);
            const pruned = pruneDates(extended, ELEVATOR_MAX_PANELS, 'left');
            if (pruned.removedCount > 0) {
                // Pruning the top removes those panels' height; everything shifts
                // up by that much, so add it back to keep the visible panel put.
                let removedTopHeight = 0;
                for (let i = 0; i < pruned.removedCount; i++) removedTopHeight += g.heights[i];
                applyOffset(offsetRef.current + removedTopHeight);
            }
            datesRef.current = pruned.dates;
            setDates(pruned.dates);
        }
    };

    const REPORT_DEBOUNCE_MS = 150;
    const reportCenterIfChanged = () => {
        // Read from datesRef so a same-frame maybeExtend() that already updated
        // the array (synchronously) is reflected here too.
        const d = datesRef.current[indexForOffset()];
        if (!d || d === lastReported.current) return;
        lastReported.current = d;
        pendingDateRef.current = d;
        if (reportTimeoutRef.current) clearTimeout(reportTimeoutRef.current);
        reportTimeoutRef.current = setTimeout(() => {
            const pending = pendingDateRef.current;
            reportTimeoutRef.current = null;
            pendingDateRef.current = null;
            if (pending) onCenterDateChange(pending);
        }, REPORT_DEBOUNCE_MS);
    };

    // Re-centre when parent changes centerDate (e.g. top prev/next chevrons).
    // If centerDate is outside the current strip (chevron jump, or it scrolled
    // out after extend/prune), rebuild the strip around it. Deps are
    // [centerDate, frameHeight] ONLY (req #2779): extend/prune changes panelGeom
    // every scroll frame, and if this effect re-ran on that it would yank the
    // view back to a stale centerDate mid-scroll. Geometry is read from the live
    // panelGeomRef instead, and dates from datesRef.
    React.useEffect(() => {
        if (frameHeight === 0 || panelGeomRef.current.stripHeight === 0) return;
        if (centerDate === lastReported.current) return;
        if (reportTimeoutRef.current) {
            clearTimeout(reportTimeoutRef.current);
            reportTimeoutRef.current = null;
            pendingDateRef.current = null;
        }
        const cur = datesRef.current;
        const idx = cur.indexOf(centerDate);
        if (idx < 0) {
            // Rebuild strip around the new centerDate and snap it to the top
            // (req #2781). Clamp the effective center to the future cap so a chevron jump past
            // this week lands on the last allowed day instead of an empty strip.
            const effCenter = (maxFutureDate && centerDate > maxFutureDate) ? maxFutureDate : centerDate;
            const rebuilt = cappedCenteredRange(effCenter, 10, maxFutureDate);
            datesRef.current = rebuilt;
            setDates(rebuilt);
            lastReported.current = centerDate;
            // req #2840 — seed the virtualization window on the new focus index so
            // the focus panel mounts in the same commit as the rebuilt dates (the
            // focus sits at the top, so mount it and several below); the rAF below
            // then corrects the offset and the geometry effect refines the range.
            const seedIdx = rebuilt.indexOf(effCenter);
            const seed = seedIdx >= 0 ? seedIdx : rebuilt.length - 1;
            setVisRange({ start: Math.max(0, seed - ELEVATOR_VIS_BUFFER), end: seed + ELEVATOR_VIS_BUFFER + 6 });
            requestAnimationFrame(() => {
                const dr = datesRef.current;
                const newIdx = dr.indexOf(effCenter);
                applyOffset(offsetForIndex(newIdx >= 0 ? newIdx : dr.length - 1));
            });
            return;
        }
        lastReported.current = centerDate;
        animateTo(offsetForIndex(idx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [centerDate, frameHeight]);

    // Initial placement — put centerDate at the TOP of the frame (req #2781). Runs
    // once when frameHeight first becomes non-zero (deps [frameHeight] only, so
    // extend/prune never re-triggers a recenter mid-scroll).
    React.useEffect(() => {
        if (frameHeight === 0 || panelGeomRef.current.stripHeight === 0) return;
        const idx = datesRef.current.indexOf(centerDate);
        if (idx >= 0) applyOffset(offsetForIndex(idx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frameHeight]);

    // Drag + momentum + wheel. Bind once per frameHeight — `dates.length` is read
    // via `datesRef` inside maybeExtend so we can extend the strip without
    // re-binding (which would lose in-progress drag state). onMove uses
    // delta-from-last instead of cumulative-from-startOffset because maybeExtend
    // can shift offsetRef mid-drag (top extension); a delta formulation stays
    // correct after that shift (req #2779, mirrors Sidewalk).
    React.useEffect(() => {
        const frame = frameRef.current;
        if (!frame || frameHeight === 0) return;
        let isDown = false;
        let startPageY = 0;
        let lastPageY = 0;
        let lastT = 0;

        const onDown = (e) => {
            if (e.button !== 0) return;
            isDown = true;
            hasDragged.current = false;
            startPageY = e.pageY;
            lastPageY = e.pageY;
            lastT = performance.now();
            velocityRef.current = 0;
            stopAnim();
            frame.style.cursor = 'grabbing';
            // Mouse: suppress text/image drag. Touch/pen (req #2802): do NOT
            // preventDefault — `touch-action: pan-x` (CSS) already arbitrates the
            // gesture (vertical → us, horizontal → page), and preventing default
            // would swallow the tap-`click` that selects a chip.
            if (e.pointerType === 'mouse') e.preventDefault();
        };
        const onMove = (e) => {
            if (!isDown) return;
            const totalDy = e.pageY - startPageY;
            if (Math.abs(totalDy) > 4) hasDragged.current = true;
            const deltaY = e.pageY - lastPageY;
            applyOffset(clampOffset(offsetRef.current + deltaY));
            maybeExtend();
            const now = performance.now();
            const dt = Math.max(1, now - lastT);
            velocityRef.current = ((e.pageY - lastPageY) / dt) * 16;
            lastPageY = e.pageY;
            lastT = now;
        };
        const onUp = () => {
            if (!isDown) return;
            isDown = false;
            frame.style.cursor = '';
            if (!hasDragged.current) { return; }
            const decay = () => {
                if (Math.abs(velocityRef.current) < 0.4) {
                    rafRef.current = null;
                    reportCenterIfChanged();       // no snap — stop wherever momentum ends
                    return;
                }
                const raw = offsetRef.current + velocityRef.current;
                const clamped = clampOffset(raw);
                applyOffset(clamped);
                maybeExtend();
                if (clamped !== raw) {
                    // Hit the future wall — kill momentum and stop here.
                    velocityRef.current = 0;
                    rafRef.current = null;
                    reportCenterIfChanged();
                    return;
                }
                velocityRef.current *= 0.93;
                rafRef.current = requestAnimationFrame(decay);
            };
            rafRef.current = requestAnimationFrame(decay);
        };
        const onClickCapture = (e) => {
            if (hasDragged.current) {
                e.stopPropagation();
                e.preventDefault();
                hasDragged.current = false;
            }
        };
        // Wheel: scroll Y translates to offset. deltaY is the natural vertical
        // scroll; ignore deltaX (no horizontal presentation inside Elevator).
        const onWheel = (e) => {
            const dyRaw = e.deltaY;
            if (!dyRaw) return;
            e.preventDefault();
            stopAnim();
            applyOffset(clampOffset(offsetRef.current - dyRaw));
            maybeExtend();
            reportCenterIfChanged();
        };

        // Pointer events (req #2802) unify mouse + touch + pen, so the strip
        // hand-scrolls on mobile (mouse-only listeners never fired for touch).
        // `pointercancel` ends a drag the browser reclaims (e.g. it decides the
        // gesture is a horizontal page-pan under touch-action:pan-x).
        frame.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        frame.addEventListener('click', onClickCapture, true);
        frame.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            frame.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            frame.removeEventListener('click', onClickCapture, true);
            frame.removeEventListener('wheel', onWheel);
            stopAnim();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frameHeight]);

    return (
        <Box className="ts-elevator" data-testid="ts-elevator" ref={frameRef}>
            {/* req #2744 — single shared time axis pinned to the top of the
                frame; panels scroll beneath it (the frame reserves padding-top
                so dates/bubbles never slide under the bar). */}
            <SharedTimeline variant="elevator" ticks={sharedTicks} />
            <Box className="ts-elevator-inner" ref={innerRef}>
                {dates.map((d, i) => {
                    const panelStyle = { height: panelHeights[i], flex: `0 0 ${panelHeights[i]}px` };
                    // req #2840 — virtualization: off-window panels render as
                    // same-height empty placeholders so every cumulative-offset /
                    // anchorDelta / maybeExtend calculation is unchanged, but the
                    // off-screen SVG trees never mount.
                    if (i < visRange.start || i > visRange.end) {
                        return <Box key={d} className="ts-elevator-panel" data-date={d} style={panelStyle} />;
                    }
                    return (
                        <Box key={d} className="ts-elevator-panel" data-date={d} style={panelStyle}>
                            {/* Per-day slice (req #2800) — see Sidewalk note above. */}
                            <BeadRow selectedDate={d}
                                     sidewalkPanel={true}
                                     hideTimeline={true}
                                     sidewalkHeight={panelHeights[i]}
                                     {...rowProps}
                                     crossDays={crossDayMap.get(d) || EMPTY_CROSS_DAYS}
                                     requirements={requirementsByDate?.get(d) || EMPTY_REQS} />
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
};

// ─────────── Top-level TimeSeriesView ──────────────────────────────────────────
const TimeSeriesView = ({
    requirements = [],
    allRequirements = [],      // req #2504 — all reqs (any status) for in-progress phantom rendering
    sessions = [],
    swarmStarts = [],          // req #2504 — real swarm-start rows for the user
    swarmStartSessions = [],   // req #2504 — junction (session_fk → swarm_start_fk)
    swarmUndos = [],           // req #2719 — undo log rows; overlay tombstones
    swarmCompletes = [],       // req #2497 — close-out rows; terminus badge per session
    swarmCompleteSessions = [],// req #2497 — junction (session_fk → swarm_complete_fk)
    selectedDate,
    timezone,
    beadWindow = '24h',
    sidewalkOn = false,
    elevatorOn = false,
    dataKey = DEFAULT_DATA_KEY,      // 'category' | 'coordination' — req #2382
    titlesOn = false,                // req #2556 — render req title to right of bubble
    completesOn = false,             // req #2790 — show completion-terminus badge (off by default)
    phasesOn = false,                // req #2823 — segment duration line by phase buckets (off by default)
    isWeekView = false,
    categoryList = [],
    onChipClick,
    onSwarmStartClick,
    onUndoClick,
    onCompleteClick,
    onCenterDateChange,
}) => {
    // The UI Options amber bar was removed 2026-04-18 — Viz and Sidewalk
    // were promoted to the toolbar, and the remaining controls have landed
    // on good defaults that ship as-is.
    const fontSizeKey  = DEFAULT_FONT_SIZE;
    const spaceKey     = DEFAULT_SPACE;
    const zoomKey      = DEFAULT_ZOOM;
    const circleSizeKey = 1;   // swarm visualizer uses size 1 across every layout
    const tooltipFontSize = getFontSize(fontSizeKey);
    const circleDiameter  = getCircleSize(circleSizeKey);

    // req #2744 — ticks for the single shared time axis. Each variant mirrors the
    // base/visible hours its rows compute in BeadRow so the shared labels align
    // with the per-row vertical dividers:
    //   Week stack rows → non-sidewalk base (36h base, beadWindow-derived visible).
    //   Elevator panels → sidewalk base (24h base, 24h visible).
    const weekTicks = useMemo(
        () => buildTicks(ZOOM_HOURS[zoomKey]?.['36h'] ?? 36, getZoomHours(zoomKey, beadWindow)),
        [zoomKey, beadWindow],
    );
    const elevatorTicks = useMemo(() => buildTicks(24, 24), []);

    // Week view: 7 dates Mon..Sun rendered top=earliest → bottom=Sunday.
    // Stack always ends at Sunday (ISO week convention).
    const rowDates = useMemo(() => {
        if (!isWeekView) return [selectedDate];
        return weekDates(selectedDate); // Mon..Sun ascending
    }, [isWeekView, selectedDate]);

    // Today (local) — mount-stable, so the in-progress cross-day spans end on a
    // deterministic day and the crossDayMap memo stays pure (matches the Elevator
    // / Sidewalk convention; avoids a wall-clock read inside the memo). req #2798.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const todayStr = useMemo(() => localDateStr(new Date()), []);

    // Map<string reqId, requirement> — used by BeadRow to populate phantom
    // datacards for in-progress sessions whose requirement isn't in the
    // completed-only `requirements` list (req #2504). Key is String(id) to
    // match the source_ref parser output.
    const requirementById = useMemo(() => {
        const m = new Map();
        for (const r of allRequirements || []) {
            if (r && r.id != null) m.set(String(r.id), r);
        }
        return m;
    }, [allRequirements]);

    // Per-day requirements bucket (req #2800) — Map<YYYY-MM-DD, requirement[]>.
    // Handed to the Sidewalk/Elevator strips so each 24h day panel receives only
    // its own day's slice instead of the whole `requirements` array. A 24h panel
    // only ever renders same-day chips (positionFor rejects anything outside ±12h
    // of noon), so the slice is sufficient; days with no completions fall back to
    // the shared stable EMPTY_REQS. Without this, one window refetch changes the
    // `requirements` prop reference for ALL ≤60 panels at once, busting BeadRow's
    // React.memo (req #2796) and re-rendering every panel's SVG in a single
    // synchronous task — the 'message'/'setTimeout' long-task violations in
    // req #2800.
    // req #2840 — stabilize the per-day array references across a refetch. The
    // raw bucketByDate allocates a fresh array for EVERY non-empty day on every
    // call, so a single window refetch handed all ≤60 panels new `requirements`
    // refs and busted BeadRow's React.memo for every one of them at once. The
    // ref-cached reconcileBuckets reuses the prior array for any day whose
    // requirement content (signature) is unchanged, so a refetch now only
    // re-renders the panels whose day actually changed. Empty days still fall to
    // the shared stable EMPTY_REQS in the strips.
    const bucketCacheRef = React.useRef(new Map());
    const requirementsByDate = useMemo(() => {
        const fresh = bucketByDate(requirements, timezone);
        const { map, cache } = reconcileBuckets(bucketCacheRef.current, fresh);
        bucketCacheRef.current = cache;
        return map;
    }, [requirements, timezone]);

    // Swarm start-time clustering (req #2341 + req #2504). Real swarm_start
    // data wins when present (junction row + swarm_start.started_at); the
    // 3-minute time-window heuristic falls through for legacy/orphan sessions.
    // The result is threaded to every BeadRow / cross-day calculation so every
    // member of a launch shares one canonical start X.
    const { canonicalStartById, clusterSizeById, swarmStartIdById, swarmStartById } = useMemo(() => {
        const { canonical, clusterSize, swarmStartIdById: idMap, swarmStartById: rowMap } =
            clusterSessionsBySwarmStart(sessions, swarmStartSessions, swarmStarts);
        return {
            canonicalStartById: canonical,
            clusterSizeById: clusterSize,
            swarmStartIdById: idMap,
            swarmStartById: rowMap,
        };
    }, [sessions, swarmStartSessions, swarmStarts]);

    // Req #2497 — Map<String(sessionId), swarm_complete row> for the completion
    // terminus badge. Multi-parent policy: most-recent close-out (highest fk)
    // wins, mirroring the swarm_start reverse lookup on the session detail page.
    const swarmCompleteBySession = useMemo(() => {
        const m = new Map();
        if (!Array.isArray(swarmCompleteSessions) || !Array.isArray(swarmCompletes)) return m;
        const byId = new Map(swarmCompletes.map(c => [c.id, c]));
        const bestFk = new Map();
        for (const j of swarmCompleteSessions) {
            if (!j || j.session_fk == null || j.swarm_complete_fk == null) continue;
            const k = String(j.session_fk);
            const prev = bestFk.get(k);
            if (prev == null || j.swarm_complete_fk > prev) bestFk.set(k, j.swarm_complete_fk);
        }
        for (const [sKey, fk] of bestFk) {
            const row = byId.get(fk);
            if (row) m.set(sKey, row);
        }
        return m;
    }, [swarmCompletes, swarmCompleteSessions]);

    // Cross-day session lines — only matters in Week + Swarm mode. For each
    // session whose started_at and linked requirement's completed_at fall on
    // different days within the visible week, build a per-day entry so BeadRow
    // can draw a dashed "in-flight" line at the session's lane Y.
    //
    // Each entry also carries the chip datacard payload (reqId, title,
    // category, status, coordination, session info) so BeadRow can wrap the
    // vertical start bar in a tooltip matching the bubble's datacard.
    //
    // Lane alignment (req #2747) — each cross-day entry carries the requirement's
    // cluster `groupKey` (canonical swarm-start) and its end-day `completedAt`,
    // but NOT a precomputed lane. BeadRow folds these entries into the
    // destination day's own `assignSwarmLanes` pass as "ghost" occupants, so the
    // dashed pass-through line gets a lane that does NOT collide with that day's
    // same-day bubbles, and cluster-mates stay contiguous. (Previously the entry
    // borrowed the row the chip occupies on its END day; that row was never
    // reserved on the intermediate days, so two long-tail sessions could stack a
    // dashed line directly over an unrelated bubble that closed that day.)
    // Req #2798 — delegate to the module-scope buildCrossDayMap, which sources
    // BOTH completed spans (from `requirements`) AND in-progress spans (from
    // `swarmStarts` × junction, via `requirementById`). The previous inline map
    // iterated only `requirements` (completed-only), so its in-progress branch
    // was dead and open multi-day sessions never drew a pass-through line.
    const crossDayMap = useMemo(() => {
        if (!isWeekView || !rowDates.length) return new Map();
        return buildCrossDayMap(rowDates, {
            requirements, sessions, swarmStarts, swarmStartSessions,
            requirementById, categoryList,
            canonicalStartById, swarmStartIdById, swarmStartById,
            timezone, startXPct: bead36hXPct, today: todayStr,
        });
    }, [isWeekView, rowDates, requirements, sessions, swarmStarts,
        swarmStartSessions, requirementById, categoryList,
        canonicalStartById, swarmStartIdById, swarmStartById, timezone, todayStr]);

    // Non-elevator week stack lives inside its own fixed-height scroll frame
    // (req #2781) — same outer box as the Elevator frame, so the page never
    // window-scrolls in week view and toggling Elevator on/off keeps the viewport
    // pinned. On focus-day change / mode toggle / data load, bring the selected
    // day's row to the TOP of the frame (just below the 38px sticky shared
    // timeline), mirroring the Elevator's top-anchored focus.
    const weekFrameRef     = React.useRef(null);
    const userScrolledRef  = React.useRef(false);  // user took manual control of the frame
    const programmaticRef  = React.useRef(false);  // our own scrollTop write (ignore in listener)
    const showWeekFrame = isWeekView && !elevatorOn && !sidewalkOn;

    // A focus-day or mode change is an intentional re-anchor — clear the manual
    // -scroll guard so the layout effect below pins the new focus day to the top.
    // MUST be useLayoutEffect declared BEFORE the anchor effect: layout effects
    // run in declaration order, so this clears the guard before the anchor reads
    // it on the same commit (otherwise Today-after-a-manual-scroll would bail).
    React.useLayoutEffect(() => {
        userScrolledRef.current = false;
    }, [showWeekFrame, selectedDate]);

    // Mark genuine user scrolls so a background data refetch (which changes the
    // `requirements`/`sessions` array refs even via structural sharing when ANY
    // row in the broad fetch window changes) does not yank the user back to the
    // focus day mid-read. Our own programmatic scrollTop writes are flagged and
    // skipped here.
    React.useEffect(() => {
        if (!showWeekFrame) return undefined;
        const frame = weekFrameRef.current;
        if (!frame) return undefined;
        const onScroll = () => {
            if (programmaticRef.current) { programmaticRef.current = false; return; }
            userScrolledRef.current = true;
        };
        frame.addEventListener('scroll', onScroll, { passive: true });
        return () => frame.removeEventListener('scroll', onScroll);
    }, [showWeekFrame]);

    React.useLayoutEffect(() => {
        if (!showWeekFrame) return;
        if (userScrolledRef.current) return;   // user is scrolling — don't fight them
        const frame = weekFrameRef.current;
        if (!frame || !selectedDate) return;
        const row = frame.querySelector(`.ts-bead[data-date="${selectedDate}"]`);
        if (!row) return;
        const WEEK_AXIS_PX = 38; // == .ts-shared-timeline-week height
        const delta = row.getBoundingClientRect().top
                    - frame.getBoundingClientRect().top
                    - WEEK_AXIS_PX;
        if (Math.abs(delta) < 1) return;       // already anchored — no scroll, no flag
        const before = frame.scrollTop;
        programmaticRef.current = true;
        frame.scrollTop += delta;
        // If the write was clamped to a no-op (focus row already at the bottom
        // limit), no scroll event fires — clear the flag so it doesn't swallow
        // the user's next real scroll.
        if (frame.scrollTop === before) programmaticRef.current = false;
    // Re-anchor on focus/mode change and on data-driven height changes — but the
    // userScrolled guard above suppresses the data case once the user scrolls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showWeekFrame, selectedDate, requirements, sessions]);

    // One BeadRow per row date (Day = [selectedDate]; Week = Mon..Sun). Shared by
    // the framed week stack and the in-flow day view so the row props stay DRY.
    const weekRows = rowDates.map(d => (
        <BeadRow
            key={d}
            requirements={requirements}
            sessions={sessions}
            selectedDate={d}
            timezone={timezone}
            beadWindow={beadWindow}
            dataKey={dataKey}
            titlesOn={titlesOn}

            completesOn={completesOn}
            phasesOn={phasesOn}
            tooltipFontSize={tooltipFontSize}
            circleDiameter={circleDiameter}
            spaceKey={spaceKey}
            zoomKey={zoomKey}
            categoryList={categoryList}
            isWeekView={isWeekView}
            hideTimeline={isWeekView}
            crossDays={crossDayMap.get(d) || EMPTY_CROSS_DAYS}
            onChipClick={onChipClick}
            onSwarmStartClick={onSwarmStartClick}
            onUndoClick={onUndoClick}
            canonicalStartById={canonicalStartById}
            clusterSizeById={clusterSizeById}
            swarmStartIdById={swarmStartIdById}
            swarmStartById={swarmStartById}
            swarmStarts={swarmStarts}
            swarmStartSessions={swarmStartSessions}
            swarmUndos={swarmUndos}
            swarmCompleteBySession={swarmCompleteBySession}
            onCompleteClick={onCompleteClick}
            requirementById={requirementById}
        />
    ));

    return (
        <SharedTooltipLayer fontSize={tooltipFontSize}>
        <Box className="ts-view" data-testid="time-series-view" data-week={isWeekView ? '1' : '0'}>
            {/* Rows — one BeadRow for day/month, seven stacked for week, OR a
                horizontally-scrolling Sidewalk for Day + sidewalkOn, OR a
                vertically-scrolling Elevator for Week + elevatorOn (req #2383). */}
            {elevatorOn && isWeekView ? (
                <Elevator
                    centerDate={selectedDate}
                    onCenterDateChange={onCenterDateChange || (() => {})}
                    sharedTicks={elevatorTicks}
                    requirements={requirements}
                    requirementsByDate={requirementsByDate}
                    sessions={sessions}
                    timezone={timezone}
                    beadWindow={beadWindow}
                    dataKey={dataKey}
                    titlesOn={titlesOn}

                    completesOn={completesOn}
                    phasesOn={phasesOn}
                    tooltipFontSize={tooltipFontSize}
                    circleDiameter={circleDiameter}
                    spaceKey={spaceKey}
                    zoomKey={zoomKey}
                    categoryList={categoryList}
                    isWeekView={false}
                    onChipClick={onChipClick}
                    onSwarmStartClick={onSwarmStartClick}
                    onUndoClick={onUndoClick}
                    canonicalStartById={canonicalStartById}
                    clusterSizeById={clusterSizeById}
                    swarmStartIdById={swarmStartIdById}
                    swarmStartById={swarmStartById}
                    swarmStarts={swarmStarts}
                    swarmStartSessions={swarmStartSessions}
                    swarmUndos={swarmUndos}
                    swarmCompleteBySession={swarmCompleteBySession}
                    onCompleteClick={onCompleteClick}
                    requirementById={requirementById}
                />
            ) : sidewalkOn && !isWeekView ? (
                <Sidewalk
                    centerDate={selectedDate}
                    onCenterDateChange={onCenterDateChange || (() => {})}
                    requirements={requirements}
                    requirementsByDate={requirementsByDate}
                    sessions={sessions}
                    timezone={timezone}
                    beadWindow={beadWindow}
                    dataKey={dataKey}
                    titlesOn={titlesOn}

                    completesOn={completesOn}
                    phasesOn={phasesOn}
                    tooltipFontSize={tooltipFontSize}
                    circleDiameter={circleDiameter}
                    spaceKey={spaceKey}
                    zoomKey={zoomKey}
                    categoryList={categoryList}
                    isWeekView={false}
                    onChipClick={onChipClick}
                    onSwarmStartClick={onSwarmStartClick}
                    onUndoClick={onUndoClick}
                    canonicalStartById={canonicalStartById}
                    clusterSizeById={clusterSizeById}
                    swarmStartIdById={swarmStartIdById}
                    swarmStartById={swarmStartById}
                    swarmStarts={swarmStarts}
                    swarmStartSessions={swarmStartSessions}
                    swarmUndos={swarmUndos}
                    swarmCompleteBySession={swarmCompleteBySession}
                    onCompleteClick={onCompleteClick}
                    requirementById={requirementById}
                />
            ) : isWeekView ? (
                /* req #2744 — Week stack: one shared time axis above the 7 rows
                   (sticky to the top of the frame) instead of a per-row axis.
                   req #2781 — wrapped in a fixed-height .ts-week-scroll frame
                   (same box as the Elevator) so the page does not window-scroll
                   in week view; the focus day is scrolled to the top by the
                   weekFrameRef layout effect above. */
                <Box className="ts-week-scroll" data-testid="ts-week-scroll" ref={weekFrameRef}>
                    <SharedTimeline variant="week" ticks={weekTicks} />
                    <Box className="ts-rows ts-rows-week">
                        {weekRows}
                    </Box>
                </Box>
            ) : (
                /* Day view keeps its own per-row axis (hideTimeline stays off)
                   and stays in normal page flow. */
                <Box className="ts-rows">
                    {weekRows}
                </Box>
            )}
        </Box>
        </SharedTooltipLayer>
    );
};

export default TimeSeriesView;
