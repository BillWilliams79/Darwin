import React, { useMemo, useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { toLocaleDateString, getTimeOfDayFraction, formatCardDateTime, formatHM12, localDateStr } from '../utils/dateFormat';
import {
    DEFAULT_FONT_SIZE,
    getFontSize, getCircleSize, formatCoordination, getCoordinationColor,
    DEFAULT_VIZ, DEFAULT_DATA_KEY,
    DEFAULT_SPACE, getSpaceMultiplier,
    DEFAULT_ZOOM, getZoomHours, ZOOM_HOURS,
    indexSessionsByRequirement,
    parseSessionRequirementId,
    clusterSessionsByStartTime,
    clusterSessionsBySwarmStart,
} from './timeSeriesSizes';
import './TimeSeriesView.css';

// ─────────── Chip-count helpers (used by Sidewalk height precomputation) ─────
// Bucket chips by their tz-local date string. Bead mode: one chip per same-day
// requirement. Swarm mode: one chip per (requirement, session) pair, or a
// single bare-requirement chip when a requirement has no linked session.
//
// Single pass over `requirements` and `sessions` so the Sidewalk parent can
// size 21 panels without 21 × O(R+S) work (was the 100-200ms stall on scroll
// that made the strip feel frozen — req #2334 follow-up). Callers that want a
// specific date's count can use `countChipsForDate`, which just delegates here.
// Exported for unit-test coverage.
export const indexChipsByDate = (requirements, sessions, timezone, vizKey) => {
    const map = new Map();
    if (!Array.isArray(requirements)) return map;
    const sessionsByReq = vizKey === 'swarm' ? indexSessionsByRequirement(sessions) : null;
    for (const r of requirements) {
        if (!r?.completed_at) continue;
        const d = toLocaleDateString(r.completed_at, timezone);
        if (!d) continue;
        let n = 1;
        if (vizKey === 'swarm') {
            const linked = sessionsByReq.get(String(r.id)) || [];
            n = linked.length > 0 ? linked.length : 1;
        }
        map.set(d, (map.get(d) || 0) + n);
    }
    return map;
};

export const countChipsForDate = (requirements, sessions, date, timezone, vizKey) => {
    if (!date) return 0;
    return indexChipsByDate(requirements, sessions, timezone, vizKey).get(date) || 0;
};

// ─────────── Cluster-stack layout (Bead mode) ─────────────────────────────────
// Chips sorted by leftPct. If a chip is within minGapPct of the previous chip,
// it extends the stack upward; otherwise a new stack begins at row 0.
//
// `topDown` reverses the walk direction (descending leftPct). Sidewalk mode uses
// this so the latest chip in a cluster gets row 0 — the row rendered closest to
// the wire (which is at the TOP of a sidewalk panel). Cluster-gap detection uses
// |Δ leftPct| so the direction of traversal doesn't change what counts as a
// cluster. Exported for unit-test coverage.
const MAX_ROWS = 24;
export const assignRows = (chips, minGapPct, topDown = false) => {
    const sorted = [...chips].sort((a, b) =>
        topDown ? b.leftPct - a.leftPct : a.leftPct - b.leftPct
    );
    const out = [];
    let stackRow = -1;
    let lastPct = null;
    for (const chip of sorted) {
        const isCluster = lastPct !== null
            && Math.abs(chip.leftPct - lastPct) < minGapPct;
        if (isCluster) {
            const nextRow = stackRow + 1;
            if (nextRow < MAX_ROWS) {
                out.push({ ...chip, row: nextRow });
                stackRow = nextRow;
            } else {
                out.push({ ...chip, row: MAX_ROWS - 1 });
            }
        } else {
            out.push({ ...chip, row: 0 });
            stackRow = 0;
        }
        lastPct = chip.leftPct;
    }
    return out;
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
// | startPct | nowPct   | Behaviour                                       |
// |----------|----------|-------------------------------------------------|
// | in       | in       | start at startPct, head at nowPct (same day)    |
// | in       | null     | start at startPct, head at 100% (open-day panel |
// |          |          |   viewed retrospectively — session was still    |
// |          |          |   active at end of that panel)                  |
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
        return { phantomStartPct: startPct, phantomLeftPct: 100, startClamped: false };
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
// like a completed chip. Returns [] when vizKey != 'swarm' or no undos in
// window.
//
// Exported for unit-test coverage.
export const buildUndoneChips = ({
    vizKey,
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
    if (vizKey !== 'swarm') return [];
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
// non-swarm or empty input. Exported for unit-test coverage of the field mapping.
export const buildCrossDayGhosts = (crossDays, vizKey) => {
    if (vizKey !== 'swarm' || !Array.isArray(crossDays) || crossDays.length === 0) return [];
    return crossDays.map((cd, i) => ({
        chipKey: `xdghost-${cd.sessionId}-${cd.role}-${i}`,
        id: cd.card?.id ?? null,
        groupKey: cd.groupKey || '',
        completed_at: cd.completedAt || null,
        isCrossDayGhost: true,
        crossDay: cd,
    }));
};

// ─────────── Max-stack-row index (Elevator per-day sizing) ───────────────────
// Return Map<YYYY-MM-DD, maxRow> where maxRow is the row index BeadRow will
// assign to its tallest chip on that date. Elevator uses this to size each day
// panel to its actual rendered content instead of the swarm worst case:
//
//   • Swarm: every chip (req + per-session fan-out) gets its own lane via
//     `assignSwarmLanes`, so maxRow = chipsByDate(date) - 1.
//   • Bead:  chips cluster-stack via `assignRows` with minGapPct=1.2 on leftPct.
//     leftPct in a 24h sidewalk panel = time-of-day fraction × 100, so we can
//     reproduce the placement here without going through positionFor.
//
// A 39-req day in bead mode that's spread across the day might only stack to
// row 3 or 4, not row 38 — this is what makes the per-day heights differ
// between bead and swarm for the same dataset (req #2383 follow-up).
// Exported for unit-test coverage.
export const indexMaxStackByDate = (requirements, sessions, timezone, vizKey) => {
    const out = new Map();
    if (!Array.isArray(requirements)) return out;

    if (vizKey === 'swarm') {
        const chipsByDate = indexChipsByDate(requirements, sessions, timezone, vizKey);
        for (const [date, n] of chipsByDate) {
            out.set(date, Math.max(0, n - 1));
        }
        return out;
    }

    // Bead: bucket leftPcts by date, then run assignRows per date.
    const leftPctsByDate = new Map();
    for (const r of requirements) {
        if (!r?.completed_at) continue;
        const d = toLocaleDateString(r.completed_at, timezone);
        if (!d) continue;
        const frac = getTimeOfDayFraction(r.completed_at, timezone);
        if (frac === null || frac === undefined) continue;
        if (!leftPctsByDate.has(d)) leftPctsByDate.set(d, []);
        leftPctsByDate.get(d).push(frac * 100);
    }
    for (const [date, leftPcts] of leftPctsByDate) {
        const chips = leftPcts.map(p => ({ leftPct: p }));
        const placed = assignRows(chips, 1.2);
        const maxRow = placed.length ? Math.max(...placed.map(c => c.row)) : 0;
        out.set(date, maxRow);
    }
    return out;
};

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
const BeadRow = ({
    requirements, sessions, categoryList, selectedDate, timezone,
    beadWindow, vizKey, tooltipFontSize, circleDiameter, spaceKey = 1,
    zoomKey = DEFAULT_ZOOM,
    dataKey = DEFAULT_DATA_KEY,   // 'category' | 'coordination' — req #2382
    titlesOn = false,             // req #2556 — render req title to right of bubble
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
    requirementById,         // req #2504 — Map<string reqId, requirement> for phantom tooltips
}) => {
    const window36h = beadWindow === '36h';
    // Week stack (req #2747) — the only mode with a single shared sticky time
    // axis at top:0 AND stacked day panels in page flow. Its per-panel date/count
    // row becomes a sticky section header (top:38, under the axis) so the current
    // day's header sticks and the next day pushes it out as you scroll. Day view,
    // Sidewalk and Elevator keep the absolute date band + count badge.
    const weekStack = isWeekView && !sidewalkPanel;
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
    //   Day view     — roomy; bubble sits above the wire/X-axis with clearance.
    //   Week view    — compressed so 7 rows fit.
    //   Sidewalk     — top-down flow: wire/timeline pinned at top, bubbles stream
    //                  down from there with the LATEST chip at row 0 just below
    //                  the wire.
    // bubbleOffset is the CSS bottom for row 0 in the bottom-anchored layouts
    // (Day / Week). Sidewalk uses top-anchored positioning (see bubbleYCss
    // below) so its bubbleOffset is the bottom-padding of the panel instead —
    // kept only so the height formula below still computes a sane lower bound.
    const LAYOUT_DAY      = { bubbleOffset: 86, baseHeight: 172 };
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

    // Bead: one chip per requirement. Swarm: one chip per (req, session) pair;
    // requirements with zero sessions get a lone chip with markerMode='left' —
    // rendered as a short vertical bar immediately left of the met bubble.
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
        if (vizKey !== 'swarm') return windowChips;
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
                    // groupKey = canonical cluster start (req #2504 grouping).
                    // All chips that launched together share one key so
                    // assignSwarmLanes stacks them in contiguous rows.
                    groupKey: canonicalStartedAt || '',
                });
            }
        }
        return out;
    }, [vizKey, windowChips, sessionsByReq, xPctFn, timezone, selectedDate,
        canonicalStartById, clusterSizeById, swarmStartIdById, swarmStartById]);

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
        if (vizKey !== 'swarm') return [];
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
    }, [vizKey, swarmStarts, swarmStartSessions, sessions, xPctFn, timezone,
        selectedDate, nowPct, requirementById, categoryList, dataKey]);

    // Undone session chips (req #2719). One chip per `swarm_undos` row —
    // driven directly by the undo log + the `swarm_starts` row it snapshots
    // (`swarm_start_fk_at_undo`) rather than the live `swarm_sessions` row.
    //
    // Why undo-driven, not session-driven: per req #2697 the `swarm_sessions`
    // hook (`ops: true`) reads from production `darwin`. A new feature like
    // `swarm_undos` whose data lives in `darwin_dev` cannot rely on a matching
    // session-status flip in production. The undo row + swarm_start row are
    // both readable in dev (undos via the default `darwinUri`, swarm_starts
    // via `darwinOpsUri`) — that pair is enough to render the chip without
    // touching the live session at all. As a bonus this also works in the
    // historical `/swarm-undo` model where the session row was deleted.
    //
    // Math is identical to a completed chip: startPct comes from the
    // swarm_start.started_at (same source the green anchor uses); leftPct
    // comes from undo.undone_at (treated as the session's completed_at).
    // `markerMode` resolves to 'normal' / 'clamped' / 'left' via the same
    // formula `drawChips` uses for completed chips.
    const undoneChips = useMemo(
        () => buildUndoneChips({
            vizKey, swarmUndos, swarmStarts, xPctFn, timezone, selectedDate,
            requirementById, categoryList,
            closeThresholdPct: CLOSE_THRESHOLD_PCT,
        }),
        [vizKey, swarmUndos, swarmStarts, xPctFn, timezone, selectedDate,
         requirementById, categoryList],
    );

    // Placement: cluster-stack for Bead, swarm-lane for Swarm.
    //
    // In Sidewalk the wire is at the TOP of the panel, so row 0 — the row
    // rendered closest to the wire — must hold the LATEST chip. Thread
    // `topDown = sidewalkPanel` through both assigners so they emit rows in
    // the direction the layout below wants.
    const topDown = sidewalkPanel;
    const allSwarmChips = (phantomChips.length || undoneChips.length)
        ? [...drawChips, ...phantomChips, ...undoneChips]
        : drawChips;

    // Ghosts are filtered out of `placed` (so no bubble / start-bar / anchor
    // renders for them); their assigned row drives the cross-day line Y via
    // `crossDayPlaced` below. See buildCrossDayGhosts (module scope) for the
    // field mapping + rationale (req #2747).
    const crossDayGhosts = buildCrossDayGhosts(crossDays, vizKey);

    const placedAll = vizKey === 'swarm'
        ? assignSwarmLanes(crossDayGhosts.length ? [...allSwarmChips, ...crossDayGhosts] : allSwarmChips, topDown)
        : assignRows(drawChips, 1.2, topDown);
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
    const rowSpacing = Math.max(16, Math.round((circleDiameter + 4) * spaceMul));

    // Vertical height — must clear the top chrome by at least half a bubble so
    // the tallest bubble never crowds the date / time-axis header. Same formula
    // for every layout; only the chrome offset changes:
    //   Day      → 46 (date band at top 26 + height 20)
    //   Week     → 26 (no date chrome above the row)
    //   Sidewalk → 80 (wire at CSS top: 68 after whitespace expansion for
    //                   req #2331/#2364, plus ~12px breathing room before row 0).
    // Panel uniformity in the Sidewalk strip is handled by the parent, which
    // passes a precomputed `sidewalkHeight` sized to the busiest day's lanes.
    // req #2744 — Elevator panels (sidewalkPanel) with the time axis suppressed
    // drop the time row (top:46..64), so the wire moves up to top:34 and row 0
    // starts at 46 instead of 80. Matching CSS: .ts-bead-sidewalk.ts-bead-no-timeline.
    const chromeOffset  = sidewalkPanel
        ? (hideTimeline ? 46 : 80)
        : (isWeekView ? 26 : 46);
    const dateClearance = Math.ceil(circleDiameter / 2) + 4;
    const height = Math.max(baseHeight,
                            maxStackRow * rowSpacing + bubbleOffset + circleDiameter
                            + chromeOffset + dateClearance);

    // Bubble positioning — top-anchored in Sidewalk (wire at top, row 0 = latest
    // right below it) and bottom-anchored in Day/Week (wire at bottom, row 0 =
    // earliest right above it). Either way row 0 renders closest to the wire;
    // the row-assignment direction above decides which chip lands there.
    const bubbleYCss      = sidewalkPanel
        ? (row) => ({ top:    `${chromeOffset + row * rowSpacing}px` })
        : (row) => ({ bottom: `${bubbleOffset + row * rowSpacing}px` });
    const bubbleCenterCss = sidewalkPanel
        ? (row) => `${chromeOffset + row * rowSpacing + circleDiameter / 2}px`
        : (row) => `calc(100% - ${row * rowSpacing + bubbleOffset + circleDiameter / 2}px)`;

    return (
        <Box className={`ts-bead ts-bead-${window36h ? '36h' : '24h'} ts-bead-${isWeekView ? 'week' : 'day'} ${sidewalkPanel ? 'ts-bead-sidewalk' : ''} ${hideTimeline ? 'ts-bead-no-timeline' : ''}`}
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

            {vizKey === 'swarm' && (
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
                        const hLine = {
                            className: 'ts-swarm-line ts-swarm-line-clamped',
                            stroke: 'rgba(96,125,139,0.85)',
                            strokeWidth: 1.5,
                            y1: yBottom,
                            y2: yBottom,
                        };
                        if (cd.role === 'middle') {
                            return <line key={key} {...hLine} x1="0%" x2="100%" />;
                        }
                        if (cd.role === 'start') {
                            const barHalf = Math.max(6, circleDiameter / 2);
                            const yTop = `calc(100% - ${cd.lane * rowSpacing + bubbleOffset + circleDiameter / 2 + barHalf}px)`;
                            const yBot = `calc(100% - ${cd.lane * rowSpacing + bubbleOffset + circleDiameter / 2 - barHalf}px)`;
                            const card = cd.card;
                            return (
                                <Tooltip
                                    key={key}
                                    arrow
                                    slotProps={{
                                        tooltip: { sx: { fontSize: tooltipFontSize, maxWidth: 360, p: 1.25 } },
                                    }}
                                    title={card ? (
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
                                                <span className="ts-datacard-key">Closed</span>
                                                <span>{formatCardDateTime(card.completed_at, card.timezone)}</span>
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
                                    ) : ''}
                                >
                                    <g data-testid={`ts-swarm-start-xd-${cd.sessionId}`}
                                       data-real={card?.swarmStartId ? '1' : '0'}
                                       style={{ cursor: card?.swarmStartId ? 'pointer' : 'default' }}
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
                                </Tooltip>
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
                        const stroke = isInProgress
                            ? '#43A047'
                            : 'rgba(96,125,139,0.85)';
                        const strokeWidth = isInProgress ? 2 : 1.5;
                        return (
                            <line
                                key={`line-${chip.chipKey}`}
                                data-testid={`ts-swarm-line-${chip.chipKey}`}
                                className={`ts-swarm-line ${isClamped ? 'ts-swarm-line-clamped' : ''} ${isInProgress ? 'ts-swarm-line-inprogress' : ''}`}
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
                        // bubbleCenterCss — top-anchored `${N}px` for sidewalk,
                        // `calc(100% - ${N}px)` for Day/Week — so the bar
                        // follows row 0 to whichever edge the wire is on.
                        const yStride = chip.row * rowSpacing + circleDiameter / 2;
                        const y1 = sidewalkPanel
                            ? `${chromeOffset + yStride - halfBar}px`
                            : `calc(100% - ${bubbleOffset + yStride - halfBar}px)`;
                        const y2 = sidewalkPanel
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
            )}

            {/* Swarm-start anchor hover targets — invisible HTML boxes overlay
                each SVG anchor circle. Hover shows a "Swarm-Start #N" datacard:
                started_at, sessions, wall, turns, autonomy, auto-start, args.
                Real (green) anchors get the full swarm_starts data; estimated
                (red) anchors get a brief "no swarm-start data" note instead.
                The hover is needed because the SVG layer has pointer-events:
                none (lines and circles are decorative); this overlay restores
                hover affordance for the anchor specifically. Req #2504. */}
            {vizKey === 'swarm' && placed.map(chip => {
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
                const anchorYpx = sidewalkPanel
                    ? chromeOffset + yStride + (anchorAtWire ? halfBar : -halfBar)
                    : bubbleOffset + yStride + (anchorAtWire ? halfBar : -halfBar);
                const yStyle = sidewalkPanel
                    ? { top:    `${anchorYpx - halfHit}px` }
                    : { bottom: `${anchorYpx - halfHit}px` };
                const isReal = !!chip.swarmStartId;
                const ss = chip.swarmStart;
                const wall = ss && ss.wall_seconds != null
                    ? (ss.wall_seconds < 60
                        ? `${ss.wall_seconds}s`
                        : `${Math.floor(ss.wall_seconds / 60)}m ${ss.wall_seconds % 60}s`)
                    : null;
                const title = isReal && ss ? (
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
                        {ss.autonomy_filter && (
                            <div className="ts-datacard-row">
                                <span className="ts-datacard-key">Autonomy</span>
                                <span>{ss.autonomy_filter}</span>
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
                );
                return (
                    <Tooltip
                        key={`anchor-hit-${chip.chipKey}`}
                        arrow
                        slotProps={{ tooltip: { sx: { fontSize: tooltipFontSize, maxWidth: 360, p: 1.25 } } }}
                        title={title}
                    >
                        <Box
                            data-testid={`ts-swarm-start-hit-${chip.chipKey}`}
                            data-real={isReal ? '1' : '0'}
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
                    </Tooltip>
                );
            })}

            {/* Tombstone overlay removed (req #2719 v2) — undone sessions now
                render as regular chips through the normal placed[] pipeline
                with a tombstone bubble swap in the chip render below. The
                session row is preserved by /swarm-undo so the chip lives,
                pays the same lane/cluster math, and inherits hover/datacard
                identically. */}

            {placed.map(chip => (
                <Tooltip
                    key={chip.chipKey || chip.id}
                    arrow
                    slotProps={{
                        tooltip: { sx: { fontSize: tooltipFontSize, maxWidth: 360, p: 1.25 } },
                    }}
                    title={
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
                        </Box>
                    }
                >
                    <Box
                        className={`ts-bead-group${chip.isPhantom ? ' ts-bead-group-phantom' : ''}`}
                        data-testid={`ts-chip-${chip.chipKey || chip.id}`}
                        data-reqid={chip.id ?? undefined}
                        data-phantom={chip.isPhantom ? '1' : undefined}
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
                                    // Phantom: hollow green ring at the line's "now" end.
                                    // Same diameter as a regular bubble so layout is stable.
                                    backgroundColor: '#ffffff',
                                    border: '2px solid #43A047',
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
                </Tooltip>
            ))}

            {/* Count pill is carried by the sticky header (Week stack) or inline to
                the left of the date in DayLabels (Day / Sidewalk / Elevator) — the
                standalone absolute badge was retired in req #2747. */}
        </Box>
    );
};

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

const Sidewalk = ({ centerDate, onCenterDateChange, ...rowProps }) => {
    const { requirements, sessions, timezone, vizKey, circleDiameter, spaceKey } = rowProps;
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

    // Uniform panel height — sized to the busiest day in the visible strip so
    // every panel shows all its lanes below the top chrome. Mirrors BeadRow's
    // height formula (sidewalk branch: chromeOffset=80, bubbleOffset=20).
    // Single-pass bucket via indexChipsByDate so 21-day strips stay O(R+S+D)
    // instead of O(D × (R+S)) — matters during scroll, when requirements
    // refetches churn this memo.
    const sidewalkHeight = useMemo(() => {
        const BASE_HEIGHT   = 400;
        const bubbleOffset  = 20;
        const chromeOffset  = 80;   // matches BeadRow's sidewalk chromeOffset (wire top:68 + padding)
        const dateClearance = Math.ceil(circleDiameter / 2) + 4;
        const spaceMul      = getSpaceMultiplier(spaceKey);
        const rowSpacing    = Math.max(16, Math.round((circleDiameter + 4) * spaceMul));
        const chipsByDate   = indexChipsByDate(requirements, sessions, timezone, vizKey);
        let maxChips = 0;
        for (const d of dates) {
            const n = chipsByDate.get(d) || 0;
            if (n > maxChips) maxChips = n;
        }
        const maxStackRow = Math.max(0, maxChips - 1);
        return Math.max(
            BASE_HEIGHT,
            maxStackRow * rowSpacing + bubbleOffset + circleDiameter + chromeOffset + dateClearance,
        );
    }, [dates, requirements, sessions, timezone, vizKey, circleDiameter, spaceKey]);

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

    // Apply a translateX to the inner strip without triggering React re-renders
    // — keeps drag at native-refresh smoothness.
    const applyOffset = (x) => {
        offsetRef.current = x;
        if (innerRef.current) innerRef.current.style.transform = `translate3d(${x}px,0,0)`;
    };

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
        if (frameWidth === 0) return 0;
        const cur = datesRef.current;
        const raw = -offsetRef.current / frameWidth;
        return Math.max(0, Math.min(cur.length - 1, Math.round(raw)));
    };

    // Infinite-scroll buffer maintenance. When the visible panel approaches
    // either edge, prepend / append SIDEWALK_EXTEND_BY days. Left extension
    // shifts translateX by -extend*frameWidth so the visible panel stays put;
    // when the array overflows SIDEWALK_MAX_PANELS, we prune the opposite end
    // (with a matching +removed*frameWidth shift if pruning the left side).
    //
    // datesRef is updated synchronously so a follow-up call within the same
    // frame doesn't see the pre-extension array and re-extend.
    const maybeExtend = () => {
        if (frameWidth === 0) return;
        const cur = datesRef.current;
        if (!cur || cur.length === 0) return;
        const raw = -offsetRef.current / frameWidth;
        const idx = Math.round(raw);
        const distLeft  = idx;
        const distRight = cur.length - 1 - idx;

        if (distLeft <= SIDEWALK_BUFFER_THRESHOLD) {
            // Extend left, then shift translateX so the visible panel stays put.
            applyOffset(offsetRef.current - SIDEWALK_EXTEND_BY * frameWidth);
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
                applyOffset(offsetRef.current + pruned.removedCount * frameWidth);
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
        if (frameWidth === 0) return;
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
            requestAnimationFrame(() => applyOffset(-rebuilt.indexOf(centerDate) * frameWidth));
            return;
        }
        lastReported.current = centerDate;
        animateTo(-idx * frameWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [centerDate, frameWidth]);

    // Initial placement on mount — put centerDate at index-of.
    React.useEffect(() => {
        if (frameWidth === 0) return;
        const idx = datesRef.current.indexOf(centerDate);
        if (idx >= 0) applyOffset(-idx * frameWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frameWidth]);

    // Drag + momentum. Bind once per frameWidth — `dates.length` is read via
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
            e.preventDefault();
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

        frame.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        frame.addEventListener('click', onClickCapture, true);
        frame.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            frame.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            frame.removeEventListener('click', onClickCapture, true);
            frame.removeEventListener('wheel', onWheel);
            stopAnim();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frameWidth]);

    return (
        <Box className="ts-sidewalk" data-testid="ts-sidewalk" ref={frameRef}>
            <Box className="ts-sidewalk-inner" ref={innerRef}>
                {dates.map(d => (
                    <Box key={d} className="ts-sidewalk-panel" data-date={d}
                         style={{ width: frameWidth || '100%', flex: `0 0 ${frameWidth || 1}px` }}>
                        <BeadRow selectedDate={d}
                                 sidewalkPanel={true}
                                 sidewalkHeight={sidewalkHeight}
                                 {...rowProps} />
                    </Box>
                ))}
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

// req #2779 — Elevator infinite scroll. Vertical analog of Sidewalk's
// SIDEWALK_* buffer constants (same values): when the centered panel comes
// within ELEVATOR_BUFFER_THRESHOLD of either end of `dates`, prepend/append
// ELEVATOR_EXTEND_BY days; once the array exceeds ELEVATOR_MAX_PANELS, prune
// the opposite end. There is no offset clamp — the strip is endless in both
// directions, so the user can scroll arbitrarily far into past or future.
const ELEVATOR_BUFFER_THRESHOLD = 5;
const ELEVATOR_EXTEND_BY = 10;
const ELEVATOR_MAX_PANELS = 60;

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
const Elevator = ({ centerDate, onCenterDateChange, sharedTicks, ...rowProps }) => {
    const { requirements, sessions, timezone, vizKey, circleDiameter, spaceKey } = rowProps;
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
    const [dates, setDates] = React.useState(() => cappedCenteredRange(centerDate, 10, maxFutureDate));
    // Mirror of `dates` for synchronous reads inside drag/wheel/momentum handlers —
    // lets maybeExtend check current length / size new panels without re-binding the
    // drag effect on every extension (req #2779, mirrors Sidewalk's datesRef).
    const datesRef = React.useRef(dates);
    const [frameHeight, setFrameHeight] = React.useState(0);

    // Per-date max stack row — reproduces BeadRow's placement for the active
    // vizKey: bead uses cluster-stack (many chips collapse to a handful of rows
    // when spread across the day), swarm uses one-lane-per-chip (maxRow =
    // chips − 1). Lifted to its own memo (req #2779) so maybeExtend can size
    // freshly-prepended panels from the same source the render uses.
    const maxRowByDate = useMemo(
        () => indexMaxStackByDate(requirements, sessions, timezone, vizKey),
        [requirements, sessions, timezone, vizKey],
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
    React.useLayoutEffect(() => { panelGeomRef.current = panelGeom; }, [panelGeom]);

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

    const applyOffset = (y) => {
        offsetRef.current = y;
        if (innerRef.current) innerRef.current.style.transform = `translate3d(0,${y}px,0)`;
    };

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
    // the frame's vertical center. Linear scan over cumulative offsets — N≤21,
    // no need for binary search.
    const indexForOffset = () => {
        const g = panelGeomRef.current;
        if (!g || g.heights.length === 0 || g.stripHeight === 0) return 0;
        const viewportH = Math.max(0, frameHeight - ELEVATOR_TOP_AXIS_PX);
        const frameCenterInStrip = -offsetRef.current + (viewportH / 2);
        for (let i = 0; i < g.heights.length; i++) {
            const bottom = g.cumulative[i] + g.heights[i];
            if (frameCenterInStrip < bottom) return i;
        }
        return g.heights.length - 1;
    };

    // Offset that places the panel at `idx` centered in the frame, then clamped
    // so the view never scrolls past the future cap (clampOffset is a no-op until
    // the strip reaches the cap — the past stays endless).
    const offsetForIndex = (idx) => {
        const g = panelGeomRef.current;
        if (!g || g.heights.length === 0) return 0;
        const i = Math.max(0, Math.min(g.heights.length - 1, idx));
        const viewportH = Math.max(0, frameHeight - ELEVATOR_TOP_AXIS_PX);
        return clampOffset(viewportH / 2 - g.cumulative[i] - g.heights[i] / 2);
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
            // Rebuild strip around the new centerDate and snap to its center.
            // Clamp the effective center to the future cap so a chevron jump past
            // this week lands on the last allowed day instead of an empty strip.
            const effCenter = (maxFutureDate && centerDate > maxFutureDate) ? maxFutureDate : centerDate;
            const rebuilt = cappedCenteredRange(effCenter, 10, maxFutureDate);
            datesRef.current = rebuilt;
            setDates(rebuilt);
            lastReported.current = centerDate;
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

    // Initial placement — put centerDate centered in the frame. Runs once when
    // frameHeight first becomes non-zero (deps [frameHeight] only, so extend/prune
    // never re-triggers a recenter mid-scroll).
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
            e.preventDefault();
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

        frame.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        frame.addEventListener('click', onClickCapture, true);
        frame.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            frame.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
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
                {dates.map((d, i) => (
                    <Box key={d} className="ts-elevator-panel" data-date={d}
                         style={{ height: panelHeights[i], flex: `0 0 ${panelHeights[i]}px` }}>
                        <BeadRow selectedDate={d}
                                 sidewalkPanel={true}
                                 hideTimeline={true}
                                 sidewalkHeight={panelHeights[i]}
                                 {...rowProps} />
                    </Box>
                ))}
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
    selectedDate,
    timezone,
    beadWindow = '24h',
    vizKey = DEFAULT_VIZ,
    sidewalkOn = false,
    elevatorOn = false,
    dataKey = DEFAULT_DATA_KEY,      // 'category' | 'coordination' — req #2382
    titlesOn = false,                // req #2556 — render req title to right of bubble
    isWeekView = false,
    categoryList = [],
    onChipClick,
    onSwarmStartClick,
    onUndoClick,
    onCenterDateChange,
}) => {
    // The UI Options amber bar was removed 2026-04-18 — Viz and Sidewalk
    // were promoted to the toolbar, and the remaining controls have landed
    // on good defaults that ship as-is.
    const fontSizeKey  = DEFAULT_FONT_SIZE;
    const spaceKey     = DEFAULT_SPACE;
    const zoomKey      = DEFAULT_ZOOM;
    const circleSizeKey = (sidewalkOn || elevatorOn)
        ? 1                                              // 21-day strips always use size 1
        : (isWeekView ? 1 : (vizKey === 'swarm' ? 1 : 3));
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
    const crossDayMap = useMemo(() => {
        const map = new Map(); // date → [{ sessionId, role, groupKey, completedAt, pct?, card? }]
        if (!isWeekView || vizKey !== 'swarm' || !rowDates.length) return map;
        const dateSet = new Set(rowDates);
        const sessionsByReq = indexSessionsByRequirement(sessions);

        for (const r of requirements) {
            if (!r.completed_at) continue;
            const endDay = toLocaleDateString(r.completed_at, timezone);
            if (!dateSet.has(endDay)) continue;
            const linked = sessionsByReq.get(String(r.id)) || [];
            const cat = categoryList.find(c => c.id === r.category_fk);
            for (const s of linked) {
                if (!s.started_at) continue;
                const startDay = toLocaleDateString(s.started_at, timezone);
                if (startDay === endDay) continue;           // single-day session — skip
                if (startDay > endDay) continue;             // nonsensical — skip

                // Datacard payload — shared by the vertical start bar's tooltip
                // and the end-day bubble's tooltip.
                const sKey = String(s.id);
                const canonicalStart = canonicalStartById?.get(sKey) ?? s.started_at;
                const swarmStartId  = swarmStartIdById?.get(sKey) ?? null;
                const swarmStartRow = swarmStartById?.get(sKey) ?? null;
                const card = {
                    id: r.id,
                    title: r.title || '',
                    categoryName: cat?.category_name || null,
                    color: cat?.color || null,
                    requirement_status: r.requirement_status || null,
                    coordination_type: r.coordination_type || null,
                    completed_at: r.completed_at,
                    timezone,
                    session: s,
                    swarmStartId,
                    swarmStart: swarmStartRow,
                };
                // Shared fields BeadRow uses to seat the ghost lane occupant:
                // groupKey clusters it with its swarm-start mates; completedAt
                // (the end-day closure) orders it within that cluster.
                const occupant = {
                    sessionId: s.id,
                    groupKey: canonicalStart || '',
                    completedAt: r.completed_at,
                    card,
                };

                // Start day entry — partial dashed line from startPct → 100%,
                // plus a vertical start bar at startPct with a tooltip.
                // Use the cluster's canonical started_at (req #2341) so cross-day
                // cluster members share the same X on the start day.
                if (dateSet.has(startDay)) {
                    const startPct = bead36hXPct(canonicalStart, timezone, startDay);
                    if (startPct !== null) {
                        const arr = map.get(startDay) || [];
                        arr.push({ ...occupant, role: 'start', pct: startPct });
                        map.set(startDay, arr);
                    }
                }

                // Middle days — full-width pass-through
                let cursor = shiftDateStr(startDay, 1);
                while (cursor < endDay && dateSet.has(cursor)) {
                    const arr = map.get(cursor) || [];
                    arr.push({ ...occupant, role: 'middle' });
                    map.set(cursor, arr);
                    cursor = shiftDateStr(cursor, 1);
                }
                // End day — bubble + in-row clamped line handle it.
            }
        }
        return map;
    }, [isWeekView, vizKey, rowDates, requirements, sessions, timezone,
        categoryList, canonicalStartById, swarmStartIdById, swarmStartById]);

    return (
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
                    sessions={sessions}
                    timezone={timezone}
                    beadWindow={beadWindow}
                    vizKey={vizKey}
                    dataKey={dataKey}
                    titlesOn={titlesOn}
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
                    requirementById={requirementById}
                />
            ) : sidewalkOn && !isWeekView ? (
                <Sidewalk
                    centerDate={selectedDate}
                    onCenterDateChange={onCenterDateChange || (() => {})}
                    requirements={requirements}
                    sessions={sessions}
                    timezone={timezone}
                    beadWindow={beadWindow}
                    vizKey={vizKey}
                    dataKey={dataKey}
                    titlesOn={titlesOn}
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
                    requirementById={requirementById}
                />
            ) : (
                <>
                    {/* req #2744 — Week stack: one shared time axis above the 7
                        rows (sticky to the top) instead of a per-row axis. Day
                        view keeps its own per-row axis (hideTimeline stays off). */}
                    {isWeekView && <SharedTimeline variant="week" ticks={weekTicks} />}
                    <Box className={`ts-rows ${isWeekView ? 'ts-rows-week' : ''}`}>
                    {rowDates.map(d => (
                        <BeadRow
                            key={d}
                            requirements={requirements}
                            sessions={sessions}
                            selectedDate={d}
                            timezone={timezone}
                            beadWindow={beadWindow}
                            vizKey={vizKey}
                            dataKey={dataKey}
                            titlesOn={titlesOn}
                            tooltipFontSize={tooltipFontSize}
                            circleDiameter={circleDiameter}
                            spaceKey={spaceKey}
                            zoomKey={zoomKey}
                            categoryList={categoryList}
                            isWeekView={isWeekView}
                            hideTimeline={isWeekView}
                            crossDays={crossDayMap.get(d) || []}
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
                            requirementById={requirementById}
                        />
                    ))}
                    </Box>
                </>
            )}
        </Box>
    );
};

export default TimeSeriesView;
