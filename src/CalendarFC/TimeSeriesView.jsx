import React, { useMemo, useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { toLocaleDateString, getTimeOfDayFraction, formatCardDateTime, formatHM12 } from '../utils/dateFormat';
import {
    DEFAULT_FONT_SIZE,
    getFontSize, getCircleSize, formatCoordination,
    DEFAULT_VIZ,
    DEFAULT_SPACE, getSpaceMultiplier,
    DEFAULT_ZOOM, getZoomHours, ZOOM_HOURS,
    indexSessionsByRequirement,
    clusterSessionsByStartTime,
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
const MAX_ROWS = 24;
const assignRows = (chips, minGapPct) => {
    const sorted = [...chips].sort((a, b) => a.leftPct - b.leftPct);
    const out = [];
    let stackRow = -1;
    let lastPct = -Infinity;
    for (const chip of sorted) {
        const isCluster = chip.leftPct - lastPct < minGapPct;
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
//   • 'clamped'                 → null (tick skipped; horizontal dashed line conveys it).
//   • 'left'                    → one gap left of bubble center (no duration line
//                                  is drawn in this mode — the bar IS the visual).
//   • 'normal', startPct valid  → at startPct. A duration line is drawn from
//                                  startPct to the bubble; the bar MUST coincide
//                                  with the line's left end or the visualization
//                                  lies (req #2399: bar was incorrectly bubble-
//                                  hugged when aligned-cluster gap was < 1.5%,
//                                  leaving the duration line dangling past it).
//                                  The non-aligned close-start case is handled
//                                  upstream in drawChips by switching markerMode
//                                  to 'left', so this branch never needs a
//                                  bubble-hug fallback of its own.
//   • 'normal', startPct null    → null (no session start to mark).
//   • unknown markerMode         → null.
// Exported for unit-test coverage.
export const swarmStartBarX = (markerMode, leftPct, startPct, gapPx) => {
    if (markerMode === 'clamped') return null;
    if (markerMode === 'left') return `calc(${leftPct}% - ${gapPx}px)`;
    if (markerMode === 'normal' && startPct !== null && startPct !== undefined) {
        return `${startPct}%`;
    }
    return null;
};

// ─────────── Swarm-lane layout (Swarm mode) ───────────────────────────────────
// Each (requirement, session) pair — or bare requirement with no session — gets
// its own row. Sorted by completed_at ascending so row 0 = earliest (bottom) and
// the highest row = latest (top). Long-running swarms bubble toward the top.
// Exported for unit-test coverage.
export const assignSwarmLanes = (chips) => {
    const sorted = [...chips].sort((a, b) => {
        const aT = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bT = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        if (aT !== bT) return aT - bT;
        // tiebreak: stable by chipKey / id for deterministic ordering
        return String(a.chipKey || a.id).localeCompare(String(b.chipKey || b.id));
    });
    return sorted.map((chip, idx) => ({ ...chip, row: idx }));
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

// Unified window-aware positioning. Anchors on noon of selectedDate in user tz.
// baseHours    — total horizontal span (0..100% across it). Use ZOOM_HOURS[zoom]['36h'].
// visibleHours — only chips whose offset from noon is ≤ visibleHours/2 render;
//                anything outside is returned null (rendered beyond the band).
//
// All zoom levels position the same chips at the same % within their base
// window, so switching 24h ↔ 36h never moves a chip — the 24h view just
// rejects anything that falls in the hidden outer bands.
const positionFor = (completedAt, timezone, selectedDate, baseHours, visibleHours) => {
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
                {formatDayLabel(l.dateStr, timezone)}
                {l.isSelected && inlineCount !== null && (
                    <span className="ts-bead-day-count-inline" data-testid="ts-bead-day-count-inline">
                        {inlineCount}
                    </span>
                )}
            </span>
        ))}
    </Box>
);

// ─────────── Per-day bead row (reusable — 1 instance for day, 7 for week) ─────
const BeadRow = ({
    requirements, sessions, categoryList, selectedDate, timezone,
    beadWindow, vizKey, tooltipFontSize, circleDiameter, spaceKey = 1,
    zoomKey = DEFAULT_ZOOM,
    crossDays = [], onChipClick, isWeekView = false,
    sidewalkPanel = false,   // when true → top-down layout + seamless 24h panel
    sidewalkHeight,
    canonicalStartById,      // Map<string sessionId, ISO started_at> — swarm alignment
    clusterSizeById,         // Map<string sessionId, n members in its cluster>
}) => {
    const window36h = beadWindow === '36h';
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
    //   Sidewalk     — top-down flow: date + x-axis at top, bubbles stream down.
    // bubbleOffset is the CSS bottom for row 0 in bottom-up layouts. For the
    // top-down sidewalk layout we use topHeader instead (pixels from TOP).
    const LAYOUT_DAY      = { bubbleOffset: 86, baseHeight: 172 };
    const LAYOUT_WEEK     = { bubbleOffset: 68, baseHeight: 116 };
    // Sidewalk: chrome (date + time axis) pinned at the top; bubbles stack
    // bottom-up below it. Panel height grows to fit the stack — no false
    // bottom, so days with many bubbles don't overflow the chrome.
    const LAYOUT_SIDEWALK = { bubbleOffset: 20, baseHeight: sidewalkHeight || 400 };
    const { bubbleOffset, baseHeight } =
        sidewalkPanel ? LAYOUT_SIDEWALK
        : isWeekView   ? LAYOUT_WEEK
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
            out.push({
                id: r.id,
                title: r.title || '',
                completed_at: r.completed_at,
                category_fk: r.category_fk,
                requirement_status: r.requirement_status || null,
                coordination_type: r.coordination_type || null,
                categoryName: cat?.category_name || null,
                color: cat?.color || null,
                timeHHMM: formatHM12(r.completed_at, timezone),
                leftPct: xPct,
                timezone,
            });
        }
        return out;
    }, [requirements, categoryList, selectedDate, timezone, xPctFn]);

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
                // Swarm alignment (req #2341): if this session is part of a
                // multi-member cluster, every member uses the cluster's canonical
                // earliest started_at so vertical start-bars line up. Singletons
                // keep their own started_at and the existing 'left' heuristic.
                const sKey = String(s.id);
                const canonicalStartedAt =
                    canonicalStartById?.get(sKey) ?? s.started_at;
                const clusterN = clusterSizeById?.get(sKey) ?? 1;
                const isAligned = clusterN > 1;

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
                });
            }
        }
        return out;
    }, [vizKey, windowChips, sessionsByReq, xPctFn, timezone, selectedDate,
        canonicalStartById, clusterSizeById]);

    // Placement: cluster-stack for Bead, swarm-lane for Swarm.
    const placed = vizKey === 'swarm' ? assignSwarmLanes(drawChips) : assignRows(drawChips, 1.2);
    const maxStackRow = placed.length ? Math.max(...placed.map(c => c.row)) : 0;

    // Space multiplier (Day view only — Week stays tight so 7 rows still fit).
    const spaceMul = isWeekView ? 1 : getSpaceMultiplier(spaceKey);
    const rowSpacing = Math.max(16, Math.round((circleDiameter + 4) * spaceMul));

    // Vertical height — must clear the top chrome by at least half a bubble so
    // the tallest bubble never crowds the date / time-axis header. Same formula
    // for every layout; only the chrome-bottom offset changes:
    //   Day      → 46 (date band at top 26 + height 20)
    //   Week     → 26 (no date chrome above the row)
    //   Sidewalk → 80 (wire at CSS top: 68 after whitespace expansion for
    //                   req #2331/#2364, plus breathing room before bubbles).
    // Panel uniformity in the Sidewalk strip is handled by the parent, which
    // passes a precomputed `sidewalkHeight` sized to the busiest day's lanes.
    const chromeBottom  = sidewalkPanel ? 80 : (isWeekView ? 26 : 46);
    const dateClearance = Math.ceil(circleDiameter / 2) + 4;
    const height = Math.max(baseHeight,
                            maxStackRow * rowSpacing + bubbleOffset + circleDiameter
                            + chromeBottom + dateClearance);

    // Unified bottom-anchored bubble positioning — earliest met (row 0) always at
    // the bottom, latest at the top, in Day/Week and Sidewalk alike.
    const bubbleYCss      = (row) => ({ bottom: `${row * rowSpacing + bubbleOffset}px` });
    const bubbleCenterCss = (row) =>
        `calc(100% - ${row * rowSpacing + bubbleOffset + circleDiameter / 2}px)`;

    const nowPct = useMemo(() => {
        const now = new Date().toISOString();
        return xPctFn(now, timezone, selectedDate);
    }, [timezone, selectedDate, xPctFn]);

    return (
        <Box className={`ts-bead ts-bead-${window36h ? '36h' : '24h'} ts-bead-${isWeekView ? 'week' : 'day'} ${sidewalkPanel ? 'ts-bead-sidewalk' : ''}`}
             data-testid="ts-bead"
             data-date={selectedDate}
             style={{ height: `${height}px` }}>

            <DayLabels
                labels={dayLabels}
                timezone={timezone}
                inlineCount={sidewalkPanel ? windowChips.length : null}
            />

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
            <BeadTimeline ticks={ticks} />

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
                    {/* Cross-day (multi-day) pass-through lines. Y lane matches the
                        end-day's bubble lane (computed at parent) so the dashed line
                        on intermediate days lands at the SAME Y as the bubble it leads
                        to. Each 'start' entry also carries a vertical start bar with
                        a datacard tooltip — gives starts without a same-day bubble
                        the same context the met bubble provides. */}
                    {crossDays.map((cd, i) => {
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
                                            {card.session && (
                                                <div className="ts-datacard-row">
                                                    <span className="ts-datacard-key">Session</span>
                                                    <span>#{card.session.id} · {card.session.swarm_status || '—'}</span>
                                                </div>
                                            )}
                                        </Box>
                                    ) : ''}
                                >
                                    <g data-testid={`ts-swarm-start-xd-${cd.sessionId}`}>
                                        {/* dashed horizontal tail from start to right edge */}
                                        <line {...hLine} x1={`${cd.pct}%`} x2="100%" />
                                        {/* solid vertical start bar at startPct */}
                                        <line
                                            className="ts-swarm-start-tick ts-swarm-start-tick-xstart"
                                            stroke="rgba(96,125,139,0.85)" strokeWidth="2" strokeLinecap="round"
                                            x1={`${cd.pct}%`} x2={`${cd.pct}%`}
                                            y1={yTop} y2={yBot}
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

                    {/* Horizontal line — only for 'normal' and 'clamped'. Line y is the
                        bubble CENTER (bubbleBottom + radius) so the arrowhead lands
                        on the middle of the circle, not its bottom. */}
                    {placed.map(chip => {
                        if (chip.markerMode !== 'normal' && chip.markerMode !== 'clamped') return null;
                        const yCenter = bubbleCenterCss(chip.row);
                        // Omit the arrowhead when the line would be shorter than
                        // the arrow itself — happens for cluster-aligned chips
                        // whose canonical start sits close to the met bubble.
                        const gapPct = chip.leftPct - chip.startPct;
                        const showArrow = gapPct >= ARROW_OMIT_THRESHOLD_PCT;
                        return (
                            <line
                                key={`line-${chip.chipKey}`}
                                data-testid={`ts-swarm-line-${chip.chipKey}`}
                                className={`ts-swarm-line ${chip.markerMode === 'clamped' ? 'ts-swarm-line-clamped' : ''}`}
                                x1={`${chip.startPct}%`}
                                y1={yCenter}
                                x2={`calc(${chip.leftPct}% - ${circleDiameter / 2 + 2}px)`}
                                y2={yCenter}
                                stroke="rgba(96,125,139,0.85)"
                                strokeWidth="1.5"
                                markerEnd={showArrow ? `url(#ts-swarm-arrow-${selectedDate})` : undefined}
                            />
                        );
                    })}
                    {/* Vertical start bar — position depends on markerMode:
                        'normal'  → at startPct (coincides with the left end of the
                                    duration line; req #2399 retired the close-gap
                                    bubble-hug shortcut that dangled the line past
                                    the bar for aligned-cluster members)
                        'left'    → immediately left of bubble (no session OR start ≈ met
                                    on a non-aligned chip — no duration line drawn)
                        'clamped' → skipped (horizontal dashed line already conveys it) */}
                    {placed.map(chip => {
                        const halfBar = Math.max(6, circleDiameter / 2);
                        const y1 = `calc(100% - ${chip.row * rowSpacing + bubbleOffset + circleDiameter / 2 - halfBar}px)`;
                        const y2 = `calc(100% - ${chip.row * rowSpacing + bubbleOffset + circleDiameter / 2 + halfBar}px)`;
                        const gap = circleDiameter / 2 + 3;
                        const x = swarmStartBarX(chip.markerMode, chip.leftPct, chip.startPct, gap);
                        if (x === null) return null;
                        return (
                            <line
                                key={`tick-${chip.chipKey}`}
                                data-testid={`ts-swarm-start-${chip.chipKey}`}
                                className={`ts-swarm-start-tick ts-swarm-start-tick-${chip.markerMode}`}
                                x1={x} y1={y1}
                                x2={x} y2={y2}
                                stroke="rgba(96,125,139,0.85)"
                                strokeWidth="2"
                                strokeLinecap="round"
                            />
                        );
                    })}
                </svg>
            )}

            {placed.map(chip => (
                <Tooltip
                    key={chip.chipKey || chip.id}
                    arrow
                    slotProps={{
                        tooltip: { sx: { fontSize: tooltipFontSize, maxWidth: 360, p: 1.25 } },
                    }}
                    title={
                        <Box className="ts-datacard" data-testid={`ts-datacard-${chip.chipKey || chip.id}`}>
                            <div className="ts-datacard-title">#{chip.id} {chip.title}</div>
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
                            <div className="ts-datacard-row">
                                <span className="ts-datacard-key">Closed</span>
                                <span>{formatCardDateTime(chip.completed_at, chip.timezone)}</span>
                            </div>
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
                        className="ts-bead-group"
                        data-testid={`ts-chip-${chip.chipKey || chip.id}`}
                        data-reqid={chip.id}
                        style={{
                            left: `${chip.leftPct}%`,
                            ...bubbleYCss(chip.row),
                        }}
                        onClick={() => onChipClick && onChipClick(chip.id)}
                    >
                        <span
                            className="ts-bead-dot"
                            data-testid={`ts-bead-dot-${chip.chipKey || chip.id}`}
                            style={{
                                backgroundColor: chip.color || '#90a4ae',
                                width:  `${circleDiameter}px`,
                                height: `${circleDiameter}px`,
                            }}
                        />
                    </Box>
                </Tooltip>
            ))}

            {/* Count bubble — muted-green pill with just the number of requirements met. */}
            <Box className="ts-bead-count" data-testid="ts-bead-count"
                 title={`${windowChips.length} requirements met on ${formatDayLabel(selectedDate, timezone)}`}>
                <Typography variant="caption">
                    {windowChips.length}
                </Typography>
            </Box>
        </Box>
    );
};

