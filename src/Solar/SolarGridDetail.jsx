import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { formatVoltage, formatCurrent, formatPowerFactor, formatWatts } from '../utils/solarFormat';

const DetailItem = ({ label, value }) => (
    <Box sx={{ textAlign: 'center', minWidth: 80 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
            {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {value}
        </Typography>
    </Box>
);

const SolarGridDetail = ({ productionDetail }) => {
    if (!productionDetail) return null;

    return (
        <Paper elevation={0} sx={{
            bgcolor: 'rgba(42, 39, 35, 0.88)',
            backdropFilter: 'blur(6px)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 2,
            px: 3,
            py: 1.5,
        }}>
            <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                <DetailItem label="Voltage" value={formatVoltage(productionDetail.rmsVoltage)} />
                <DetailItem label="Current" value={formatCurrent(productionDetail.rmsCurrent)} />
                <DetailItem label="Power Factor" value={formatPowerFactor(productionDetail.pwrFactor)} />
                <DetailItem label="Apparent Power" value={productionDetail.apprntPwr != null ? `${Math.round(productionDetail.apprntPwr)} VA` : '—'} />
                <DetailItem label="Reactive Power" value={productionDetail.reactPwr != null ? `${productionDetail.reactPwr.toFixed(1)} VAR` : '—'} />
            </Box>
        </Paper>
    );
};

export default SolarGridDetail;
