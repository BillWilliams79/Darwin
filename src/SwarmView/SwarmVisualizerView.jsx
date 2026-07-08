import React, { useContext, useMemo, useCallback, useState, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import { useSwarmVisualizerStore } from '../stores/useSwarmVisualizerStore';
import {
    useRequirementsDone, useSessions, useAllCategories,
    useAllSwarmStarts, useAllSwarmStartSessions,
    useAllRequirements, useAllSwarmUndos,
    useAllSwarmCompletes, useAllSwarmCompleteSessions,
    useDevServers,
} from '../hooks/useDataQueries';
import { localDateStr } from '../utils/dateFormat';
import { PHASE_SEGMENTS, PHASE_UNCLASSIFIED_COLOR } from '../CalendarFC/timeSeriesSizes';
// The Konva canvas (req #2841) is the only visualizer substrate (req #2844 —
// the SVG/DOM "Classic" TimeSeriesView was retired). Lazy because Konva pulls a
// large canvas bundle; code-split it so the rest of /swarm doesn't pay for it.
const KonvaSwarmCanvas = lazy(() => import('./KonvaSwarmCanvas'));
import Box from '@mui/material/Box';

// req #2823 — compact legend for the "Phases" overlay. Maps PHASE_SEGMENTS to
// swatches grouped by agentic / human family, plus the neutral-gray
// "Unclassified" swatch for legacy (instrumented=0) sessions. Rendered only when
// the Phases toggle is on, so the default view stays uncluttered.
// req #2880 — the phase key follows the same rule the canvas uses to draw phase
// SEGMENTS (`usePhases = phasesOn || level === 'in'`): the Phases toggle controls
// it at the out/mid levels, but the deepest ('in') zoom always shows phases, so
// the key is forced visible there regardless of the toggle.
export const shouldShowPhaseLegend = ({ phasesOn, zoomLevel }) =>
    !!phasesOn || zoomLevel === 'in';

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
// Konva fetch window to week boundaries so panning never slides the window
// (req #2777).
export const mondayOf = (dateStr) => {
    if (!dateStr) return dateStr;
    const d = new Date(dateStr + 'T12:00:00');
    const mondayOffset = (d.getDay() + 6) % 7;
    return shiftDay(dateStr, -mondayOffset);
};

const SwarmVisualizerView = () => {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();

    const currentDate = useSwarmVisualizerStore(s => s.currentDate);
    const dataKey     = useSwarmVisualizerStore(s => s.dataKey);
    const titlesOn    = useSwarmVisualizerStore(s => s.titlesOn);
    const completesOn = useSwarmVisualizerStore(s => s.completesOn);
    const phasesOn    = useSwarmVisualizerStore(s => s.phasesOn);
    const konvaWide   = useSwarmVisualizerStore(s => s.konvaWide);
    const costOn      = useSwarmVisualizerStore(s => s.costOn);
    const devServersOn = useSwarmVisualizerStore(s => s.devServersOn);
    const viewResetTick = useSwarmVisualizerStore(s => s.viewResetTick);
    // Scroll-up auto-extend (req #2859) — how many extra days of history the
    // canvas has asked for, plus the action it calls when the user pans near the
    // oldest loaded day.
    const pastExtraDays = useSwarmVisualizerStore(s => s.pastExtraDays);
    const extendPast    = useSwarmVisualizerStore(s => s.extendPast);

    // Current semantic zoom level reported by the canvas (req #2880). At the `in`
    // level phase segments draw regardless of the Phases toggle, so the phase key
    // must follow suit — show it whenever phasesOn OR we're zoomed all the way in.
    const [zoomLevel, setZoomLevel] = useState('mid');

    // Konva canvas fetch window (req #2841) — a wide, week-quantized range so the
    // user can pan freely across ~7 weeks of past + the rest of this week without
    // a refetch. Quantizing to Monday(currentDate) means the query key only
    // changes when toolbar Prev/Next/Today crosses a week boundary, which
    // keepPreviousData masks; free canvas pan never moves the window.
    //
    // req #2859 — `pastExtraDays` widens the window's PAST edge further back as the
    // user pans up near the oldest loaded day, so scrolling up never dead-ends.
    // The future edge (and Monday quantization) is unchanged, so a backward
    // extension only prepends older days; keepPreviousData masks the refetch.
    const fetchRange = useMemo(() => {
        const monday = mondayOf(currentDate);
        return { start: shiftDay(monday, -45 - pastExtraDays), end: shiftDay(monday, 13) };
    }, [currentDate, pastExtraDays]);

    // How many days to fetch per scroll-up extension (req #2859). A multiple of 7
    // keeps the past edge Monday-aligned like the base window, so the per-day
    // grid stays phase-stable across extensions.
    const onExtendPast = useCallback(() => extendPast(28), [extendPast]);

    const fetchStart = fetchRange.start + 'T00:00:00';
    const fetchEnd   = fetchRange.end   + 'T23:59:59';

    const { data: requirements = [] } = useRequirementsDone(
        profile?.userName, fetchStart, fetchEnd,
        { fields: 'id,title,completed_at,category_fk,requirement_status,coordination_type,ai_model' }
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
        { fields: 'id,title,category_fk,coordination_type,ai_model,requirement_status,completed_at,started_at' },
    );
    // Active dev servers (req #2857) — overlay a clickable port pill on each bead
    // whose session has an active, associated dev server. The table holds only
    // currently-claimed servers (released ones are deleted), so a row's mere
    // presence means "active". Small projection: id + port + session link + the
    // terminal number for the hover card. Reads route through `darwinOpsUri`
    // (always production `darwin`) per the req #2871 dev_servers carve-out — this
    // table is live machine state written by the MCP claim_dev_server tool, never
    // a seeded `darwin_dev` fixture, so a dev build reads the real claims.
    const { data: devServers = [] } = useDevServers(
        profile?.userName,
        { fields: 'id,port,session_fk,terminal_number,started_at' },
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

    // Toolbar moved into the parent SwarmView header row (req #2407); this
    // component now renders only the Konva canvas content (req #2844).
    return (
        <div>
            {shouldShowPhaseLegend({ phasesOn, zoomLevel }) && <PhaseLegend />}
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
                devServers={devServers}
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
                devServersOn={devServersOn}
                wide36={konvaWide}
                resetTick={viewResetTick}
                onChipClick={onChipClick}
                onSwarmStartClick={onSwarmStartClick}
                onUndoClick={onUndoClick}
                onCompleteClick={onCompleteClick}
                onExtendPast={onExtendPast}
                onLevelChange={setZoomLevel}
            />
            </Suspense>
        </div>
    );
};

export default SwarmVisualizerView;
