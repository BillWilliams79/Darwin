import React, { useState, useEffect, useContext } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TableChartIcon from '@mui/icons-material/TableChart';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { formatDuration } from '../utils/mapDataUtils';

// ── helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d) {
    // Returns "YYYY-MM-DD" for a Date object, in local time
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getWeekBounds(d) {
    // Sunday-to-Saturday week containing d
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay()); // back to Sunday
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

function sumDistance(runs, fromDate, toDate) {
    // Sum distance_mi for runs whose start_time falls within [fromDate, toDate]
    const from = fromDate.getTime();
    const to = toDate.getTime();
    let total = 0;
    for (const r of runs) {
        const t = new Date(r.start_time.endsWith('Z') ? r.start_time : r.start_time + 'Z').getTime();
        if (t >= from && t <= to) total += Number(r.distance_mi) || 0;
    }
    return total;
}

function fmtMiles(val) {
    if (val === null || val === undefined) return '—';
    const n = Math.round(val * 10) / 10;
    return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function clockStr(d) {
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m} ${ampm}`;
}

function footerDateStr(run) {
    const startTimeStr = run.start_time;
    const startDate = new Date(startTimeStr.endsWith('Z') ? startTimeStr : startTimeStr + 'Z');
    // Apply PST/PDT offset (same logic as MapStatsCard)
    const month = startDate.getUTCMonth() + 1;
    const offsetHours = [1, 2, 3, 11, 12].includes(month) ? 8 : 7;
    const local = new Date(startDate.getTime() - offsetHours * 3600 * 1000);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let h = local.getUTCHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const m = String(local.getUTCMinutes()).padStart(2, '0');
    return `Done ${months[local.getUTCMonth()]} ${local.getUTCDate()}, ${local.getUTCFullYear()} at ${h}:${m} ${ampm}`;
}

// ── sub-component: a single stat cell ─────────────────────────────────────────

const StatCell = ({ label, value, unit, color, fontSize = '2.15rem', letterSpacing: valueLs }) => (
    <Box sx={{ flex: 1, py: '4px', pl: 0, pr: '2px', textAlign: 'right' }}>
        <Typography component="div" sx={{
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 400,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            lineHeight: 1.2,
            mb: '1px',
        }}>
            {label}
        </Typography>
        <Typography component="div" sx={{
            color,
            fontSize,
            fontWeight: 700,
            lineHeight: 1.05,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: valueLs || '-0.01em',
        }}>
            {value}
        </Typography>
        {unit && (
            <Typography component="div" sx={{
                color: '#ffffff',
                fontSize: '12px',
                lineHeight: 1.3,
                mt: '1px',
            }}>
                {unit}
            </Typography>
        )}
    </Box>
);

// ── row wrapper ───────────────────────────────────────────────────────────────

const StatRow = ({ children }) => (
    <Box sx={{
        display: 'flex',
    }}>
        {children}
    </Box>
);

// ── main component ─────────────────────────────────────────────────────────────

const CyclemeterStatsCard = ({ run, routeName, onCollapse, onToggleStyle }) => {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const [now, setNow] = useState(new Date());
    const [periods, setPeriods] = useState(null); // null = loading

    // Live clock
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Fetch aggregate mileage for period display
    useEffect(() => {
        if (!darwinUri || !idToken) return;

        const today = new Date();
        const from = new Date(today);
        from.setMonth(from.getMonth() - 14);
        const fromStr = toDateStr(from);
        const toStr = toDateStr(today);

        const url = `${darwinUri}/map_runs?filter_ts=(start_time,${fromStr},${toStr})&fields=distance_mi,start_time`;

        call_rest_api(url, 'GET', '', idToken)
            .then(result => {
                const runs = result?.data || [];

                const thisWeekBounds = getWeekBounds(today);
                const lastWeekStart = new Date(thisWeekBounds.start);
                lastWeekStart.setDate(lastWeekStart.getDate() - 7);
                const lastWeekEnd = new Date(thisWeekBounds.start);
                lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
                lastWeekEnd.setHours(23, 59, 59, 999);

                const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                const thisMonthEnd = today;

                const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
                lastMonthEnd.setHours(23, 59, 59, 999);

                const thisYearStart = new Date(today.getFullYear(), 0, 1);
                const thisYearEnd = today;

                setPeriods({
                    thisWeek:  sumDistance(runs, thisWeekBounds.start, thisWeekBounds.end),
                    lastWeek:  sumDistance(runs, lastWeekStart, lastWeekEnd),
                    thisMonth: sumDistance(runs, thisMonthStart, thisMonthEnd),
                    lastMonth: sumDistance(runs, lastMonthStart, lastMonthEnd),
                    thisYear:  sumDistance(runs, thisYearStart, thisYearEnd),
                });
            })
            .catch(() => {
                setPeriods({ thisWeek: null, lastWeek: null, thisMonth: null, lastMonth: null, thisYear: null });
            });
    }, [darwinUri, idToken]);

    if (!run) return null;

    const fmtHM = (s) => { s = Math.floor(s); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`; };
    const rideTime = fmtHM(run.run_time_sec);
    const stopTime = fmtHM(run.stopped_time_sec || 0);
    const distDisplay = Number(run.distance_mi).toFixed(2);
    const ascent = run.ascent_ft != null ? Math.round(Number(run.ascent_ft)) : '—';
    const avgSpeed = run.avg_speed_mph != null ? Number(run.avg_speed_mph).toFixed(2) : '—';

    const tw  = periods ? fmtMiles(periods.thisWeek)  : '—';
    const lw  = periods ? fmtMiles(periods.lastWeek)  : '—';
    const tm  = periods ? fmtMiles(periods.thisMonth) : '—';
    const lm  = periods ? fmtMiles(periods.lastMonth) : '—';
    const ty  = periods ? fmtMiles(periods.thisYear)  : '—';

    const stopEvents = {
        onMouseDown:   (e) => e.stopPropagation(),
        onClick:       (e) => e.stopPropagation(),
        onDoubleClick: (e) => e.stopPropagation(),
        onWheel:       (e) => e.stopPropagation(),
    };

    return (
        <Paper
            elevation={0}
            {...stopEvents}
            data-testid="cyclemeter-stats-card"
            sx={{
                pointerEvents: 'auto',
                bgcolor: '#000000',
                borderRadius: 1,
                width: 280,
                overflow: 'hidden',
            }}
        >
            {/* ── Header ─────────────────────────────────────────────────── */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 1.5,
                pt: 1,
                pb: 0.5,
            }}>
                <Typography sx={{
                    color: '#FFB300',
                    fontSize: 13,
                    fontWeight: 700,
                    flex: 1,
                    mr: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {routeName || run.activity_name || 'Activity'}
                </Typography>
                <Typography sx={{
                    color: '#FFB300',
                    fontSize: 13,
                    fontWeight: 700,
                    mr: 0.5,
                    flexShrink: 0,
                }}>
                    {run.activity_name || ''}
                </Typography>
                <Tooltip title="Switch to Compact view">
                    <IconButton
                        size="small"
                        onClick={onToggleStyle}
                        sx={{ color: 'rgba(255,255,255,0.5)', p: '2px' }}
                        data-testid="map-stats-style-toggle-btn"
                    >
                        <TableChartIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                </Tooltip>
                <IconButton
                    size="small"
                    onClick={onCollapse}
                    sx={{ color: 'rgba(255,255,255,0.5)', p: '2px' }}
                    data-testid="map-stats-collapse-btn"
                >
                    <ExpandMoreIcon sx={{ fontSize: 16 }} />
                </IconButton>
            </Box>

            {/* ── Row 1: Ride Time | Stopped Time ────────────────────────── */}
            <StatRow>
                <StatCell label="RIDE TIME"    value={rideTime} unit=""   color="#FF7700" fontSize="1.85rem" />
                <StatCell label="STOPPED TIME" value={stopTime} unit=""   color="#FF7700" fontSize="1.85rem" />
            </StatRow>

            {/* ── Row 2: Distance | Ascent ───────────────────────────────── */}
            <StatRow>
                <StatCell label="DISTANCE"     value={distDisplay} unit="miles" color="#00DD00" />
                <StatCell label="ASCENT"       value={String(ascent)} unit="feet"  color="#00DD00" />
            </StatRow>

            {/* ── Row 3: Average Speed | Heart Rate ─────────────────────── */}
            <StatRow>
                <StatCell label="AVERAGE SPEED" value={avgSpeed} unit="mph"  color="#CC44FF" />
                <StatCell
                    label="HEART RATE"
                    value="━━━"
                    unit="bpm"
                    color="#FF3B30"
                    fontSize="1.1rem"
                    letterSpacing="0.05em"
                />
            </StatRow>

            {/* ── Row 4: This Week | Last Week ──────────────────────────── */}
            <StatRow>
                <StatCell label="THIS WEEK"  value={tw} unit="miles" color="#3399FF" fontSize="1.55rem" />
                <StatCell label="LAST WEEK"  value={lw} unit="miles" color="#3399FF" fontSize="1.55rem" />
            </StatRow>

            {/* ── Row 5: This Month | Last Month ───────────────────────── */}
            <StatRow>
                <StatCell label="THIS MONTH" value={tm} unit="miles" color="#3399FF" fontSize="1.55rem" />
                <StatCell label="LAST MONTH" value={lm} unit="miles" color="#3399FF" fontSize="1.55rem" />
            </StatRow>

            {/* ── Row 6: This Year | Clock ──────────────────────────────── */}
            <StatRow>
                <StatCell label="THIS YEAR"  value={ty}           unit="miles" color="#3399FF" />
                <StatCell label="CLOCK"      value={clockStr(now)} unit=""      color="#FFFFFF" fontSize="1.85rem" />
            </StatRow>

            {/* ── Footer ─────────────────────────────────────────────────── */}
            <Box sx={{
                py: '5px',
                px: 1,
                textAlign: 'center',
            }}>
                <Typography sx={{ color: '#888888', fontSize: '10px' }}>
                    {footerDateStr(run)}
                </Typography>
            </Box>
        </Paper>
    );
};

export default CyclemeterStatsCard;
