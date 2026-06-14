import React, { useMemo, useCallback } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { useSwarmVisualizerStore } from '../stores/useSwarmVisualizerStore';
import { localDateStr } from '../utils/dateFormat';

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

const VisualizerToolbar = () => {
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
    const setViewType    = useSwarmVisualizerStore(s => s.setViewType);
    const setCurrentDate = useSwarmVisualizerStore(s => s.setCurrentDate);
    const setBeadWindow  = useSwarmVisualizerStore(s => s.setBeadWindow);
    const setSidewalkOn  = useSwarmVisualizerStore(s => s.setSidewalkOn);
    const setElevatorOn  = useSwarmVisualizerStore(s => s.setElevatorOn);
    const setDataKey     = useSwarmVisualizerStore(s => s.setDataKey);
    const setTitlesOn    = useSwarmVisualizerStore(s => s.setTitlesOn);
    const setCompletesOn = useSwarmVisualizerStore(s => s.setCompletesOn);
    const setPhasesOn    = useSwarmVisualizerStore(s => s.setPhasesOn);
    const setKonvaOn     = useSwarmVisualizerStore(s => s.setKonvaOn);
    const setKonvaWide   = useSwarmVisualizerStore(s => s.setKonvaWide);
    const setCostOn      = useSwarmVisualizerStore(s => s.setCostOn);
    const resetView      = useSwarmVisualizerStore(s => s.resetView);

    const isWeekView = viewType === 'week';
    const todayStr = useMemo(() => localDateStr(), []);

    const step = isWeekView ? 7 : 1;
    const handlePrev = useCallback(() => {
        setCurrentDate(shiftDay(currentDate, -step));
    }, [currentDate, step, setCurrentDate]);
    const handleNext = useCallback(() => {
        setCurrentDate(shiftDay(currentDate, step));
    }, [currentDate, step, setCurrentDate]);
    const handleToday = useCallback(() => {
        // Canvas mode (req #2841): "Today" is a full view reset — recenter on today
        // at mid zoom, full window width. Bump resetView so it fires even when the
        // date is already today.
        setCurrentDate(todayStr);
        resetView();
    }, [todayStr, setCurrentDate, resetView]);

    const handleViewTypeChange = useCallback((_event, next) => {
        if (!next) return;
        setViewType(next);
    }, [setViewType]);

    const handleSidewalkClick = useCallback(() => {
        const next = !sidewalkOn;
        setSidewalkOn(next);
        if (next) {
            setBeadWindow('24h');
            setElevatorOn(false);
        }
    }, [sidewalkOn, setSidewalkOn, setBeadWindow, setElevatorOn]);

    const handleElevatorClick = useCallback(() => {
        if (!isWeekView) return;
        const next = !elevatorOn;
        setElevatorOn(next);
        if (next) {
            setBeadWindow('24h');
            setSidewalkOn(false);
        }
    }, [isWeekView, elevatorOn, setElevatorOn, setBeadWindow, setSidewalkOn]);

    const handleCoordinationClick = useCallback(() => {
        setDataKey(dataKey === 'coordination' ? 'category' : 'coordination');
    }, [dataKey, setDataKey]);

    const handleTitlesClick = useCallback(() => {
        setTitlesOn(!titlesOn);
    }, [titlesOn, setTitlesOn]);

    const handleCompletesClick = useCallback(() => {
        setCompletesOn(!completesOn);
    }, [completesOn, setCompletesOn]);

    const handlePhasesClick = useCallback(() => {
        setPhasesOn(!phasesOn);
    }, [phasesOn, setPhasesOn]);

    const handleKonvaClick = useCallback(() => {
        setKonvaOn(!konvaOn);
    }, [konvaOn, setKonvaOn]);

    const handleCostClick = useCallback(() => {
        setCostOn(!costOn);
    }, [costOn, setCostOn]);

    // Auto-off sidewalk/elevator when the active layout stops applying.
    React.useEffect(() => {
        if (isWeekView && sidewalkOn) setSidewalkOn(false);
    }, [isWeekView, sidewalkOn, setSidewalkOn]);
    // The 6h/12h sub-day zooms only exist in Sidewalk (req #2823 follow-up). If
    // Sidewalk turns off while one is selected, fall back to 24h so the non-
    // sidewalk render paths never see a sub-day window.
    React.useEffect(() => {
        if (!sidewalkOn && (beadWindow === '6h' || beadWindow === '12h')) {
            setBeadWindow('24h');
        }
    }, [sidewalkOn, beadWindow, setBeadWindow]);
    React.useEffect(() => {
        if (!isWeekView && elevatorOn) setElevatorOn(false);
    }, [isWeekView, elevatorOn, setElevatorOn]);

    const displayTitle = isWeekView ? formatWeekTitle(currentDate) : formatDayTitle(currentDate);

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <ToggleButtonGroup value={viewType} exclusive onChange={handleViewTypeChange}
                               size="small" data-testid="visualizer-view-toggle">
                <ToggleButton value="day"  className="cal-toggle-btn">Day</ToggleButton>
                <ToggleButton value="week" className="cal-toggle-btn">Week</ToggleButton>
            </ToggleButtonGroup>
            <Button onClick={handleToday} size="small" className="cal-toggle-btn"
                    variant="outlined" sx={{ textTransform: 'none', ml: 0.5 }}>
                Today
            </Button>
            {/* req #2841 — Canvas (Konva zoomable grid, default) vs Classic
                (SVG/DOM TimeSeriesView baseline, req #2840). When Canvas is on,
                the classic-only window/mode buttons below don't apply and are
                disabled; the data overlays (Autonomy/Title/Done/Phases) still do. */}
            <ToggleButton value="konva" className="cal-toggle-btn" size="small"
                          sx={{ ml: 0.5 }}
                          selected={konvaOn}
                          onChange={handleKonvaClick}
                          data-testid="visualizer-canvas-toggle">
                Canvas
            </ToggleButton>
            <ToggleButtonGroup size="small" sx={{ ml: 0.5 }}
                               data-testid="timeseries-group">
                {/* 6h / 12h sub-day zooms — Sidewalk-only (req #2823 follow-up).
                    They widen each day panel so the strip scrolls through a slice
                    of the day, spreading chips + phase segments out. Disabled
                    outside Sidewalk, where a sub-day window would clip the day. */}
                <ToggleButton value="6h" className="cal-toggle-btn"
                              selected={beadWindow === '6h' && sidewalkOn}
                              disabled={!sidewalkOn || konvaOn}
                              onChange={() => setBeadWindow('6h')}
                              data-testid="timeseries-window-6h">
                    6h
                </ToggleButton>
                <ToggleButton value="12h" className="cal-toggle-btn"
                              selected={beadWindow === '12h' && sidewalkOn}
                              disabled={!sidewalkOn || konvaOn}
                              onChange={() => setBeadWindow('12h')}
                              data-testid="timeseries-window-12h">
                    12h
                </ToggleButton>
                <ToggleButton value="24h" className="cal-toggle-btn"
                              selected={beadWindow === '24h'}
                              disabled={konvaOn}
                              onChange={() => setBeadWindow('24h')}
                              data-testid="timeseries-window-24h">
                    24h
                </ToggleButton>
                {/* req #2841 — when the Canvas is on, the 36h button toggles the
                    canvas's mid-zoom 36h noon-centered window (on by default);
                    in Classic it selects the 36h bead window as before. */}
                <ToggleButton value="36h" className="cal-toggle-btn"
                              selected={konvaOn ? konvaWide : (beadWindow === '36h' && !sidewalkOn && !elevatorOn)}
                              disabled={konvaOn ? false : (sidewalkOn || elevatorOn)}
                              onChange={konvaOn ? () => setKonvaWide(!konvaWide) : () => setBeadWindow('36h')}
                              data-testid="timeseries-window-36h">
                    36h
                </ToggleButton>
                <ToggleButton value="sidewalk" className="cal-toggle-btn"
                              selected={sidewalkOn && !isWeekView}
                              disabled={isWeekView || konvaOn}
                              onChange={handleSidewalkClick}
                              data-testid="timeseries-sidewalk">
                    Sidewalk
                </ToggleButton>
                <ToggleButton value="elevator" className="cal-toggle-btn"
                              selected={elevatorOn && isWeekView}
                              disabled={!isWeekView || konvaOn}
                              onChange={handleElevatorClick}
                              data-testid="timeseries-elevator">
                    Elevator
                </ToggleButton>
                <ToggleButton value="coordination" className="cal-toggle-btn"
                              selected={dataKey === 'coordination'}
                              onChange={handleCoordinationClick}
                              data-testid="timeseries-data-coordination">
                    Autonomy
                </ToggleButton>
                <ToggleButton value="titles" className="cal-toggle-btn"
                              selected={titlesOn}
                              onChange={handleTitlesClick}
                              data-testid="timeseries-titles">
                    Title
                </ToggleButton>
                <ToggleButton value="completes" className="cal-toggle-btn"
                              selected={completesOn}
                              onChange={handleCompletesClick}
                              data-testid="timeseries-completes">
                    Done
                </ToggleButton>
                <ToggleButton value="phases" className="cal-toggle-btn"
                              selected={phasesOn}
                              onChange={handlePhasesClick}
                              data-testid="timeseries-phases">
                    Phases
                </ToggleButton>
                {/* req #2846 — size each bead by its session's token cost so
                    expensive work stands out at a glance. Canvas-only (the bead
                    sizing lives in KonvaSwarmCanvas); disabled in Classic. */}
                <ToggleButton value="cost" className="cal-toggle-btn"
                              selected={costOn && konvaOn}
                              disabled={!konvaOn}
                              onChange={handleCostClick}
                              data-testid="timeseries-cost"
                              title="Size beads by token cost">
                    Cost
                </ToggleButton>
            </ToggleButtonGroup>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 0.5 }}>
                <IconButton onClick={handlePrev} size="small" data-testid="visualizer-prev">
                    <ChevronLeftIcon />
                </IconButton>
                <Typography data-testid="visualizer-date-title" sx={{
                    fontFamily: "'Roboto',sans-serif", fontSize: '1em', fontWeight: 500,
                    textAlign: 'center', minWidth: 170, whiteSpace: 'nowrap',
                }}>
                    {displayTitle}
                </Typography>
                <IconButton onClick={handleNext} size="small" data-testid="visualizer-next">
                    <ChevronRightIcon />
                </IconButton>
            </Box>
        </Box>
    );
};

export default VisualizerToolbar;
