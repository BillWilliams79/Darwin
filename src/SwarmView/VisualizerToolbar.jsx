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

// req #2844 — the Konva canvas is the only visualizer substrate now (the Classic
// SVG/DOM TimeSeriesView and its Day/Week, Sidewalk, Elevator, and sub-day bead
// windows were retired). The toolbar keeps only the Konva-relevant controls:
// date navigation, the 36h mid-zoom toggle, and the data overlays.
const VisualizerToolbar = () => {
    const currentDate = useSwarmVisualizerStore(s => s.currentDate);
    const dataKey     = useSwarmVisualizerStore(s => s.dataKey);
    const titlesOn    = useSwarmVisualizerStore(s => s.titlesOn);
    const completesOn = useSwarmVisualizerStore(s => s.completesOn);
    const phasesOn    = useSwarmVisualizerStore(s => s.phasesOn);
    const konvaWide   = useSwarmVisualizerStore(s => s.konvaWide);
    const costOn      = useSwarmVisualizerStore(s => s.costOn);
    const setCurrentDate = useSwarmVisualizerStore(s => s.setCurrentDate);
    const setDataKey     = useSwarmVisualizerStore(s => s.setDataKey);
    const setTitlesOn    = useSwarmVisualizerStore(s => s.setTitlesOn);
    const setCompletesOn = useSwarmVisualizerStore(s => s.setCompletesOn);
    const setPhasesOn    = useSwarmVisualizerStore(s => s.setPhasesOn);
    const setKonvaWide   = useSwarmVisualizerStore(s => s.setKonvaWide);
    const setCostOn      = useSwarmVisualizerStore(s => s.setCostOn);
    const resetView      = useSwarmVisualizerStore(s => s.resetView);

    const todayStr = useMemo(() => localDateStr(), []);

    const handlePrev = useCallback(() => {
        setCurrentDate(shiftDay(currentDate, -1));
    }, [currentDate, setCurrentDate]);
    const handleNext = useCallback(() => {
        setCurrentDate(shiftDay(currentDate, 1));
    }, [currentDate, setCurrentDate]);
    const handleToday = useCallback(() => {
        // Canvas mode (req #2841): "Today" is a full view reset — recenter on today
        // at mid zoom, full window width. Bump resetView so it fires even when the
        // date is already today.
        setCurrentDate(todayStr);
        resetView();
    }, [todayStr, setCurrentDate, resetView]);

    const handleWideClick = useCallback(() => {
        setKonvaWide(!konvaWide);
    }, [konvaWide, setKonvaWide]);

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

    const handleCostClick = useCallback(() => {
        setCostOn(!costOn);
    }, [costOn, setCostOn]);

    const displayTitle = formatDayTitle(currentDate);

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <Button onClick={handleToday} size="small" className="cal-toggle-btn"
                    variant="outlined" sx={{ textTransform: 'none' }}>
                Today
            </Button>
            <ToggleButtonGroup size="small" sx={{ ml: 0.5 }}
                               data-testid="timeseries-group">
                {/* req #2841 — 36h toggles the canvas's mid-zoom 36h noon-centered
                    window (on by default). */}
                <ToggleButton value="36h" className="cal-toggle-btn"
                              selected={konvaWide}
                              onChange={handleWideClick}
                              data-testid="timeseries-window-36h">
                    36h
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
                    expensive work stands out at a glance. The Konva canvas is the
                    only visualizer substrate (req #2844). */}
                <ToggleButton value="cost" className="cal-toggle-btn"
                              selected={costOn}
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
