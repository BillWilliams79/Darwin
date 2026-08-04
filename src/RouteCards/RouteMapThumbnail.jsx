import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import { useMapCoordinates } from '../hooks/useDataQueries';

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
const TILE_ATTRIBUTION = '&copy; Esri, HERE, Garmin, USGS';

const DEFAULT_HEIGHT = 240;

/** Auto-fit map bounds to the polyline */
const FitBounds = ({ positions }) => {
    const map = useMap();
    React.useEffect(() => {
        if (positions.length > 1) {
            map.fitBounds(positions, { padding: [10, 10] });
        }
    }, [map, positions]);
    return null;
};

const wrapperSx = {
    mx: 0.5,
    mt: 1,
    borderRadius: 2,
    overflow: 'hidden',
    border: '2px solid #bdbdbd',
};

// tracks (req #3165): the aggregator card's non-interactive preview tier —
// the SAME thumbnail a per-ride card shows, generalized to draw one polyline
// per aggregated ride instead of one. When supplied, the internal single-run
// fetch is skipped (the caller already holds the combined tracks); the
// runId path below is completely unchanged for every existing caller.
// preferCanvas: default false (SVG), matching every existing single-ride
// caller; the aggregator opts in because up to MAX_AGGREGATE_RUNS SVG nodes
// does not scale the way one canvas layer does.
const RouteMapThumbnail = ({ runId, height = DEFAULT_HEIGHT, tracks, preferCanvas = false }) => {
    const { data: coords = [], isLoading } = useMapCoordinates(runId, { enabled: !tracks });
    // Empty tracks are routine (a run whose coordinate fetch returned no
    // rows) — drop them before they become empty Polylines / dilute FitBounds.
    const allTracks = useMemo(
        () => (tracks ?? (coords.length > 0 ? [coords] : [])).filter(t => t.length > 0),
        [tracks, coords]
    );

    if (isLoading) {
        return (
            <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', ...wrapperSx }}>
                <CircularProgress size={24} />
            </Box>
        );
    }

    if (allTracks.length === 0) {
        return (
            <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', ...wrapperSx }}>
                No map data
            </Box>
        );
    }

    const allPositions = allTracks.map(t => t.map(c => [Number(c.latitude), Number(c.longitude)]));
    const flatPositions = allPositions.flat();

    return (
        <Box sx={wrapperSx}>
            <MapContainer
                center={flatPositions[0]}
                zoom={13}
                preferCanvas={preferCanvas}
                style={{ height, width: '100%' }}
                dragging={false}
                scrollWheelZoom={false}
                doubleClickZoom={false}
                touchZoom={false}
                zoomControl={false}
                attributionControl={false}
            >
                <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
                {allPositions.map((positions, i) => (
                    <Polyline key={i} positions={positions} pathOptions={{ color: '#4285F4', weight: 3 }} />
                ))}
                <FitBounds positions={flatPositions} />
            </MapContainer>
        </Box>
    );
};

export default RouteMapThumbnail;
