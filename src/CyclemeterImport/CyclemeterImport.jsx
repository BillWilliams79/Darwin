import React, { useState, useCallback, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import TuneIcon from '@mui/icons-material/Tune';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { runPipelineForFormat, extractFromCyclemeter, extractFromStravaGpx, extractFromCyclemeterKml, extractFromDarwinKml, extractFromMtbProjectGpx, detectFormat, precisionOptimizer, distanceOptimizer, DEFAULT_CONFIG } from '../cyclemeter';
import { mapRunToSql, mapCoordinatesToSql, extractUniqueRoutes, filterNewRunsByCutoff, normalizeRouteName } from '../cyclemeter/sqlMapper';
import StravaImport from '../strava/StravaImport';

const FILTER_TYPES = ['allRoutes', 'routeIDs', 'notesLike', 'dateRange'];
const COORD_BATCH_SIZE = 500;
const CONCURRENCY_LIMIT = 5;
const SINGLE_FILE_FORMATS = new Set(['cyclemeter-kml', 'darwin-kml', 'cyclemeter-gpx', 'strava-gpx', 'mtbproject-gpx']);

/** Maps format IDs to extraction functions for the Save to Darwin flow */
const EXTRACTORS = {
    'cyclemeter': extractFromCyclemeter,
    'cyclemeter-kml': extractFromCyclemeterKml,
    'darwin-kml': extractFromDarwinKml,
    'cyclemeter-gpx': extractFromStravaGpx,
    'strava-gpx': extractFromStravaGpx,
    'mtbproject-gpx': extractFromMtbProjectGpx,
};

const CyclemeterImport = () => {
    const navigate = useNavigate();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);

    // File state
    const [dbFile, setDbFile] = useState(null);
    const [fileName, setFileName] = useState('');
    const [dragging, setDragging] = useState(false);
    const [formatInfo, setFormatInfo] = useState(null); // { format, label, source } from detectFormat

    // Config state
    const [minDelta, setMinDelta] = useState(DEFAULT_CONFIG.minDelta);
    const [precision, setPrecision] = useState(DEFAULT_CONFIG.precision);

    // Filter state
    const [filterType, setFilterType] = useState('allRoutes');
    const [routeIDsInput, setRouteIDsInput] = useState('56, 10');
    const [notesLikeInput, setNotesLikeInput] = useState('');
    const [dateStart, setDateStart] = useState('');
    const [dateEnd, setDateEnd] = useState('');

    // Advanced config toggle
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Pipeline state
    const [processing, setProcessing] = useState(false);
    const [stats, setStats] = useState(null);
    const [error, setError] = useState(null);

    // Save to Darwin state
    const [saving, setSaving] = useState(false);
    const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 });
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
    const abortRef = useRef(null);

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

    const handleDrop = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) {
            console.log('[Import] Dropped file:', file.name, file.size, 'bytes');
            setDbFile(file);
            setFileName(file.name);
            setStats(null);
            setError(null);
            setFormatInfo(null);
            try {
                const info = await detectFormat(file);
                console.log('[Import] Detected format:', info.format, info.label);
                setFormatInfo(info);

                // Auto-process single-file formats (GPX, KML) — skip the manual Process step
                if (SINGLE_FILE_FORMATS.has(info.format)) {
                    console.log('[Import] Auto-processing single-file format:', info.format);
                    setProcessing(true);
                    try {
                        const buffer = await file.arrayBuffer();
                        const config = buildConfig();
                        const result = await runPipelineForFormat(buffer, config, info.format);
                        console.log('[Import] Auto-process complete. Runs:', result.stats.totalRuns, 'Points:', result.stats.totalExtracted);
                        setStats(result.stats);
                    } catch (pipeErr) {
                        console.error('[Import] Auto-process error:', pipeErr);
                        setError(pipeErr.message || 'Pipeline failed');
                    } finally {
                        setProcessing(false);
                    }
                }
            } catch (err) {
                console.error('[Import] Format detection failed:', err);
                setError(err.message);
            }
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
        // allRoutes: empty queryFilter = no filtering

        return {
            mapTitle: DEFAULT_CONFIG.mapTitle,
            mapDescription: DEFAULT_CONFIG.mapDescription,
            outputFilename: DEFAULT_CONFIG.outputFilename,
            minDelta: Number(minDelta),
            precision: Number(precision),
            queryFilter,
        };
    };

    const handleProcess = async () => {
        console.log('[Import] handleProcess called, dbFile:', !!dbFile, 'format:', formatInfo?.format);
        if (!dbFile || !formatInfo) return;

        setProcessing(true);
        setError(null);
        setStats(null);

        try {
            console.log('[Import] Reading file as ArrayBuffer...');
            const buffer = await dbFile.arrayBuffer();
            console.log('[Import] ArrayBuffer ready, size:', buffer.byteLength);
            const config = buildConfig();
            console.log('[Import] Config:', JSON.stringify(config));
            console.log('[Import] Starting pipeline for format:', formatInfo.format);
            const result = await runPipelineForFormat(buffer, config, formatInfo.format);
            console.log('[Import] Pipeline complete. Runs:', result.stats.totalRuns, 'Points:', result.stats.totalExtracted);
            setStats(result.stats);
        } catch (err) {
            console.error('[Import] Pipeline error:', err);
            setError(err.message || 'Pipeline failed');
        } finally {
            setProcessing(false);
        }
    };

    /**
     * Concurrency-limited parallel execution.
     * Processes tasks with at most `limit` running concurrently.
     */
    const asyncPool = async (limit, items, fn, signal) => {
        const results = [];
        const executing = new Set();

        for (const [index, item] of items.entries()) {
            if (signal?.aborted) throw new Error('Save cancelled');

            const p = fn(item, index).finally(() => executing.delete(p));
            results.push(p);
            executing.add(p);

            if (executing.size >= limit) {
                await Promise.race(executing);
            }
        }

        return Promise.allSettled(results);
    };

    const handleSaveToDarwin = async () => {
        if (!dbFile || !formatInfo) return;

        const controller = new AbortController();
        abortRef.current = controller;

        setSaving(true);
        setError(null);
        setSaveProgress({ current: 0, total: 0 });

        try {
            // Re-extract raw data (pre-formatRunData) for accurate SQL mapping
            // Apply precision + distance optimizers (same as KML pipeline) so stored
            // coordinates match the KML output, but skip formatRunData which
            // destructively converts runTime/startTime needed for SQL mapping.
            const buffer = await dbFile.arrayBuffer();
            const config = buildConfig();
            const extractor = EXTRACTORS[formatInfo.format];
            const rawRuns = await extractor(buffer, config);
            precisionOptimizer(rawRuns, config.precision);
            distanceOptimizer(rawRuns, config.minDelta);

            if (rawRuns.length === 0) {
                setError('No activities found with current filter settings');
                setSaving(false);
                return;
            }

            // Dedup pre-check: query latest imported run for this source
            // Lambda returns 404 when table is empty (no rows) — treat as no prior imports
            let cutoffDate = null;
            try {
                const cutoffResult = await call_rest_api(
                    `${darwinUri}/map_runs?fields=start_time&source=${formatInfo.source}&sort=start_time:desc`, 'GET', null, idToken
                );
                cutoffDate = cutoffResult.data?.[0]?.start_time || null;
            } catch (e) {
                if (e?.httpStatus?.httpStatus !== 404) throw e;
            }
            const { newRuns, skippedCount } = filterNewRunsByCutoff(rawRuns, cutoffDate);

            if (newRuns.length === 0) {
                setSnackbar({
                    open: true,
                    message: `All ${rawRuns.length} activities already imported (latest: ${cutoffDate})`,
                    severity: 'info',
                });
                setSaving(false);
                return;
            }

            const totalRuns = newRuns.length;
            setSaveProgress({ current: 0, total: totalRuns });

            // Step 1: Fetch existing routes, save only new ones
            // Lambda returns 404 when table is empty — treat as no existing routes
            const routeIdMap = new Map(); // cyclemeter routeID → SQL map_routes id
            const routeNameMap = new Map(); // normalized route name → SQL map_routes id
            try {
                const existingRoutesResult = await call_rest_api(
                    `${darwinUri}/map_routes?fields=id,route_id,name`, 'GET', null, idToken
                );
                if (existingRoutesResult.data) {
                    for (const r of existingRoutesResult.data) {
                        routeIdMap.set(r.route_id, r.id);
                        const normalized = normalizeRouteName(r.name);
                        if (normalized && !routeNameMap.has(normalized)) {
                            routeNameMap.set(normalized, r.id);
                        }
                    }
                }
            } catch (e) {
                if (e?.httpStatus?.httpStatus !== 404) throw e;
            }

            const uniqueRoutes = extractUniqueRoutes(newRuns);
            for (const route of uniqueRoutes) {
                if (controller.signal.aborted) throw new Error('Save cancelled');
                if (routeIdMap.has(route.route_id)) continue; // already exists by route_id

                // Check for existing route with matching name (handles single-file imports)
                const normalizedName = normalizeRouteName(route.name);
                const existingByName = routeNameMap.get(normalizedName);
                if (existingByName) {
                    routeIdMap.set(route.route_id, existingByName);
                    continue;
                }

                const result = await call_rest_api(
                    `${darwinUri}/map_routes`, 'POST', route, idToken
                );
                if (result.httpStatus.httpStatus === 200 && result.data?.[0]?.id) {
                    routeIdMap.set(route.route_id, result.data[0].id);
                    routeNameMap.set(normalizedName, result.data[0].id);
                }
            }

            // Step 2: Save new runs with concurrency limit
            let completed = 0;

            await asyncPool(CONCURRENCY_LIMIT, newRuns, async (run) => {
                if (controller.signal.aborted) throw new Error('Save cancelled');

                const mapRouteFk = routeIdMap.get(run.routeID) || null;
                const sqlRun = mapRunToSql(run, mapRouteFk, formatInfo.source);

                const runResult = await call_rest_api(
                    `${darwinUri}/map_runs`, 'POST', sqlRun, idToken
                );

                if (runResult.httpStatus.httpStatus !== 200 || !runResult.data?.[0]?.id) {
                    console.warn('[Cyclemeter] Failed to save run:', run.runID);
                    return;
                }

                const sqlRunId = runResult.data[0].id;

                // Step 3: Batch POST coordinates
                if (run.coordinates.length > 0) {
                    const sqlCoords = mapCoordinatesToSql(run.coordinates);

                    for (let i = 0; i < sqlCoords.length; i += COORD_BATCH_SIZE) {
                        if (controller.signal.aborted) throw new Error('Save cancelled');

                        const batch = sqlCoords.slice(i, i + COORD_BATCH_SIZE).map(coord => ({
                            ...coord,
                            map_run_fk: sqlRunId,
                        }));

                        await call_rest_api(
                            `${darwinUri}/map_coordinates`, 'POST', batch, idToken
                        );
                    }
                }

                // Step 4: Save partner links (Darwin KML with ExtendedData)
                if (run.partnerNames && run.partnerNames.length > 0) {
                    for (const partnerName of run.partnerNames) {
                        if (controller.signal.aborted) throw new Error('Save cancelled');

                        // Find or create partner
                        let partnerId = null;
                        try {
                            const existingResult = await call_rest_api(
                                `${darwinUri}/map_partners?name=${encodeURIComponent(partnerName)}`, 'GET', null, idToken
                            );
                            if (existingResult.data?.[0]?.id) {
                                partnerId = existingResult.data[0].id;
                            }
                        } catch (e) {
                            if (e?.httpStatus?.httpStatus !== 404) throw e;
                        }

                        if (!partnerId) {
                            const createResult = await call_rest_api(
                                `${darwinUri}/map_partners`, 'POST', { name: partnerName }, idToken
                            );
                            if (createResult.httpStatus.httpStatus === 200 && createResult.data?.[0]?.id) {
                                partnerId = createResult.data[0].id;
                            }
                        }

                        if (partnerId) {
                            await call_rest_api(
                                `${darwinUri}/map_run_partners`, 'POST',
                                { map_run_fk: sqlRunId, map_partner_fk: partnerId }, idToken
                            );
                        }
                    }
                }

                completed++;
                setSaveProgress({ current: completed, total: totalRuns });
            }, controller.signal);

            setSnackbar({
                open: true,
                message: skippedCount > 0
                    ? `Saved ${completed} new activities (${skippedCount} already imported, skipped)`
                    : `Saved ${completed} activities to Darwin`,
                severity: 'success',
            });

        } catch (err) {
            if (err.message === 'Save cancelled') {
                setSnackbar({ open: true, message: 'Save cancelled', severity: 'info' });
            } else {
                console.error('[Cyclemeter] Save error:', err);
                setError(err.message || 'Save to Darwin failed');
            }
        } finally {
            setSaving(false);
            abortRef.current = null;
        }
    };

    const handleCancelSave = () => {
        if (abortRef.current) {
            abortRef.current.abort();
        }
    };

    const progressPercent = saveProgress.total > 0
        ? Math.round((saveProgress.current / saveProgress.total) * 100)
        : 0;

    return (
        <Box sx={{ maxWidth: 960, mx: 'auto', mt: 3, px: 2 }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/maps')} sx={{ mb: 1 }} size="small">
                Maps
            </Button>
            <Typography variant="h5" gutterBottom>Import</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Supported formats:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>Cyclemeter</Typography>
                    <Chip label="Database (.db)" size="small" variant="outlined" />
                    <Chip label="KML (.kml)" size="small" variant="outlined" />
                    <Chip label="GPX (.gpx)" size="small" variant="outlined" />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>Strava</Typography>
                    <Chip label="GPX (.gpx)" size="small" variant="outlined" />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>MTB Project</Typography>
                    <Chip label="GPX (.gpx)" size="small" variant="outlined" />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>Darwin</Typography>
                    <Chip label="KML (.kml)" size="small" variant="outlined" />
                </Box>
            </Box>

            {/* Strava API Import — only shown for the owner account */}
            {profile?.id === '37df7531-000d-4470-8be4-1792d8261f69' && (
                <>
                    <StravaImport />
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', my: 2 }}>
                        — or import from file —
                    </Typography>
                </>
            )}

            {/* Drop Zone */}
            <Paper
                variant="outlined"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                sx={{
                    p: 3, mb: 2, textAlign: 'center', cursor: 'pointer',
                    borderStyle: 'dashed', borderWidth: 2,
                    borderColor: dragging ? 'primary.main' : formatInfo ? 'success.main' : (fileName && !formatInfo) ? 'error.main' : 'divider',
                    backgroundColor: dragging ? 'action.hover' : 'background.default',
                }}
            >
                <CloudUploadIcon sx={{ fontSize: 40, color: formatInfo ? 'success.main' : 'text.secondary', mb: 1 }} />
                <Typography variant="body1">
                    {fileName
                        ? `${fileName} (${(dbFile.size / 1024 / 1024).toFixed(1)} MB)`
                        : 'Drop Meter.db, .kml, or .gpx file here'
                    }
                </Typography>
                {formatInfo && (
                    <Typography variant="body2" color="text.secondary">
                        Detected: {formatInfo.label}
                    </Typography>
                )}
            </Paper>

            {/* Advanced toggle */}
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <IconButton
                    size="small"
                    onClick={() => setShowAdvanced(v => !v)}
                    color={showAdvanced ? 'primary' : 'default'}
                >
                    <TuneIcon />
                </IconButton>
                <Typography
                    variant="body2"
                    color={showAdvanced ? 'primary' : 'text.secondary'}
                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setShowAdvanced(v => !v)}
                >
                    Advanced
                </Typography>
            </Box>

            <Collapse in={showAdvanced}>
                {/* Configuration */}
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>Configuration</Typography>
                    <Box sx={{ display: 'flex', gap: 2 }}>
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
                </Paper>

                {/* Query Filter — only shown for Cyclemeter (filters are DB-specific) */}
                {(!formatInfo || formatInfo.format === 'cyclemeter') && <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
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

                    {filterType === 'allRoutes' && (
                        <Typography variant="body2" color="text.secondary">
                            All routes in the file will be imported.
                        </Typography>
                    )}
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
                </Paper>}
            </Collapse>

            {/* Actions */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                {(!formatInfo || !SINGLE_FILE_FORMATS.has(formatInfo.format) || !stats) && (
                    <Button
                        variant="contained"
                        startIcon={processing ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                        onClick={handleProcess}
                        disabled={!dbFile || !formatInfo || processing || saving}
                        data-testid="process-button"
                    >
                        {processing ? 'Processing...' : 'Process'}
                    </Button>
                )}
                {stats && !saving && (
                    <Button
                        variant="contained"
                        color="secondary"
                        startIcon={<SaveIcon />}
                        onClick={handleSaveToDarwin}
                        disabled={!dbFile || processing}
                        data-testid="save-to-darwin-button"
                    >
                        Save to Darwin
                    </Button>
                )}
                {saving && (
                    <Button
                        variant="outlined"
                        color="error"
                        startIcon={<CancelIcon />}
                        onClick={handleCancelSave}
                        data-testid="cancel-save-button"
                    >
                        Cancel
                    </Button>
                )}
            </Box>

            {/* Save Progress */}
            {saving && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        Saving activity {saveProgress.current} of {saveProgress.total}
                    </Typography>
                    <LinearProgress variant="determinate" value={progressPercent} />
                </Paper>
            )}

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
                            <tr><td>Total Activities</td><td><strong>{stats.totalRuns}</strong></td></tr>
                            <tr><td>Total Distance</td><td><strong>{stats.totalDistance} miles</strong></td></tr>
                            <tr><td>GPS Points Extracted</td><td><strong>{stats.totalExtracted.toLocaleString()}</strong></td></tr>
                            <tr><td>GPS Points Trimmed</td><td><strong>{(stats.totalTrimmed ?? 0).toLocaleString()}</strong></td></tr>
                            <tr><td>GPS Points Stripped ({minDelta}m)</td><td><strong>{stats.totalStripped.toLocaleString()}</strong></td></tr>
                            <tr><td>GPS Points Remaining</td><td><strong>{stats.totalRemaining.toLocaleString()}</strong></td></tr>
                            <tr><td>Reduction</td><td><strong>{stats.percentReduction}%</strong></td></tr>
                        </tbody>
                    </Box>
                </Paper>
            )}

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={6000}
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
            >
                <Alert
                    onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                    severity={snackbar.severity}
                    variant="filled"
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default CyclemeterImport;
