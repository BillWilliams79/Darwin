import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { toLocaleDateString, getTimeOfDayFraction, formatCardDateTime, formatHM12 } from '../utils/dateFormat';
import { trimTo35 } from '../utils/stringFormat';
import './TimeSeriesView.css';

// Granularity → tick positions + labels (AM/PM labels).
const GRANULARITY_TICKS = {
    '24h':  { count: 8,  labels: ['12a','3a','6a','9a','12p','3p','6p','9p','12a'] },
    '4h':   { count: 6,  labels: ['12a','4a','8a','12p','4p','8p','12a'] },
    '8h':   { count: 3,  labels: ['12a','8a','4p','12a'] },
    'ampm': { count: 2,  labels: ['AM','|','PM'] },
};

// Granularity → bucket count (0 = continuous). Non-zero granularities snap chips to
// bucket centers, producing visible columns instead of exact time positions.
const GRANULARITY_BUCKETS = { '24h': 0, '4h': 6, '8h': 3, 'ampm': 2 };

const UNCATEGORIZED = { id: '__uncat__', category_name: 'Uncategorized', color: null, sort_order: Infinity };

// Snap a [0,1) fractional time to the center of its bucket (number of equal buckets).
// bucket=0 → continuous (no snap).
const snapToBucket = (frac, bucketCount) => {
    if (!bucketCount) return frac;
    const idx = Math.min(bucketCount - 1, Math.floor(frac * bucketCount));
    return (idx + 0.5) / bucketCount;
};

// Cluster-stack layout: chips sorted by leftPct. If a chip is within clusterGapPct of
// the *previous* chip, extend the current stack upward (row = prev.row + 1). Otherwise
// start a new stack at row 0. Produces the "tall finger" look users like — chips from
// the same time window grow a single tower. Distinct time clusters each get their
// own tower at row 0. showAll=true removes the row cap.
const DEFAULT_MAX_ROWS = 4;
const assignRows = (chips, minGapPct, showAll) => {
    const maxRows = showAll ? Infinity : DEFAULT_MAX_ROWS;
    const sorted = [...chips].sort((a, b) => a.leftPct - b.leftPct);
    const out = [];
    const overflow = [];
    let stackRow = -1;
    let lastPct = -Infinity;
    for (const chip of sorted) {
        const isCluster = chip.leftPct - lastPct < minGapPct;
        if (isCluster) {
            const nextRow = stackRow + 1;
            if (nextRow < maxRows) {
                out.push({ ...chip, row: nextRow });
                stackRow = nextRow;
            } else {
                overflow.push(chip);
                // stackRow stays; lastPct still updates so the next chip can still cluster
            }
        } else {
            out.push({ ...chip, row: 0 });
            stackRow = 0;
        }
        lastPct = chip.leftPct;
    }
    return { placed: out, overflowCount: overflow.length };
};

