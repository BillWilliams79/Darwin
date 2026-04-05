import React, { useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import BarChartIcon from '@mui/icons-material/BarChart';

import CyclemeterStatsCard from './CyclemeterStatsCard';
import CycloCompactCard from './CycloCompactCard';

const MapStatsCard = ({ run, routeName, partners = [], runPartners = [] }) => {
    const [expanded, setExpanded] = useState(true);
    const [cardStyle, setCardStyle] = useState(() => {
        const saved = localStorage.getItem('mapStatsStyle');
        return (saved === 'cyclemeter' || saved === 'compact') ? saved : 'cyclemeter';
    });

    const toggleStyle = () => {
        const next = cardStyle === 'compact' ? 'cyclemeter' : 'compact';
        localStorage.setItem('mapStatsStyle', next);
        setCardStyle(next);
    };

    if (!run) return null;

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
                {cardStyle === 'cyclemeter' ? (
                    <CyclemeterStatsCard
                        run={run}
                        routeName={routeName}
                        onCollapse={() => setExpanded(false)}
                        onToggleStyle={toggleStyle}
                    />
                ) : (
                    <CycloCompactCard
                        run={run}
                        routeName={routeName}
                        partners={partners}
                        runPartners={runPartners}
                        onCollapse={() => setExpanded(false)}
                        onToggleStyle={toggleStyle}
                    />
                )}
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
