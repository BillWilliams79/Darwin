import React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

import { formatDuration } from '../utils/mapDataUtils';

const RouteStatsOverlay = ({ run, routeName }) => {
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

    return (
        <Paper variant="outlined" sx={{ p: 2, mt: 2 }} data-testid="route-stats-panel">
            <Typography sx={{ fontSize: 20, fontWeight: 'normal', mb: 1 }}>
                {routeName || run.activity_name || 'Activity'}
            </Typography>

            <Box component="table" sx={{ width: '100%', '& td': { py: 0.3, pr: 3 }, '& td:first-of-type': { color: 'text.secondary' } }}>
                <tbody>
                    {stats.map(({ label, value }) => (
                        <tr key={label}>
                            <td>{label}</td>
                            <td><strong>{value}</strong></td>
                        </tr>
                    ))}
                </tbody>
            </Box>

            {run.notes && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, fontStyle: 'italic' }}>
                    {run.notes}
                </Typography>
            )}
        </Paper>
    );
};

export default RouteStatsOverlay;
