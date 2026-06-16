// konvaSwarmModel.js — pure data model for the Konva swarm visualizer (req #2841).
//
// The Konva redesign renders a zoomable "time-of-day × days" grid:
//   • X axis = clock time within a day, 0h..36h (so late-night work and its
//     next-afternoon finish sit in one row; spillover past midnight stays visible).
//   • Y axis = days, stacked as aligned rows; days STAY aligned by clock time.
//   • Depth  = semantic zoom: the zoom scale selects a level-of-detail.
//
// This module is the pure substrate: given the orchestrated data
// SwarmVisualizerView feeds it, it produces, per calendar day, the
// laid-out chip model (beads, duration spans, phantoms, tombstones, cross-day
// pass-throughs). It reuses the EXPORTED geometry helpers verbatim — only the
// x-axis convention differs (0..36h left-aligned here vs. the 36h noon-centered
// window of positionFor), supplied via the local `xPct36` closure. Everything is
// pure + exported so the render layer stays thin and the math is unit-testable.

import {
    toLocaleDateString, getTimeOfDayFraction, localDateStr,
} from '../utils/dateFormat';
import {
    indexSessionsByRequirement,
    parseSessionRequirementId,
    clusterSessionsBySwarmStart,
    computePhaseSegments,
} from '../CalendarFC/timeSeriesSizes';
import {
    assignSwarmLanes,
    buildCrossDayMap,
    buildCrossDayGhosts,
    buildUndoneChips,
    computePhantomPlacement,
    isHiddenSwarmStatus,
    coordinationRingColor,
} from '../CalendarFC/swarmGeometry';

// ── Axis constants ──────────────────────────────────────────────────────────
// A day-row spans 0h (its local midnight) to DAY_HOURS = 24h (the next midnight).
// Cross-day spans (late-night work finishing the next day) are carried by the
// cross-day map: a dashed 'start' tail on the start-day row + the completion bead
// on the end-day row — so a 24h axis needs no extra spillover width on the right.
export const DAY_HOURS = 24;

// Close-gap threshold (in x%) below which a started_at ≈ completed_at collapses
// the start bar to hug the bead's left side. Mirrors BeadRow.CLOSE_THRESHOLD_PCT.
export const CLOSE_THRESHOLD_PCT = 1.5;

// ── 0..36h x-mapping ────────────────────────────────────────────────────────
// Hours from the row's local midnight to `ts`. dayOffset is whole-day delta
// between ts's local day and rowDate (noon-anchored to dodge DST), plus the
// fractional time-of-day. A ts on rowDate at 14:00 → 14; on rowDate+1 at 02:00
// → 26. Returns NaN when ts is unparseable.
export function hoursFromRowMidnight(ts, timezone, rowDate) {
    const tsDay  = toLocaleDateString(ts, timezone);
    const tsFrac = getTimeOfDayFraction(ts, timezone);
    if (tsDay === null || tsFrac === null) return NaN;
    const rowAnchor = new Date(rowDate + 'T12:00:00');
    const tsAnchor  = new Date(tsDay + 'T12:00:00');
    const dayOffset = Math.round((tsAnchor - rowAnchor) / 86400000);
    return dayOffset * 24 + tsFrac * 24;
}

// x% (0..100) of `ts` across a row's [0, DAY_HOURS] (24h) axis, or null when ts
// falls outside it (adjacent row / cross-day line). Shaped like positionFor(...)
// so it can be the `xPctFn`/`startXPct` the shared helpers call.
export function xPct36(ts, timezone, rowDate) {
    const h = hoursFromRowMidnight(ts, timezone, rowDate);
    if (!Number.isFinite(h)) return null;
    if (h < 0 || h > DAY_HOURS) return null;
    return (h / DAY_HOURS) * 100;
}

// Windowed x% — generalizes xPct36 to an arbitrary hour window [winStartH,
// winEndH]. Used for the 36h "noon-centered" trial that shows the prior evening
// (winStartH = -6 → 6pm) and next morning (winEndH = 30 → 6am) on each day row,
// like the old day/36h visualizer. Default window === xPct36 (0..24).
export function xPctWin(ts, timezone, rowDate, winStartH = 0, winEndH = DAY_HOURS) {
    const h = hoursFromRowMidnight(ts, timezone, rowDate);
    if (!Number.isFinite(h)) return null;
    if (h < winStartH || h > winEndH) return null;
    return ((h - winStartH) / (winEndH - winStartH)) * 100;
}

