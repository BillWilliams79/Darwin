import React, { useContext, useMemo, useState } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { fetchEntity } from '../hooks/factory/createEntityQueries';
import { mapCoordinateKeys } from '../hooks/useQueryKeys';
import ExportMapPreview from '../MapExport/ExportMapPreview';
import PhotoMarkerLayer from './PhotoMarkerLayer';
import { unionPhotosForRuns } from '../photo-browser/filterUtils.js';
import { IS_MACOS } from '../photo-browser/proxyConfig.js';

// Same gate as RouteCard's camera button / RouteCardView's index load.
const PHOTO_FEATURE_ENABLED = IS_MACOS && localStorage.getItem('photo-browser-enabled') !== 'false';

// One coordinate fetch per aggregated ride, capped and reported in the header.
export const MAX_AGGREGATE_RUNS = 200;

// Lambda-Rest opens ONE fresh RDS connection per invocation and db.t4g.small
// has ~170 connections of real headroom, so the aggregate must never fan out
// its fetches all at once — a 200-wide burst is an RDS memory incident, not a
// slow page (code review, req #3158). Four workers keeps the card's peak DB
// footprint at 4 while the per-run cache still fills for every consumer.
const FETCH_CONCURRENCY = 4;

const MAP_HEIGHT = 380;

const MapAggregatorCard = ({ runs = [], dedupedPhotoIndex = null }) => {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);
    const queryClient = useQueryClient();

    const truncated = runs.length > MAX_AGGREGATE_RUNS;
    // `runs` arrives sorted start_time:desc, so the cap keeps the most recent rides.
    const aggregateRuns = useMemo(
        () => (truncated ? runs.slice(0, MAX_AGGREGATE_RUNS) : runs),
        [runs, truncated]
    );
    const runsKey = useMemo(() => aggregateRuns.map(r => r.id).join(','), [aggregateRuns]);

    const [loadedCount, setLoadedCount] = useState(0);

    // ONE query for the whole aggregate, fetching per-run coordinate sets
    // through a bounded worker pool. Each run's result is read from / written
    // to the shared per-run cache key (mapCoordinateKeys.byRun), so
    // RouteMapThumbnail and RouteDetailView still share every byte.
    // staleTime Infinity: tracks are immutable after import, and it stops the
    // global 30s-stale + refetch-on-focus policy re-firing the pool (and
    // refitting the map, discarding the user's pan/zoom) on every tab return.
    const aggregateQuery = useQuery({
        queryKey: ['map_coordinates_aggregate', runsKey],
        enabled: !!idToken && aggregateRuns.length > 0,
        staleTime: Infinity,
        queryFn: async () => {
            setLoadedCount(0);
            const results = new Array(aggregateRuns.length);
            let next = 0;
            let done = 0;
            const worker = async () => {
                while (next < aggregateRuns.length) {
                    const idx = next++;
                    const run = aggregateRuns[idx];
                    const key = mapCoordinateKeys.byRun(run.id);
                    let coords = queryClient.getQueryData(key);
                    if (coords === undefined) {
                        coords = await fetchEntity(
                            `${darwinUri}/map_coordinates?map_run_fk=${run.id}&fields=latitude,longitude,altitude&sort=seq:asc`,
                            idToken
                        );
                        queryClient.setQueryData(key, coords);
                    }
                    results[idx] = coords;
                    done += 1;
                    setLoadedCount(done);
                }
            };
            await Promise.all(
                Array.from({ length: Math.min(FETCH_CONCURRENCY, aggregateRuns.length) }, worker)
            );
            return results;
        },
    });

    const routeCoordinates = useMemo(
        () => (aggregateQuery.data || []).filter(coords => coords && coords.length > 0),
        [aggregateQuery.data]
    );

    // Flattened track points for the photo grid overlay's placement avoidance.
    // Sampled: findBestPlacement projects every point on the UI thread each
    // time a grid opens, and quadrant-picking needs shape, not every vertex.
    const flatCoordinates = useMemo(() => {
        const flat = routeCoordinates.flat();
        const MAX_PLACEMENT_POINTS = 2000;
        if (flat.length <= MAX_PLACEMENT_POINTS) return flat;
        const stride = Math.ceil(flat.length / MAX_PLACEMENT_POINTS);
        return flat.filter((_, i) => i % stride === 0);
    }, [routeCoordinates]);

    const totalDistance = useMemo(
        () => aggregateRuns.reduce((sum, run) => sum + (Number(run.distance_mi) || 0), 0),
        [aggregateRuns]
    );

    const totalPhotos = useMemo(() => {
        if (!PHOTO_FEATURE_ENABLED || !dedupedPhotoIndex) return null;
        // ALL in-window photos, matching the per-card badge convention
        // (countPhotosForRun). The marker layer shows the geotagged subset of
        // this same union, so the map can legitimately show fewer than counted.
        return unionPhotosForRuns(dedupedPhotoIndex, aggregateRuns).length;
    }, [dedupedPhotoIndex, aggregateRuns]);

    // Success only — a disabled query (no token yet) keeps the spinner rather
    // than declaring "no tracks" from data that was never fetched.
    const allSettled = aggregateQuery.isSuccess;
    const loadFailed = aggregateQuery.isError;
    const statsParts = [
        `${aggregateRuns.length} ride${aggregateRuns.length === 1 ? '' : 's'}`,
        `${totalDistance.toFixed(1)} mi`,
    ];
    if (totalPhotos != null) statsParts.push(`${totalPhotos} photo${totalPhotos === 1 ? '' : 's'}`);

    return (
        <Card raised={true} data-testid="map-aggregator-card" sx={{ border: '2px solid transparent' }}>
            <CardContent sx={{ pl: '13.6px', pr: '10.7px' }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 500 }}>
                        Aggregate Map
                    </Typography>
                    <Typography variant="body2" color="text.secondary" data-testid="map-aggregator-card-stats">
                        {statsParts.join(' • ')}
                    </Typography>
                    {truncated && (
                        <Typography variant="caption" color="warning.main">
                            showing the {MAX_AGGREGATE_RUNS} most recent of {runs.length} rides
                        </Typography>
                    )}
                </Box>

                {routeCoordinates.length > 0 ? (
                    <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '2px solid #bdbdbd' }}>
                        <ExportMapPreview routeCoordinates={routeCoordinates} height={MAP_HEIGHT}>
                            {PHOTO_FEATURE_ENABLED && aggregateRuns.length > 0 && (
                                <PhotoMarkerLayer
                                    runs={aggregateRuns}
                                    coordinates={flatCoordinates}
                                    dedupedIndex={dedupedPhotoIndex}
                                />
                            )}
                        </ExportMapPreview>
                    </Box>
                ) : (
                    <Box sx={{
                        height: MAP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 2, border: '2px solid #bdbdbd',
                    }}>
                        {loadFailed ? (
                            <Typography variant="body2" color="error">
                                Couldn't load ride tracks — check the connection and refilter to retry
                            </Typography>
                        ) : allSettled ? (
                            <Typography variant="body2" color="text.disabled">
                                No GPS tracks in the filtered rides
                            </Typography>
                        ) : (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <CircularProgress size={24} />
                                <Typography variant="body2" color="text.secondary">
                                    Loading tracks {loadedCount}/{aggregateRuns.length}
                                </Typography>
                            </Box>
                        )}
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};

export default MapAggregatorCard;