// ─────────── Controls ─────────────────────────────────────────────────────────
const TimeSeriesControls = ({
    view, granularity, chipMode, laneMode, showAll, beadWindow,
    onViewChange, onGranularityChange, onChipModeChange, onLaneModeChange,
    onShowAllChange, onBeadWindowChange,
}) => (
    <Box className="ts-controls" data-testid="ts-controls">
        <Box className="ts-control-row">
            <Typography variant="caption" className="ts-control-label">View</Typography>
            <ToggleButtonGroup
                value={view} exclusive size="small"
                onChange={(_, v) => v && onViewChange(v)}
                data-testid="ts-view"
            >
                <ToggleButton value="rail"    className="cal-toggle-btn" data-testid="ts-view-rail">Rail</ToggleButton>
                <ToggleButton value="river"   className="cal-toggle-btn" data-testid="ts-view-river">Vertical River</ToggleButton>
                <ToggleButton value="density" className="cal-toggle-btn" data-testid="ts-view-density">Density Rail</ToggleButton>
                <ToggleButton value="bead"    className="cal-toggle-btn" data-testid="ts-view-bead">Bead Necklace</ToggleButton>
            </ToggleButtonGroup>
        </Box>
        <Box className="ts-control-row">
            <Typography variant="caption" className="ts-control-label">Granularity</Typography>
            <ToggleButtonGroup
                value={granularity} exclusive size="small"
                onChange={(_, v) => v && onGranularityChange(v)}
                data-testid="ts-granularity"
            >
                <ToggleButton value="24h"  className="cal-toggle-btn" data-testid="ts-granularity-24h">24h</ToggleButton>
                <ToggleButton value="4h"   className="cal-toggle-btn" data-testid="ts-granularity-4h">6×4h</ToggleButton>
                <ToggleButton value="8h"   className="cal-toggle-btn" data-testid="ts-granularity-8h">3×8h</ToggleButton>
                <ToggleButton value="ampm" className="cal-toggle-btn" data-testid="ts-granularity-ampm">AM/PM</ToggleButton>
            </ToggleButtonGroup>
        </Box>
        <Box className="ts-control-row">
            <Typography variant="caption" className="ts-control-label">Chip</Typography>
            <ToggleButtonGroup
                value={chipMode} exclusive size="small"
                onChange={(_, v) => v && onChipModeChange(v)}
                data-testid="ts-chipmode"
            >
                <ToggleButton value="id"    className="cal-toggle-btn" data-testid="ts-chipmode-id">#id</ToggleButton>
                <ToggleButton value="title" className="cal-toggle-btn" data-testid="ts-chipmode-title">summary</ToggleButton>
            </ToggleButtonGroup>
        </Box>
        <Box className="ts-control-row">
            <Typography variant="caption" className="ts-control-label">Lanes</Typography>
            <ToggleButtonGroup
                value={laneMode} exclusive size="small"
                onChange={(_, v) => v && onLaneModeChange(v)}
                data-testid="ts-lanemode"
            >
                <ToggleButton value="none"     className="cal-toggle-btn" data-testid="ts-lanemode-none">None</ToggleButton>
                <ToggleButton value="category" className="cal-toggle-btn" data-testid="ts-lanemode-category">By Category</ToggleButton>
            </ToggleButtonGroup>
        </Box>
        {view === 'bead' && (
            <Box className="ts-control-row">
                <Typography variant="caption" className="ts-control-label">Window</Typography>
                <ToggleButtonGroup
                    value={beadWindow} exclusive size="small"
                    onChange={(_, v) => v && onBeadWindowChange(v)}
                    data-testid="ts-beadwindow"
                >
                    <ToggleButton value="24h" className="cal-toggle-btn" data-testid="ts-beadwindow-24h">24h (strict)</ToggleButton>
                    <ToggleButton value="36h" className="cal-toggle-btn" data-testid="ts-beadwindow-36h">36h (day+)</ToggleButton>
                </ToggleButtonGroup>
            </Box>
        )}
        <Box className="ts-control-row">
            <FormControlLabel
                control={
                    <Switch
                        size="small"
                        checked={showAll}
                        onChange={(e) => onShowAllChange(e.target.checked)}
                        data-testid="ts-showall"
                    />
                }
                label={<Typography variant="caption">Show all</Typography>}
                sx={{ ml: 0, mr: 0 }}
            />
        </Box>
    </Box>
);

// ─────────── Block background columns (for granularity > 24h) ────────────────
const BlockColumns = ({ granularity }) => {
    const buckets = GRANULARITY_BUCKETS[granularity] || 0;
    if (!buckets) return null;
    const cols = [];
    for (let i = 0; i < buckets; i++) {
        cols.push(
            <Box
                key={i}
                className={`ts-block ts-block-${i % 2 === 0 ? 'even' : 'odd'}`}
                style={{
                    left: `${(i / buckets) * 100}%`,
                    width: `${(1 / buckets) * 100}%`,
                }}
            />
        );
    }
    return <Box className="ts-block-columns" aria-hidden="true">{cols}</Box>;
};

