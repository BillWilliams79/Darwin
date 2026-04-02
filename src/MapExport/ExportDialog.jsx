import React, { useState, useMemo, useEffect } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import BuildIcon from '@mui/icons-material/Build';
import CloseIcon from '@mui/icons-material/Close';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';

import call_rest_api from '../RestApi/RestApi';
import { generateKml, downloadFile } from '../cyclemeter';
import { reconstructRun } from '../utils/mapDataUtils';
import ExportMapPreview from './ExportMapPreview';

const ExportDialog = ({ open, onClose, runs, routes, partners = [], runPartners = [], darwinUri, idToken, filterDescription }) => {
    const [mapTitle, setMapTitle] = useState('');
    const [mapDescription, setMapDescription] = useState('');
    const [outputFilename, setOutputFilename] = useState('');
    const [generating, setGenerating] = useState(false);
    const [kmlContent, setKmlContent] = useState(null);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(null);
    const [routeCoordinates, setRouteCoordinates] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const [darwinCompat, setDarwinCompat] = useState(false);

    // Reset all state each time the dialog opens (filters may have changed)
    useEffect(() => {
        if (open) {
            setMapTitle('');
            setMapDescription('');
            setOutputFilename('');
            setKmlContent(null);
            setStats(null);
            setRouteCoordinates(null);
            setError(null);
            setExpanded(false);
            setDarwinCompat(false);
        }
    }, [open]);

    // Build partner lookup: run ID → array of partner names
    const runPartnerNamesMap = useMemo(() => {
        if (!darwinCompat) return new Map();
        const partnerById = new Map();
        for (const p of partners) partnerById.set(p.id, p.name);
        const m = new Map();
        for (const rp of runPartners) {
            if (!m.has(rp.map_run_fk)) m.set(rp.map_run_fk, []);
            const name = partnerById.get(rp.map_partner_fk);
            if (name) m.get(rp.map_run_fk).push(name);
        }
        return m;
    }, [darwinCompat, partners, runPartners]);

    // Build route lookup
    const routeMap = useMemo(() => {
        const m = new Map();
        for (const route of routes) {
            m.set(route.id, route.name);
        }
        return m;
    }, [routes]);

    // Count distinct routes in the runs
    const distinctRouteCount = useMemo(() => {
        const ids = new Set();
        for (const run of runs) {
            if (run.map_route_fk != null) ids.add(run.map_route_fk);
        }
        return ids.size;
    }, [runs]);

    const handleGenerate = async () => {
        if (runs.length === 0) return;

        setGenerating(true);
        setError(null);
        setKmlContent(null);
        setStats(null);
        setRouteCoordinates(null);

        try {
            const transformedRuns = [];
            const allCoords = [];
            let totalCoords = 0;

            for (const run of runs) {
                let coords = [];
                try {
                    const coordResult = await call_rest_api(
                        `${darwinUri}/map_coordinates?map_run_fk=${run.id}&fields=latitude,longitude,altitude&sort=seq:asc`,
                        'GET', '', idToken
                    );
                    coords = coordResult.data || [];
                } catch (coordErr) {
                    // 404 = no coordinates for this run — skip gracefully (matches fetchEntity behavior)
                    if (coordErr?.httpStatus?.httpStatus !== 404) throw coordErr;
                }
                totalCoords += coords.length;
                allCoords.push(coords);

                const routeName = routeMap.get(run.map_route_fk) || '';
                transformedRuns.push(reconstructRun(run, coords, routeName));
            }

            transformedRuns.sort((a, b) => a.startTime - b.startTime);

            // Attach partner names when Darwin Compatibility is enabled
            if (darwinCompat) {
                for (const tr of transformedRuns) {
                    const names = runPartnerNamesMap.get(tr.runID);
                    if (names && names.length > 0) tr.partnerNames = names;
                }
            }

            const effectiveTitle = mapTitle || 'Darwin Map Export';
            const effectiveDescription = mapDescription || filterDescription || 'All activities';
            const rawFilename = outputFilename || 'DarwinExport';
            const effectiveFilename = rawFilename.replace(/\.kml$/i, '');
            const config = {
                mapTitle: effectiveTitle,
                mapDescription: effectiveDescription,
                outputFilename: effectiveFilename,
                darwinCompatibility: darwinCompat,
            };
            const kml = generateKml(transformedRuns, config);
            setKmlContent(kml);
            setRouteCoordinates(allCoords);

            let totalDistance = 0;
            for (const r of transformedRuns) {
                totalDistance += r.distance;
            }
            setStats({
                totalRuns: transformedRuns.length,
                totalDistance: Math.round(totalDistance * 10) / 10,
                totalCoordinates: totalCoords,
            });
        } catch (err) {
            console.error('[ExportDialog] Generate error:', err);
            const msg = err?.message
                || (err?.httpStatus ? `API error ${err.httpStatus.httpStatus}: ${err.httpStatus.httpMethod} failed` : null)
                || 'KML generation failed';
            setError(msg);
        } finally {
            setGenerating(false);
        }
    };

    const handleDownload = () => {
        if (kmlContent) {
            const rawFilename = outputFilename || 'DarwinExport';
            const effectiveFilename = rawFilename.replace(/\.kml$/i, '');
            downloadFile(kmlContent, `${effectiveFilename}.kml`);
        }
    };

    const handleClose = () => {
        setExpanded(false);
        onClose();
    };

    // Dialog starts narrow; widens after generation to show map card
    const dialogMaxWidth = routeCoordinates ? 'sm' : 'xs';

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            fullWidth
            maxWidth={expanded ? false : dialogMaxWidth}
            fullScreen={expanded}
            data-testid="export-dialog"
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                Export KML
                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                    {runs.length} activities across {distinctRouteCount} routes
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                {expanded && (
                    <IconButton
                        onClick={() => setExpanded(false)}
                        size="small"
                        title="Exit full screen"
                        data-testid="export-collapse-button"
                    >
                        <FullscreenExitIcon />
                    </IconButton>
                )}
                <IconButton onClick={handleClose} size="small" title="Close export menu" data-testid="export-close-button">
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {expanded ? (
                    /* Fullscreen: map fills the space */
                    <Box sx={{ height: 'calc(100vh - 120px)' }}>
                        <ExportMapPreview routeCoordinates={routeCoordinates} height="100%" />
                    </Box>
                ) : (
                    /* Normal: config form, then map card after generation */
                    <Box>
                        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>KML Configuration</Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <TextField
                                    label="Map Title"
                                    placeholder="Darwin Map Export"
                                    value={mapTitle}
                                    onChange={(e) => setMapTitle(e.target.value)}
                                    size="small"
                                    fullWidth
                                    InputLabelProps={{ shrink: true }}
                                />
                                <TextField
                                    label="Map Description"
                                    placeholder={filterDescription || 'All activities'}
                                    value={mapDescription}
                                    onChange={(e) => setMapDescription(e.target.value)}
                                    size="small"
                                    fullWidth
                                    InputLabelProps={{ shrink: true }}
                                />
                                <TextField
                                    label="Output Filename"
                                    placeholder="DarwinExport.kml"
                                    value={outputFilename}
                                    onChange={(e) => setOutputFilename(e.target.value)}
                                    size="small"
                                    sx={{ maxWidth: 300 }}
                                    InputLabelProps={{ shrink: true }}
                                />
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={darwinCompat}
                                            onChange={(e) => setDarwinCompat(e.target.checked)}
                                            size="small"
                                            data-testid="darwin-compat-switch"
                                        />
                                    }
                                    label={
                                        <Box>
                                            <Typography variant="body2">Darwin Compatibility</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                Include metadata for lossless re-import into Darwin
                                            </Typography>
                                        </Box>
                                    }
                                />
                            </Box>
                        </Paper>

                        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                            <Button
                                variant="contained"
                                startIcon={generating ? <CircularProgress size={20} /> : <BuildIcon />}
                                onClick={handleGenerate}
                                disabled={runs.length === 0 || generating}
                                data-testid="generate-kml-button"
                            >
                                {generating ? 'Generating...' : 'Generate KML'}
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

                        {error && (
                            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: 'error.main' }}>
                                <Typography color="error">{error}</Typography>
                            </Paper>
                        )}

                        {stats && (
                            <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="export-stats-panel">
                                <Typography variant="subtitle2" gutterBottom>Export Summary</Typography>
                                <Box component="table" sx={{ '& td': { pr: 3, py: 0.3 } }}>
                                    <tbody>
                                        <tr><td>Total Activities</td><td><strong>{stats.totalRuns}</strong></td></tr>
                                        <tr><td>Total Distance</td><td><strong>{stats.totalDistance} miles</strong></td></tr>
                                        <tr><td>GPS Coordinates</td><td><strong>{stats.totalCoordinates.toLocaleString()}</strong></td></tr>
                                    </tbody>
                                </Box>
                            </Paper>
                        )}

                        {/* Map card — click to expand fullscreen */}
                        {routeCoordinates && (
                            <Paper
                                variant="outlined"
                                sx={{ overflow: 'hidden', cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
                                onClick={() => setExpanded(true)}
                                data-testid="export-map-card"
                            >
                                <ExportMapPreview routeCoordinates={routeCoordinates} height={240} compact />
                            </Paper>
                        )}
                    </Box>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default ExportDialog;
