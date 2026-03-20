import React, { useState, useContext } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import BuildIcon from '@mui/icons-material/Build';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { useMapRuns, useMapRoutes } from '../hooks/useDataQueries';
import { generateKml, downloadFile, DEFAULT_CONFIG } from '../cyclemeter';
import { reconstructRun } from '../utils/mapDataUtils';

const MapExportView = () => {
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const creatorFk = profile?.id;

    const { data: runs = [], isLoading: runsLoading } = useMapRuns(creatorFk);
    const { data: routes = [] } = useMapRoutes(creatorFk);

    const [mapTitle, setMapTitle] = useState(DEFAULT_CONFIG.mapTitle);
    const [mapDescription, setMapDescription] = useState(DEFAULT_CONFIG.mapDescription);
    const [outputFilename, setOutputFilename] = useState(DEFAULT_CONFIG.outputFilename);
    const [generating, setGenerating] = useState(false);
    const [kmlContent, setKmlContent] = useState(null);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(null);

    // Build route lookup
    const routeMap = new Map();
    for (const route of routes) {
        routeMap.set(route.id, route.name);
    }

    const handleGenerate = async () => {
        if (runs.length === 0) return;

        setGenerating(true);
        setError(null);
        setKmlContent(null);
        setStats(null);

        try {
            // Fetch coordinates for each run
            const transformedRuns = [];
            let totalCoords = 0;

            for (const run of runs) {
                const coordResult = await call_rest_api(
                    `${darwinUri}/map_coordinates?map_run_fk=${run.id}&sort=seq:asc`,
                    'GET', '', idToken
                );
                const coords = coordResult.data || [];
                totalCoords += coords.length;

                const routeName = routeMap.get(run.map_route_fk) || '';
                transformedRuns.push(reconstructRun(run, coords, routeName));
            }

            // Sort by start_time ascending (KML convention)
            transformedRuns.sort((a, b) => a.startTime - b.startTime);

            const config = { mapTitle, mapDescription, outputFilename };
            const kml = generateKml(transformedRuns, config);
            setKmlContent(kml);

            // Compute stats
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
            console.error('[MapExport] Generate error:', err);
            setError(err.message || 'KML generation failed');
        } finally {
            setGenerating(false);
        }
    };

    const handleDownload = () => {
        if (kmlContent) {
            downloadFile(kmlContent, `${outputFilename}.kml`);
        }
    };

    return (
        <Box sx={{ maxWidth: 700, mx: 'auto', mt: 3, px: 2 }}>
            <Typography variant="h5" gutterBottom>Export KML</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Generate a KML file from stored run data for Google MyMaps.
                {!runsLoading && ` ${runs.length} runs available.`}
            </Typography>

            {/* KML Config */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>KML Configuration</Typography>
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
                    <TextField
                        label="Output Filename"
                        value={outputFilename}
                        onChange={(e) => setOutputFilename(e.target.value)}
                        size="small"
                        sx={{ maxWidth: 300 }}
                    />
                </Box>
            </Paper>

            {/* Actions */}
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

            {/* Error */}
            {error && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: 'error.main' }}>
                    <Typography color="error">{error}</Typography>
                </Paper>
            )}

            {/* Stats */}
            {stats && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="export-stats-panel">
                    <Typography variant="subtitle2" gutterBottom>Export Summary</Typography>
                    <Box component="table" sx={{ '& td': { pr: 3, py: 0.3 } }}>
                        <tbody>
                            <tr><td>Total Runs</td><td><strong>{stats.totalRuns}</strong></td></tr>
                            <tr><td>Total Distance</td><td><strong>{stats.totalDistance} miles</strong></td></tr>
                            <tr><td>GPS Coordinates</td><td><strong>{stats.totalCoordinates.toLocaleString()}</strong></td></tr>
                        </tbody>
                    </Box>
                </Paper>
            )}
        </Box>
    );
};

export default MapExportView;
