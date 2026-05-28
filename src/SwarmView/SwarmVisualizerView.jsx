import React, { useContext, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import { useSwarmVisualizerStore } from '../stores/useSwarmVisualizerStore';
import {
    useRequirementsDone, useSessions, useAllCategories,
    useAllSwarmStarts, useAllSwarmStartSessions,
    useAllRequirements, useAllSwarmUndos,
} from '../hooks/useDataQueries';
import { localDateStr } from '../utils/dateFormat';
import TimeSeriesView from '../CalendarFC/TimeSeriesView';

// Shift a YYYY-MM-DD string by N days using local calendar parts, so east-of-UTC
// timezones don't roll the result backward.
const shiftDay = (dateStr, delta) => {
    if (!dateStr) return dateStr;
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return localDateStr(d);
};

const SwarmVisualizerView = () => {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();

    const viewType    = useSwarmVisualizerStore(s => s.viewType);
    const currentDate = useSwarmVisualizerStore(s => s.currentDate);
    const vizKey      = useSwarmVisualizerStore(s => s.vizKey);
    const beadWindow  = useSwarmVisualizerStore(s => s.beadWindow);
    const sidewalkOn  = useSwarmVisualizerStore(s => s.sidewalkOn);
    const elevatorOn  = useSwarmVisualizerStore(s => s.elevatorOn);
    const dataKey     = useSwarmVisualizerStore(s => s.dataKey);
    const titlesOn    = useSwarmVisualizerStore(s => s.titlesOn);
    const setCurrentDate = useSwarmVisualizerStore(s => s.setCurrentDate);

    const isWeekView = viewType === 'week';

    // Query date range — matches the calendar's time-series logic verbatim:
    //   Sidewalk on (Day)      → ±15 days around currentDate (21-day panel strip)
    //   Elevator on (Week)     → ±15 days around currentDate (vertical 21-day strip)
    //   Week view              → Mon..Sun of currentDate's week, ±1 day edges
    //   Day view               → ±1 day around currentDate (tz spillover safety)
    const fetchRange = useMemo(() => {
        if (sidewalkOn && !isWeekView) {
            return { start: shiftDay(currentDate, -15), end: shiftDay(currentDate, 15) };
        }
        if (elevatorOn && isWeekView) {
            return { start: shiftDay(currentDate, -15), end: shiftDay(currentDate, 15) };
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
    }, [sidewalkOn, elevatorOn, isWeekView, currentDate]);

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
        { fields: 'id,started_at,session_count,wall_seconds,turn_count,auto_start,arguments,autonomy_filter' },
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

    const onCenterDateChange = useCallback((d) => {
        if (d && d !== currentDate) setCurrentDate(d);
    }, [currentDate, setCurrentDate]);

    // Toolbar moved into the parent SwarmView header row (req #2407); this
    // component now renders only the time-series content.
    return (
        <div>
            <TimeSeriesView
                requirements={requirements}
                allRequirements={allRequirements}
                sessions={sessions}
                swarmStarts={swarmStarts}
                swarmStartSessions={swarmStartSessions}
                swarmUndos={swarmUndos}
                selectedDate={currentDate}
                timezone={profile?.timezone}
                beadWindow={beadWindow}
                vizKey={vizKey}
                sidewalkOn={sidewalkOn}
                elevatorOn={elevatorOn}
                dataKey={dataKey}
                titlesOn={titlesOn}
                isWeekView={isWeekView}
                categoryList={categoryList}
                onChipClick={onChipClick}
                onCenterDateChange={onCenterDateChange}
            />
        </div>
    );
};

export default SwarmVisualizerView;