// ── Semantic zoom levels ────────────────────────────────────────────────────
// The render scale `k` selects content (not just size):
//   out — dense overview: one density dot per session, weekend shading.
//   mid — the current bead look: beads + duration lines + cross-day + titles.
//   in  — lanes spread; each bead expands into its phase bar.
export const SEMANTIC_OUT_MAX = 0.5;   // ratio < 0.5 → out. Lowered from 0.68 (req #2847)
                                       //   to shift the overview→tracks crossover in favor
                                       //   of tracks — tracks now appear at a lower zoom.
export const SEMANTIC_IN_MIN  = 1.9;   // ratio >= 1.9 → in
export function semanticLevel(k) {
    if (!Number.isFinite(k) || k < SEMANTIC_OUT_MAX) return 'out';
    if (k >= SEMANTIC_IN_MIN) return 'in';
    return 'mid';
}

// ── Day-string helpers ──────────────────────────────────────────────────────
export function shiftDayStr(dateStr, delta) {
    if (!dateStr) return dateStr;
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return localDateStr(d);
}

// Whole-day signed delta between two YYYY-MM-DD strings (b - a), noon-anchored.
export function dayDelta(a, b) {
    if (!a || !b) return 0;
    const da = new Date(a + 'T12:00:00');
    const db = new Date(b + 'T12:00:00');
    return Math.round((db - da) / 86400000);
}

// Inclusive list of YYYY-MM-DD between start and end (start..end).
export function dateRange(startDate, endDate) {
    const out = [];
    if (!startDate || !endDate) return out;
    const n = dayDelta(startDate, endDate);
    if (n < 0) return out;
    for (let i = 0; i <= n; i++) out.push(shiftDayStr(startDate, i));
    return out;
}

export function isWeekend(dateStr) {
    if (!dateStr) return false;
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    return dow === 0 || dow === 6;
}

// ── Canvas re-centering decision (req #2860) ────────────────────────────────
// The Konva canvas centers the viewport vertically on the selected day. That
// transform is computed in an effect, but it must NOT be computed only once: on
// a hard reset the effect first fires while the data is still empty (every row a
// uniform ROW_MIN), centers today against that flat layout, and then the async
// data arrives — the dense rows grow, every row below shifts down, and today's
// row lands at a NEW world-Y. The original guard keyed only on
// navigation (selectedDate|range|size|resetTick), so it never recomputed after
// that relayout and the view stayed pinned to the stale world-Y, which fell over
// the densest data mass (historically the mid/late-May swarm cluster) — the
// "visualizer defaults to May 20/21" affinity.
//
// This pure helper decides, on each effect run, whether to re-issue the
// centering transform:
//   • `navChanged`     — selectedDate / range / size / resetTick changed: an
//                        explicit navigation (mount, Prev/Next/Today, resize).
//                        Always recenter, and clear the manual-pan lock.
//   • `geometryShifted`— the selected day's world-Y center moved (an async
//                        data-load relayout). Recenter ONLY if the user has not
//                        manually panned, so a background refetch
//                        (refetchOnWindowFocus) can't yank a hand-positioned view
//                        back to today.
// `navKey`/`lastNavKey` are the navigation-intent strings; `centerY`/`lastCenterY`
// are rowTopFor(selectedDate) now vs. at the last centering.
export function recenterDecision({
    navKey, lastNavKey, centerY, lastCenterY, userPanned,
} = {}) {
    const navChanged = navKey !== lastNavKey;
    const geometryShifted = centerY !== lastCenterY;
    return {
        recenter: navChanged || (geometryShifted && !userPanned),
        clearPan: navChanged,
    };
}