const TimelineTicks = ({ granularity }) => {
    const cfg = GRANULARITY_TICKS[granularity] || GRANULARITY_TICKS['24h'];
    const ticks = [];
    for (let i = 0; i <= cfg.count; i++) {
        const leftPct = (i / cfg.count) * 100;
        ticks.push(
            <Box key={i} className="ts-tick" style={{ left: `${leftPct}%` }}>
                <span className="ts-tick-line" />
                <span className="ts-tick-label">{cfg.labels[i] ?? ''}</span>
            </Box>
        );
    }
    return <Box className="ts-ticks" data-testid="ts-ticks">{ticks}</Box>;
};

// X-axis per-chip time labels. Each chip's HH:MM is anchored at its X position with a
// small tick riser connecting down to the label. Labels stagger across up to two rows
// when they'd overlap (minGapPct apart), so dense clusters remain readable.
const ChipTimeAxis = ({ chips, minGapPct = 3.5 }) => {
    const sorted = [...chips].sort((a, b) => a.truePct - b.truePct);
    const rowLastPct = [];
    const placed = [];
    for (const chip of sorted) {
        let row = 0;
        for (; row < 2; row++) {
            if (rowLastPct[row] === undefined || chip.truePct - rowLastPct[row] >= minGapPct) {
                rowLastPct[row] = chip.truePct;
                break;
            }
        }
        // If neither row has space, stack on row 1 anyway (accept overlap).
        if (row >= 2) row = 1;
        placed.push({ ...chip, axisRow: row });
    }
    return (
        <Box className="ts-chip-axis" data-testid="ts-chip-axis" aria-hidden="false">
            {placed.map(chip => (
                <Box
                    key={chip.id}
                    className={`ts-axis-mark ts-axis-row-${chip.axisRow}`}
                    style={{ left: `${chip.truePct}%` }}
                >
                    <span className="ts-axis-riser" />
                    <span className="ts-axis-time">{chip.timeHHMM}</span>
                </Box>
            ))}
        </Box>
    );
};

// ─────────── Chip ─────────────────────────────────────────────────────────────
const Chip = ({ chip, chipMode, onChipClick, variant = 'default' }) => {
    const body = chipMode === 'id' ? `#${chip.id}` : trimTo35(chip.title);
    const tooltipBody = (
        <>
            <div>#{chip.id} {chip.title}</div>
            <div style={{ opacity: 0.8, fontSize: '0.8em' }}>{formatCardDateTime(chip.completed_at, chip.timezone)}</div>
        </>
    );
    return (
        <Tooltip title={tooltipBody} arrow>
            <Box
                className={`ts-chip ts-chip-${variant}`}
                data-testid={`ts-chip-${chip.id}`}
                style={{
                    left: chip.leftPct !== undefined ? `${chip.leftPct}%` : undefined,
                    top:  chip.topPct  !== undefined ? `${chip.topPct}%`  : undefined,
                    bottom: chip.bottom !== undefined ? `${chip.bottom}px` : undefined,
                    backgroundColor: chip.color || '#90a4ae',
                }}
                onClick={() => onChipClick && onChipClick(chip.id)}
            >
                <span className="ts-chip-time">{chip.timeHHMM}</span>
                <span className="ts-chip-body">{body}</span>
            </Box>
        </Tooltip>
    );
};

