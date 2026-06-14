import React, { useContext, useMemo, useCallback, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import { useSwarmVisualizerStore } from '../stores/useSwarmVisualizerStore';
import {
    useRequirementsDone, useSessions, useAllCategories,
    useAllSwarmStarts, useAllSwarmStartSessions,
    useAllRequirements, useAllSwarmUndos,
    useAllSwarmCompletes, useAllSwarmCompleteSessions,
} from '../hooks/useDataQueries';
import { localDateStr } from '../utils/dateFormat';
import { PHASE_SEGMENTS, PHASE_UNCLASSIFIED_COLOR } from '../CalendarFC/timeSeriesSizes';
import TimeSeriesView from '../CalendarFC/TimeSeriesView';
// Lazy — Konva pulls a large canvas bundle; code-split it so the SVG/DOM
// "Classic" path (and helper-only imports such as the elevatorFetchWindow test)
// never evaluate the konva module (req #2841).
const KonvaSwarmCanvas = lazy(() => import('./KonvaSwarmCanvas'));
import Box from '@mui/material/Box';

// req #2823 — compact legend for the "Phases" overlay. Maps PHASE_SEGMENTS to
// swatches grouped by agentic / human family, plus the neutral-gray
// "Unclassified" swatch for legacy (instrumented=0) sessions. Rendered only when
// the Phases toggle is on, so the default view stays uncluttered.
const PhaseSwatch = ({ color, label }) => (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <Box component="span" sx={{
            width: 14, height: 6, borderRadius: '3px',
            backgroundColor: color, flexShrink: 0,
        }} />
        <span>{label}</span>
    </Box>
);

const PhaseLegend = () => {
    const agentic = PHASE_SEGMENTS.filter(p => p.family === 'agentic');
    const human   = PHASE_SEGMENTS.filter(p => p.family === 'human');
    return (
        <Box data-testid="ts-phase-legend"
             sx={{
                 display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                 gap: 1.5, rowGap: 0.5, px: 1, py: 0.5, mb: 0.5,
                 fontSize: '0.75rem', color: 'text.secondary',
             }}>
            <Box component="span" sx={{ fontWeight: 600 }}>Agentic:</Box>
            {agentic.map(p => <PhaseSwatch key={p.key} color={p.color} label={p.label} />)}
            <Box component="span" sx={{ fontWeight: 600, ml: 1 }}>Human:</Box>
            {human.map(p => <PhaseSwatch key={p.key} color={p.color} label={p.label} />)}
            <PhaseSwatch color={PHASE_UNCLASSIFIED_COLOR} label="Unclassified" />
        </Box>
    );
};

// Shift a YYYY-MM-DD string by N days using local calendar parts, so east-of-UTC
// timezones don't roll the result backward.
export const shiftDay = (dateStr, delta) => {
    if (!dateStr) return dateStr;
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return localDateStr(d);
};

// Monday of the week containing `dateStr` (local calendar). Used to quantize the
// elevator fetch window to week boundaries so scrolling within a week never
// slides the window (req #2777).
export const mondayOf = (dateStr) => {
    if (!dateStr) return dateStr;
    const d = new Date(dateStr + 'T12:00:00');
    const mondayOffset = (d.getDay() + 6) % 7;
    return shiftDay(dateStr, -mondayOffset);
};

const SwarmVisualizerView = () => {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();

    const viewType    = useSwarmVisualizerStore(s => s.viewType);
    const currentDate = useSwarmVisualizerStore(s => s.currentDate);
    const beadWindow  = useSwarmVisualizerStore(s => s.beadWindow);
    const sidewalkOn  = useSwarmVisualizerStore(s => s.sidewalkOn);
    const elevatorOn  = useSwarmVisualizerStore(s => s.elevatorOn);
    const dataKey     = useSwarmVisualizerStore(s => s.dataKey);
    const titlesOn    = useSwarmVisualizerStore(s => s.titlesOn);
    const completesOn = useSwarmVisualizerStore(s => s.completesOn);
    const phasesOn    = useSwarmVisualizerStore(s => s.phasesOn);
    const konvaOn     = useSwarmVisualizerStore(s => s.konvaOn);
    const konvaWide   = useSwarmVisualizerStore(s => s.konvaWide);
    const costOn      = useSwarmVisualizerStore(s => s.costOn);
    const viewResetTick = useSwarmVisualizerStore(s => s.viewResetTick);
    const setCurrentDate = useSwarmVisualizerStore(s => s.setCurrentDate);

    const isWeekView = viewType === 'week';

    // Query date range — matches the calendar's time-series logic verbatim:
    //   Sidewalk on (Day)      → ±15 days around currentDate (21-day panel strip)
    //   Elevator on (Week)     → Monday(currentDate) ±28d (infinite strip; req #2779/#2777)
    //   Week view              → Mon..Sun of currentDate's week, ±1 day edges
    //   Day view               → ±1 day around currentDate (tz spillover safety)
    const fetchRange = useMemo(() => {
        // Konva canvas (req #2841) — a wide, week-quantized window so the user can
        // pan freely across ~7 weeks of past + the rest of this week without a
        // refetch. Quantizing to Monday(currentDate) means the query key only
        // changes when toolbar Prev/Next/Today crosses a week boundary, which
        // keepPreviousData masks; free canvas pan never moves the window.
        if (konvaOn) {
            const monday = mondayOf(currentDate);
            return { start: shiftDay(monday, -45), end: shiftDay(monday, 13) };
        }
        if (sidewalkOn && !isWeekView) {
            return { start: shiftDay(currentDate, -15), end: shiftDay(currentDate, 15) };
        }
        if (elevatorOn && isWeekView) {
            // The elevator is an INFINITE vertical strip (req #2779) — drag/wheel/
            // momentum extend it indefinitely into past/future. The scroll reports
            // the TOP day up as `currentDate` (req #2781 — the focus day sits at the
            // top of the frame), so `currentDate` tracks the day at the viewport top
            // and the window follows the scroll. Anchoring the fetch window directly
            // on `currentDate` slid it per-day, generating a new query key on every
            // scroll tick and reloading the data (req #2777). Quantize the window to
            // the Monday of currentDate's week and widen it to ±28d: that covers the
            // handful of panels visible around the top day from any scroll position
            // within the week, and it only changes when the top day crosses a week
            // boundary (a handful of times per sweep), which
            // keepPreviousData on the query masks without a blank flash. (A fast
            // fling past the window briefly shows un-filled days until momentum
            // settles and the debounced refetch lands.)
            const monday = mondayOf(currentDate);
            return { start: shiftDay(monday, -28), end: shiftDay(monday, 28) };
        }
        if (isWeekView) {
            const d = new Date(currentDate + 'T12:00:00');
            const mondayOffset = (d.getDay() + 6) % 7;
            const monday = new Date(d); monday.setDate(d.getDate() - mondayOffset);
            const start = new Date(monday); start.setDate(monday.getDate() - 1);
            const end   = new Date(monday); end.setDate(monday.getDate() + 7);
            return { start: localDateStr(start), end: localDateStr(end) };
        }
        return { start: shiftDay(currentDate, -1), end: shiftDay(currentDate, 1) };
    }, [konvaOn, sidewalkOn, elevatorOn, isWeekView, currentDate]);

    const fetchStart = fetchRange.start + 'T00:00:00';
    const fetchEnd   = fetchRange.end   + 'T23:59:59';

    const { data: requirements = [] } = useRequirementsDone(
        profile?.userName, fetchStart, fetchEnd,
        { fields: 'id,title,completed_at,category_fk,requirement_status,coordination_type' }
    );
    const { data: sessions = [] } = useSessions(profile?.userName);
    const { data: categoryList = [] } = useAllCategories(
        profile?.userName, { fields: 'id,category_name,color,sort_order' }
    );
    // Real swarm-start data (req #2504). The list query is small (bounded TEXT
    // blobs) and globally scoped per user; junction rows are tiny FK pairs.
    // Small projection for the visualizer — we only need id, started_at,
    // session_count, wall_seconds, arguments for cluster + tooltip display.
    const { data: swarmStarts = [] } = useAllSwarmStarts(
        profile?.userName,
        { fields: 'id,started_at,session_count,wall_seconds,turn_count,auto_start,arguments' },
    );
    const { data: swarmStartSessions = [] } = useAllSwarmStartSessions(profile?.userName);
    // Req #2719 — overlay tombstones in place of swarm-start anchors for
    // launches that were /swarm-undone. The snapshot column
    // `swarm_start_fk_at_undo` survives the cascading session delete, so a
    // small projection is enough.
    const { data: swarmUndos = [] } = useAllSwarmUndos(
        profile?.userName,
        { fields: 'id,swarm_start_fk_at_undo,req_id_at_undo,task_name,branch,coordination_type,reason,undone_at' },
    );
    // Req #2497 — overlay completion termini on the session lanes. Small
    // projection: completed_at + status drive the glyph/colour; wall_seconds the
    // duration arc; token columns the two-segment build-vs-ship cost bar;
    // skill_name distinguishes the primary-session lane (no requirement bubble).
    const { data: swarmCompletes = [] } = useAllSwarmCompletes(
        profile?.userName,
        { fields: 'id,skill_name,status,session_count,wall_seconds,' +
                  'tokens_input,tokens_cache_write,tokens_cache_read,tokens_output,' +
                  'started_at,completed_at' },
    );
    const { data: swarmCompleteSessions = [] } = useAllSwarmCompleteSessions(profile?.userName);
    // All requirements (any status) — needed so in-progress phantoms can render
    // the same datacard shape as completed bubbles (req #2504). Small projection
    // keeps the payload tight; the visualizer only consumes id/title/category/
    // coordination/status.
    const { data: allRequirements = [] } = useAllRequirements(
        profile?.userName,
        { fields: 'id,title,category_fk,coordination_type,requirement_status,completed_at,started_at' },
    );

    // Scroll restore — visualizer-specific key so the saved position never
    // leaks into /calview (which has its own `calview_scrollY`).
    React.useEffect(() => {
        const savedY = sessionStorage.getItem('visualizer_scrollY');
        if (savedY !== null) {
            const y = parseInt(savedY, 10);
            sessionStorage.removeItem('visualizer_scrollY');
            requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
        }
    }, []);

    const onChipClick = useCallback((reqId) => {
        sessionStorage.setItem('visualizer_scrollY', String(window.scrollY));
        navigate(`/swarm/requirement/${reqId}`, { state: { from: 'visualizer' } });
    }, [navigate]);

    // Swarm-start anchor click (req #2747) — open the single swarm-start detail,
    // mirroring the requirement-chip flow. Save scroll first so the detail page's
    // Back (navigate(-1) → /swarm, visualizer view persisted) lands on this exact
    // viewpoint. Only real swarm-starts carry an id; estimated anchors pass null.
    const onSwarmStartClick = useCallback((swarmStartId) => {
        if (swarmStartId == null) return;
        sessionStorage.setItem('visualizer_scrollY', String(window.scrollY));
        navigate(`/swarm/swarm-starts/${swarmStartId}`, { state: { from: '/swarm' } });
    }, [navigate]);

    // Tombstone (undone session) click (req #2747) — open the swarm-undo detail
    // rather than the requirement; the undo data is the pertinent context here,
    // and the user can hop to the requirement from there. SwarmUndoDetail's Back
    // honours `state.from`, returning to the visualizer.
    const onUndoClick = useCallback((undoId) => {
        if (undoId == null) return;
        sessionStorage.setItem('visualizer_scrollY', String(window.scrollY));
        navigate(`/swarm/swarm-undos/${undoId}`, { state: { from: '/swarm' } });
    }, [navigate]);

    // Completion-terminus click (req #2497) — open the swarm-complete detail.
    // Mirrors the undo/swarm-start flows; SwarmCompleteDetail's Back honours
    // state.from to return to this viewpoint.
    const onCompleteClick = useCallback((completeId) => {
        if (completeId == null) return;
        sessionStorage.setItem('visualizer_scrollY', String(window.scrollY));
        navigate(`/swarm/swarm-completes/${completeId}`, { state: { from: '/swarm' } });
    }, [navigate]);

    const onCenterDateChange = useCallback((d) => {
        if (d && d !== currentDate) setCurrentDate(d);
    }, [currentDate, setCurrentDate]);

    // Toolbar moved into the parent SwarmView header row (req #2407); this
    // component now renders only the time-series content.
    if (konvaOn) {
        return (
            <div>
                {phasesOn && <PhaseLegend />}
                <Suspense fallback={<Box sx={{ height: 'calc(100vh - 150px)', minHeight: 480 }} />}>
                <KonvaSwarmCanvas
                    requirements={requirements}
                    allRequirements={allRequirements}
                    sessions={sessions}
                    swarmStarts={swarmStarts}
                    swarmStartSessions={swarmStartSessions}
                    swarmUndos={swarmUndos}
                    swarmCompletes={swarmCompletes}
                    swarmCompleteSessions={swarmCompleteSessions}
                    selectedDate={currentDate}
                    timezone={profile?.timezone}
                    categoryList={categoryList}
                    rangeStart={fetchRange.start}
                    rangeEnd={fetchRange.end}
                    dataKey={dataKey}
                    titlesOn={titlesOn}
                    completesOn={completesOn}
                    phasesOn={phasesOn}
                    costOn={costOn}
                    wide36={konvaWide}
                    resetTick={viewResetTick}
                    onChipClick={onChipClick}
                    onSwarmStartClick={onSwarmStartClick}
                    onUndoClick={onUndoClick}
                    onCompleteClick={onCompleteClick}
                />
                </Suspense>
            </div>
        );
    }

    return (
        <div>
            {phasesOn && <PhaseLegend />}
            <TimeSeriesView
                requirements={requirements}
                allRequirements={allRequirements}
                sessions={sessions}
                swarmStarts={swarmStarts}
                swarmStartSessions={swarmStartSessions}
                swarmUndos={swarmUndos}
                swarmCompletes={swarmCompletes}
                swarmCompleteSessions={swarmCompleteSessions}
                selectedDate={currentDate}
                timezone={profile?.timezone}
                beadWindow={beadWindow}
                sidewalkOn={sidewalkOn}
                elevatorOn={elevatorOn}
                dataKey={dataKey}
                titlesOn={titlesOn}
                completesOn={completesOn}
                phasesOn={phasesOn}
                isWeekView={isWeekView}
                categoryList={categoryList}
                onChipClick={onChipClick}
                onSwarmStartClick={onSwarmStartClick}
                onUndoClick={onUndoClick}
                onCompleteClick={onCompleteClick}
                onCenterDateChange={onCenterDateChange}
            />
        </div>
    );
};

export default SwarmVisualizerView;
