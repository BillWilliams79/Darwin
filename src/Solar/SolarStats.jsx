import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import { SOLAR_CONFIG } from '../config/solar';
import { formatWatts, formatKwh, formatSavings, formatPercentOfPeak } from '../utils/solarFormat';
import { useSolarSettingsStore } from '../stores/useSolarSettingsStore';
import { useState } from 'react';

const cardSx = {
    bgcolor: 'rgba(42, 39, 35, 0.88)',
    backdropFilter: 'blur(6px)',
    border: '1px solid rgba(255,255,255,0.10)',
    p: 2,
    borderRadius: 2,
    minWidth: 160,
    flex: 1,
};

const sunAnimation = {
    '@keyframes sun-pulse': {
        '0%, 100%': { filter: 'drop-shadow(0 0 4px #ff9800)' },
        '50%': { filter: 'drop-shadow(0 0 12px #ffb74d)' },
    },
};

const SolarStats = ({ production }) => {
    const ratePerKwh = useSolarSettingsStore(s => s.ratePerKwh);
    const setRatePerKwh = useSolarSettingsStore(s => s.setRatePerKwh);
    const [editingRate, setEditingRate] = useState(false);
    const [rateInput, setRateInput] = useState(String(ratePerKwh));

    const isProducing = production?.wattsNow > 0;

    const handleRateBlur = () => {
        const parsed = parseFloat(rateInput);
        if (!isNaN(parsed) && parsed > 0) {
            setRatePerKwh(parsed);
        } else {
            setRateInput(String(ratePerKwh));
        }
        setEditingRate(false);
    };

    return (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', ...sunAnimation }}>
            {/* Producing Now */}
            <Paper elevation={0} sx={cardSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <WbSunnyIcon sx={{
                        color: isProducing ? '#ff9800' : 'text.disabled',
                        fontSize: 20,
                        ...(isProducing && { animation: 'sun-pulse 2s ease-in-out infinite' }),
                    }} />
                    <Typography variant="caption" color="text.secondary">Producing Now</Typography>
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {formatWatts(production?.wattsNow)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {formatPercentOfPeak(production?.wattsNow, SOLAR_CONFIG.peakCapacityWatts)} of peak
                </Typography>
            </Paper>

            {/* Today */}
            <Paper elevation={0} sx={cardSx}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                    Today
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {formatKwh(production?.wattHoursToday)}
                </Typography>
            </Paper>

            {/* This Week */}
            <Paper elevation={0} sx={cardSx}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                    This Week
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {formatKwh(production?.wattHoursSevenDays)}
                </Typography>
            </Paper>

            {/* Lifetime */}
            <Paper elevation={0} sx={cardSx}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                    Lifetime
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {formatKwh(production?.wattHoursLifetime)}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                        {formatSavings(production?.wattHoursLifetime, ratePerKwh)} saved @
                    </Typography>
                    {editingRate ? (
                        <TextField
                            size="small"
                            value={rateInput}
                            onChange={e => setRateInput(e.target.value)}
                            onBlur={handleRateBlur}
                            onKeyDown={e => e.key === 'Enter' && handleRateBlur()}
                            autoFocus
                            sx={{ width: 70, '& input': { fontSize: 12, p: '2px 6px' } }}
                        />
                    ) : (
                        <Typography
                            variant="caption"
                            sx={{ color: 'primary.main', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                            onClick={() => { setRateInput(String(ratePerKwh)); setEditingRate(true); }}
                        >
                            ${ratePerKwh}/kWh
                        </Typography>
                    )}
                </Box>
            </Paper>
        </Box>
    );
};

export default SolarStats;
