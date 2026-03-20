import React from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { useNavigate } from 'react-router-dom';

import RouteMapThumbnail from './RouteMapThumbnail';
import { formatDuration } from '../utils/mapDataUtils';

const RouteCard = ({ run, routeName }) => {
    const navigate = useNavigate();

    // Parse start_time for display
    const startTimeStr = run.start_time;
    const startDate = new Date(startTimeStr.endsWith('Z') ? startTimeStr : startTimeStr + 'Z');
    const month = startDate.getUTCMonth() + 1;
    const offsetHours = [1, 2, 3, 11, 12].includes(month) ? 8 : 7;
    const localDate = new Date(startDate.getTime() - offsetHours * 3600 * 1000);

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateStr = `${days[localDate.getUTCDay()]}, ${months[localDate.getUTCMonth()]} ${localDate.getUTCDate()}, ${localDate.getUTCFullYear()}`;

    const distance = Number(run.distance_mi).toFixed(1);
    const avgSpeed = run.avg_speed_mph != null ? Number(run.avg_speed_mph).toFixed(1) : '—';
    const maxSpeed = run.max_speed_mph != null ? Number(run.max_speed_mph).toFixed(1) : '—';
    const ascent = run.ascent_ft != null ? Math.round(Number(run.ascent_ft)) : '—';
    const rideTime = formatDuration(run.run_time_sec);
    const stopTime = formatDuration(run.stopped_time_sec || 0);

    return (
        <Card raised={true}
              data-testid="route-card"
              sx={{
                  border: '2px solid transparent',
              }}
        >
            <CardActionArea onClick={() => navigate(`/maps/routes/${run.id}`)}>
                <RouteMapThumbnail runId={run.id} />
                <CardContent>
                    <Box className="card-header" sx={{ marginBottom: 2 }}>
                        <Typography sx={{ fontSize: 24, fontWeight: 'normal' }}>
                            {routeName || run.activity_name || 'Activity'}
                        </Typography>
                    </Box>

                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {dateStr}
                    </Typography>

                    <Box component="table" sx={{ width: '100%', '& td': { py: 0.2 }, '& td:first-of-type': { color: 'text.secondary', pr: 1.5 } }}>
                        <tbody>
                            <tr><td>Distance</td><td>{distance} mi</td></tr>
                            <tr><td>Avg Speed</td><td>{avgSpeed} mph</td></tr>
                            <tr><td>Max Speed</td><td>{maxSpeed} mph</td></tr>
                            <tr><td>Ascent</td><td>{ascent} ft</td></tr>
                            <tr><td>Ride Time</td><td>{rideTime}</td></tr>
                            <tr><td>Stop Time</td><td>{stopTime}</td></tr>
                        </tbody>
                    </Box>

                    {run.notes && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
                            {run.notes}
                        </Typography>
                    )}
                </CardContent>
            </CardActionArea>
        </Card>
    );
};

export default RouteCard;