// ─────────── Horizontal Rail (A1) ─────────────────────────────────────────────
const HorizontalRail = ({ chips, granularity, chipMode, onChipClick, nowPct, showAll, withDensity }) => {
    const sorted = [...chips].sort((a, b) => a.leftPct - b.leftPct);
    const minGapPct = chipMode === 'id' ? 4 : 12;
    const { placed, overflowCount } = assignRows(sorted, minGapPct, showAll);
    const railHeight = showAll && placed.length > 0
        ? Math.max(140, Math.max(...placed.map(c => c.row)) * 26 + 64)
        : 140;
    return (
        <Box className="ts-rail" data-testid="ts-rail"
             style={{ height: `${withDensity ? railHeight + 40 : railHeight}px` }}>
            <BlockColumns granularity={granularity} />
            {withDensity && <DensityCurve chips={chips} />}
            {nowPct !== null && (
                <Box className="ts-now-marker" data-testid="ts-now-marker" style={{ left: `${nowPct}%` }} />
            )}
            <TimelineTicks granularity={granularity} />
            {withDensity && <ChipTimeAxis chips={chips} />}
            {placed.map(chip => (
                <Chip
                    key={chip.id}
                    chip={{ ...chip, bottom: chip.row * 26 + 32 }}
                    chipMode={chipMode}
                    onChipClick={onChipClick}
                />
            ))}
            {overflowCount > 0 && !showAll && (
                <Box className="ts-chip ts-chip-overflow" data-testid="ts-chip-overflow"
                     style={{ right: 4, bottom: `${DEFAULT_MAX_ROWS * 26 + 32}px` }}>
                    +{overflowCount} more
                </Box>
            )}
        </Box>
    );
};

// ─────────── Density curve (overlay for A3) ───────────────────────────────────
const DensityCurve = ({ chips }) => {
    // 48 bins → half-hour resolution.
    const path = useMemo(() => {
        if (!chips.length) return '';
        const bins = new Array(48).fill(0);
        for (const chip of chips) {
            const idx = Math.min(47, Math.max(0, Math.floor((chip.leftPct / 100) * 48)));
            bins[idx] += 1;
        }
        const max = Math.max(...bins, 1);
        // Smooth with a 3-point moving average.
        const smooth = bins.map((_, i) => {
            const left = bins[i - 1] ?? 0;
            const mid = bins[i];
            const right = bins[i + 1] ?? 0;
            return (left + mid * 2 + right) / 4;
        });
        // Build SVG path — area under curve, 0..100 x, 0..30 y (inverted: high = low y).
        const pts = smooth.map((v, i) => {
            const x = (i / 47) * 100;
            const y = 30 - (v / max) * 28;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        });
        return `M0,30 L${pts.join(' L')} L100,30 Z`;
    }, [chips]);
    return (
        <svg className="ts-density" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
            <path d={path} fill="rgba(33,150,243,0.15)" stroke="rgba(33,150,243,0.4)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        </svg>
    );
};

// ─────────── Vertical Timeline River (A2) ─────────────────────────────────────
const VerticalRiver = ({ chips, granularity, chipMode, onChipClick, nowPct, showAll }) => {
    // Sort by time; alternate left/right sides.
    const sorted = [...chips].sort((a, b) => a.leftPct - b.leftPct);
    // Visible count: respect show-all, else cap at a reasonable vertical window.
    const DEFAULT_CAP = 30;
    const visible = showAll ? sorted : sorted.slice(0, DEFAULT_CAP);
    const overflow = sorted.length - visible.length;
    // Height: one row per chip, ~32px each.
    const height = Math.max(320, visible.length * 34 + 64);
    return (
        <Box className="ts-river" data-testid="ts-river" style={{ height: `${height}px` }}>
            {/* Tick labels on the left (time-of-day) */}
            <VerticalTicks granularity={granularity} />
            {/* Central spine */}
            <Box className="ts-river-spine" />
            {nowPct !== null && (
                <Box className="ts-river-now" data-testid="ts-now-marker" style={{ top: `${nowPct}%` }} />
            )}
            {visible.map((chip, i) => {
                const side = i % 2 === 0 ? 'left' : 'right';
                return (
                    <Box
                        key={chip.id}
                        className={`ts-river-row ts-river-row-${side}`}
                        style={{ top: `${chip.leftPct}%` }}
                    >
                        <Chip
                            chip={{ ...chip, leftPct: undefined }}
                            chipMode={chipMode}
                            onChipClick={onChipClick}
                            variant="river"
                        />
                    </Box>
                );
            })}
            {overflow > 0 && !showAll && (
                <Box className="ts-chip ts-chip-overflow" data-testid="ts-chip-overflow"
                     sx={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)' }}>
                    +{overflow} more
                </Box>
            )}
        </Box>
    );
};