// ─────────── Sidewalk — transform-based pure-drag horizontal scroller ─────────
// The outer frame is fixed (width: 100%, overflow: hidden). The inner flex strip
// contains 21 day panels (centered on centerDate), each exactly one frame wide.
// Dragging the inner strip horizontally changes its translateX; release applies
// a momentum decay then snaps to the nearest panel. No native scrollbar — the
// user is pushing content around, not a thumb.
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
    const [frameWidth, setFrameWidth] = React.useState(0);

    // Uniform panel height — sized to the busiest day in the visible strip so
    // every panel shows all its lanes below the top chrome. Mirrors BeadRow's
    // height formula (sidewalk branch: chromeBottom=50, bubbleOffset=20).
    // Single-pass bucket via indexChipsByDate so 21-day strips stay O(R+S+D)
    // instead of O(D × (R+S)) — matters during scroll, when requirements
    // refetches churn this memo.
    const sidewalkHeight = useMemo(() => {
        const BASE_HEIGHT   = 400;
        const bubbleOffset  = 20;
        const chromeBottom  = 80;   // matches BeadRow's sidewalk chromeBottom (wire top:68 + padding)
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
            maxStackRow * rowSpacing + bubbleOffset + circleDiameter + chromeBottom + dateClearance,
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
        if (Math.abs(delta) < 1) { applyOffset(target); return; }
        const duration = Math.min(450, 180 + Math.abs(delta) * 0.4);
        const t0 = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - t0) / duration);
            const eased = 1 - (1 - t) ** 3;   // ease-out cubic
            applyOffset(start + delta * eased);
            if (t < 1) rafRef.current = requestAnimationFrame(step);
            else { rafRef.current = null; reportCenterIfChanged(); }
        };
        rafRef.current = requestAnimationFrame(step);
    };

    const indexForOffset = () => {
        if (frameWidth === 0) return 0;
        const raw = -offsetRef.current / frameWidth;
        return Math.max(0, Math.min(dates.length - 1, Math.round(raw)));
    };

    // Trailing-debounce onCenterDateChange so a scroll sweep through N panels
    // doesn't fire N setCalendarView → requirements refetch → re-render cycles.
    // lastReported updates synchronously so the centerDate useEffect's
    // re-entrance guard still works when the debounced callback finally flushes.
    const REPORT_DEBOUNCE_MS = 150;
    const reportCenterIfChanged = () => {
        const d = dates[indexForOffset()];
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
        const idx = dates.indexOf(centerDate);
        if (idx < 0) {
            // Rebuild strip around the new centerDate and snap to its center.
            const rebuilt = centeredDateRange(centerDate, 10);
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
        const idx = dates.indexOf(centerDate);
        if (idx >= 0) applyOffset(-idx * frameWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frameWidth]);

    // Drag + momentum. Bind once per frameWidth so closures see a stable width.
    React.useEffect(() => {
        const frame = frameRef.current;
        if (!frame || frameWidth === 0) return;
        let isDown = false;
        let startPageX = 0;
        let startOffset = 0;
        let lastPageX = 0;
        let lastT = 0;

        // Clamp offset to the strip bounds so wheel/drag past either edge can't
        // walk every panel off-screen and leave the viewport blank (day-0 bug,
        // exposed once bubbles became tall enough to be worth chasing past the
        // 21st day). True infinite scroll is tracked by req #2396.
        const minOffset = -(dates.length - 1) * frameWidth;
        const clampOffset = (x) => Math.max(minOffset, Math.min(0, x));

        const onDown = (e) => {
            if (e.button !== 0) return;
            isDown = true;
            hasDragged.current = false;
            startPageX = e.pageX;
            startOffset = offsetRef.current;
            lastPageX = e.pageX;
            lastT = performance.now();
            velocityRef.current = 0;
            stopAnim();
            frame.style.cursor = 'grabbing';
            e.preventDefault();
        };
        const onMove = (e) => {
            if (!isDown) return;
            const dx = e.pageX - startPageX;
            if (Math.abs(dx) > 4) hasDragged.current = true;
            applyOffset(clampOffset(startOffset + dx));
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
                const raw = offsetRef.current + velocityRef.current;
                const clamped = clampOffset(raw);
                applyOffset(clamped);
                if (clamped !== raw) {
                    // Hit a wall — kill momentum so we don't spin frames applying no-op offsets.
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
            applyOffset(clampOffset(offsetRef.current - dxRaw));
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
    }, [frameWidth, dates.length]);

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

// ─────────── Top-level TimeSeriesView ──────────────────────────────────────────
const TimeSeriesView = ({
    requirements = [],
    sessions = [],
    selectedDate,
    timezone,
    beadWindow = '24h',
    vizKey = DEFAULT_VIZ,
    sidewalkOn = false,
    isWeekView = false,
    categoryList = [],
    onChipClick,
    onCenterDateChange,
}) => {
    // The UI Options amber bar was removed 2026-04-18 — Viz and Sidewalk
    // were promoted to the toolbar, and the remaining controls have landed
    // on good defaults that ship as-is.
    const fontSizeKey  = DEFAULT_FONT_SIZE;
    const spaceKey     = DEFAULT_SPACE;
    const zoomKey      = DEFAULT_ZOOM;
    const circleSizeKey = sidewalkOn
        ? 1                                              // Sidewalk always uses size 1
        : (isWeekView ? 1 : (vizKey === 'swarm' ? 1 : 3));
    const tooltipFontSize = getFontSize(fontSizeKey);
    const circleDiameter  = getCircleSize(circleSizeKey);

    // Week view: 7 dates Mon..Sun rendered top=earliest → bottom=Sunday.
    // Stack always ends at Sunday (ISO week convention).
    const rowDates = useMemo(() => {
        if (!isWeekView) return [selectedDate];
        return weekDates(selectedDate); // Mon..Sun ascending
    }, [isWeekView, selectedDate]);

    // Swarm start-time clustering (req #2341) — computed once per session-array
    // change and threaded to every BeadRow / cross-day calculation so all members
    // of a 3-minute launch cluster share one canonical start X.
    const { canonicalStartById, clusterSizeById } = useMemo(() => {
        const { canonical, clusterSize } = clusterSessionsByStartTime(sessions);
        return { canonicalStartById: canonical, clusterSizeById: clusterSize };
    }, [sessions]);

    // Cross-day session lines — only matters in Week + Swarm mode. For each
    // session whose started_at and linked requirement's completed_at fall on
    // different days within the visible week, build a per-day entry so BeadRow
    // can draw a dashed "in-flight" line at the session's lane Y.
    //
    // Each entry also carries the chip datacard payload (reqId, title,
    // category, status, coordination, session info) so BeadRow can wrap the
    // vertical start bar in a tooltip matching the bubble's datacard.
    //
    // Lane alignment — each cross-day entry uses the row the session's chip
    // will actually occupy on its end day (computed via assignSwarmLanes per
    // day). That way the dashed line on prior days lands at the SAME Y as
    // the bubble on the end day.
    const crossDayMap = useMemo(() => {
        const map = new Map(); // date → [{ sessionId, role, lane, pct?, card? }]
        if (!isWeekView || vizKey !== 'swarm' || !rowDates.length) return map;
        const dateSet = new Set(rowDates);
        const sessionsByReq = indexSessionsByRequirement(sessions);

        // Build the same swarm chip list BeadRow will build for each day, then
        // run assignSwarmLanes to find each chip's row. Lets us look up
        // `endDayLane(reqId, sessionId)` → row.
        const dayLaneMap = new Map(); // date → Map(chipKey → row)
        for (const d of rowDates) {
            const chips = [];
            for (const r of requirements) {
                if (!r.completed_at) continue;
                if (toLocaleDateString(r.completed_at, timezone) !== d) continue;
                const linked = sessionsByReq.get(String(r.id)) || [];
                if (linked.length === 0) {
                    chips.push({ chipKey: String(r.id), id: r.id, completed_at: r.completed_at });
                    continue;
                }
                for (const s of linked) {
                    chips.push({ chipKey: `${r.id}-s${s.id}`, id: r.id, completed_at: r.completed_at });
                }
            }
            const placed = assignSwarmLanes(chips);
            const m = new Map();
            for (const c of placed) m.set(c.chipKey, c.row);
            dayLaneMap.set(d, m);
        }

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

                const chipKey = `${r.id}-s${s.id}`;
                const endLane = dayLaneMap.get(endDay)?.get(chipKey) ?? 0;

                // Datacard payload — shared by the vertical start bar's tooltip
                // and the end-day bubble's tooltip.
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
                };

                // Start day entry — partial dashed line from startPct → 100%,
                // plus a vertical start bar at startPct with a tooltip.
                // Use the cluster's canonical started_at (req #2341) so cross-day
                // cluster members share the same X on the start day.
                if (dateSet.has(startDay)) {
                    const canonicalStart =
                        canonicalStartById.get(String(s.id)) ?? s.started_at;
                    const startPct = bead36hXPct(canonicalStart, timezone, startDay);
                    if (startPct !== null) {
                        const arr = map.get(startDay) || [];
                        arr.push({ sessionId: s.id, role: 'start', lane: endLane, pct: startPct, card });
                        map.set(startDay, arr);
                    }
                }

                // Middle days — full-width pass-through
                let cursor = shiftDateStr(startDay, 1);
                while (cursor < endDay && dateSet.has(cursor)) {
                    const arr = map.get(cursor) || [];
                    arr.push({ sessionId: s.id, role: 'middle', lane: endLane });
                    map.set(cursor, arr);
                    cursor = shiftDateStr(cursor, 1);
                }
                // End day — bubble + in-row clamped line handle it.
            }
        }
        return map;
    }, [isWeekView, vizKey, rowDates, requirements, sessions, timezone,
        categoryList, canonicalStartById]);

    return (
        <Box className="ts-view" data-testid="time-series-view" data-week={isWeekView ? '1' : '0'}>
            {/* Rows — one BeadRow for day/month, seven stacked for week, OR a
                horizontally-scrolling Sidewalk for Day + sidewalkOn. */}
            {sidewalkOn && !isWeekView ? (
                <Sidewalk
                    centerDate={selectedDate}
                    onCenterDateChange={onCenterDateChange || (() => {})}
                    requirements={requirements}
                    sessions={sessions}
                    timezone={timezone}
                    beadWindow={beadWindow}
                    vizKey={vizKey}
                    tooltipFontSize={tooltipFontSize}
                    circleDiameter={circleDiameter}
                    spaceKey={spaceKey}
                    zoomKey={zoomKey}
                    categoryList={categoryList}
                    isWeekView={false}
                    onChipClick={onChipClick}
                    canonicalStartById={canonicalStartById}
                    clusterSizeById={clusterSizeById}
                />
            ) : (
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
                            tooltipFontSize={tooltipFontSize}
                            circleDiameter={circleDiameter}
                            spaceKey={spaceKey}
                            zoomKey={zoomKey}
                            categoryList={categoryList}
                            isWeekView={isWeekView}
                            crossDays={crossDayMap.get(d) || []}
                            onChipClick={onChipClick}
                            canonicalStartById={canonicalStartById}
                            clusterSizeById={clusterSizeById}
                        />
                    ))}
                </Box>
            )}
        </Box>
    );
};

export default TimeSeriesView;
