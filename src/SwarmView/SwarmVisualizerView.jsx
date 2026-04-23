import React, { useContext, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

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

const formatDayTitle = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString(undefined, {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
};

const formatWeekTitle = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    const mondayOffset = (d.getDay() + 6) % 7;
    const monday = new Date(d); monday.setDate(d.getDate() - mondayOffset);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const opts   = { month: 'short', day: 'numeric' };
    const optsYr = { month: 'short', day: 'numeric', year: 'numeric' };
    return `Week of ${monday.toLocaleDateString(undefined, opts)} – ${sunday.toLocaleDateString(undefined, optsYr)}`;
};

const SwarmVisualizerView = () => {
    const { profile } = useContext(AuthContext);
    const navigate = useNavigate();

    const viewType    = useSwarmVisualizerStore(s => s.viewType);
    const currentDate = useSwarmVisualizerStore(s => s.currentDate);
    const vizKey      = useSwarmVisualizerStore(s => s.vizKey);
    const beadWindow  = useSwarmVisualizerStore(s => s.beadWindow);
    const sidewalkOn  = useSwarmVisualizerStore(s => s.sidewalkOn);
    const setViewType    = useSwarmVisualizerStore(s => s.setViewType);
    const setCurrentDate = useSwarmVisualizerStore(s => s.setCurrentDate);
    const setVizKey      = useSwarmVisualizerStore(s => s.setVizKey);
    const setBeadWindow  = useSwarmVisualizerStore(s => s.setBeadWindow);
    const setSidewalkOn  = useSwarmVisualizerStore(s => s.setSidewalkOn);

    const isWeekView = viewType === 'week';
    const todayStr = useMemo(() => localDateStr(), []);

    // Query date range — matches the calendar's time-series logic verbatim:
    //   Sidewalk on + Day view → ±15 days around currentDate (21-day panel strip)
    //   Week view              → Mon..Sun of currentDate's week, ±1 day edges
    //   Day view               → ±1 day around currentDate (tz spillover safety)
    const fetchRange = useMemo(() => {
        if (sidewalkOn && !isWeekView) {
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
    }, [sidewalkOn, isWeekView, currentDate]);

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

    // Prev/Next shifts by 7 days in week view, 1 day otherwise. Today returns to today.
    const step = isWeekView ? 7 : 1;
    const handlePrev = useCallback(() => {
        setCurrentDate(shiftDay(currentDate, -step));
    }, [currentDate, step, setCurrentDate]);
    const handleNext = useCallback(() => {
        setCurrentDate(shiftDay(currentDate, step));
    }, [currentDate, step, setCurrentDate]);
    const handleToday = useCallback(() => {
        setCurrentDate(todayStr);
    }, [todayStr, setCurrentDate]);

    const handleViewTypeChange = useCallback((_event, next) => {
        if (!next) return;
        setViewType(next);
    }, [setViewType]);

    // Bead / Swarm click behaves like a radio — the only currently-selectable
    // viz is the one clicked. Unlike the old calendar toolbar there's no
    // "Time Series off" state to toggle into, because the visualizer IS the
    // time series view here.
    const handleVizClick = useCallback((viz) => {
        setVizKey(viz);
    }, [setVizKey]);

    // Sidewalk forces 24h bead window; also auto-disabled in week view.
    const handleSidewalkClick = useCallback(() => {
        const next = !sidewalkOn;
        setSidewalkOn(next);
        if (next) setBeadWindow('24h');
    }, [sidewalkOn, setSidewalkOn, setBeadWindow]);

    // If the user switches to Week view while Sidewalk is on, turn Sidewalk off
    // (Sidewalk is a Day-only layout).
    React.useEffect(() => {
        if (isWeekView && sidewalkOn) setSidewalkOn(false);
    }, [isWeekView, sidewalkOn, setSidewalkOn]);

    const displayTitle = isWeekView ? formatWeekTitle(currentDate) : formatDayTitle(currentDate);

    // Scroll restore — use a visualizer-specific sessionStorage key so the
    // saved position never leaks into /calview (which has its own `calview_scrollY`).
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

    // Layout mirrors the old Calendar Time-Series render: toolbar sits inside
    // a `px: 2, pt: '18pt'` Box (same as the Calendar toolbar wrapper), and
    // TimeSeriesView renders full-bleed below it — identical to the previous
    // `<div><TimeSeriesView/></div>` placement outside the calendar's padded Box.
    return (
        <>
            <Box sx={{ px: 2, pt: '18pt' }}>
            {/* Toolbar row: view toggle + viz toggle group + date nav */}
            <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                mb: 1.5, flexWrap: 'wrap', gap: 1,
            }}>
                {/* Left: Day/Week + Today + Bead/Swarm/24h/36h/Sidewalk */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <ToggleButtonGroup value={viewType} exclusive onChange={handleViewTypeChange}
                                       size="small" data-testid="visualizer-view-toggle">
                        <ToggleButton value="day"  className="cal-toggle-btn">Day</ToggleButton>
                        <ToggleButton value="week" className="cal-toggle-btn">Week</ToggleButton>
                    </ToggleButtonGroup>
                    <Button onClick={handleToday} size="small" className="cal-toggle-btn"
                            variant="outlined" sx={{ textTransform: 'none', ml: 0.5 }}>
                        Today
                    </Button>
                    <ToggleButtonGroup size="small" sx={{ ml: 0.5 }}
                                       data-testid="timeseries-group">
                        <ToggleButton value="bead" className="cal-toggle-btn"
                                      selected={vizKey === 'bead'}
                                      onChange={() => handleVizClick('bead')}
                                      data-testid="timeseries-viz-bead">
                            Bead
                        </ToggleButton>
                        <ToggleButton value="swarm" className="cal-toggle-btn"
                                      selected={vizKey === 'swarm'}
                                      onChange={() => handleVizClick('swarm')}
                                      data-testid="timeseries-viz-swarm">
                            Swarm
                        </ToggleButton>
                        <ToggleButton value="24h" className="cal-toggle-btn"
                                      selected={beadWindow === '24h'}
                                      onChange={() => setBeadWindow('24h')}
                                      data-testid="timeseries-window-24h">
                            24h
                        </ToggleButton>
                        <ToggleButton value="36h" className="cal-toggle-btn"
                                      selected={beadWindow === '36h' && !sidewalkOn}
                                      disabled={sidewalkOn}
                                      onChange={() => setBeadWindow('36h')}
                                      data-testid="timeseries-window-36h">
                            36h
                        </ToggleButton>
                        <ToggleButton value="sidewalk" className="cal-toggle-btn"
                                      selected={sidewalkOn && !isWeekView}
                                      disabled={isWeekView}
                                      onChange={handleSidewalkClick}
                                      data-testid="timeseries-sidewalk">
                            Sidewalk
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>
                {/* Center: ← Title → */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <IconButton onClick={handlePrev} size="small" data-testid="visualizer-prev">
                        <ChevronLeftIcon />
                    </IconButton>
                    <Typography sx={{
                        fontFamily: "'Roboto',sans-serif", fontSize: '1.3em', fontWeight: 500,
                        textAlign: 'center', minWidth: 180,
                    }}>
                        {displayTitle}
                    </Typography>
                    <IconButton onClick={handleNext} size="small" data-testid="visualizer-next">
                        <ChevronRightIcon />
                    </IconButton>
                </Box>
                {/* Right spacer to keep center column truly centered when width allows */}
                <Box sx={{ minWidth: 1 }} />
            </Box>
            </Box>

            <div>
                <TimeSeriesView
                    requirements={requirements}
                    sessions={sessions}
                    selectedDate={currentDate}
                    timezone={profile?.timezone}
                    beadWindow={beadWindow}
                    vizKey={vizKey}
                    sidewalkOn={sidewalkOn}
                    isWeekView={isWeekView}
                    categoryList={categoryList}
                    onChipClick={onChipClick}
                    onCenterDateChange={onCenterDateChange}
                />
            </div>
        </>
    );
};

export default SwarmVisualizerView;