const VerticalTicks = ({ granularity }) => {
    const cfg = GRANULARITY_TICKS[granularity] || GRANULARITY_TICKS['24h'];
    const ticks = [];
    for (let i = 0; i <= cfg.count; i++) {
        const topPct = (i / cfg.count) * 100;
        ticks.push(
            <Box key={i} className="ts-vtick" style={{ top: `${topPct}%` }}>
                <span className="ts-vtick-label">{cfg.labels[i] ?? ''}</span>
                <span className="ts-vtick-line" />
            </Box>
        );
    }
    return <Box className="ts-vticks" data-testid="ts-vticks">{ticks}</Box>;
};

// ─────────── Bead Necklace — 36-hour window (A5) ──────────────────────────────
// X axis is a 36-hour continuum starting at 18:00 of the day BEFORE selectedDate and
// ending at 06:00 of the day AFTER selectedDate. Day-nav arrows on the left/right
// edges let the user shift the anchor date ±1 day.

const shiftDateStr = (dateStr, delta) => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
};

// Convert a completed_at timestamp to its X position in the 36-hour window
// (returns null if outside). Window anchors on selectedDate in the user tz.
const beadXPct = (completedAt, timezone, selectedDate) => {
    const chipDay = toLocaleDateString(completedAt, timezone);
    const chipFrac = getTimeOfDayFraction(completedAt, timezone);
    if (chipFrac === null || chipDay === null) return null;
    const prevDay = shiftDateStr(selectedDate, -1);
    const nextDay = shiftDateStr(selectedDate, 1);

    let hoursFromStart;
    if (chipDay === prevDay) {
        if (chipFrac < 18 / 24) return null;
        hoursFromStart = (chipFrac - 18 / 24) * 24;  // 0..6
    } else if (chipDay === selectedDate) {
        hoursFromStart = 6 + chipFrac * 24;            // 6..30
    } else if (chipDay === nextDay) {
        if (chipFrac >= 6 / 24) return null;
        hoursFromStart = 30 + chipFrac * 24;           // 30..36
    } else {
        return null;
    }
    return (hoursFromStart / 36) * 100;
};

// Tick positions within the 36-hour window. Percent positions along the 36h span.
const BEAD_TICKS_36H = [
    { pct: 0,              label: '6pm',  kind: 'minor' },  // 18:00 prev
    { pct: 100 * 6  / 36,  label: '12am', kind: 'major' },  // midnight of selected day
    { pct: 100 * 12 / 36,  label: '6am',  kind: 'minor' },  // 06:00 sel
    { pct: 100 * 18 / 36,  label: '12pm', kind: 'major' },  // noon sel
    { pct: 100 * 24 / 36,  label: '6pm',  kind: 'minor' },  // 18:00 sel
    { pct: 100 * 30 / 36,  label: '12am', kind: 'major' },  // midnight next
    { pct: 100,            label: '6am',  kind: 'minor' },  // 06:00 next
];

// 24h strict: the selectedDate from 12am to 12am next day.
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

const DayLabels = ({ selectedDate, timezone }) => {
    const prev = shiftDateStr(selectedDate, -1);
    const next = shiftDateStr(selectedDate, 1);
    const fmt = (s) => {
        const d = new Date(s + 'T12:00:00');
        const opts = { weekday: 'short', month: 'short', day: 'numeric', ...(timezone && { timeZone: timezone }) };
        return d.toLocaleDateString(undefined, opts);
    };
    // Show each day label centered over its portion of the 36h window:
    // prev day visible band: 0..6h (0..16.67%), center at ~8.33%
    // selected day band: 6..30h (16.67..83.33%), center at 50%
    // next day band: 30..36h (83.33..100%), center at ~91.67%
    return (
        <Box className="ts-bead-days" aria-hidden="true">
            <span className="ts-bead-day-label" style={{ left: '8.33%' }}>{fmt(prev)}</span>
            <span className="ts-bead-day-label ts-bead-day-label-sel" style={{ left: '50%' }}>{fmt(selectedDate)}</span>
            <span className="ts-bead-day-label" style={{ left: '91.67%' }}>{fmt(next)}</span>
        </Box>
    );
};