// ── Shared-context precompute ───────────────────────────────────────────────
// Build the cross-data maps once for the whole visible window so each per-day
// build is cheap. `dates` is the full visible date list (the cross-day map needs
// the union so a multi-day span emits middle lines on every covered day).
export function buildModelContext({
    requirements = [],
    allRequirements = [],
    sessions = [],
    categoryList = [],
    swarmStarts = [],
    swarmStartSessions = [],
    swarmUndos = [],
    swarmCompletes = [],
    swarmCompleteSessions = [],
    timezone,
    dates = [],
    today = null,
    win = { start: 0, end: DAY_HOURS },
} = {}) {
    const requirementById = new Map();
    for (const r of allRequirements) {
        if (r && r.id != null) requirementById.set(String(r.id), r);
    }
    // Completed-in-window requirements also belong in the lookup (they may not be
    // in allRequirements' projection ordering, but ids are stable).
    for (const r of requirements) {
        if (r && r.id != null && !requirementById.has(String(r.id))) {
            requirementById.set(String(r.id), r);
        }
    }

    const { canonical, clusterSize, swarmStartIdById, swarmStartById } =
        clusterSessionsBySwarmStart(sessions, swarmStartSessions, swarmStarts);

    // Index sessions-by-requirement and categories-by-id once for the whole
    // window — buildDayModel runs once per visible date, so rebuilding these
    // per-day would repeat O(sessions)+O(categories) work for every row.
    const sessionsByReq = indexSessionsByRequirement(sessions);
    const catById = new Map((categoryList || []).map(c => [c.id, c]));

    // swarm_complete keyed by session id (req #2497 completion termini).
    const swarmCompleteBySession = new Map();
    const completeById = new Map();
    for (const c of swarmCompletes) {
        if (c && c.id != null) completeById.set(String(c.id), c);
    }
    for (const j of swarmCompleteSessions) {
        if (!j || j.session_fk == null || j.swarm_complete_fk == null) continue;
        const c = completeById.get(String(j.swarm_complete_fk));
        if (c) swarmCompleteBySession.set(String(j.session_fk), c);
    }

    const todayStr = today || localDateStr();
    const xw = (ts, tz, d) => xPctWin(ts, tz, d, win.start, win.end);

    // Cross-day pass-through map across the full visible window. startXPct uses
    // the SAME window convention as the beads so the start bar lands correctly.
    const crossDayMap = buildCrossDayMap(dates, {
        requirements,
        sessions,
        swarmStarts,
        swarmStartSessions,
        requirementById,
        categoryList,
        canonicalStartById: canonical,
        swarmStartIdById,
        swarmStartById,
        timezone,
        startXPct: xw,
        today: todayStr,
    });

    return {
        requirements,
        sessions,
        categoryList,
        swarmStarts,
        swarmStartSessions,
        swarmUndos,
        timezone,
        requirementById,
        canonicalStartById: canonical,
        clusterSizeById: clusterSize,
        swarmStartIdById,
        swarmStartById,
        swarmCompleteBySession,
        sessionsByReq,
        catById,
        crossDayMap,
        today: todayStr,
        win,
    };
}

