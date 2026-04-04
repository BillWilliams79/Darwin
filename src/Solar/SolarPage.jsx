import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import useSolarPolling from '../hooks/useSolarPolling';
import SolarStats from './SolarStats';
import SolarGridDetail from './SolarGridDetail';
import SolarPanelGrid from './SolarPanelGrid';

const SolarPage = () => {
    const { production, productionDetail, inverters, error, loading, lastUpdated } = useSolarPolling();

    const hasData = production || inverters;

    if (loading && !hasData) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error && !hasData) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 10, gap: 2 }}>
                <WifiOffIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                <Typography variant="h6" color="text.secondary">
                    Solar data unavailable
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    The local Enphase proxy may not be running.
                </Typography>
                <Typography variant="caption" color="text.disabled">
                    Start it with: node solar/proxy.js
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ mt: 3, px: 2, maxWidth: 900, mx: 'auto' }}>
            {error && hasData && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Live updates paused — last updated {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'unknown'}
                </Alert>
            )}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                <SolarStats production={production} />
                <SolarGridDetail productionDetail={productionDetail} />
                <SolarPanelGrid inverters={inverters} />
            </Box>

            {lastUpdated && !error && (
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 2, textAlign: 'right' }}>
                    Updated {new Date(lastUpdated).toLocaleTimeString()}
                </Typography>
            )}
        </Box>
    );
};

export default SolarPage;
