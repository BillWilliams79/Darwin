import React, { useMemo } from 'react';
import Card from '@mui/material/Card';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import { useMapCoordinatesForRuns } from '../hooks/useDataQueries';
import { countPhotosForRuns } from '../photo-browser/filterUtils.js';
import { IS_MACOS } from '../photo-browser/proxyConfig.js';
import ExportMapPreview from '../MapExport/ExportMapPreview';
import PhotoMarkerLayer from './PhotoMarkerLayer';

const MAP_HEIGHT = 400;

// Same frame as RouteMapThumbnail so the aggregator map reads as part of the
// card grid rather than a different surface.
const mapWrapperSx = {
    mx: 0.5,
    mb: 1,
    borderRadius: 2,
    overflow: 'hidden',
    border: '2px solid #bdbdbd',
};

/**
 * Aggregator card — combined ride track map (req #3158).
 *
 * Always the first cell of the RouteCardView grid: one polyline per currently
 * filtered ride on a single fitted-bounds map (ExportMapPreview presentation),
 * headed by ride count, total distance, and photo count. Fed the FULL filtered
 * list, never the paginated slice.
 */
// dedupedPhotoIndex three-state: an array = parent-loaded index, null = parent
// is loading (or found none), undefined = parent is not managing the index at
// all and the photo layer self-loads. No default — it would erase the
// null/undefined distinction the layer's fallback depends on.
const MapAggregatorCard = ({ runs = [], dedupedPhotoIndex }) => {
    // Same gate expression as RouteMapFull's per-ride photo layer.
    const photoMarkersEnabled = IS_MACOS && localStorage.getItem('photo-browser-enabled') !== 'false';
    const runIds = useMemo(() => runs.map(r => r.id), [runs]);
    const { data: tracks = [], isLoading, isError } = useMapCoordinatesForRuns(runIds);

    // Point cloud for the photo grid overlay's track-avoidance placement,
    // downsampled: the placement heuristic only needs a quadrant histogram,
    // and projecting every point of the full filtered list (measured ~1.8M
    // points at 500 rides) blocks the main thread on first grid open.
    const flatTrackCoords = useMemo(() => {
        const flat = tracks.flat();
        const MAX_PLACEMENT_POINTS = 4000;
        if (flat.length <= MAX_PLACEMENT_POINTS) return flat;
        const stride = Math.ceil(flat.length / MAX_PLACEMENT_POINTS);
        const sampled = [];
        for (let i = 0; i < flat.length; i += stride) sampled.push(flat[i]);
        return sampled;
    }, [tracks]);

    const totalDistance = useMemo(() => {
        let total = 0;
        for (const run of runs) total += Number(run.distance_mi) || 0;
        return Math.round(total * 10) / 10;
    }, [runs]);

    // Photo count only renders once the (parent-loaded) index is available —
    // same gating as the per-ride cards (req #2855). The batched util, not a
    // countPhotosForRun loop: this card spans the FULL filtered list, where
    // the per-ride linear scan measurably blocks the main thread for seconds.
    const photoCount = useMemo(
        () => (dedupedPhotoIndex ? countPhotosForRuns(dedupedPhotoIndex, runs) : null),
        [dedupedPhotoIndex, runs]
    );

    const hasTrack = tracks.some(t => t.length > 0);

    return (
        <Card raised
            data-testid="map-aggregator-card"
            sx={{ border: '2px solid transparent', '&:hover': { borderColor: 'primary.main' } }}
        >
            <Box
                sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', px: 2, pt: 1.5, pb: 0.5 }}
                data-testid="map-aggregator-card-stats"
            >
                <Typography sx={{ fontSize: 24 }}>
                    {runs.length} {runs.length === 1 ? 'ride' : 'rides'}
                </Typography>
                <Typography variant="body2" color="text.secondary" component="span" sx={{ mx: 0.75 }}>·</Typography>
                <Typography variant="body2" color="text.secondary">{totalDistance} mi</Typography>
                {photoCount != null && (
                    <>
                        <Typography variant="body2" color="text.secondary" component="span" sx={{ mx: 0.75 }}>·</Typography>
                        <Typography variant="body2" color="text.secondary">
                            {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
                        </Typography>
                    </>
                )}
            </Box>

            <Box sx={mapWrapperSx}>
                {isLoading ? (
                    <Box sx={{ height: MAP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : isError ? (
                    <Box sx={{ height: MAP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', color: 'error.main' }}
                        data-testid="map-aggregator-card-error"
                    >
                        Failed to load ride tracks
                    </Box>
                ) : hasTrack ? (
                    /* scrollWheel off: a wheel over the card must scroll the page,
                       not zoom the map — zooming stays available via the map's own
                       controls, double-click, and fullscreen. preferCanvas: one
                       SVG node per ride does not scale to the whole filtered
                       table; canvas rendering does. */
                    <ExportMapPreview routeCoordinates={tracks} height={MAP_HEIGHT} scrollWheel={false} preferCanvas>
                        {/* Union of photos across every aggregated ride's time
                            window (req #3159) — same cluster/grid/lightbox layer
                            as the per-ride full map, same feature gate. Renders
                            nothing when the local index/proxy is absent. */}
                        {photoMarkersEnabled && (
                            <PhotoMarkerLayer
                                runs={runs}
                                coordinates={flatTrackCoords}
                                dedupedIndex={dedupedPhotoIndex}
                            />
                        )}
                    </ExportMapPreview>
                ) : (
                    <Box sx={{ height: MAP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover' }}>
                        No map data
                    </Box>
                )}
            </Box>
        </Card>
    );
};

export default React.memo(MapAggregatorCard);