// ── Per-day chip model ──────────────────────────────────────────────────────
// Port of BeadRow's windowChips → drawChips → phantomChips → undoneChips →
// assignSwarmLanes pipeline, made pure and parameterized on the 0..36h xPct36
// mapping. `dataKey` drives the coordination ring; topDown=true keeps row 0 =
// latest (the canvas draws lanes downward from the wire at the row top).
//
// Returns { placed, crossDayPlaced, nowPct, count, maxRow }:
//   placed         — laid-out chips (beads/phantoms/tombstones), each with .row.
//   crossDayPlaced — cross-day dashed-line entries for this date, each with .lane.
//   nowPct         — x% of "now" on this row (or null) for the live-time marker.
//   count          — completed-requirement count (the date's header badge).
//   maxRow         — highest lane index used (drives the row's natural height).
export function buildDayModel(date, ctx, { dataKey = 'category', nowIso = null } = {}) {
    const {
        requirements, sessions, categoryList, timezone,
        requirementById, canonicalStartById, clusterSizeById,
        swarmStartIdById, swarmStartById, swarmCompleteBySession,
        swarmStarts, swarmStartSessions, swarmUndos, crossDayMap,
        sessionsByReq: ctxSessionsByReq, catById: ctxCatById,
    } = ctx;

    const empty = { placed: [], crossDayPlaced: [], nowPct: null, count: 0, maxRow: 0 };
    if (!date) return empty;

    const sessionsByReq = ctxSessionsByReq || indexSessionsByRequirement(sessions);
    const catById = ctxCatById || new Map((categoryList || []).map(c => [c.id, c]));

    // Per-row time window (default 24h = own day). A wider window (e.g. the 36h
    // noon-centered trial, [-6, 30]) shows the prior evening + next morning as
    // context, so a near-midnight chip intentionally appears on two adjacent rows
    // — exactly like the old day/36h visualizer. xw() returns null outside the
    // window, which is what scopes each row's beads.
    const win = ctx.win || { start: 0, end: DAY_HOURS };
    const xw = (ts) => xPctWin(ts, timezone, date, win.start, win.end);
    const sameLocalDay = (ts) => toLocaleDateString(ts, timezone) === date;

    // windowChips — completed requirements whose completion lands in this row's
    // window. `ownCount` is the own-day subset only (drives the "N met" badge).
    const windowChips = [];
    let ownCount = 0;
    for (const r of (requirements || [])) {
        if (!r || !r.completed_at) continue;
        const xPct = xw(r.completed_at);
        if (xPct === null) continue;
        if (sameLocalDay(r.completed_at)) ownCount++;
        const cat = catById.get(r.category_fk);
        windowChips.push({
            id: r.id,
            title: r.title || '',
            completed_at: r.completed_at,
            category_fk: r.category_fk,
            requirement_status: r.requirement_status || null,
            coordination_type: r.coordination_type || null,
            categoryName: cat?.category_name || null,
            color: cat?.color || null,
            ringColor: coordinationRingColor(dataKey, r.coordination_type),
            leftPct: xPct,
            timezone,
        });
    }

    // drawChips — one chip per (requirement, session) pair; bare requirement → 'left'.
    const drawChips = [];
    for (const chip of windowChips) {
        const sess = sessionsByReq.get(String(chip.id)) || [];
        if (sess.length === 0) {
            drawChips.push({
                ...chip, chipKey: String(chip.id),
                startPct: null, startClamped: false, markerMode: 'left', session: null,
            });
            continue;
        }
        for (const s of sess) {
            const sKey = String(s.id);
            const canonicalStartedAt = canonicalStartById?.get(sKey) ?? s.started_at;
            const clusterN = clusterSizeById?.get(sKey) ?? 1;
            const isAligned = clusterN > 1;
            const swarmStartId  = swarmStartIdById?.get(sKey) ?? null;
            const swarmStartRow = swarmStartById?.get(sKey) ?? null;

            const rawStart = xw(canonicalStartedAt);
            let startPct = rawStart;
            let startClamped = false;
            let markerMode = 'normal';
            if (startPct === null && canonicalStartedAt) {
                startPct = 0; startClamped = true; markerMode = 'clamped';
            } else if (startPct !== null && !isAligned &&
                       Math.abs(chip.leftPct - startPct) < CLOSE_THRESHOLD_PCT) {
                markerMode = 'left';
            }
            drawChips.push({
                ...chip,
                chipKey: `${chip.id}-s${s.id}`,
                startPct, startClamped, markerMode, session: s,
                swarmStartId, swarmStart: swarmStartRow,
                swarmComplete: swarmCompleteBySession?.get(sKey) ?? null,
                groupKey: canonicalStartedAt || '',
            });
        }
    }

    // nowPct for this row — wherever "now" falls inside this row's window. With a
    // wide (36h) window it can legitimately appear on two adjacent rows as context.
    const now = nowIso || new Date().toISOString();
    const nowPct = xw(now);

    // phantomChips — in-progress sessions (req #2504), placed via the four-case
    // computePhantomPlacement helper.
    const phantomChips = [];
    if (Array.isArray(swarmStarts) && swarmStarts.length && Array.isArray(sessions)) {
        const sessionsByStartFk = new Map();
        for (const j of (swarmStartSessions || [])) {
            if (!j || j.swarm_start_fk == null || j.session_fk == null) continue;
            const k = String(j.swarm_start_fk);
            if (!sessionsByStartFk.has(k)) sessionsByStartFk.set(k, []);
            sessionsByStartFk.get(k).push(String(j.session_fk));
        }
        const sessionById = new Map();
        for (const s of sessions) {
            if (s && s.id != null) sessionById.set(String(s.id), s);
        }
        for (const ss of swarmStarts) {
            if (!ss || ss.id == null || !ss.started_at) continue;
            const startPct = xw(ss.started_at);
            const placement = computePhantomPlacement(startPct, nowPct);
            if (placement === null) continue;
            const { phantomStartPct, phantomLeftPct, startClamped } = placement;
            const linked = sessionsByStartFk.get(String(ss.id)) || [];
            for (const sid of linked) {
                const s = sessionById.get(sid);
                if (!s) continue;
                if (isHiddenSwarmStatus(s.swarm_status)) continue;
                const reqId = parseSessionRequirementId(s.source_ref);
                const r = reqId && requirementById ? requirementById.get(reqId) : null;
                if (r && r.completed_at) continue;
                const cat = r ? catById.get(r.category_fk) : null;
                phantomChips.push({
                    id: r ? r.id : (reqId ? Number(reqId) : null),
                    chipKey: `phantom-${reqId || 's' + s.id}-s${s.id}`,
                    isPhantom: true,
                    title: r?.title || ss.arguments || '(in progress)',
                    completed_at: s.started_at || ss.started_at,
                    category_fk: r?.category_fk ?? null,
                    requirement_status: r?.requirement_status ?? null,
                    coordination_type: r?.coordination_type ?? null,
                    categoryName: cat?.category_name || null,
                    color: cat?.color || '#43A047',
                    ringColor: coordinationRingColor(dataKey, r?.coordination_type),
                    leftPct: phantomLeftPct,
                    timezone,
                    session: s,
                    startPct: phantomStartPct,
                    startClamped,
                    markerMode: 'inprogress',
                    swarmStartId: ss.id,
                    swarmStart: ss,
                    groupKey: ss.started_at,
                });
            }
        }
    }

    // undoneChips — tombstones (req #2719). Windowed by xw (null off-window), so
    // a tombstone shows on whatever row(s) its undone_at falls in.
    // xPctFn wrapper drops buildUndoneChips' (tz, date) args on purpose — xw's
    // closure already carries this row's timezone+date (the same values passed).
    const undoneChips = buildUndoneChips({
        swarmUndos, swarmStarts, xPctFn: (ts) => xw(ts), timezone, selectedDate: date,
        requirementById, categoryList, closeThresholdPct: CLOSE_THRESHOLD_PCT,
    });

    // Cross-day ghosts occupy lanes so same-day beads pack around them (req #2747).
    const crossDays = (crossDayMap && crossDayMap.get(date)) || [];
    const crossDayGhosts = buildCrossDayGhosts(crossDays);

    const allSwarmChips = [...drawChips, ...phantomChips, ...undoneChips];
    const placedAll = assignSwarmLanes(
        crossDayGhosts.length ? [...allSwarmChips, ...crossDayGhosts] : allSwarmChips,
        true,  // topDown — row 0 = latest, drawn just under the wire at the row top
    );
    const placed = crossDayGhosts.length
        ? placedAll.filter(c => !c.isCrossDayGhost)
        : placedAll;
    const crossDayPlaced = crossDayGhosts.length
        ? placedAll.filter(c => c.isCrossDayGhost).map(g => ({ ...g.crossDay, lane: g.row }))
        : [];
    const maxRow = placedAll.length ? Math.max(...placedAll.map(c => c.row)) : 0;

    return { placed, crossDayPlaced, nowPct, count: ownCount, maxRow };
}

