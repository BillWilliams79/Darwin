import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { toLocaleDateString, getTimeOfDayFraction, formatCardDateTime, formatHM12 } from '../utils/dateFormat';
import './TimeSeriesView.css';

// ─────────── Cluster-stack layout ─────────────────────────────────────────────
// Chips sorted by leftPct. If a chip is within clusterGapPct of the *previous*
// chip, it extends the current stack upward (row = prev.row + 1). Otherwise a
// new stack begins at row 0. Produces the "tall finger" look — chips from the
// same time window grow a single tower; distinct clusters each get their own.
const MAX_ROWS = 24;
const assignRows = (chips, minGapPct) => {
    const sorted = [...chips].sort((a, b) => a.leftPct - b.leftPct);
    const out = [];
    let stackRow = -1;
    let lastPct = -Infinity;
    for (const chip of sorted) {
        const isCluster = chip.leftPct - lastPct < minGapPct;
        if (isCluster) {
            const nextRow = stackRow + 1;
            if (nextRow < MAX_ROWS) {
                out.push({ ...chip, row: nextRow });
                stackRow = nextRow;
            } else {
                // Rare: >24 chips inside the same time cluster — drop the oldest overflow;
                // keep chip in the stack at MAX_ROWS-1 (reader sees the cluster capped).
                out.push({ ...chip, row: MAX_ROWS - 1 });
            }
        } else {
            out.push({ ...chip, row: 0 });
            stackRow = 0;
        }
        lastPct = chip.leftPct;
    }
    return out;
};

// ─────────── Date helpers ─────────────────────────────────────────────────────
const shiftDateStr = (dateStr, delta) => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
};

// 36h window: 18:00 prev → 06:00 next
const bead36hXPct = (completedAt, timezone, selectedDate) => {
    const chipDay = toLocaleDateString(completedAt, timezone);
    const chipFrac = getTimeOfDayFraction(completedAt, timezone);
    if (chipFrac === null || chipDay === null) return null;
    const prevDay = shiftDateStr(selectedDate, -1);
    const nextDay = shiftDateStr(selectedDate, 1);

    let hoursFromStart;
    if (chipDay === prevDay) {
        if (chipFrac < 18 / 24) return null;
        hoursFromStart = (chipFrac - 18 / 24) * 24;
    } else if (chipDay === selectedDate) {
        hoursFromStart = 6 + chipFrac * 24;
    } else if (chipDay === nextDay) {
        if (chipFrac >= 6 / 24) return null;
        hoursFromStart = 30 + chipFrac * 24;
    } else {
        return null;
    }
    return (hoursFromStart / 36) * 100;
};

// 24h window: selectedDate 00:00 → 24:00
const bead24hXPct = (completedAt, timezone, selectedDate) => {
    const chipDay = toLocaleDateString(completedAt, timezone);
    if (chipDay !== selectedDate) return null;
    const frac = getTimeOfDayFraction(completedAt, timezone);
    if (frac === null) return null;
    return frac * 100;
};

// ─────────── Tick sets ────────────────────────────────────────────────────────
const BEAD_TICKS_36H = [
    { pct: 0,              label: '6pm',  kind: 'minor' },
    { pct: 100 * 6  / 36,  label: '12am', kind: 'major' },
    { pct: 100 * 12 / 36,  label: '6am',  kind: 'minor' },
    { pct: 100 * 18 / 36,  label: '12pm', kind: 'major' },
    { pct: 100 * 24 / 36,  label: '6pm',  kind: 'minor' },
    { pct: 100 * 30 / 36,  label: '12am', kind: 'major' },
    { pct: 100,            label: '6am',  kind: 'minor' },
];
const BEAD_TICKS_24H = [
    { pct: 0,     label: '12am', kind: 'major' },
    { pct: 12.5,  label: '3am',  kind: 'minor' },
    { pct: 25,    label: '6am',  kind: 'minor' },
    { pct: 37.5,  label: '9am',  kind: 'minor' },
    { pct: 50,    label: '12pm', kind: 'major' },
    { pct: 62.5,  label: '3pm',  kind: 'minor' },
    { pct: 75,    label: '6pm',  kind: 'minor' },
    { pct: 87.5,  label: '9pm',  kind: 'minor' },
    { pct: 100,   label: '12am', kind: 'major' },
];

// ─────────── Tick / label components ──────────────────────────────────────────
const BeadTimeline = ({ ticks }) => (
    <Box className="ts-bead-timeline" data-testid="ts-bead-timeline" aria-hidden="true">
        {ticks.map((t, i) => (
            <Box key={i} className={`ts-bead-tick ts-bead-tick-${t.kind}`} style={{ left: `${t.pct}%` }}>
                <span className="ts-bead-tick-line" />
                <span className="ts-bead-tick-label">{t.label}</span>
            </Box>
        ))}
    </Box>
);

const DayLabels36h = ({ selectedDate, timezone }) => {
    const fmt = (s) => {
        const d = new Date(s + 'T12:00:00');
        const opts = { weekday: 'short', month: 'short', day: 'numeric', ...(timezone && { timeZone: timezone }) };
        return d.toLocaleDateString(undefined, opts);
    };
    return (
        <Box className="ts-bead-days" aria-hidden="true">
            <span className="ts-bead-day-label" style={{ left: '8.33%' }}>{fmt(shiftDateStr(selectedDate, -1))}</span>
            <span className="ts-bead-day-label ts-bead-day-label-sel" style={{ left: '50%' }}>{fmt(selectedDate)}</span>
            <span className="ts-bead-day-label" style={{ left: '91.67%' }}>{fmt(shiftDateStr(selectedDate, 1))}</span>
        </Box>
    );
};

