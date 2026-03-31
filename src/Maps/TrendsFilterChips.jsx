import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import RouteIcon from '@mui/icons-material/Route';
import PeopleIcon from '@mui/icons-material/People';

import { TABLE_WIDTH } from '../MapRuns/MapRunsView';

const ACCENT = '#E91E63';

const chipSx = {
    borderColor: ACCENT,
    color: ACCENT,
    '& .MuiChip-deleteIcon': { color: ACCENT, '&:hover': { color: '#C2185B' } },
};

const TrendsFilterChips = ({ timeFilter, selectedRouteIds, selectedPartnerIds = [], onClearTimeFilter, onClearRouteFilter, onClearPartnerFilter }) => (
    <Box
        data-testid="trends-filter-chips"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, px: 2, flexWrap: 'wrap', maxWidth: TABLE_WIDTH }}
    >
        {timeFilter && (
            <Chip
                icon={<CalendarTodayIcon />}
                label={timeFilter.label}
                variant="outlined"
                size="small"
                onDelete={onClearTimeFilter}
                sx={chipSx}
                data-testid="time-filter-chip"
            />
        )}
        {selectedRouteIds.length > 0 && (
            <Chip
                icon={<RouteIcon />}
                label={`Routes (${selectedRouteIds.length})`}
                variant="outlined"
                size="small"
                onDelete={onClearRouteFilter}
                sx={chipSx}
                data-testid="route-filter-chip"
            />
        )}
        {selectedPartnerIds.length > 0 && (
            <Chip
                icon={<PeopleIcon />}
                label={`Partners (${selectedPartnerIds.length})`}
                variant="outlined"
                size="small"
                onDelete={onClearPartnerFilter}
                sx={chipSx}
                data-testid="partner-filter-chip"
            />
        )}
    </Box>
);

export default TrendsFilterChips;
