import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { SOLAR_CONFIG } from '../config/solar';
import { formatWatts } from '../utils/solarFormat';

const DARWIN_RED = '#E91E63';
const DARWIN_RED_DIM = 'rgba(233, 30, 99, 0.15)';

const panelAnimation = {
    '@keyframes panel-glow': {
        '0%, 100%': { opacity: 0.85 },
        '50%': { opacity: 1 },
    },
};

const SolarPanelGrid = ({ inverters }) => {
    if (!inverters || inverters.length === 0) return null;

    const totalWatts = inverters.reduce((sum, inv) => sum + (inv.lastReportWatts || 0), 0);

    return (
        <Box sx={panelAnimation}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1.5 }}>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    Solar Array
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {SOLAR_CONFIG.panelCount} Panels &middot; {formatWatts(totalWatts)}
                </Typography>
            </Box>
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(${SOLAR_CONFIG.gridCols}, 1fr)`,
                gap: 0.75,
                maxWidth: 800,
            }}>
                {inverters.map((inv) => {
                    const isActive = inv.lastReportWatts > 0;
                    const pct = inv.maxReportWatts ? Math.round((inv.lastReportWatts / inv.maxReportWatts) * 100) : 0;
                    const opacity = isActive ? 0.2 + (pct / 100) * 0.4 : 0.08;
                    const lastReport = inv.lastReportDate
                        ? new Date(inv.lastReportDate * 1000).toLocaleTimeString()
                        : 'Unknown';

                    return (
                        <Tooltip
                            key={inv.serialNumber}
                            enterDelay={400}
                            enterNextDelay={200}
                            title={
                                <Box sx={{ fontSize: 12 }}>
                                    <Box sx={{ fontWeight: 600, mb: 0.5 }}>SN: {inv.serialNumber}</Box>
                                    <Box>Now: {inv.lastReportWatts} W ({pct}%)</Box>
                                    <Box>Max: {inv.maxReportWatts} W</Box>
                                    <Box>Last: {lastReport}</Box>
                                </Box>
                            }
                        >
                            <Box sx={{
                                aspectRatio: '3 / 4',
                                borderRadius: 1,
                                bgcolor: '#1a1816',
                                border: '2px solid',
                                borderColor: isActive ? 'rgba(233, 30, 99, 0.25)' : 'rgba(255,255,255,0.06)',
                                position: 'relative',
                                overflow: 'hidden',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '2px',
                                '&:hover': { borderColor: DARWIN_RED },
                            }}>
                                {/* Panel grid lines */}
                                <Box sx={{
                                    position: 'absolute',
                                    inset: 3,
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gridTemplateRows: '1fr 1fr 1fr',
                                    gap: '1px',
                                    opacity: 0.12,
                                    '& > div': { border: '0.5px solid rgba(255,255,255,0.3)' },
                                }}>
                                    {[...Array(6)].map((_, i) => <div key={i} />)}
                                </Box>
                                {/* Color overlay */}
                                <Box sx={{
                                    position: 'absolute',
                                    inset: 0,
                                    bgcolor: DARWIN_RED,
                                    opacity,
                                    ...(isActive && { animation: 'panel-glow 3s ease-in-out infinite' }),
                                }} />
                                {/* Current watts */}
                                <Typography sx={{
                                    position: 'relative',
                                    zIndex: 1,
                                    fontWeight: 700,
                                    fontSize: 20,
                                    lineHeight: 1,
                                    color: isActive ? '#fff' : 'rgba(255,255,255,0.3)',
                                    textShadow: isActive ? `0 1px 4px rgba(0,0,0,0.6)` : 'none',
                                }}>
                                    {inv.lastReportWatts}
                                    <Typography component="span" sx={{ fontSize: 12, fontWeight: 500, ml: '1px' }}>W</Typography>
                                </Typography>
                                {/* Daily kWh per panel */}
                                {/* % of panel max */}
                                {isActive && (
                                    <Typography sx={{
                                        position: 'relative',
                                        zIndex: 1,
                                        fontSize: 16,
                                        lineHeight: 1,
                                        color: 'rgba(255,255,255,0.55)',
                                        fontWeight: 600,
                                    }}>
                                        {pct}
                                        <Typography component="span" sx={{ fontSize: 10, fontWeight: 500, ml: '1px' }}>%</Typography>
                                    </Typography>
                                )}
                            </Box>
                        </Tooltip>
                    );
                })}
            </Box>
        </Box>
    );
};

export default SolarPanelGrid;
