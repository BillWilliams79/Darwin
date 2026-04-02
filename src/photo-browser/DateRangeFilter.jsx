import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/**
 * DateRangeFilter
 * Compact filter bar: start/end datetime-local pickers + photo/video toggles + Clear.
 *
 * Props:
 *   startDate: string (datetime-local format "YYYY-MM-DDTHH:MM") or ''
 *   endDate: string or ''
 *   showImages: boolean
 *   showVideos: boolean
 *   onChange: ({ startDate, endDate, showImages, showVideos }) => void
 */
const DateRangeFilter = ({ startDate, endDate, showImages, showVideos, onChange }) => {
    const handleChange = (field, value) => {
        onChange({ startDate, endDate, showImages, showVideos, [field]: value });
    };

    const handleClear = () => {
        onChange({ startDate: '', endDate: '', showImages: true, showVideos: true });
    };

    const isActive = startDate || endDate || !showImages || !showVideos;

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 1.5, mb: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                Filter:
            </Typography>
            <TextField
                label="From"
                type="datetime-local"
                size="small"
                value={startDate}
                onChange={(e) => handleChange('startDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 200 }}
            />
            <TextField
                label="To"
                type="datetime-local"
                size="small"
                value={endDate}
                onChange={(e) => handleChange('endDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 200 }}
            />
            <FormControlLabel
                control={
                    <Checkbox
                        checked={showImages}
                        onChange={(e) => handleChange('showImages', e.target.checked)}
                        size="small"
                    />
                }
                label="Photos"
                sx={{ mr: 0 }}
            />
            <FormControlLabel
                control={
                    <Checkbox
                        checked={showVideos}
                        onChange={(e) => handleChange('showVideos', e.target.checked)}
                        size="small"
                    />
                }
                label="Videos"
                sx={{ mr: 0 }}
            />
            {isActive && (
                <Button size="small" variant="outlined" onClick={handleClear}>
                    Clear
                </Button>
            )}
        </Box>
    );
};

export default DateRangeFilter;
