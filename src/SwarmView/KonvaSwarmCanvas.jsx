// KonvaSwarmCanvas.jsx — Konva render layer for the swarm visualizer (req #2841).
//
// A 2D zoomable / pannable grid: X = clock-time within a day (0..36h), Y = days
// stacked as aligned rows (today centered). Continuous wheel/pinch zoom (centered
// on the cursor) and drag-pan are supplied by the d3-zoom BEHAVIOR — it computes
// the {x, y, k} transform and draws nothing; we apply that transform to a single
// Konva <Group>. The zoom scale drives SEMANTIC zoom: the level-of-detail (out →
// density dots, mid → DURATION TRACKS + beads + cross-day, in → per-phase track
// segments) changes with depth, not just the pixel scale.
//
// The DURATION TRACK (swarm start → completion) is the primary glyph — the swarm
// visualizer is about how long work takes, where the time went (phases), and how
// spans flow across days; the bead is just the completion terminus. The world
// LAYOUT (row tops, lane positions, heights) is k-independent so zoom is a pure
// transform and rows never reflow; only GLYPH sizes counter-scale by 1/k so beads
// and labels keep a constant on-screen size at any zoom.
//
// Glyph vocabulary carried over from the SVG design: a vertical START TICK +
// anchor dot (green real / red estimated) that stacks into a grouping bar for a
// multi-session swarm-start; a rounded-stone TOMBSTONE with an etched cross for
// undos; a ✓ / ! / ⚑ completion badge. A single shared top axis labels the clock.
//
// Konva's hit-graph gives per-glyph hover/click for free — a single HTML datacard
// overlay follows the pointer instead of 600+ MUI tooltips. All geometry comes
// from the shared pure helpers via konvaSwarmModel.

import React, {
    useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback,
} from 'react';
import { Stage, Layer, Group, Rect, Circle, Line, Text, Path } from 'react-konva';
import { useTheme } from '@mui/material/styles';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';

import { localDateStr } from '../utils/dateFormat';
import {
    formatCoordination, PHASE_UNCLASSIFIED_COLOR,
} from '../CalendarFC/timeSeriesSizes';
import { sessionTokenCost, formatTokens } from './sessionPhases';
import { computeDayHeaders } from './dayHeaderLayout';
import { laneParityFor } from '../CalendarFC/swarmGeometry';
import {
    dateRange, semanticLevel,
    buildModelContext, buildDayModel, phaseBarSegments,
    recenterDecision,
} from './konvaSwarmModel';
import '../CalendarFC/swarmVisualizer.css';

// ── World-space layout constants (k-independent; d3-zoom scales these) ─────────
const LEFTPAD  = 14;
const RIGHTPAD = 14;
const AXIS_W   = 1320;
const WORLD_W  = LEFTPAD + AXIS_W + RIGHTPAD;
const CHROME_TOP = 26;  // per-row top band (date label + wire) before lane 0
const LANE_H   = 30;
const ROW_MIN  = 70;
const ROW_PAD  = 18;

// Per-row time windows. The plain day is midnight→midnight (24h). The 36h
// noon-centered window ([-6h, +30h]) shows the prior evening (6pm→midnight) on
// the left and the next morning (midnight→6am) on the right, like the old
// day/36h view. The 36h window applies to MID zoom only (toggled by the 36h
// button); Overview and Detail always use the plain 24h day.
const WIN24 = { start: 0, end: 24 };
const WIN36 = { start: -6, end: 30 };
// 6-hour ticks spanning a window, e.g. WIN24 → [0,6,12,18,24], WIN36 → [-6..30].
const ticksForWin = (win) => {
    const out = [];
    for (let h = win.start; h <= win.end + 0.001; h += 6) out.push(h);
    return out;
};

// On-screen target sizes (px) — divided by k at draw time so they stay constant.
const BEAD_R_S  = 9;    // bead radius (−25% per req #2847; was 12)
const DOT_R_S   = 3.2;
const TRACK_W_S = 4;
const FONT_TITLE_S = 13.75;  // +25% per round-3 feedback
const AXIS_H = 22;      // shared top time-axis bar height
const HEADER_H = 22;    // sticky per-day date/count header height

const REAL_GREEN = '#43A047';
const EST_RED    = '#E53935';

// Dev-server port pill (req #2857). Colour-matched to the per-day "requirements
// met" count badge beside each date header so the two green pills read as one
// family. Dark-mode aware: { fill, edge, fg } mirror that badge's
// background / border / text exactly (see the day-header span below).
const DEVSERV_PALETTE = (dark) => (dark
    ? { fill: '#2e3b2e', edge: '#4a7a4a', fg: '#81c784' }   // dark badge
    : { fill: '#6fa86f', edge: '#ffffff', fg: '#ffffff' }); // light badge (white text/edge for lift)

// Cost-sizing (req #2846). When the "Cost" toggle is on, each bead's radius is
// scaled by its session token cost relative to the most-expensive session in the
// fetched window: radius ∝ √(cost / maxCost) so VISUAL AREA ≈ cost. The √ is then
// mapped onto [COST_MIN_MULT, COST_MAX_MULT] so the cheapest work still reads as a
// small-but-visible bead and the priciest pops without swamping the row.
const COST_MIN_MULT = 0.55;
const COST_MAX_MULT = 2.4;

const hourLabel = (h) => {
    const hod = ((h % 24) + 24) % 24;
    if (hod === 0) return '12a';
    if (hod === 12) return '12p';
    return hod < 12 ? `${hod}a` : `${hod - 12}p`;
};

const xWorld = (pct) => LEFTPAD + (pct / 100) * AXIS_W;
const beadFill = (chip) => chip.color || '#9E9E9E';

// Which row (date) sits at world-Y `y` — used to re-anchor the view on the day at
// the viewport center when the time window toggles (so 36h on/off doesn't jump).
const dateAtWorldY = (rows, y) => {
    for (const r of rows) if (y >= r.top && y < r.top + r.height) return r.date;
    return null;
};

// Popup datetime — "Mon Day @ h:mma" with NO year and NO weekday (req feedback).
// Parses MySQL UTC ("YYYY-MM-DD HH:MM:SS") and ISO strings the same way as
// utils/dateFormat's toDate.
const parseTs = (s) => {
    if (!s) return null;
    if (typeof s === 'string' && s.includes(' ') && !s.includes('T')) return new Date(s.replace(' ', 'T') + 'Z');
    return new Date(s);
};
const fmtDT = (s, tz) => {
    const d = parseTs(s);
    if (!d || isNaN(d.getTime())) return '—';
    const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(tz && { timeZone: tz }) });
    const p = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...(tz && { timeZone: tz }) }).formatToParts(d);
    const g = (type) => p.find(x => x.type === type)?.value || '';
    return `${datePart} @ ${g('hour')}:${g('minute')}${g('dayPeriod').toLowerCase()}`;
};