// Compute chip X position for 24h strict window (selectedDate only).
const bead24hXPct = (completedAt, timezone, selectedDate) => {
    const chipDay = toLocaleDateString(completedAt, timezone);
    if (chipDay !== selectedDate) return null;
    const frac = getTimeOfDayFraction(completedAt, timezone);
    if (frac === null) return null;
    return frac * 100;
};

const BeadNecklace = ({
    requirements, categoryList, selectedDate, timezone,
    chipMode, onChipClick, showAll, window36h, onPrevDay, onNextDay,
}) => {
    const ticks = window36h ? BEAD_TICKS_36H : BEAD_TICKS_24H;
    const xPctFn = window36h ? beadXPct : bead24hXPct;

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

    // Cluster-stack: chips whose leftPct is within minGapPct of the previous chip
    // extend the stack upward; otherwise a new stack begins at row 0.
    const minGapPct = 1.2;
    const { placed, overflowCount } = assignRows(windowChips, minGapPct, showAll);
    const maxStackRow = placed.length ? Math.max(...placed.map(c => c.row)) : 0;
    const height = showAll
        ? Math.max(200, maxStackRow * 18 + 140)
        : 200;

    // Now marker: where does "now" fall in the window?
    const nowPct = useMemo(() => {
        const now = new Date().toISOString();
        return xPctFn(now, timezone, selectedDate);
    }, [timezone, selectedDate, xPctFn]);

    const windowLabel = window36h ? '36h window' : 'today';

    return (
        <Box className={`ts-bead ts-bead-${window36h ? '36h' : '24h'}`}
             data-testid="ts-bead"
             style={{ height: `${height}px` }}>
            {/* Day-nav arrows centered vertically on left/right edges */}
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

            {/* Day labels above the wire (36h only shows prev/sel/next; 24h shows only sel) */}
            {window36h ? (
                <DayLabels selectedDate={selectedDate} timezone={timezone} />
            ) : (
                <Box className="ts-bead-days" aria-hidden="true">
                    <span className="ts-bead-day-label ts-bead-day-label-sel" style={{ left: '50%' }}>
                        {(() => {
                            const d = new Date(selectedDate + 'T12:00:00');
                            const opts = { weekday: 'short', month: 'short', day: 'numeric', ...(timezone && { timeZone: timezone }) };
                            return d.toLocaleDateString(undefined, opts);
                        })()}
                    </span>
                </Box>
            )}

            {/* Major vertical dividers (midnight / noon) */}
            {ticks.filter(t => t.kind === 'major').map((t, i) => (
                <Box key={i} className="ts-bead-divider" style={{ left: `${t.pct}%` }} />
            ))}

            {/* Now marker */}
            {nowPct !== null && (
                <Box className="ts-now-marker" data-testid="ts-now-marker" style={{ left: `${nowPct}%` }} />
            )}

            {/* Thin horizontal wire */}
            <Box className="ts-bead-wire" />

            {/* X-axis ticks */}
            <BeadTimeline ticks={ticks} />

            {/* Beads */}
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
                        <span
                            className="ts-bead-dot"
                            style={{ backgroundColor: chip.color || '#90a4ae' }}
                        />
                    </Box>
                </Tooltip>
            ))}

            {overflowCount > 0 && !showAll && (
                <Box className="ts-chip ts-chip-overflow" data-testid="ts-chip-overflow"
                     style={{ right: 56, bottom: '72px' }}>
                    +{overflowCount} more — toggle "Show all"
                </Box>
            )}

            {/* Count summary — sits below the X axis in the prev-day band (36h)
                or the left edge (24h). */}
            <Box className={`ts-bead-count ts-bead-count-${window36h ? '36h' : '24h'}`}
                 data-testid="ts-bead-count">
                <Typography variant="caption" color="text.secondary">
                    {windowChips.length} closed · {windowLabel}
                </Typography>
            </Box>
        </Box>
    );
};

