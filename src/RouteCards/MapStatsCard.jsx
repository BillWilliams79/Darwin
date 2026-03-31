import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import BarChartIcon from '@mui/icons-material/BarChart';

import { formatDuration } from '../utils/mapDataUtils';

const MapStatsCard = ({ run, routeName, partners = [], runPartners = [] }) => {
    const [expanded, setExpanded] = useState(true);

    if (!run) return null;

    // Parse start_time for display
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

    const distance = Number(run.distance_mi).toFixed(1);
    const avgSpeed = run.avg_speed_mph != null ? Number(run.avg_speed_mph).toFixed(1) : '—';
    const maxSpeed = run.max_speed_mph != null ? Number(run.max_speed_mph).toFixed(1) : '—';
    const ascent = run.ascent_ft != null ? Math.round(Number(run.ascent_ft)) : '—';
    const descent = run.descent_ft != null ? Math.round(Number(run.descent_ft)) : '—';
    const rideTime = formatDuration(run.run_time_sec);
    const stopTime = formatDuration(run.stopped_time_sec || 0);
    const calories = run.calories != null ? Number(run.calories) : '—';

    const stats = [
        { label: 'Activity', value: run.activity_name || 'Unknown' },
        { label: 'Date', value: dateStr },
        { label: 'Start Time', value: timeStr },
        { label: 'Distance', value: `${distance} mi` },
        { label: 'Avg Speed', value: `${avgSpeed} mph` },
        { label: 'Max Speed', value: `${maxSpeed} mph` },
        { label: 'Ascent', value: `${ascent} ft` },
        { label: 'Descent', value: `${descent} ft` },
        { label: 'Ride Time', value: rideTime },
        { label: 'Stop Time', value: stopTime },
        { label: 'Calories', value: calories },
    ];

    const stopEvents = {
        onMouseDown: (e) => e.stopPropagation(),
        onClick: (e) => e.stopPropagation(),
        onDoubleClick: (e) => e.stopPropagation(),
        onWheel: (e) => e.stopPropagation(),
    };

    return (
        <Box
            sx={{
                position: 'absolute',
                bottom: 24,
                right: 10,
                zIndex: 800,
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
            }}
            data-testid="map-stats-card"
        >
            <Collapse in={expanded}>
                <Paper
                    elevation={0}
                    {...stopEvents}
                    sx={{
                        pointerEvents: 'auto',
                        bgcolor: (theme) => theme.palette.mode === 'dark'
                            ? 'rgba(42, 39, 35, 0.88)'
                            : 'rgba(255, 255, 255, 0.90)',
                        backdropFilter: 'blur(6px)',
                        color: 'text.primary',
                        borderRadius: 2,
                        p: 1.5,
                        maxWidth: 320,
                        minWidth: 260,
                        border: (theme) => theme.palette.mode === 'dark'
                            ? '1px solid rgba(255,255,255,0.10)'
                            : '1px solid rgba(0,0,0,0.12)',
                    }}
                    data-testid="map-stats-panel"
                >
                    {/* Header: route name + collapse button */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="body2" fontWeight="medium" noWrap sx={{ flex: 1, mr: 1 }}>
                            {routeName || run.activity_name || 'Activity'}
                        </Typography>
                        <IconButton
                            size="small"
                            onClick={() => setExpanded(false)}
                            sx={{ color: 'text.secondary', p: 0.25 }}
                            data-testid="map-stats-collapse-btn"
                        >
                            <ExpandMoreIcon fontSize="small" />
                        </IconButton>
                    </Box>

                    {/* 2-column stats grid */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px' }}>
                        {stats.map(({ label, value }) => (
                            <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                                <Typography variant="caption" color="text.secondary" noWrap>{label}</Typography>
                                <Typography variant="caption" fontWeight="bold" noWrap>{value}</Typography>
                            </Box>
                        ))}
                    </Box>

                    {/* Notes */}
                    {run.notes && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, fontStyle: 'italic', display: 'block' }}>
                            {run.notes}
                        </Typography>
                    )}

                    {/* Partners */}
                    {(() => {
                        const partnerIds = runPartners.filter(rp => rp.map_run_fk === run.id).map(rp => rp.map_partner_fk);
                        const partnerNames = partners.filter(p => partnerIds.includes(p.id));
                        if (partnerNames.length === 0) return null;
                        return (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }} data-testid="partner-chips">
                                {partnerNames.map(p => (
                                    <Chip key={p.id} label={p.name} size="small" variant="outlined" sx={{ height: 20, '& .MuiChip-label': { px: 1, fontSize: '0.7rem' } }} />
                                ))}
                            </Box>
                        );
                    })()}
                </Paper>
            </Collapse>

            {!expanded && (
                <Tooltip title="Show ride stats">
                    <IconButton
                        size="small"
                        {...stopEvents}
                        onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                        sx={{
                            pointerEvents: 'auto',
                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                ? 'rgba(42, 39, 35, 0.88)'
                                : 'rgba(255, 255, 255, 0.90)',
                            color: 'text.primary',
                            border: (theme) => theme.palette.mode === 'dark'
                                ? '1px solid rgba(255,255,255,0.10)'
                                : '1px solid rgba(0,0,0,0.12)',
                            '&:hover': {
                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                    ? 'rgba(42, 39, 35, 0.95)'
                                    : 'rgba(255, 255, 255, 0.98)',
                            },
                        }}
                        data-testid="map-stats-expand-btn"
                    >
                        <BarChartIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}
        </Box>
    );
};

export default MapStatsCard;