const DayLabel24h = ({ selectedDate, timezone }) => {
    const d = new Date(selectedDate + 'T12:00:00');
    const opts = { weekday: 'short', month: 'short', day: 'numeric', ...(timezone && { timeZone: timezone }) };
    return (
        <Box className="ts-bead-days" aria-hidden="true">
            <span className="ts-bead-day-label ts-bead-day-label-sel" style={{ left: '50%' }}>
                {d.toLocaleDateString(undefined, opts)}
            </span>
        </Box>
    );
};

// ─────────── Main Bead Necklace ────────────────────────────────────────────────
const TimeSeriesView = ({
    requirements = [],
    selectedDate,
    timezone,
    beadWindow = '24h',      // '24h' | '36h'
    categoryList = [],
    onPrevDay,
    onNextDay,
    onChipClick,
}) => {
    const window36h = beadWindow === '36h';
    const ticks = window36h ? BEAD_TICKS_36H : BEAD_TICKS_24H;
    const xPctFn = window36h ? bead36hXPct : bead24hXPct;

    // Chips within the window.
    const windowChips = useMemo(() => {
        if (!selectedDate) return [];
        const out = [];
        for (const r of requirements) {
            if (!r.completed_at) continue;
            const xPct = xPctFn(r.completed_at, timezone, selectedDate);
            if (xPct === null) continue;
            const cat = categoryList.find(c => c.id === r.category_fk);
            out.push({
                id: r.id,
                title: r.title || '',
                completed_at: r.completed_at,
                category_fk: r.category_fk,
                color: cat?.color || null,
                timeHHMM: formatHM12(r.completed_at, timezone),
                leftPct: xPct,
                timezone,
            });
        }
        return out;
    }, [requirements, categoryList, selectedDate, timezone, xPctFn]);

    // Cluster-stack the beads.
    const minGapPct = 1.2;
    const placed = assignRows(windowChips, minGapPct);
    const maxStackRow = placed.length ? Math.max(...placed.map(c => c.row)) : 0;
    const height = Math.max(200, maxStackRow * 18 + 140);

    // Now marker.
    const nowPct = useMemo(() => {
        const now = new Date().toISOString();
        return xPctFn(now, timezone, selectedDate);
    }, [timezone, selectedDate, xPctFn]);

    const windowLabel = window36h ? '36h window' : '24h window';

    return (
        <Box className="ts-view" data-testid="time-series-view">
            <Box className={`ts-bead ts-bead-${window36h ? '36h' : '24h'}`}
                 data-testid="ts-bead"
                 style={{ height: `${height}px` }}>

                <IconButton
                    className="ts-bead-nav ts-bead-nav-prev"
                    data-testid="ts-bead-prev-day"
                    onClick={onPrevDay}
                    size="small"
                    aria-label="previous day"
                >
                    <ChevronLeftIcon />
                </IconButton>
                <IconButton
                    className="ts-bead-nav ts-bead-nav-next"
                    data-testid="ts-bead-next-day"
                    onClick={onNextDay}
                    size="small"
                    aria-label="next day"
                >
                    <ChevronRightIcon />
                </IconButton>

                {window36h
                    ? <DayLabels36h selectedDate={selectedDate} timezone={timezone} />
                    : <DayLabel24h selectedDate={selectedDate} timezone={timezone} />
                }

                {ticks.filter(t => t.kind === 'major').map((t, i) => (
                    <Box key={i} className="ts-bead-divider" style={{ left: `${t.pct}%` }} />
                ))}

                {nowPct !== null && (
                    <Box className="ts-now-marker" data-testid="ts-now-marker" style={{ left: `${nowPct}%` }} />
                )}

                <Box className="ts-bead-wire" />
                <BeadTimeline ticks={ticks} />

                {placed.map(chip => (
                    <Tooltip
                        key={chip.id}
                        title={
                            <>
                                <div>#{chip.id} {chip.title}</div>
                                <div style={{ opacity: 0.8, fontSize: '0.8em' }}>{formatCardDateTime(chip.completed_at, chip.timezone)}</div>
                            </>
                        }
                        arrow
                    >
                        <Box
                            className="ts-bead-group"
                            data-testid={`ts-chip-${chip.id}`}
                            style={{
                                left: `${chip.leftPct}%`,
                                bottom: `${chip.row * 18 + 88}px`,
                            }}
                            onClick={() => onChipClick && onChipClick(chip.id)}
                        >
                            <span className="ts-bead-id">#{chip.id}</span>
                            <span
                                className="ts-bead-dot"
                                style={{ backgroundColor: chip.color || '#90a4ae' }}
                            />
                        </Box>
                    </Tooltip>
                ))}

                <Box className={`ts-bead-count ts-bead-count-${window36h ? '36h' : '24h'}`}
                     data-testid="ts-bead-count">
                    <Typography variant="caption" color="text.secondary">
                        {windowChips.length} closed · {windowLabel}
                    </Typography>
                </Box>
            </Box>
        </Box>
    );
};

export default TimeSeriesView;