// ─────────── Category lane (wrapper for horizontal-rail views) ────────────────
const LaneRail = ({ chips, label, granularity, chipMode, onChipClick, nowPct, isLastLane, showAll, withDensity }) => {
    const sorted = [...chips].sort((a, b) => a.leftPct - b.leftPct);
    const minGapPct = chipMode === 'id' ? 4 : 12;
    const { placed, overflowCount } = assignRows(sorted, minGapPct, showAll);
    const railHeight = showAll && placed.length > 0
        ? Math.max(72, Math.max(...placed.map(c => c.row)) * 26 + 40)
        : (isLastLane ? 96 : 72);
    return (
        <Box className="ts-lane" data-testid={`ts-lane-${label}`}>
            <Typography className="ts-lane-label" variant="caption">{label}</Typography>
            <Box className="ts-lane-rail" style={{ height: `${railHeight}px` }}>
                <BlockColumns granularity={granularity} />
                {withDensity && <DensityCurve chips={chips} />}
                {nowPct !== null && (
                    <Box className="ts-now-marker" style={{ left: `${nowPct}%` }} />
                )}
                {isLastLane && <TimelineTicks granularity={granularity} />}
                {placed.map(chip => (
                    <Chip
                        key={chip.id}
                        chip={{ ...chip, bottom: chip.row * 26 + (isLastLane ? 32 : 8) }}
                        chipMode={chipMode}
                        onChipClick={onChipClick}
                    />
                ))}
                {overflowCount > 0 && !showAll && (
                    <Box className="ts-chip ts-chip-overflow"
                         style={{ right: 4, bottom: '4px' }}>
                        +{overflowCount} more
                    </Box>
                )}
            </Box>
        </Box>
    );
};

