import React, { useContext, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthContext from '../Context/AuthContext';
import { useSwarmVisualizerStore } from '../stores/useSwarmVisualizerStore';
import { useRequirementsDone, useSessions, useAllCategories } from '../hooks/useDataQueries';
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
                sessions={sessions}
                selectedDate={currentDate}
                timezone={profile?.timezone}
                beadWindow={beadWindow}
                vizKey={vizKey}
                sidewalkOn={sidewalkOn}
                elevatorOn={elevatorOn}
                dataKey={dataKey}
                isWeekView={isWeekView}
                categoryList={categoryList}
                onChipClick={onChipClick}
                onCenterDateChange={onCenterDateChange}
            />
        </div>
    );
};

export default SwarmVisualizerView;
