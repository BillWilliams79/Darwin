import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import LinearProgress from '@mui/material/LinearProgress';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import { DataGrid } from '@mui/x-data-grid';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { precisionOptimizer, distanceOptimizer, DEFAULT_CONFIG } from '../cyclemeter';
import { mapRunToSql, mapCoordinatesToSql, extractUniqueRoutes, filterNewRunsByCutoff, normalizeRouteName } from '../cyclemeter/sqlMapper';
import { mapStravaActivityToRun } from './stravaDataMapper';
import {
    buildAuthorizeUrl,
    exchangeCodeForTokens,
    getValidAccessToken,
    fetchActivities,
    fetchActivityDetail,
    fetchStreams,
    cacheTokensLocally,
    getCachedTokens,
    clearCachedTokens,
    loadTokensFromDb,
    saveTokensToDb,
    deleteTokensFromDb,
} from '../services/stravaService';

const COORD_BATCH_SIZE = 500;
const CONCURRENCY_LIMIT = 5;
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const STRAVA_SOURCE = 'strava-api';

/** Format seconds as H:MM:SS */
function formatTime(seconds) {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Format meters as miles (1 decimal) */
function metersToMiles(m) {
    return (m / 1609.344).toFixed(1);
}

/** Format meters as feet (integer) */
function metersToFeet(m) {
    return Math.round(m * 3.281);
}

/** Format ISO date as readable local date */
function formatDate(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const columns = [
    { field: 'name', headerName: 'Name', flex: 2, minWidth: 150 },
    { field: 'sport_type', headerName: 'Type', width: 110 },
    {
        field: 'start_date_local',
        headerName: 'Date',
        width: 120,
        valueFormatter: (value) => formatDate(value),
    },
    {
        field: 'distance',
        headerName: 'Distance',
        width: 90,
        valueFormatter: (value) => `${metersToMiles(value)} mi`,
    },
    {
        field: 'moving_time',
        headerName: 'Time',
        width: 90,
        valueFormatter: (value) => formatTime(value),
    },
    {
        field: 'total_elevation_gain',
        headerName: 'Elevation',
        width: 90,
        valueFormatter: (value) => `${metersToFeet(value)} ft`,
    },
];

const StravaImport = () => {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Connection state
    const [stored, setStored] = useState(null); // { id, access_token, refresh_token, expires_at, athlete }
    const [loading, setLoading] = useState(true);
    const [connectError, setConnectError] = useState(null);

    // Activity browser state
    const [activities, setActivities] = useState([]);
    const [page, setPage] = useState(0); // 0-indexed for DataGrid
    const [pageSize, setPageSize] = useState(25);
    const [selectedIds, setSelectedIds] = useState([]);
    const selectionModel = { type: 'include', ids: new Set(selectedIds) };
    const handleSelectionChange = (model) => {
        if (model?.type === 'exclude') {
            // "Select all" in DataGrid v8: exclude mode with empty set = all selected
            const excludedIds = model.ids || new Set();
            const allIds = activities.map(a => a.id).filter(id => !excludedIds.has(id));
            setSelectedIds(allIds);
        } else {
            setSelectedIds(model?.ids ? [...model.ids] : []);
        }
    };
    const [fetchingActivities, setFetchingActivities] = useState(false);
    const [hasFetched, setHasFetched] = useState(false); // user must click "Load Activities" first

    // Date filter — inputs are uncommitted until user clicks Load
    const [dateAfter, setDateAfter] = useState('');
    const [dateBefore, setDateBefore] = useState('');
    const [committedAfter, setCommittedAfter] = useState('');
    const [committedBefore, setCommittedBefore] = useState('');
    const [fetchTrigger, setFetchTrigger] = useState(0); // incremented to trigger fetch

    // Import state
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
    const abortRef = useRef(null);

    // -----------------------------------------------------------------------
    // Load tokens on mount (cache → DB fallback)
    // -----------------------------------------------------------------------
    useEffect(() => {
        let cancelled = false;
        async function loadTokens() {
            // First check if this is an OAuth callback
            const code = searchParams.get('code');
            if (code) {
                try {
                    const tokens = await exchangeCodeForTokens(code);
                    const athleteData = tokens.athlete ? {
                        id: tokens.athlete.id,
                        firstname: tokens.athlete.firstname,
                        lastname: tokens.athlete.lastname,
                        profile: tokens.athlete.profile,
                    } : null;
                    const tokenState = {
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token,
                        expires_at: tokens.expires_at,
                        athlete: athleteData,
                    };
                    cacheTokensLocally(tokenState);
                    if (darwinUri && idToken) {
                        await saveTokensToDb(darwinUri, idToken, call_rest_api, { ...tokenState, athlete: athleteData });
                        const dbRecord = await loadTokensFromDb(darwinUri, idToken, call_rest_api);
                        if (dbRecord) tokenState.id = dbRecord.id;
                    }
                    if (!cancelled) {
                        setStored(tokenState);
                        setLoading(false);
                    }
                    // Clean URL params
                    navigate('/maps/import', { replace: true });
                    return;
                } catch (err) {
                    console.error('[Strava] OAuth callback error:', err);
                    if (!cancelled) {
                        setConnectError(err.message);
                        setLoading(false);
                    }
                    navigate('/maps/import', { replace: true });
                    return;
                }
            }

            // Check for error callback
            const error = searchParams.get('error');
            if (error) {
                if (!cancelled) {
                    setConnectError(`Strava authorization denied: ${error}`);
                    setLoading(false);
                }
                navigate('/maps/import', { replace: true });
                return;
            }

            // Normal load: check cache, then DB
            const cached = getCachedTokens();
            if (cached && cached.access_token && cached.expires_at > 0) {
                if (!cancelled) {
                    setStored(cached);
                    setLoading(false);
                }
                // Also load DB record ID for updates
                if (darwinUri && idToken) {
                    const dbRecord = await loadTokensFromDb(darwinUri, idToken, call_rest_api);
                    if (dbRecord && !cancelled) {
                        setStored(prev => prev ? { ...prev, id: dbRecord.id } : prev);
                    }
                }
                return;
            }

            // No cache — try DB
            if (darwinUri && idToken) {
                const dbRecord = await loadTokensFromDb(darwinUri, idToken, call_rest_api);
                if (dbRecord && !cancelled) {
                    cacheTokensLocally(dbRecord);
                    setStored(dbRecord);
                }
            }
            if (!cancelled) setLoading(false);
        }
        loadTokens();
        return () => { cancelled = true; };
    }, [darwinUri, idToken, searchParams, navigate]);

    // -----------------------------------------------------------------------
    // Fetch activities when connected or page/pageSize changes
    // -----------------------------------------------------------------------
    const loadActivities = useCallback(async () => {
        if (!stored?.access_token) return;
        setFetchingActivities(true);
        try {
            const { accessToken, updatedStored } = await getValidAccessToken(stored, darwinUri, idToken, call_rest_api);
            if (updatedStored !== stored) setStored(updatedStored);
            const dateFilter = {};
            if (committedAfter) dateFilter.after = Math.floor(new Date(committedAfter).getTime() / 1000);
            if (committedBefore) dateFilter.before = Math.floor(new Date(committedBefore + 'T23:59:59').getTime() / 1000);
            const data = await fetchActivities(accessToken, page + 1, pageSize, dateFilter);
            setActivities(data);
            setHasFetched(true);
        } catch (err) {
            console.error('[Strava] Fetch activities error:', err);
            setSnackbar({ open: true, message: `Failed to load activities: ${err.message}`, severity: 'error' });
        } finally {
            setFetchingActivities(false);
        }
    }, [stored, page, pageSize, committedAfter, committedBefore, darwinUri, idToken]);

    // Fetch on trigger (Load button), page, or pageSize change — only after first load
    useEffect(() => {
        if (stored && !loading && fetchTrigger > 0) {
            loadActivities();
        }
    }, [fetchTrigger, page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Load Activities (user-initiated)
    // -----------------------------------------------------------------------
    const handleLoadActivities = () => {
        setCommittedAfter(dateAfter);
        setCommittedBefore(dateBefore);
        setPage(0);
        setSelectedIds([]);
        setHasFetched(true);
        setFetchTrigger(t => t + 1);
    };

    // -----------------------------------------------------------------------
    // Connect / Disconnect
    // -----------------------------------------------------------------------
    const handleConnect = () => {
        window.location.href = buildAuthorizeUrl();
    };

    const handleDisconnect = async () => {
        if (stored?.id) {
            try { await deleteTokensFromDb(darwinUri, idToken, call_rest_api, stored.id); } catch { /* best effort */ }
        }
        clearCachedTokens();
        setStored(null);
        setActivities([]);
        setSelectedIds([]);
    };

    // -----------------------------------------------------------------------
    // Import selected activities
    // -----------------------------------------------------------------------
    const handleImport = async () => {
        if (selectedIds.length === 0) return;

        const controller = new AbortController();
        abortRef.current = controller;
        setImporting(true);
        setImportProgress({ current: 0, total: selectedIds.length });

        try {
            const { accessToken, updatedStored } = await getValidAccessToken(stored, darwinUri, idToken, call_rest_api);
            if (updatedStored !== stored) setStored(updatedStored);

            // Dedup check: get latest strava-api run
            let cutoffDate = null;
            try {
                const cutoffResult = await call_rest_api(
                    `${darwinUri}/map_runs?fields=start_time&source=${STRAVA_SOURCE}&sort=start_time:desc`, 'GET', null, idToken
                );
                cutoffDate = cutoffResult.data?.[0]?.start_time || null;
            } catch (e) {
                if (e?.httpStatus?.httpStatus !== 404) throw e;
            }

            // Fetch existing routes for dedup
            const routeIdMap = new Map();
            const routeNameMap = new Map();
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

            let completed = 0;
            let skipped = 0;

            // Process each selected activity sequentially (respects rate limits)
            for (const activityId of selectedIds) {
                if (controller.signal.aborted) throw new Error('Import cancelled');

                // Fetch detail + streams
                const [detail, streams] = await Promise.all([
                    fetchActivityDetail(accessToken, activityId),
                    fetchStreams(accessToken, activityId),
                ]);

                // Map to Run object
                const run = mapStravaActivityToRun(detail, streams);

                // Dedup check
                if (cutoffDate && new Date(run.startTime) <= new Date(cutoffDate)) {
                    skipped++;
                    completed++;
                    setImportProgress({ current: completed, total: selectedIds.length });
                    continue;
                }

                // Apply optimizers
                precisionOptimizer([run], DEFAULT_CONFIG.precision);
                distanceOptimizer([run], DEFAULT_CONFIG.minDelta);

                // Save route
                let mapRouteFk = routeIdMap.get(run.routeID) || null;
                if (!mapRouteFk) {
                    const normalizedName = normalizeRouteName(run.name);
                    mapRouteFk = routeNameMap.get(normalizedName) || null;
                }
                if (!mapRouteFk) {
                    const routeResult = await call_rest_api(
                        `${darwinUri}/map_routes`, 'POST',
                        { route_id: run.routeID, name: run.name }, idToken
                    );
                    if (routeResult.httpStatus.httpStatus === 200 && routeResult.data?.[0]?.id) {
                        mapRouteFk = routeResult.data[0].id;
                        routeIdMap.set(run.routeID, mapRouteFk);
                        routeNameMap.set(normalizeRouteName(run.name), mapRouteFk);
                    }
                }

                // Save run
                const sqlRun = mapRunToSql(run, mapRouteFk, STRAVA_SOURCE);
                const runResult = await call_rest_api(
                    `${darwinUri}/map_runs`, 'POST', sqlRun, idToken
                );

                if (runResult.httpStatus.httpStatus === 200 && runResult.data?.[0]?.id) {
                    const sqlRunId = runResult.data[0].id;

                    // Save coordinates in batches
                    if (run.coordinates.length > 0) {
                        const sqlCoords = mapCoordinatesToSql(run.coordinates);
                        for (let i = 0; i < sqlCoords.length; i += COORD_BATCH_SIZE) {
                            if (controller.signal.aborted) throw new Error('Import cancelled');
                            const batch = sqlCoords.slice(i, i + COORD_BATCH_SIZE).map(coord => ({
                                ...coord,
                                map_run_fk: sqlRunId,
                            }));
                            await call_rest_api(
                                `${darwinUri}/map_coordinates`, 'POST', batch, idToken
                            );
                        }
                    }
                }

                completed++;
                setImportProgress({ current: completed, total: selectedIds.length });
            }

            const imported = completed - skipped;
            setSnackbar({
                open: true,
                message: skipped > 0
                    ? `Imported ${imported} activities (${skipped} already imported, skipped)`
                    : `Imported ${imported} activities to Darwin`,
                severity: 'success',
            });
            setSelectedIds([]);
        } catch (err) {
            if (err.message === 'Import cancelled') {
                setSnackbar({ open: true, message: 'Import cancelled', severity: 'info' });
            } else {
                console.error('[Strava] Import error:', err);
                const msg = err.message || err.httpStatus?.httpMessage || String(err);
                setSnackbar({ open: true, message: `Import failed: ${msg}`, severity: 'error' });
            }
        } finally {
            setImporting(false);
            abortRef.current = null;
        }
    };

    const handleCancelImport = () => {
        if (abortRef.current) abortRef.current.abort();
    };

    const progressPercent = importProgress.total > 0
        ? Math.round((importProgress.current / importProgress.total) * 100)
        : 0;

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    if (loading) {
        return (
            <Paper variant="outlined" sx={{ p: 3, mb: 2, textAlign: 'center' }}>
                <CircularProgress size={24} sx={{ mr: 1 }} />
                <Typography variant="body2" component="span">Checking Strava connection...</Typography>
            </Paper>
        );
    }

    // Not connected
    if (!stored) {
        return (
            <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Strava</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Connect your Strava account to browse and import activities directly.
                </Typography>
                {connectError && (
                    <Typography color="error" variant="body2" sx={{ mb: 2 }}>{connectError}</Typography>
                )}
                <Button
                    variant="contained"
                    onClick={handleConnect}
                    sx={{
                        backgroundColor: '#FC4C02',
                        '&:hover': { backgroundColor: '#e04400' },
                        textTransform: 'none',
                        fontWeight: 600,
                    }}
                >
                    Connect with Strava
                </Button>
                <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                    Powered by Strava
                </Typography>
            </Paper>
        );
    }

    // Connected — activity browser
    const athleteName = stored.athlete
        ? `${stored.athlete.firstname || ''} ${stored.athlete.lastname || ''}`.trim()
        : 'Connected';

    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                    <Typography variant="subtitle2">
                        Strava — {athleteName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        Powered by Strava
                    </Typography>
                </Box>
                <Link
                    component="button"
                    variant="body2"
                    onClick={handleDisconnect}
                    sx={{ color: 'text.secondary' }}
                >
                    Disconnect
                </Link>
            </Box>

            {/* Date filter + Load button */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
                <TextField
                    label="After"
                    type="date"
                    value={dateAfter}
                    onChange={(e) => setDateAfter(e.target.value)}
                    size="small"
                    InputLabelProps={{ shrink: true }}
                    sx={{ width: 150 }}
                />
                <TextField
                    label="Before"
                    type="date"
                    value={dateBefore}
                    onChange={(e) => setDateBefore(e.target.value)}
                    size="small"
                    InputLabelProps={{ shrink: true }}
                    sx={{ width: 150 }}
                />
                <Button
                    variant="contained"
                    size="small"
                    onClick={handleLoadActivities}
                    disabled={fetchingActivities}
                >
                    {fetchingActivities ? 'Loading...' : 'Load Activities'}
                </Button>
            </Box>

            {/* Activity table — only shown after first load */}
            {hasFetched && (
                <DataGrid
                    rows={activities}
                    columns={columns}
                    checkboxSelection
                    disableRowSelectionOnClick
                    rowSelectionModel={selectionModel}
                    onRowSelectionModelChange={handleSelectionChange}
                    loading={fetchingActivities}
                    hideFooterPagination
                    hideFooter
                    autoHeight
                    getRowId={(row) => row.id}
                    sx={{
                        mb: 2,
                        '& .MuiDataGrid-columnHeaders': { backgroundColor: 'action.hover' },
                    }}
                />
            )}

            {/* Pagination controls — only shown after first load */}
            {hasFetched && (
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
                <TextField
                    select
                    label="Per page"
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                    size="small"
                    sx={{ width: 100 }}
                >
                    {PAGE_SIZE_OPTIONS.map(n => (
                        <MenuItem key={n} value={n}>{n}</MenuItem>
                    ))}
                </TextField>
                <Button
                    size="small"
                    disabled={page === 0 || fetchingActivities}
                    onClick={() => setPage(p => p - 1)}
                >
                    Previous
                </Button>
                <Typography variant="body2" color="text.secondary">
                    Page {page + 1}
                </Typography>
                <Button
                    size="small"
                    disabled={activities.length < pageSize || fetchingActivities}
                    onClick={() => setPage(p => p + 1)}
                >
                    Next
                </Button>
            </Box>
            )}

            {/* Import actions */}
            {hasFetched && (
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {!importing && (
                    <Button
                        variant="contained"
                        onClick={handleImport}
                        disabled={selectedIds.length === 0 || importing}
                    >
                        Import {selectedIds.length > 0 ? `${selectedIds.length} Selected` : 'Selected'}
                    </Button>
                )}
                {importing && (
                    <Button variant="outlined" color="error" onClick={handleCancelImport}>
                        Cancel
                    </Button>
                )}
            </Box>
            )}

            {/* Import progress */}
            {importing && (
                <Box sx={{ mt: 2 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        Importing activity {importProgress.current} of {importProgress.total}
                    </Typography>
                    <LinearProgress variant="determinate" value={progressPercent} />
                </Box>
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
        </Paper>
    );
};

export default StravaImport;