// ─────────── Main view ────────────────────────────────────────────────────────
const TimeSeriesView = ({
    requirements = [],
    selectedDate,
    timezone,
    view = 'rail',
    granularity = '24h',
    chipMode = 'title',
    laneMode = 'none',
    showAll = false,
    beadWindow = '36h',
    categoryList = [],
    onViewChange,
    onGranularityChange,
    onChipModeChange,
    onLaneModeChange,
    onShowAllChange,
    onBeadWindowChange,
    onPrevDay,
    onNextDay,
    onChipClick,
}) => {
    const bucketCount = GRANULARITY_BUCKETS[granularity] || 0;

    const dayChips = useMemo(() => {
        if (!selectedDate) return [];
        const result = [];
        for (const r of requirements) {
            if (!r.completed_at) continue;
            if (toLocaleDateString(r.completed_at, timezone) !== selectedDate) continue;
            const frac = getTimeOfDayFraction(r.completed_at, timezone);
            if (frac === null) continue;
            const snapped = snapToBucket(frac, bucketCount);
            const cat = categoryList.find(c => c.id === r.category_fk);
            result.push({
                id: r.id,
                title: r.title || '',
                completed_at: r.completed_at,
                category_fk: r.category_fk,
                color: cat?.color || null,
                categoryName: cat?.category_name || null,
                categorySort: cat?.sort_order ?? Infinity,
                leftPct: snapped * 100,
                truePct: frac * 100,       // unsnapped position, used by bead time-ticks
                timeHHMM: formatHM12(r.completed_at, timezone),
                timezone,
            });
        }
        return result;
    }, [requirements, selectedDate, timezone, categoryList, bucketCount]);

    const nowPct = useMemo(() => {
        if (!selectedDate) return null;
        const today = toLocaleDateString(new Date().toISOString(), timezone);
        if (selectedDate !== today) return null;
        const frac = getTimeOfDayFraction(new Date().toISOString(), timezone);
        if (frac === null) return null;
        return snapToBucket(frac, bucketCount) * 100;
    }, [selectedDate, timezone, bucketCount]);

    const lanes = useMemo(() => {
        if (laneMode !== 'category') return null;
        const groups = new Map();
        for (const chip of dayChips) {
            const key = chip.category_fk || UNCATEGORIZED.id;
            if (!groups.has(key)) {
                const cat = chip.category_fk
                    ? categoryList.find(c => c.id === chip.category_fk)
                    : UNCATEGORIZED;
                groups.set(key, {
                    key,
                    label: cat?.category_name || UNCATEGORIZED.category_name,
                    sort_order: cat?.sort_order ?? Infinity,
                    chips: [],
                });
            }
            groups.get(key).chips.push(chip);
        }
        return [...groups.values()].sort((a, b) => a.sort_order - b.sort_order);
    }, [dayChips, laneMode, categoryList]);

    // Lane mode only composes with rail-family views (rail, density).
    // River and Bead ignore lane mode (they'd need a different layout strategy —
    // future work). Select base renderer here.
    const renderBase = () => {
        if (view === 'river') {
            return (
                <VerticalRiver
                    chips={dayChips} granularity={granularity}
                    chipMode={chipMode} onChipClick={onChipClick}
                    nowPct={nowPct} showAll={showAll}
                />
            );
        }
        if (view === 'bead') {
            return (
                <BeadNecklace
                    requirements={requirements}
                    categoryList={categoryList}
                    selectedDate={selectedDate}
                    timezone={timezone}
                    chipMode={chipMode}
                    onChipClick={onChipClick}
                    showAll={showAll}
                    window36h={beadWindow === '36h'}
                    onPrevDay={onPrevDay}
                    onNextDay={onNextDay}
                />
            );
        }
        const withDensity = view === 'density';
        if (laneMode === 'category' && lanes) {
            return (
                <Box className="ts-lanes" data-testid="ts-lanes">
                    {lanes.map((lane, idx) => (
                        <LaneRail
                            key={lane.key}
                            chips={lane.chips}
                            label={lane.label}
                            granularity={granularity}
                            chipMode={chipMode}
                            onChipClick={onChipClick}
                            nowPct={nowPct}
                            isLastLane={idx === lanes.length - 1}
                            showAll={showAll}
                            withDensity={withDensity}
                        />
                    ))}
                </Box>
            );
        }
        return (
            <HorizontalRail
                chips={dayChips} granularity={granularity}
                chipMode={chipMode} onChipClick={onChipClick}
                nowPct={nowPct} showAll={showAll}
                withDensity={withDensity}
            />
        );
    };

    return (
        <Box className="ts-view" data-testid="time-series-view">
            <TimeSeriesControls
                view={view}
                granularity={granularity}
                chipMode={chipMode}
                laneMode={laneMode}
                showAll={showAll}
                beadWindow={beadWindow}
                onViewChange={onViewChange}
                onGranularityChange={onGranularityChange}
                onChipModeChange={onChipModeChange}
                onLaneModeChange={onLaneModeChange}
                onShowAllChange={onShowAllChange}
                onBeadWindowChange={onBeadWindowChange}
            />
            {/* Bead view owns its own empty-state (36h window can be non-empty even if
                the selected day is). Other views use the dayChips check. */}
            {view !== 'bead' && dayChips.length === 0 ? (
                <Box className="ts-empty" data-testid="ts-empty">
                    <Typography color="text.secondary">
                        No requirements closed on {selectedDate || 'the selected date'}
                    </Typography>
                </Box>
            ) : (
                renderBase()
            )}
            <Box className="ts-summary-strip" data-testid="ts-summary-strip">
                <Typography variant="caption" color="text.secondary">
                    {dayChips.length} requirement{dayChips.length === 1 ? '' : 's'} closed
                    {view !== 'rail' && ` · ${view} view`}
                    {bucketCount > 0 && ` · bucketed by ${granularity}`}
                </Typography>
            </Box>
        </Box>
    );
};

export default TimeSeriesView;
