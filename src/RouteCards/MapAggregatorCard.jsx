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

// Ceiling on how many rides one aggregate draws (req #3174, restoring the cap
// lost in the #3181 revert). Every aggregated ride costs one map_coordinates
// query and one polyline, so an unfiltered table is an unbounded fan-out at the
// gateway and an unbounded point cloud in the browser — measured ~1.8M points
// at 500 rides. 200 keeps both bounded while covering every realistic filter.
// Exported so the component test can drive the boundary without stubbing 200
// rides' worth of tracks by hand.
export const MAX_AGGREGATE_RUNS = 200;

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
 * list, never the paginated slice — then capped at MAX_AGGREGATE_RUNS for the
 * draw, with the shortfall reported in the header (req #3174).
 */
// dedupedPhotoIndex three-state: an array = parent-loaded index, null = parent
// is loading (or found none), undefined = parent is not managing the index at
// all and the photo layer self-loads. No default — it would erase the
// null/undefined distinction the layer's fallback depends on.
const MapAggregatorCard = ({ runs = [], dedupedPhotoIndex }) => {
    // Same gate expression as RouteMapFull's per-ride photo layer.
    const photoMarkersEnabled = IS_MACOS && localStorage.getItem('photo-browser-enabled') !== 'false';

    // The cap applies to the FULL filtered list handed down by RouteCardView —
    // never to a pagination slice, which is a different (and wrong) reduction.
    // `runs` inherits map_runs sort=start_time:desc and every filter stage is an
    // order-preserving .filter(), so the retained head really is the most recent.
    const truncated = runs.length > MAX_AGGREGATE_RUNS;
    const aggregateRuns = useMemo(
        () => (truncated ? runs.slice(0, MAX_AGGREGATE_RUNS) : runs),
        [runs, truncated]
    );

    const runIds = useMemo(() => aggregateRuns.map(r => r.id), [aggregateRuns]);
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

    // Over the CAPPED set, like every other figure in the header: the stats
    // describe the rides actually on the map, so header and map agree. The
    // truncation caption is what reports the rides left out.
    // distance_mi arrives as a string DECIMAL from Lambda-Rest; `|| 0` absorbs
    // both NULL columns and any unparseable value without poisoning the sum.
    const totalDistance = useMemo(() => {
        let total = 0;
        for (const run of aggregateRuns) total += Number(run.distance_mi) || 0;
        return Math.round(total * 10) / 10;
    }, [aggregateRuns]);

    // Photo count only renders once the (parent-loaded) index is available —
    // same gating as the per-ride cards (req #2855). The batched util, not a
    // countPhotosForRun loop: this card spans the FULL filtered list, where
    // the per-ride linear scan measurably blocks the main thread for seconds.
    const photoCount = useMemo(
        () => (dedupedPhotoIndex ? countPhotosForRuns(dedupedPhotoIndex, aggregateRuns) : null),
        [dedupedPhotoIndex, aggregateRuns]
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
                    {aggregateRuns.length} {aggregateRuns.length === 1 ? 'ride' : 'rides'}
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

            {/* The rides left out. Without this the header silently reads 200
                while the filter selected far more, and nothing on screen says
                why the two disagree. Deliberately a SIBLING of the stats row,
                not a child: `map-aggregator-card-stats` is read as the stats
                text (here and in test case 1), and the true total inside this
                sentence would contaminate it. */}
            {truncated && (
                <Typography
                    variant="caption"
                    color="warning.main"
                    component="div"
                    sx={{ px: 2, pb: 0.5 }}
                    data-testid="map-aggregator-card-truncation"
                >
                    showing the {MAX_AGGREGATE_RUNS} most recent of {runs.length} rides
                </Typography>
            )}

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
                                runs={aggregateRuns}
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
