import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DashboardIcon from '@mui/icons-material/Dashboard';

import { formatDuration } from '../utils/mapDataUtils';

// Color scheme matching the Cyclemeter card
const COLOR = {
    time:     '#FF7700',
    distElev: '#00DD00',
    speed:    '#CC44FF',
    period:   '#3399FF',
    thisYear: '#5BC8FA',
    header:   '#FFB300',
    neutral:  'rgba(255,255,255,0.80)',
};

const CycloCompactCard = ({ run, routeName, partners = [], runPartners = [], onCollapse, onToggleStyle }) => {
    if (!run) return null;

    // Date/time parsing (same logic as MapStatsCard)
    const startTimeStr = run.start_time;
    const startDate = new Date(startTimeStr.endsWith('Z') ? startTimeStr : startTimeStr + 'Z');
    const month = startDate.getUTCMonth() + 1;
    const offsetHours = [1, 2, 3, 11, 12].includes(month) ? 8 : 7;
    const localDate = new Date(startDate.getTime() - offsetHours * 3600 * 1000);

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateStr = `${days[localDate.getUTCDay()]}, ${months[localDate.getUTCMonth()]} ${localDate.getUTCDate()}, ${localDate.getUTCFullYear()}`;
    let hours = localDate.getUTCHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const pad2 = n => n < 10 ? '0' + n : String(n);
    const timeStr = `${pad2(hours)}:${pad2(localDate.getUTCMinutes())} ${ampm}`;

    const distance = Number(run.distance_mi).toFixed(2);
    const avgSpeed = run.avg_speed_mph != null ? Number(run.avg_speed_mph).toFixed(1) : '—';
    const maxSpeed = run.max_speed_mph != null ? Number(run.max_speed_mph).toFixed(1) : '—';
    const ascent   = run.ascent_ft  != null ? Math.round(Number(run.ascent_ft))  : '—';
    const descent  = run.descent_ft != null ? Math.round(Number(run.descent_ft)) : '—';
    const rideTime = formatDuration(run.run_time_sec);
    const stopTime = formatDuration(run.stopped_time_sec || 0);
    const calories = run.calories != null ? Number(run.calories) : '—';

    // Fields in Cyclemeter order, with Cyclemeter colors
    const stats = [
        { label: 'Ride Time',    value: rideTime,                    color: COLOR.time     },
        { label: 'Stop Time',    value: stopTime,                    color: COLOR.time     },
        { label: 'Distance',     value: `${distance} mi`,            color: COLOR.distElev },
        { label: 'Ascent',       value: `${ascent} ft`,              color: COLOR.distElev },
        { label: 'Avg Speed',    value: `${avgSpeed} mph`,           color: COLOR.speed    },
        { label: 'Max Speed',    value: `${maxSpeed} mph`,           color: COLOR.speed    },
        { label: 'Descent',      value: `${descent} ft`,             color: COLOR.distElev },
        { label: 'Calories',     value: String(calories),            color: COLOR.thisYear },
        { label: 'Activity',     value: run.activity_name || '—',    color: COLOR.header   },
        { label: 'Date',         value: dateStr,                     color: COLOR.neutral  },
        { label: 'Start Time',   value: timeStr,                     color: COLOR.neutral  },
    ];

    const stopEvents = {
        onMouseDown:   (e) => e.stopPropagation(),
        onClick:       (e) => e.stopPropagation(),
        onDoubleClick: (e) => e.stopPropagation(),
        onWheel:       (e) => e.stopPropagation(),
    };

    // Render partners if any
    const partnerIds = runPartners.filter(rp => rp.map_run_fk === run.id).map(rp => rp.map_partner_fk);
    const partnerNames = partners.filter(p => partnerIds.includes(p.id));

    return (
        <Paper
            elevation={0}
            {...stopEvents}
            data-testid="cyclo-compact-card"
            sx={{
                pointerEvents: 'auto',
                bgcolor: 'rgba(8, 6, 4, 0.92)',
                backdropFilter: 'blur(6px)',
                borderRadius: 2,
                p: 1.5,
                maxWidth: 320,
                minWidth: 260,
                border: '1px solid rgba(255,255,255,0.12)',
            }}
        >
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                <Typography
                    variant="body2"
                    noWrap
                    sx={{ flex: 1, mr: 1, color: COLOR.header, fontWeight: 700 }}
                >
                    {routeName || run.activity_name || 'Activity'}
                </Typography>
                <Tooltip title="Switch to Classic view">
                    <IconButton
                        size="small"
                        onClick={onToggleStyle}
                        sx={{ color: 'rgba(255,255,255,0.45)', p: 0.25 }}
                        data-testid="map-stats-style-toggle-btn"
                    >
                        <DashboardIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <IconButton
                    size="small"
                    onClick={onCollapse}
                    sx={{ color: 'rgba(255,255,255,0.45)', p: 0.25 }}
                    data-testid="map-stats-collapse-btn"
                >
                    <ExpandMoreIcon fontSize="small" />
                </IconButton>
            </Box>

            {/* 2-column stats grid */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 16px' }}>
                {stats.map(({ label, value, color }) => (
                    <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'baseline' }}>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.45)', flexShrink: 0 }} noWrap>
                            {label}
                        </Typography>
                        <Typography variant="caption" fontWeight="bold" sx={{ color }} noWrap>
                            {value}
                        </Typography>
                    </Box>
                ))}
            </Box>

            {/* Notes */}
            {run.notes && (
                <Typography variant="caption" sx={{ mt: 0.5, fontStyle: 'italic', display: 'block', color: 'rgba(255,255,255,0.45)' }}>
                    {run.notes}
                </Typography>
            )}

            {/* Partners */}
            {partnerNames.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }} data-testid="partner-chips">
                    {partnerNames.map(p => (
                        <Chip
                            key={p.id}
                            label={p.name}
                            size="small"
                            variant="outlined"
                            sx={{
                                height: 20,
                                borderColor: 'rgba(255,255,255,0.25)',
                                color: 'rgba(255,255,255,0.70)',
                                '& .MuiChip-label': { px: 1, fontSize: '0.7rem' },
                            }}
                        />
                    ))}
                </Box>
            )}
        </Paper>
    );
};

export default CycloCompactCard;
