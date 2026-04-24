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
    const vizKey      = useSwarmVisualizerStore(s => s.vizKey);
    const beadWindow  = useSwarmVisualizerStore(s => s.beadWindow);
    const sidewalkOn  = useSwarmVisualizerStore(s => s.sidewalkOn);
    const elevatorOn  = useSwarmVisualizerStore(s => s.elevatorOn);
    const dataKey     = useSwarmVisualizerStore(s => s.dataKey);
    const setViewType    = useSwarmVisualizerStore(s => s.setViewType);
    const setCurrentDate = useSwarmVisualizerStore(s => s.setCurrentDate);
    const setVizKey      = useSwarmVisualizerStore(s => s.setVizKey);
    const setBeadWindow  = useSwarmVisualizerStore(s => s.setBeadWindow);
    const setSidewalkOn  = useSwarmVisualizerStore(s => s.setSidewalkOn);
    const setElevatorOn  = useSwarmVisualizerStore(s => s.setElevatorOn);
    const setDataKey     = useSwarmVisualizerStore(s => s.setDataKey);

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
        setCurrentDate(todayStr);
    }, [todayStr, setCurrentDate]);

    const handleViewTypeChange = useCallback((_event, next) => {
        if (!next) return;
        setViewType(next);
    }, [setViewType]);

    const handleVizClick = useCallback((viz) => {
        setVizKey(viz);
    }, [setVizKey]);

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

    // Auto-off sidewalk/elevator when the active layout stops applying.
    React.useEffect(() => {
        if (isWeekView && sidewalkOn) setSidewalkOn(false);
    }, [isWeekView, sidewalkOn, setSidewalkOn]);
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
                              selected={beadWindow === '36h' && !sidewalkOn && !elevatorOn}
                              disabled={sidewalkOn || elevatorOn}
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
                <ToggleButton value="elevator" className="cal-toggle-btn"
                              selected={elevatorOn && isWeekView}
                              disabled={!isWeekView}
                              onChange={handleElevatorClick}
                              data-testid="timeseries-elevator">
                    Elevator
                </ToggleButton>
                <ToggleButton value="coordination" className="cal-toggle-btn"
                              selected={dataKey === 'coordination'}
                              onChange={handleCoordinationClick}
                              data-testid="timeseries-data-coordination">
                    Coordination
                </ToggleButton>
            </ToggleButtonGroup>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 0.5 }}>
                <IconButton onClick={handlePrev} size="small" data-testid="visualizer-prev">
                    <ChevronLeftIcon />
                </IconButton>
                <Typography sx={{
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