// Duration span → drawable segments (in world x).
function durationSegments(chip, usePhases) {
    const endX = xWorld(chip.leftPct);
    let startX;
    if (chip.markerMode === 'left') return [];
    if (chip.startClamped || chip.startPct == null) startX = xWorld(0);
    else startX = xWorld(chip.startPct);
    if (Math.abs(endX - startX) < 0.5) return [];
    const dashed = chip.startClamped || chip.markerMode === 'inprogress';
    if (usePhases) {
        // computePhaseSegments proportionally splits the [startX, endX] range it's
        // GIVEN, so passing world-X in means x1Pct/x2Pct come back as world-X too
        // (the "Pct" suffix is a misnomer inherited from the shared helper).
        const { classified, segments } = phaseBarSegments(chip, startX, endX);
        if (classified && segments.length) {
            return segments.map(s => ({ x1: s.x1Pct, x2: s.x2Pct, color: s.color, dashed: false }));
        }
        return [{ x1: startX, x2: endX, color: PHASE_UNCLASSIFIED_COLOR, dashed }];
    }
    return [{ x1: startX, x2: endX, color: beadFill(chip), dashed }];
}

const KonvaSwarmCanvas = ({
    requirements, allRequirements, sessions,
    swarmStarts, swarmStartSessions, swarmUndos,
    swarmCompletes, swarmCompleteSessions, devServers,
    selectedDate, timezone, categoryList,
    rangeStart, rangeEnd, dataKey = 'category',
    titlesOn = false, completesOn = false, phasesOn = false,
    costOn = false, devServersOn = true, wide36 = true, resetTick = 0,
    onChipClick, onSwarmStartClick, onUndoClick, onCompleteClick,
    onExtendPast,
}) => {
    const theme = useTheme();
    const dark = theme.palette.mode === 'dark';
    const C = useMemo(() => ({
        bg:        theme.palette.background.default,
        text:      theme.palette.text.primary,
        textDim:   theme.palette.text.secondary,
        wire:      theme.palette.divider,
        gridMajor: dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
        gridMinor: dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
        // Alternating day shades so each day reads as its own band (req feedback).
        dayEven:   dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
        dayOdd:    dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
        selected:  dark ? 'rgba(144,202,249,0.12)' : 'rgba(25,118,210,0.08)',
        beadEdge:  theme.palette.background.paper,
        now:       theme.palette.error.main,
        tomb:      dark ? '#9e9e9e' : '#757575',
        axisBg:    dark ? 'rgba(30,30,30,0.92)' : 'rgba(250,250,250,0.94)',
    }), [theme, dark]);

    const containerRef = useRef(null);
    const stageRef = useRef(null);
    const zoomRef = useRef(null);
    const downRef = useRef(null);
    const draggingRef = useRef(false);   // true while a drag-pan gesture is active (cursor → grabbing)
    const userPannedRef = useRef(false); // true once the user has manually panned/zoomed (req #2860)
    const rowsRef = useRef([]);          // live rows for hit-testing in handlers
    const centerDateRef = useRef(null);  // date currently at the viewport center
    const prevWinRef = useRef(null);     // detects a window (36h) toggle
    // req #2859 — scroll-up auto-extend bookkeeping. onExtendPastRef/rangeStartRef
    // keep the d3-zoom handler (which closes over a stale render) reading the live
    // callback + current fetch boundary; extendFiredForRef guards so we fire the
    // extension at most once per loaded boundary (rangeStart), not on every wheel
    // tick while the next window is in flight.
    const onExtendPastRef = useRef(onExtendPast);
    const rangeStartRef = useRef(rangeStart);
    const extendFiredForRef = useRef(null);
    onExtendPastRef.current = onExtendPast;
    rangeStartRef.current = rangeStart;
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [transform, setTransform] = useState(null);
    const [tooltip, setTooltip] = useState(null);

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect;
            if (cr) setSize({ w: Math.round(cr.width), h: Math.round(cr.height) });
        });
        ro.observe(el);
        setSize({ w: el.clientWidth, h: el.clientHeight });
        return () => ro.disconnect();
    }, []);

    // The time window is a single user setting that applies to EVERY zoom level
    // (req feedback) — so zooming never flips the window or redraws the model. It
    // changes only when the 36h toggle flips. `win` is a stable module ref, so the
    // model rebuilds only on that toggle (or a data change), never on a zoom tick.
    const kBase = size.w > 0 ? size.w / WORLD_W : 0.7;
    const curK = transform ? transform.k : kBase;
    const level = semanticLevel(kBase > 0 ? curK / kBase : 1);
    const win = wide36 ? WIN36 : WIN24;
    const winSpan = win.end - win.start;
    const hourToPct = (h) => ((h - win.start) / winSpan) * 100;
    const noonPct = hourToPct(12);
    const hourTicks = useMemo(() => ticksForWin(win), [win]);

    const today = useMemo(() => localDateStr(), []);
    const dates = useMemo(
        () => (rangeStart && rangeEnd ? dateRange(rangeStart, rangeEnd) : []),
        [rangeStart, rangeEnd],
    );

    const ctx = useMemo(() => buildModelContext({
        requirements, allRequirements, sessions, categoryList,
        swarmStarts, swarmStartSessions, swarmUndos,
        swarmCompletes, swarmCompleteSessions,
        timezone, dates, today, win,
    }), [requirements, allRequirements, sessions, categoryList,
        swarmStarts, swarmStartSessions, swarmUndos,
        swarmCompletes, swarmCompleteSessions, timezone, dates, today, win]);

    const rows = useMemo(() => {
        const out = [];
        let top = 0;
        for (const date of dates) {
            const model = buildDayModel(date, ctx, { dataKey });
            const height = Math.max(ROW_MIN, CHROME_TOP + (model.maxRow + 1) * LANE_H + ROW_PAD);
            out.push({ date, top, height, model, parity: laneParityFor(date) });
            top += height;
        }
        // req #2859 — re-anchor the world-Y origin on the NEWEST in-window day so a
        // backward fetch-window extension (scroll-up auto-extend) never shifts the
        // rows the user is looking at. Prepending older days — or those older days
        // growing as their async data lands — increases every accumulated `top`,
        // including the anchor's, by the same amount; subtracting the anchor's top
        // cancels that out for every existing row (older rows just take more
        // negative Y), so the viewport stays put and the canvas doesn't jump. The
        // newest day is always present and is untouched by a past-edge extension,
        // making it the stable reference (today can leave the window on deep nav).
        if (out.length) {
            const anchor = out[out.length - 1].top;
            if (anchor) for (const r of out) r.top -= anchor;
        }
        return out;
    }, [dates, ctx, dataKey]);

    rowsRef.current = rows;
    // World vertical extent. After the newest-day re-anchor (req #2859) the first
    // row's top is negative and the last row's bottom is its own height, so the
    // world spans [rows[0].top, rows[last].bottom]; `worldMidY` is its true center.
    // The "center on worldMidY" branches below are fallbacks for when a target
    // date isn't found in the window (effectively unreachable, since selectedDate /
    // centerDateRef are always in-window) — computing the real midpoint keeps them
    // correct rather than collapsing onto the bottom row.
    const worldTop = rows.length ? rows[0].top : 0;
    const worldBot = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0;
    const worldMidY = (worldTop + worldBot) / 2;

    // Cost-sizing normalization (req #2846). The most-expensive session in the
    // FETCHED window (not just the visible rows) is the reference, so a bead's
    // size is stable while the user pans the canvas — it only re-references when
    // the data window itself changes (a week-boundary crossing). Computed
    // unconditionally (cheap, one pass) but only consumed when `costOn`.
    const maxCost = useMemo(() => {
        let m = 0;
        for (const r of rows) {
            for (const chip of r.model.placed) {
                if (!chip.session) continue;
                const c = sessionTokenCost(chip.session);
                if (c > m) m = c;
            }
        }
        return m;
    }, [rows]);

    // Per-chip radius multiplier. 1 (no scaling) when cost mode is off, the chip
    // has no session, or the window carries no token data. Undone tombstones keep
    // their base size (handled at the call site). cost 0 → COST_MIN_MULT so a
    // token-less session is small-but-present rather than invisible.
    const costMult = useCallback((chip) => {
        if (!costOn || maxCost <= 0 || !chip || !chip.session) return 1;
        const c = sessionTokenCost(chip.session);
        if (c <= 0) return COST_MIN_MULT;
        const norm = Math.sqrt(c / maxCost);   // 0..1, area-proportional
        return COST_MIN_MULT + norm * (COST_MAX_MULT - COST_MIN_MULT);
    }, [costOn, maxCost]);

    const rowTopFor = useCallback((date) => {
        const r = rows.find(rr => rr.date === date);
        return r ? r.top + r.height / 2 : worldMidY;
    }, [rows, worldMidY]);

    // Active dev servers keyed by session id (req #2857). The table holds only
    // currently-claimed servers, so a row's presence == active. If a session
    // somehow has more than one, the highest id (most-recently claimed) wins.
    const devServerBySession = useMemo(() => {
        const m = new Map();
        for (const ds of (devServers || [])) {
            if (!ds || ds.session_fk == null || ds.port == null) continue;
            const k = String(ds.session_fk);
            const prev = m.get(k);
            if (!prev || (ds.id ?? 0) > (prev.id ?? 0)) m.set(k, ds);
        }
        return m;
    }, [devServers]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || size.w === 0) return;
        const sel = select(el);
        const zb = d3zoom()
            .scaleExtent([kBase * 0.25, kBase * 6])
            .filter((ev) => (ev.type === 'wheel' ? true : !ev.button))
            .clickDistance(5)
            .on('zoom', (ev) => {
                const tr = ev.transform;
                setTransform({ x: tr.x, y: tr.y, k: tr.k });
                // A real user gesture (drag/wheel) carries a sourceEvent; a
                // programmatic zb.transform (our centering) does not. Latch the
                // manual-pan flag so a later data-load relayout never yanks the
                // hand-positioned view back to today (req #2860).
                if (ev.sourceEvent) userPannedRef.current = true;
                // Track the day at the viewport center so a window (36h) toggle can
                // re-anchor on it instead of jumping to a different day.
                const d = dateAtWorldY(rowsRef.current, (size.h / 2 - tr.y) / tr.k);
                if (d) centerDateRef.current = d;
                // req #2859 — scroll-up auto-extend. When a DRAG-PAN brings the
                // viewport's top edge within one screenful of the oldest loaded
                // day, ask the view to widen the fetch window backward so panning
                // up never dead-ends. Gated to drag gestures (sourceEvent present
                // and not a wheel) so neither wheel zoom-out — which would race the
                // cap with a burst of refetches — nor the programmatic centering
                // transforms ever trigger it. Pre-fetching a screen early means the
                // new (older) rows are usually populated before they scroll into
                // view. Fire once per loaded boundary: the guard re-arms only when
                // rangeStart actually changes (new data settled), so an in-flight
                // refetch isn't spammed.
                const isDragPan = ev.sourceEvent && ev.sourceEvent.type !== 'wheel';
                const rws = rowsRef.current;
                if (isDragPan && rws.length && onExtendPastRef.current && tr.k > 0) {
                    const yTopWorld = (-tr.y) / tr.k;
                    const topEdge = rws[0].top;
                    const screenWorld = size.h / tr.k;
                    if (yTopWorld <= topEdge + screenWorld &&
                        extendFiredForRef.current !== rangeStartRef.current) {
                        extendFiredForRef.current = rangeStartRef.current;
                        onExtendPastRef.current();
                    }
                }
            })
            // Drag-pan cursor: closed-hand 'grabbing' while a pointer drag is in
            // flight, restored to the open-hand 'grab' on release (req #2853). Wheel
            // zoom (sourceEvent.type === 'wheel') and programmatic transforms
            // (no sourceEvent) must NOT touch the cursor — guarded via draggingRef
            // so they can't clobber a hover 'pointer'.
            .on('start', (ev) => {
                if (!ev.sourceEvent || ev.sourceEvent.type === 'wheel') return;
                draggingRef.current = true;
                const c = stageRef.current?.container();
                if (c) c.style.cursor = 'grabbing';
            })
            .on('end', () => {
                if (!draggingRef.current) return;
                draggingRef.current = false;
                const c = stageRef.current?.container();
                if (c) c.style.cursor = 'grab';
            });
        sel.call(zb);
        sel.on('dblclick.zoom', null);   // don't zoom on double-click (conflicts with click-to-open)
        // Resting cursor over the pannable canvas is the open hand (req #2853).
        const sc = stageRef.current?.container();
        if (sc) sc.style.cursor = 'grab';
        zoomRef.current = zb;
        return () => { sel.on('.zoom', null); };
    }, [size.w, size.h, kBase]);

    // Click-to-open (req feedback: navigation regressed). d3-zoom owns the pointer
    // gesture and can swallow Konva's synthetic click, so we resolve clicks from
    // the DOM 'click' event ourselves: on a non-drag click, hit-test the stage and
    // fire the Konva 'activate' event on the topmost shape (react-konva binds the
    // `onActivate` prop as that event) — beads → requirement, start anchors →
    // swarm-start, completion badges → swarm-complete.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onDown = (e) => { downRef.current = { x: e.clientX, y: e.clientY }; };
        const onClick = (e) => {
            const d = downRef.current;
            if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // was a drag (d3 clickDistance=5)
            const stage = stageRef.current;
            if (!stage) return;
            const rect = el.getBoundingClientRect();
            const node = stage.getIntersection({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            if (node) node.fire('activate', { evt: e }, false);
        };
        el.addEventListener('mousedown', onDown);
        el.addEventListener('click', onClick);
        return () => { el.removeEventListener('mousedown', onDown); el.removeEventListener('click', onClick); };
    }, []);

    // Center the viewport on the selected day at the base (mid) zoom — full window
    // width aligned to the frame, scale = kBase. Also the Today/"view reset" action
    // (resetTick bump) re-runs this even when the date is unchanged, snapping zoom
    // back to mid and the window back to full-width-centered-on-today (req feedback).
    //
    // req #2860 — the recenter must also re-fire when an async data-load relayout
    // shifts the selected day's world-Y (its row top moves once the dense rows grow
    // from their empty-data ROW_MIN), so the view follows today instead of staying
    // pinned to the stale pre-data world-Y (which fell over the mid/late-May data
    // mass). recenterDecision() encodes "recenter on navigation OR on a geometry
    // shift the user hasn't overridden by manually panning". Refs hold the last
    // navigation key and the last centered world-Y.
    const lastNavKeyRef = useRef(null);
    const lastCenterYRef = useRef(null);
    useEffect(() => {
        const el = containerRef.current;
        const zb = zoomRef.current;
        if (!el || !zb || size.w === 0 || !rows.length) return;
        // req #2860 — recenter on navigation OR on an async-relayout geometry
        // shift the user hasn't overridden by panning. req #2859 — key `navKey` on
        // rangeEnd, NOT rangeStart: a scroll-up auto-extend moves only the PAST edge
        // of the fetch window and must not read as navigation (which would yank the
        // view back to the selected day). Toolbar Prev/Next/Today shifts Monday →
        // rangeEnd moves too, so genuine week navigation still recenters; intra-week
        // changes move selectedDate. The newest-day layout anchor (above) also keeps
        // the selected day's world-Y fixed across an extension, so `geometryShifted`
        // stays false there too — panning up never recenters.
        const navKey = `${selectedDate}|${rangeEnd}|${size.w}x${size.h}|${resetTick}`;
        const cy = rowTopFor(selectedDate);
        const { recenter, clearPan } = recenterDecision({
            navKey, lastNavKey: lastNavKeyRef.current,
            centerY: cy, lastCenterY: lastCenterYRef.current,
            userPanned: userPannedRef.current,
        });
        if (!recenter) return;
        if (clearPan) userPannedRef.current = false;  // explicit navigation releases the manual-pan lock
        lastNavKeyRef.current = navKey;
        lastCenterYRef.current = cy;
        centerDateRef.current = selectedDate;
        const ty = size.h / 2 - cy * kBase;
        select(el).call(zb.transform, zoomIdentity.translate(0, ty).scale(kBase));
    }, [selectedDate, rangeStart, rangeEnd, size.w, size.h, rows, kBase, rowTopFor, resetTick]);

    // Window (36h) toggle — re-anchor on the day at the viewport center, PRESERVING
    // the current zoom and x-pan, so flipping 36h on/off doesn't jump to a random
    // day (req feedback). Runs only when `win` actually flips.
    useEffect(() => {
        if (prevWinRef.current === null) { prevWinRef.current = win; return; }
        if (prevWinRef.current === win) return;
        prevWinRef.current = win;
        const el = containerRef.current;
        const zb = zoomRef.current;
        if (!el || !zb || size.w === 0 || !rows.length) return;
        const anchor = centerDateRef.current || selectedDate;
        const r = rows.find(rr => rr.date === anchor);
        const cy = r ? r.top + r.height / 2 : worldMidY;
        const k = transform ? transform.k : kBase;
        const tx = transform ? transform.x : 0;
        select(el).call(zb.transform, zoomIdentity.translate(tx, size.h / 2 - cy * k).scale(k));
    }, [win, rows, size.w, size.h, worldMidY, kBase, selectedDate, transform]);

    // Until the centering effect installs the real transform, fall back to a view
    // centered on the SELECTED day's row (today on a fresh load) — NOT the world
    // midpoint. The world midpoint is the vertical center of the fetched world, and
    // because row height scales with session count that midpoint lands on the
    // densest data mass (historically the mid/late-May swarm cluster), which is the
    // source of the "visualizer defaults to May 20/21" affinity (req #2856).
    // rowTopFor falls back to worldMidY itself only when the selected row isn't
    // present.
    const t = transform || { x: 0, y: size.h / 2 - rowTopFor(selectedDate) * kBase, k: kBase };
    const inv = t.k > 0 ? 1 / t.k : 1;

    const visibleRows = useMemo(() => {
        if (!rows.length || size.h === 0) return [];
        const yTop = (-t.y) / t.k;
        const yBot = (size.h - t.y) / t.k;
        const pad = 240;
        return rows.filter(r => r.top + r.height >= yTop - pad && r.top <= yBot + pad);
    }, [rows, t.y, t.k, size.h]);

    // Shared top time-axis ticks in SCREEN space (follows pan/zoom horizontally).
    const axisTicks = useMemo(() => {
        const out = [];
        for (const h of hourTicks) {
            const sx = xWorld(hourToPct(h)) * t.k + t.x;
            if (sx >= 0 && sx <= size.w) out.push({ h, sx });
        }
        return out;
    }, [hourTicks, win, t.k, t.x, size.w]);

    // Per-day date/count headers in SCREEN space. Each sits at its row's top, but
    // the topmost visible day's header STICKS just under the time axis and is
    // pushed up by the next day's header as it scrolls in (req feedback — matches
    // the old visualizer's sticky header). Centered on the noon column.
    const dayHeaders = useMemo(() => {
        if (!visibleRows.length || size.w === 0) return [];
        const noonScreenX = xWorld(noonPct) * t.k + t.x;
        return computeDayHeaders(visibleRows, t, size.h, noonScreenX, selectedDate, AXIS_H, HEADER_H);
    }, [visibleRows, t.k, t.x, t.y, size.w, size.h, noonPct, selectedDate]);

    const showTip = useCallback((chip, e) => {
        const p = e?.target?.getStage?.()?.getPointerPosition?.();
        if (p) setTooltip({ x: p.x, y: p.y, chip });
    }, []);
    const hideTip = useCallback(() => setTooltip(null), []);
    const cursorPointer = (e, on) => {
        const stage = e?.target?.getStage?.();
        if (!stage) return;
        // Don't touch the cursor mid-drag — a shape sliding under/out from the
        // pointer during a pan must not flicker 'grabbing' → 'pointer'/'grab'
        // (req #2853). The drag end handler restores 'grab'.
        if (draggingRef.current) return;
        stage.container().style.cursor = on ? 'pointer' : 'grab';
    };
    const handleChipClick = useCallback((chip) => {
        if (chip.isUndone) { onUndoClick?.(chip.undo?.id ?? null); return; }
        if (chip.isPhantom) {
            if (chip.id != null) onChipClick?.(chip.id);
            else onSwarmStartClick?.(chip.swarmStartId ?? null);
            return;
        }
        if (chip.id != null) onChipClick?.(chip.id);
    }, [onChipClick, onSwarmStartClick, onUndoClick]);

    // ── Glyph builders ───────────────────────────────────────────────────────
    const tombstone = (key, cx, cy, beadR) => {
        // Rounded-stone silhouette + etched white Latin cross, scaled to screen
        // via a wrapping Group (scaleX/Y = inv) so the path math stays in px.
        const S = 2 * beadR / inv + 6;            // screen size (undo inv on beadR)
        const half = S / 2, topR = S * 0.45, cxL = S / 2;
        const crossH = S * 0.66, crossW = crossH / 2;
        const thick = Math.max(1.6, crossW / 3);
        const crossTop = S * 0.18;
        const data = `M 1.5 ${S - 1} L 1.5 ${topR} Q 1.5 1 ${cxL} 1 `
                   + `Q ${S - 1.5} 1 ${S - 1.5} ${topR} L ${S - 1.5} ${S - 1} Z`;
        return (
            // listening=false — the bead hit-target (drawn on top) owns hover/click.
            <Group key={`${key}-tb`} x={cx} y={cy} scaleX={inv} scaleY={inv}
                   offsetX={half} offsetY={half} listening={false}>
                <Path data={data} fill="#424242" stroke="#9E9E9E" strokeWidth={1} />
                <Rect x={cxL - thick / 2} y={crossTop} width={thick} height={crossH} fill="#fff" cornerRadius={0.5} />
                <Rect x={cxL - crossW / 2} y={crossTop + crossH / 4} width={crossW} height={thick} fill="#fff" cornerRadius={0.5} />
            </Group>
        );
    };

    const completionBadge = (key, cx, cy, beadR, sc) => {
        const ok = sc.status === 'ok';
        const bg = ok ? '#4caf50' : (sc.status === 'error' ? '#ffa726' : '#90a4ae');
        const isPrimary = sc.skill_name === 'primary-ai-swarm-complete';
        const glyph = isPrimary ? '⚑' : (ok ? '✓' : '!');
        const r = 6.5 * inv;
        const bx = cx + beadR * 0.75, by = cy - beadR * 0.75;
        return (
            <Group key={`${key}-cmp`}>
                <Circle x={bx} y={by} radius={r} fill={bg} stroke={C.beadEdge} strokeWidth={1.4 * inv}
                        onActivate={() => onCompleteClick?.(sc.id)} />
                <Text x={bx} y={by} text={glyph} fontSize={9 * inv} fontStyle="bold"
                      fill={ok ? '#fff' : '#000'} width={2 * r} height={2 * r}
                      offsetX={r} offsetY={r} align="center" verticalAlign="middle" listening={false} />
            </Group>
        );
    };

    // Dev-server port pill (req #2857). Anchored at the bead's lower-right so it
    // clears the completion badge (top-right) and the title (right). Renders a
    // small white monitor icon + the port number on a cyan pill; clicking opens
    // https://localhost:{port}. Everything inside the wrapping Group is in SCREEN
    // px (scaleX/Y = inv undoes the world→screen zoom), so the pill stays a
    // constant size at any zoom — like every other glyph. The pill Rect is the
    // only listening child, so the canvas click hit-test fires its onActivate.
    const devServerBadge = (key, cx, cy, beadR, ds, chipForTip) => {
        const bR = beadR / inv;                  // bead radius in screen px
        const H = 16;
        const portStr = String(ds.port);
        const PADL = 4, ICON_W = 9, GAP = 4, PADR = 6;
        const textW = portStr.length * 6.4;
        const W = PADL + ICON_W + GAP + textW + PADR;
        const x0 = bR * 0.5, y0 = bR * 0.35;     // pill top-left, off the bead's lower-right
        // Monitor icon (screen rect + stand + base), vertically centered in the pill.
        const scrW = 9, scrH = 6;
        const icx = x0 + PADL, icy = y0 + (H - scrH) / 2 - 1;
        const openServer = () => {
            try { window.open(`https://localhost:${ds.port}`, '_blank', 'noopener,noreferrer'); }
            catch (e) { /* popup blocked — no-op */ }
        };
        const pal = DEVSERV_PALETTE(dark);
        return (
            <Group key={`${key}-ds`} x={cx} y={cy} scaleX={inv} scaleY={inv}>
                <Rect x={x0} y={y0} width={W} height={H} cornerRadius={H / 2}
                      fill={pal.fill} stroke={pal.edge} strokeWidth={1.4}
                      shadowColor="#000" shadowBlur={3} shadowOpacity={0.35}
                      onActivate={openServer}
                      onMouseEnter={(e) => { cursorPointer(e, true); showTip(chipForTip, e); }}
                      onMouseLeave={(e) => { cursorPointer(e, false); hideTip(); }} />
                <Rect x={icx} y={icy} width={scrW} height={scrH} cornerRadius={1} fill={pal.fg} listening={false} />
                <Rect x={icx + scrW / 2 - 0.75} y={icy + scrH} width={1.5} height={2} fill={pal.fg} listening={false} />
                <Rect x={icx + scrW / 2 - 2.5} y={icy + scrH + 2} width={5} height={1.3} fill={pal.fg} cornerRadius={0.6} listening={false} />
                <Text x={x0 + PADL + ICON_W + GAP} y={y0} width={textW + 2} height={H}
                      text={portStr} fontSize={10.5} fontStyle="bold" fill={pal.fg}
                      align="left" verticalAlign="middle" listening={false} />
            </Group>
        );
    };

    // Swarm-start glyph (req #2504 same-day; req #2862 cross-day start day) —
    // a vertical tick spanning the lane slot + an anchor dot at the top.
    // Green = a real swarm_start row, red = an estimated (cluster-inferred) one.
    // `tipChip` drives the hover datacard (Swarm-Start #N) — pass the completed
    // chip OR the cross-day card, whichever owns the glyph. Returns the tick +
    // dot nodes. Shared by the same-day `model.placed` loop and the cross-day
    // `role:'start'` loop so the start day of a multi-day span shows the SAME
    // anchor glyph as a single-day bead (previously the cross-day start day drew
    // only the dashed tail, so multi-day requirements had no start glyph at all).
    const swarmStartGlyph = (key, sx, cy, swarmStartId, swarmStartRow, tipChip) => {
        const real = swarmStartId != null;
        const col = real ? REAL_GREEN : EST_RED;
        // Span reduced by 1/3 from the full lane, kept centered on the lane.
        const yTop = cy - LANE_H * (1 / 3), yBot = cy + LANE_H * (1 / 3);
        return [
            <Line key={`${key}-stk`} points={[sx, yTop, sx, yBot]}
                  stroke={col} strokeWidth={2.5 * inv} lineCap="round" />,
            <Circle key={`${key}-sdot`} x={sx} y={yTop} radius={3.2 * inv} fill={col}
                    stroke={C.beadEdge} strokeWidth={0.8 * inv}
                    hitStrokeWidth={10 * inv}
                    onMouseEnter={swarmStartRow ? (e) => { cursorPointer(e, true); showTip({ ...tipChip, isSwarmStartCard: true }, e); } : undefined}
                    onMouseLeave={swarmStartRow ? (e) => { cursorPointer(e, false); hideTip(); } : undefined}
                    onActivate={real ? () => onSwarmStartClick?.(swarmStartId) : undefined} />,
        ];
    };

    // ── Row renderer ─────────────────────────────────────────────────────────
    const renderRow = (r) => {
        const { date, top, height, model, parity } = r;
        const isSel = date === selectedDate;
        const laneY = (row) => top + CHROME_TOP + row * LANE_H + LANE_H / 2;
        const usePhases = phasesOn || level === 'in';
        const beadR = (level === 'out' ? DOT_R_S : BEAD_R_S) * inv;
        const trackW = TRACK_W_S * inv;
        const nodes = [];

        // Alternating day background + selected-day highlight.
        nodes.push(<Rect key="bg" x={0} y={top} width={WORLD_W} height={height}
                         fill={parity === 'odd' ? C.dayOdd : C.dayEven} />);
        if (isSel) nodes.push(<Rect key="sel" x={0} y={top} width={WORLD_W} height={height} fill={C.selected} />);

        // Hour gridlines (full row height). Per-row hour LABELS removed — the
        // shared top axis carries the clock notation (req feedback: declutter).
        for (const h of hourTicks) {
            const x = xWorld(hourToPct(h));
            const major = (((h % 12) + 12) % 12) === 0;   // midnight / noon / next midnight
            nodes.push(<Line key={`g${h}`} points={[x, top, x, top + height]}
                             stroke={major ? C.gridMajor : C.gridMinor} strokeWidth={1 * inv} />);
        }

        // Wire under the chrome band.
        const wireY = top + CHROME_TOP - 6;
        nodes.push(<Line key="wire" points={[LEFTPAD, wireY, WORLD_W - RIGHTPAD, wireY]}
                         stroke={C.wire} strokeWidth={1 * inv} />);

        // Date + count is drawn as a STICKY HTML header overlay (below), not in
        // the canvas, so it can pin under the time axis like the old visualizer.

        // Live-time marker — full row height.
        if (model.nowPct != null) {
            const nx = xWorld(model.nowPct);
            nodes.push(<Line key="now" points={[nx, top, nx, top + height]}
                             stroke={C.now} strokeWidth={1.5 * inv} opacity={0.85} />);
        }

        // ── OUT level: density dots only (one mark per completion) ───────────
        if (level === 'out') {
            model.placed.forEach((chip) => {
                const rad = DOT_R_S * 2.25 * inv * (chip.isUndone ? 1 : costMult(chip));
                nodes.push(<Circle key={chip.chipKey || chip.id} x={xWorld(chip.leftPct)} y={laneY(chip.row)}
                                   radius={rad} fill={beadFill(chip)} opacity={0.85} />);
            });
            return <Group key={date}>{nodes}</Group>;
        }

        // ── Cross-day dashed pass-throughs ───────────────────────────────────
        model.crossDayPlaced.forEach((cd, i) => {
            const y = laneY(cd.lane);
            const card = cd.card;
            let x1 = LEFTPAD;
            const x2 = WORLD_W - RIGHTPAD;
            const isStart = cd.role === 'start' && cd.pct != null;
            if (isStart) x1 = xWorld(cd.pct);
            nodes.push(<Line key={`xd${i}`} points={[x1, y, x2, y]}
                             stroke={card?.color || C.tomb} strokeWidth={trackW * 0.7}
                             dash={[6 * inv, 4 * inv]} opacity={0.55} lineCap="round"
                             hitStrokeWidth={12 * inv}
                             onMouseEnter={card ? (e) => { cursorPointer(e, true); showTip({ ...card, isCrossDay: true }, e); } : undefined}
                             onMouseLeave={card ? (e) => { cursorPointer(e, false); hideTip(); } : undefined} />);
            // Anchor the swarm-start glyph at the start-day's dashed tail (req
            // #2862). For a requirement started one day and completed another the
            // completion bead's start is clamped off-window (no glyph drawn
            // there), so this cross-day start entry is the only place the
            // swarm-start anchor can appear.
            if (isStart) {
                nodes.push(...swarmStartGlyph(`xd${i}`, x1, y,
                                              card?.swarmStartId ?? null,
                                              card?.swarmStart ?? null, card));
            }
        });

        // ── Duration tracks + start ticks + terminal glyphs ──────────────────
        model.placed.forEach((chip) => {
            const cx = xWorld(chip.leftPct);
            const cy = laneY(chip.row);
            const key = chip.chipKey || chip.id;
            // Cost-scaled bead radius (req #2846). Undone tombstones keep base
            // size; the duration track + start tick are unaffected (cost is a
            // property of the completion bead, not the span).
            const cr = beadR * (chip.isUndone ? 1 : costMult(chip));

            // Active dev server for this bead's session (req #2857). Tombstones
            // never carry one. `tipChip` enriches the hover datacard with the
            // dev-server row whether the pointer lands on the bead or the pill.
            const ds = (devServersOn && !chip.isUndone && chip.session)
                ? devServerBySession.get(String(chip.session.id)) : null;
            const tipChip = ds ? { ...chip, devServer: ds } : chip;

            // The track (phase-segmented at "in", else a thick line).
            durationSegments(chip, usePhases).forEach((s, si) => {
                nodes.push(<Line key={`${key}-tk${si}`} points={[s.x1, cy, s.x2, cy]}
                                 stroke={s.color} strokeWidth={trackW}
                                 lineCap={s.dashed ? 'butt' : 'round'}
                                 dash={s.dashed ? [5 * inv, 3 * inv] : undefined}
                                 opacity={chip.isPhantom ? 0.8 : 0.95} />);
            });

            // Swarm-start: vertical tick spanning the lane slot (stacks into a
            // grouping bar for a multi-session start) + an anchor dot at the top.
            if (chip.startPct != null && !chip.startClamped && chip.markerMode !== 'left') {
                nodes.push(...swarmStartGlyph(key, xWorld(chip.startPct), cy,
                                              chip.swarmStartId, chip.swarmStart, chip));
            }

            // Terminal glyph.
            if (chip.isUndone) {
                nodes.push(tombstone(key, cx, cy, cr));
            } else if (chip.isPhantom) {
                // In-flight: text-colored core + colored ring (+40% thicker). The
                // earlier white core read too bright, so the core matches the text.
                nodes.push(<Circle key={`${key}-ph`} x={cx} y={cy} radius={cr}
                                   fill={C.textDim} stroke={beadFill(chip)} strokeWidth={3.5 * inv} />);
            } else {
                // Completed bead: category fill + a thin white highlight ring.
                nodes.push(<Circle key={`${key}-bd`} x={cx} y={cy} radius={cr}
                                   fill={beadFill(chip)} stroke="#ffffff" strokeWidth={1.8 * inv} />);
            }
            if (chip.ringColor) {
                nodes.push(<Circle key={`${key}-rg`} x={cx} y={cy} radius={cr + 3 * inv} stroke={chip.ringColor} strokeWidth={2.8 * inv} />);
            }
            // Hit target (hover + click). Pushed BEFORE the completion badge so
            // the badge (drawn on top) keeps its own onCompleteClick within its
            // bounds, while the hit target catches the rest of the bead area.
            nodes.push(<Circle key={`${key}-hit`} x={cx} y={cy} radius={cr + 5 * inv} fill="transparent"
                               onMouseEnter={(e) => { cursorPointer(e, true); showTip(tipChip, e); }}
                               onMouseLeave={(e) => { cursorPointer(e, false); hideTip(); }}
                               onActivate={() => handleChipClick(chip)} />);
            if (completesOn && chip.swarmComplete && !chip.isUndone && !chip.isPhantom) {
                nodes.push(completionBadge(key, cx, cy, cr, chip.swarmComplete));
            }
            // Dev-server pill drawn last so it sits on top of the bead/hit target
            // and owns its own click (open) + hover (datacard) (req #2857).
            if (ds) {
                nodes.push(devServerBadge(key, cx, cy, cr, ds, tipChip));
            }
            if (titlesOn && chip.title) {
                nodes.push(<Text key={`${key}-tt`} x={cx + (cr + 6 * inv)} y={cy - 7 * inv}
                                 text={chip.title.length > 46 ? chip.title.slice(0, 45) + '…' : chip.title}
                                 fontSize={FONT_TITLE_S * inv} fill={C.textDim} listening={false} />);
            }
        });

        return <Group key={date}>{nodes}</Group>;
    };

    const hasData = rows.some(r => r.model.placed.length > 0 || r.model.crossDayPlaced.length > 0);

    return (
        <Box ref={containerRef} data-testid="konva-swarm-canvas"
             style={{ position: 'relative', height: 'calc(100vh - 150px)', minHeight: 480,
                      // req #2870: the 16px left margin formerly cleared the floating
                      // sidebar collapse edge-tab that overlapped this canvas's left edge.
                      // That tab moved into the navbar, so the canvas reclaims full width.
                      width: '100%',
                      border: `1px solid ${C.wire}`, borderRadius: 6, overflow: 'hidden',
                      background: C.bg, touchAction: 'none' }}>
            {size.w > 0 && (
                <Stage ref={stageRef} width={size.w} height={size.h}>
                    <Layer>
                        <Group x={t.x} y={t.y} scaleX={t.k} scaleY={t.k}>
                            {visibleRows.map(renderRow)}
                        </Group>
                    </Layer>
                </Stage>
            )}

            {/* Per-day date + green count badge. The topmost day's header sticks
                just under the time axis and is pushed up by the next day (req
                feedback). Centered on the noon column; date first, count to the
                right as a green circle. */}
            {dayHeaders.map((h) => (
                <div key={h.key} style={{
                    position: 'absolute', left: h.left, top: h.top, height: HEADER_H,
                    transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6,
                    whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none',
                }}>
                    <span style={{
                        fontSize: '0.82rem', fontWeight: 700, fontFamily: "'Roboto', sans-serif",
                        color: h.isSel ? theme.palette.primary.main : (dark ? '#fff' : 'rgba(0,0,0,0.85)'),
                    }}>
                        {new Date(h.date + 'T12:00:00').toLocaleDateString(undefined,
                            { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    {h.count > 0 && (
                        // Exact earlier-design "req met" pill (swarmVisualizer.css
                        // .ts-bead-day-count-inline / .ts-bead-sticky-count).
                        <span title={`${h.count} requirements met`} style={{
                            minWidth: 18, padding: '0 6px', textAlign: 'center', borderRadius: 999,
                            background: dark ? '#2e3b2e' : '#6fa86f',
                            color: dark ? '#81c784' : '#fff',
                            border: dark ? '1px solid #4a7a4a' : 'none',
                            fontWeight: 700, fontSize: '0.74rem', lineHeight: 1.45,
                            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.12)',
                        }}>{h.count}</span>
                    )}
                </div>
            ))}

            {/* Shared top time-axis — single clock notation for every row, follows
                horizontal pan/zoom (req feedback: one notation, not per-day). */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: AXIS_H,
                background: C.axisBg, borderBottom: `1px solid ${C.wire}`,
                pointerEvents: 'none', userSelect: 'none',
            }}>
                {axisTicks.map(({ h, sx }) => (
                    <div key={h} style={{
                        position: 'absolute', left: sx, top: 0, transform: 'translateX(-50%)',
                        fontSize: 10, lineHeight: `${AXIS_H}px`, color: C.textDim, whiteSpace: 'nowrap',
                    }}>{hourLabel(h)}</div>
                ))}
            </div>

            <div style={{
                position: 'absolute', bottom: 8, right: 10, fontSize: 11, color: C.textDim,
                background: dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.82)',
                padding: '2px 8px', borderRadius: 10, pointerEvents: 'none', userSelect: 'none',
            }} data-testid="konva-zoom-level">
                {level === 'out' ? 'Overview' : level === 'in' ? 'Detail · phases' : 'Tracks'}{costOn ? ' · sized by cost' : ''} · drag to pan · scroll to zoom
            </div>

            {!hasData && size.w > 0 && (
                <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                    color: C.textDim, fontSize: 14, pointerEvents: 'none',
                }}>No swarm activity in this window.</div>
            )}

            {tooltip && (
                <DataCard chip={tooltip.chip} x={tooltip.x} y={tooltip.y}
                          containerW={size.w} containerH={size.h} />
            )}
        </Box>
    );
};

