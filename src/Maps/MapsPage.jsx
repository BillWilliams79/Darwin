import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import CloseIcon from '@mui/icons-material/Close';

import MapRunsView, { TABLE_WIDTH } from '../MapRuns/MapRunsView';
import RouteCardView from '../RouteCards/RouteCardView';
import TrendsView from '../Trends/TrendsView';
import { useTrendsStore } from '../stores/useTrendsStore';

const STORAGE_KEY = 'darwin-maps-view';

const MapsPage = () => {
    const navigate = useNavigate();
    const [view, setView] = useState(() => localStorage.getItem(STORAGE_KEY) || 'table');
    const { timeFilter, setTimeFilter, setSelectedRouteIds } = useTrendsStore();

    const handleViewChange = (event, newView) => {
        if (newView !== null) {
            setView(newView);
            localStorage.setItem(STORAGE_KEY, newView);
        }
    };

    const handleBucketClick = useCallback((filter) => {
        setTimeFilter(filter);
        setSelectedRouteIds([]);
    }, [setTimeFilter, setSelectedRouteIds]);

    const handleResetFilter = useCallback(() => {
        setTimeFilter(null);
        setSelectedRouteIds([]);
    }, [setTimeFilter, setSelectedRouteIds]);

    const title = timeFilter ? `Maps - ${timeFilter.label}` : 'Maps';

    return (
        <Box sx={{ mt: 3, minWidth: 0, overflow: 'hidden' }}>
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: 2, mb: 1, px: 2,
                ...(view === 'table' ? { maxWidth: TABLE_WIDTH } : {}),
            }}>
                <Typography variant="h5">{title}</Typography>

                {timeFilter && (
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<CloseIcon />}
                        onClick={handleResetFilter}
                        data-testid="reset-filter-button"
                    >
                        Reset View
                    </Button>
                )}

                <Box sx={{ flexGrow: 1 }} />

                {view !== 'trends' && !timeFilter && (
                    <>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<CloudUploadIcon />}
                            onClick={() => navigate('/maps/import')}
                        >
                            Import
                        </Button>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<FileDownloadOutlinedIcon />}
                            onClick={() => navigate('/maps/export')}
                        >
                            Export
                        </Button>

                        <Box sx={{ width: 16 }} />
                    </>
                )}

                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={handleViewChange}
                    size="small"
                    sx={{ flexShrink: 0 }}
                >
                    <ToggleButton value="table" data-testid="view-toggle-table">
                        <TableChartIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Table
                    </ToggleButton>
                    <ToggleButton value="cards" data-testid="view-toggle-cards">
                        <ViewModuleIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Cards
                    </ToggleButton>
                    <ToggleButton value="trends" data-testid="view-toggle-trends">
                        <TrendingUpIcon sx={{ mr: 0.5 }} fontSize="small" />
                        Trends
                    </ToggleButton>
                </ToggleButtonGroup>
            </Box>

            {view === 'trends'
                ? <TrendsView onBucketClick={handleBucketClick} />
                : view === 'table'
                    ? <MapRunsView timeFilter={timeFilter} />
                    : <RouteCardView timeFilter={timeFilter} />
            }
        </Box>
    );
};

export default MapsPage;
