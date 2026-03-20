import React, { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

import { runPipeline, downloadFile, DEFAULT_CONFIG } from '../cyclemeter';

const FILTER_TYPES = ['routeIDs', 'notesLike', 'dateRange'];

const CyclemeterImport = () => {
    // File state
    const [dbFile, setDbFile] = useState(null);
    const [fileName, setFileName] = useState('');
    const [dragging, setDragging] = useState(false);

    // Config state
    const [mapTitle, setMapTitle] = useState(DEFAULT_CONFIG.mapTitle);
    const [mapDescription, setMapDescription] = useState(DEFAULT_CONFIG.mapDescription);
    const [outputFilename, setOutputFilename] = useState(DEFAULT_CONFIG.outputFilename);
    const [minDelta, setMinDelta] = useState(DEFAULT_CONFIG.minDelta);
    const [precision, setPrecision] = useState(DEFAULT_CONFIG.precision);

    // Filter state
    const [filterType, setFilterType] = useState('routeIDs');
    const [routeIDsInput, setRouteIDsInput] = useState('56, 10');
    const [notesLikeInput, setNotesLikeInput] = useState('');
    const [dateStart, setDateStart] = useState('');
    const [dateEnd, setDateEnd] = useState('');

    // Pipeline state
    const [processing, setProcessing] = useState(false);
    const [stats, setStats] = useState(null);
    const [kmlContent, setKmlContent] = useState(null);
    const [error, setError] = useState(null);

    // Drag-and-drop handlers
    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) {
            console.log('[Cyclemeter] Dropped file:', file.name, file.size, 'bytes');
            setDbFile(file);
            setFileName(file.name);
            setStats(null);
            setKmlContent(null);
            setError(null);
        }
    }, []);

    const buildConfig = () => {
        const queryFilter = {};
        if (filterType === 'routeIDs') {
            queryFilter.routeIDs = routeIDsInput.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        } else if (filterType === 'notesLike') {
            queryFilter.notesLike = notesLikeInput;
        } else if (filterType === 'dateRange') {
            queryFilter.dateRange = { start: dateStart, end: dateEnd };
        }

        return {
            mapTitle,
            mapDescription,
            outputFilename,
            minDelta: Number(minDelta),
            precision: Number(precision),
            queryFilter,
        };
    };

    const handleProcess = async () => {
        console.log('[Cyclemeter] handleProcess called, dbFile:', !!dbFile);
        if (!dbFile) return;

        setProcessing(true);
        setError(null);
        setStats(null);
        setKmlContent(null);

        try {
            console.log('[Cyclemeter] Reading file as ArrayBuffer...');
            const buffer = await dbFile.arrayBuffer();
            console.log('[Cyclemeter] ArrayBuffer ready, size:', buffer.byteLength);
            const config = buildConfig();
            console.log('[Cyclemeter] Config:', JSON.stringify(config));
            console.log('[Cyclemeter] Starting pipeline...');
            const result = await runPipeline(buffer, config);
            console.log('[Cyclemeter] Pipeline complete. Runs:', result.stats.totalRuns, 'Points:', result.stats.totalExtracted);
            setStats(result.stats);
            setKmlContent(result.kml);
        } catch (err) {
            console.error('[Cyclemeter] Pipeline error:', err);
            setError(err.message || 'Pipeline failed');
        } finally {
            setProcessing(false);
        }
    };

    const handleDownload = () => {
        if (kmlContent) {
            downloadFile(kmlContent, `${outputFilename}.kml`);
        }
    };

    return (
        <Box sx={{ maxWidth: 700, mx: 'auto', mt: 3, px: 2 }}>
            <Typography variant="h5" gutterBottom>Cyclemeter Import</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Extract cycling/hiking data from a Cyclemeter database, transform it, and download as KML for Google MyMaps.
            </Typography>

            {/* Drop Zone */}
            <Paper
                variant="outlined"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                sx={{
                    p: 3, mb: 2, textAlign: 'center', cursor: 'pointer',
                    borderStyle: 'dashed', borderWidth: 2,
                    borderColor: dragging ? 'primary.main' : fileName ? 'success.main' : 'divider',
                    backgroundColor: dragging ? 'action.hover' : 'background.default',
                }}
            >
                <CloudUploadIcon sx={{ fontSize: 40, color: fileName ? 'success.main' : 'text.secondary', mb: 1 }} />
                <Typography variant="body1">
                    {fileName
                        ? `${fileName} (${(dbFile.size / 1024 / 1024).toFixed(1)} MB)`
                        : 'Drop Meter.db here'
                    }
                </Typography>
            </Paper>

            {/* Configuration */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Configuration</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        label="Map Title"
                        value={mapTitle}
                        onChange={(e) => setMapTitle(e.target.value)}
                        size="small"
                        fullWidth
                    />
                    <TextField
                        label="Map Description"
                        value={mapDescription}
                        onChange={(e) => setMapDescription(e.target.value)}
                        size="small"
                        fullWidth
                    />
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            label="Output Filename"
                            value={outputFilename}
                            onChange={(e) => setOutputFilename(e.target.value)}
                            size="small"
                            sx={{ flex: 1 }}
                        />
                        <TextField
                            label="Min Delta (m)"
                            type="number"
                            value={minDelta}
                            onChange={(e) => setMinDelta(e.target.value)}
                            size="small"
                            sx={{ width: 120 }}
                        />
                        <TextField
                            label="Precision"
                            type="number"
                            value={precision}
                            onChange={(e) => setPrecision(e.target.value)}
                            size="small"
                            sx={{ width: 100 }}
                            inputProps={{ min: 0, max: 7 }}
                        />
                    </Box>
                </Box>
            </Paper>

            {/* Query Filter */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Query Filter</Typography>
                <TextField
                    select
                    label="Filter Type"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    size="small"
                    sx={{ width: 200, mb: 2 }}
                >
                    {FILTER_TYPES.map(t => (
                        <MenuItem key={t} value={t}>{t}</MenuItem>
                    ))}
                </TextField>

                {filterType === 'routeIDs' && (
                    <TextField
                        label="Route IDs (comma-separated)"
                        value={routeIDsInput}
                        onChange={(e) => setRouteIDsInput(e.target.value)}
                        size="small"
                        fullWidth
                        helperText="e.g., 56, 10"
                    />
                )}
                {filterType === 'notesLike' && (
                    <TextField
                        label="Notes contains"
                        value={notesLikeInput}
                        onChange={(e) => setNotesLikeInput(e.target.value)}
                        size="small"
                        fullWidth
                        helperText="e.g., Season2"
                    />
                )}
                {filterType === 'dateRange' && (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            label="Start Date"
                            type="date"
                            value={dateStart}
                            onChange={(e) => setDateStart(e.target.value)}
                            size="small"
                            InputLabelProps={{ shrink: true }}
                            sx={{ flex: 1 }}
                        />
                        <TextField
                            label="End Date"
                            type="date"
                            value={dateEnd}
                            onChange={(e) => setDateEnd(e.target.value)}
                            size="small"
                            InputLabelProps={{ shrink: true }}
                            sx={{ flex: 1 }}
                        />
                    </Box>
                )}
            </Paper>

            {/* Actions */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Button
                    variant="contained"
                    startIcon={processing ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                    onClick={handleProcess}
                    disabled={!dbFile || processing}
                    data-testid="process-button"
                >
                    {processing ? 'Processing...' : 'Process'}
                </Button>
                {kmlContent && (
                    <Button
                        variant="outlined"
                        startIcon={<FileDownloadOutlinedIcon />}
                        onClick={handleDownload}
                        data-testid="download-kml-button"
                    >
                        Download KML
                    </Button>
                )}
            </Box>

            {/* Error */}
            {error && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: 'error.main' }}>
                    <Typography color="error">{error}</Typography>
                </Paper>
            )}

            {/* Stats */}
            {stats && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="stats-panel">
                    <Typography variant="subtitle2" gutterBottom>Results</Typography>
                    <Box component="table" sx={{ '& td': { pr: 3, py: 0.3 } }}>
                        <tbody>
                            <tr><td>Total Runs</td><td><strong>{stats.totalRuns}</strong></td></tr>
                            <tr><td>Total Distance</td><td><strong>{stats.totalDistance} miles</strong></td></tr>
                            <tr><td>GPS Points Extracted</td><td><strong>{stats.totalExtracted.toLocaleString()}</strong></td></tr>
                            <tr><td>GPS Points Stripped ({minDelta}m)</td><td><strong>{stats.totalStripped.toLocaleString()}</strong></td></tr>
                            <tr><td>GPS Points Remaining</td><td><strong>{stats.totalRemaining.toLocaleString()}</strong></td></tr>
                            <tr><td>Reduction</td><td><strong>{stats.percentReduction}%</strong></td></tr>
                        </tbody>
                    </Box>
                </Paper>
            )}
        </Box>
    );
};

export default CyclemeterImport;