// Lightweight Box shim so we don't pull MUI just for a styled div ref.
const Box = React.forwardRef(({ children, ...rest }, ref) => (
    <div ref={ref} {...rest}>{children}</div>
));
Box.displayName = 'KonvaCanvasBox';

// HTML datacard — reuses .ts-shared-tooltip / .ts-datacard-* CSS.
const DataCard = ({ chip, x, y, containerW, containerH }) => {
    const CARD_W = 260;
    const left = Math.min(Math.max(8, x + 14), Math.max(8, containerW - CARD_W - 8));
    const top = Math.min(Math.max(8, y + 14), Math.max(8, containerH - 40));
    const tz = chip.timezone;

    // Swarm-start anchor hover — its own datacard (mirrors the earlier design's
    // renderAnchorCard): Swarm-Start #N with started/sessions/wall/turns/command.
    if (chip.isSwarmStartCard && chip.swarmStart) {
        const ss = chip.swarmStart;
        const wall = ss.wall_seconds != null
            ? (ss.wall_seconds < 60 ? `${ss.wall_seconds}s`
                : `${Math.floor(ss.wall_seconds / 60)}m ${ss.wall_seconds % 60}s`)
            : null;
        return (
            <div className="ts-shared-tooltip" style={{
                position: 'absolute', left, top, maxWidth: CARD_W, zIndex: 20, pointerEvents: 'none',
            }}>
                <div className="ts-datacard">
                    <div className="ts-datacard-title">Swarm-Start #{ss.id}</div>
                    <div className="ts-datacard-row"><span className="ts-datacard-key">Started</span><span>{fmtDT(ss.started_at, tz)}</span></div>
                    {ss.session_count != null && (
                        <div className="ts-datacard-row"><span className="ts-datacard-key">Sessions</span><span>{ss.session_count}</span></div>
                    )}
                    {wall && (
                        <div className="ts-datacard-row"><span className="ts-datacard-key">Wall</span><span>{wall}</span></div>
                    )}
                    {ss.turn_count != null && (
                        <div className="ts-datacard-row"><span className="ts-datacard-key">Turns</span><span>{ss.turn_count}</span></div>
                    )}
                    {ss.auto_start ? (
                        <div className="ts-datacard-row"><span className="ts-datacard-key">Auto-Start</span><span>yes</span></div>
                    ) : null}
                    <div className="ts-datacard-row"><span className="ts-datacard-key">Command</span>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                            /swarm-start{ss.arguments ? ` ${ss.arguments}` : ''}</span></div>
                </div>
            </div>
        );
    }

    return (
        <div className="ts-shared-tooltip" style={{
            position: 'absolute', left, top, maxWidth: CARD_W, zIndex: 20, pointerEvents: 'none',
        }}>
            <div className="ts-datacard">
                <div className="ts-datacard-title">{chip.id != null ? `#${chip.id} ` : ''}{chip.title || '(untitled)'}</div>
                <div className="ts-datacard-row"><span className="ts-datacard-key">Category</span><span>{chip.categoryName || '—'}</span></div>
                <div className="ts-datacard-row"><span className="ts-datacard-key">Autonomy</span><span>{formatCoordination(chip.coordination_type)}</span></div>
                {chip.isPhantom && (
                    <div className="ts-datacard-row"><span className="ts-datacard-key">Status</span>
                        <span style={{ color: '#43A047', fontWeight: 600 }}>
                            in progress{chip.requirement_status ? ` · ${chip.requirement_status}` : ''}</span></div>
                )}
                {chip.session?.started_at && (
                    <div className="ts-datacard-row"><span className="ts-datacard-key">Started</span>
                        <span>{fmtDT(chip.session.started_at, tz)}{chip.startClamped ? ' (before window)' : ''}</span></div>
                )}
                {chip.isUndone ? (
                    <>
                        <div className="ts-datacard-row"><span className="ts-datacard-key">Status</span><span style={{ color: '#616161', fontWeight: 600 }}>undone</span></div>
                        {chip.completed_at && (<div className="ts-datacard-row"><span className="ts-datacard-key">Undone</span><span>{fmtDT(chip.completed_at, tz)}</span></div>)}
                        {chip.undo?.reason && (<div className="ts-datacard-row"><span className="ts-datacard-key">Reason</span><span style={{ whiteSpace: 'pre-wrap' }}>{chip.undo.reason}</span></div>)}
                    </>
                ) : (!chip.isPhantom && !chip.isCrossDay && chip.completed_at && (
                    <div className="ts-datacard-row"><span className="ts-datacard-key">Closed</span><span>{fmtDT(chip.completed_at, tz)}</span></div>
                ))}
                {chip.swarmStart && (
                    <div className="ts-datacard-row"><span className="ts-datacard-key">Swarm-Start</span>
                        <span>#{chip.swarmStart.id}
                            {chip.swarmStart.session_count != null ? ` · ${chip.swarmStart.session_count} session${chip.swarmStart.session_count === 1 ? '' : 's'}` : ''}</span></div>
                )}
                {chip.swarmComplete && (
                    <div className="ts-datacard-row"><span className="ts-datacard-key">Closed by</span>
                        <span>#{chip.swarmComplete.id} · {chip.swarmComplete.status}</span></div>
                )}
                {chip.session && (
                    <div className="ts-datacard-row"><span className="ts-datacard-key">Session</span><span>#{chip.session.id} · {chip.session.swarm_status || '—'}</span></div>
                )}
                {/* req #2857 — name the active dev server when one is attached; the
                    cyan port pill on the bead is the clickable link, this labels it. */}
                {chip.devServer && (
                    <div className="ts-datacard-row"><span className="ts-datacard-key">Dev Server</span>
                        <span style={{ color: '#4a7a4a', fontWeight: 600 }}>
                            :{chip.devServer.port}
                            {chip.devServer.terminal_number != null ? ` · Term ${chip.devServer.terminal_number}` : ''}
                            {' · click pill to open'}</span></div>
                )}
                {/* req #2846 — surface the session's token cost regardless of the
                    Cost sizing toggle; the bead area encodes it, this names it.
                    Shown for every session-bearing bead — "—" when the session has
                    no token instrumentation, so the line never silently vanishes. */}
                {chip.session && (() => {
                    const cost = sessionTokenCost(chip.session);
                    return (
                        <div className="ts-datacard-row"><span className="ts-datacard-key">Token Cost</span>
                            <span>{cost > 0 ? `${formatTokens(cost)} tok` : '—'}</span></div>
                    );
                })()}
            </div>
        </div>
    );
};

export default KonvaSwarmCanvas;
