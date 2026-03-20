import React from 'react';
import Typography from '@mui/material/Typography';

const RouteGroupHeader = ({ label }) => (
    <Typography
        variant="h6"
        sx={{ mt: 3, mb: 1, color: 'text.secondary' }}
    >
        {label}
    </Typography>
);

export default RouteGroupHeader;