// ── Swarm-start glyph placement (req #2874) ─────────────────────────────────
// Decide where the canvas draws a completed chip's swarm-start anchor relative to
// its completion bead. Fixes the "short session shows no swarm-start / no duration
// line" bug: when a session's start ≈ completion the model collapses it to
// markerMode 'left' (|leftPct − startPct| < CLOSE_THRESHOLD_PCT), and the canvas
// previously drew NOTHING for that case — so brief swarm sessions rendered as a
// lone bead. This restores the documented "hug the bead's left side" behavior.
//
// Inputs (all in world units): `cx`/`cr` = the bead's center-x and radius;
// `trueX` = xWorld(chip.startPct), the start's real x; `hugGap` = the on-screen
// hug distance already scaled to world units.
//
// Returns:
//   null                              — no anchor (no real start, or start clamped
//                                       off-window / owned by the cross-day layer).
//   { glyphX, connector: null }       — draw the glyph at its true x (normal case).
//   { glyphX, connector: { x1, x2 } } — 'left' collapse: glyph hugged just left of
//                                       the bead + a short connector standing in for
//                                       the collapsed duration line.
// Keys on `startPct != null`, so a bare completed requirement with no session
// (markerMode 'left' but startPct === null) correctly yields null — no glyph.
export function startGlyphPlacement(chip, { cx, cr, trueX, hugGap } = {}) {
    if (!chip || chip.startPct == null || chip.startClamped) return null;
    if (chip.markerMode === 'left') {
        const glyphX = cx - cr - hugGap;
        return { glyphX, connector: { x1: glyphX, x2: cx - cr } };
    }
    return { glyphX: trueX, connector: null };
}

// ── Phase-bar segmentation for "in" zoom ────────────────────────────────────
// Expand a completed chip's duration span [startX..endX] (pixels) into phase
// segments, colored by the req #2332 buckets. Returns the computePhaseSegments
// result ({ classified, segments:[{color,x1Pct,x2Pct,...}] }); callers draw a
// single neutral bar when classified === false.
export function phaseBarSegments(chip, startX, endX) {
    if (!chip || !chip.session) return { classified: false, segments: [] };
    return computePhaseSegments(chip.session, startX, endX);
}
