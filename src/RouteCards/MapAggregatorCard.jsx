import React, { useMemo, useState } from 'react';
import Card from '@mui/material/Card';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

import { useMapCoordinatesForRuns } from '../hooks/useDataQueries';
import { countPhotosForRuns } from '../photo-browser/filterUtils.js';
import RouteMapThumbnail from './RouteMapThumbnail';
import RouteMapFull from './RouteMapFull';

const MAP_HEIGHT = 400;

// Ceiling on how many rides one aggregate draws (req #3174, restoring the cap
// lost in the #3181 revert). Every aggregated ride costs one map_coordinates
// query and one polyline, so an unfiltered table is an unbounded fan-out at the
// gateway and an unbounded point cloud in the browser — measured ~1.8M points
// at 500 rides. 200 keeps both bounded while covering every realistic filter.
// Exported so the component test can drive the boundary without stubbing 200
// rides' worth of tracks by hand.
export const MAX_AGGREGATE_RUNS = 200;

// Frame for the loading/error/no-data states — the preview tier supplies its
// own frame instead (RouteMapThumbnail's own wrapperSx; same
// mx/borderRadius/overflow/border values, `mt` not `mb`).
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
 * filtered ride, drawn on the SAME two-tier map every per-ride card uses —
 * a non-interactive preview (RouteMapThumbnail) in the card until clicked,
 * then the SAME full interactive experience a per-ride card's click leaves
 * the card grid entirely for (RouteMapFull, generalized for multiple tracks,
 * req #3165 review). A per-ride card gets there by navigating to its own
 * page; the aggregate has no id to route to, so a `Dialog fullScreen` — the
 * identical pattern ExportDialog already uses to expand its own map — takes
 * the map out of the card and over the whole viewport instead, rather than
 * growing the map inside the 400px card cell (which is not the same thing
 * and was called out as such in review). Headed by ride count, total
 * distance, and photo count. Fed the FULL filtered list, never the paginated
 * slice — then capped at MAX_AGGREGATE_RUNS for the draw, with the shortfall
 * reported in the header (req #3174).
 */
// dedupedPhotoIndex three-state: an array = parent-loaded index, null = parent
// is loading (or found none), undefined = parent is not managing the index at
// all and the photo layer self-loads. No default — it would erase the
// null/undefined distinction the layer's fallback depends on.
const MapAggregatorCard = ({ runs = [], dedupedPhotoIndex }) => {
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

    // Whether the full-screen dialog (RouteMapFull) is open. false = the
    // card shows only the non-interactive preview (RouteMapThumbnail).
    const [expanded, setExpanded] = useState(false);

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
        <>
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

                {isLoading ? (
                    <Box sx={{ ...mapWrapperSx, height: MAP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : isError ? (
                    <Box sx={{ ...mapWrapperSx, height: MAP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', color: 'error.main' }}
                        data-testid="map-aggregator-card-error"
                    >
                        Failed to load ride tracks
                    </Box>
                ) : !hasTrack ? (
                    <Box sx={{ ...mapWrapperSx, height: MAP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover' }}>
                        No map data
                    </Box>
                ) : (
                    /* The clickable preview tier — the SAME thumbnail a per-ride
                       card shows. RouteMapThumbnail supplies its own frame (`mt`
                       rather than `mb`, so this tier's gap sits above the map
                       instead of below — cosmetic, not a functional gap). */
                    <Box
                        onClick={() => setExpanded(true)}
                        sx={{ cursor: 'pointer' }}
                        data-testid="map-aggregator-card-preview"
                    >
                        <RouteMapThumbnail tracks={tracks} height={MAP_HEIGHT} preferCanvas />
                    </Box>
                )}
            </Card>

            {/* The full-interactive tier — the SAME map a per-ride card opens
                on click (RouteMapFull, generalized for multiple tracks), but
                reached by leaving the card grid entirely rather than growing
                inside a 400px cell. A per-ride card gets there by navigating
                to its own page; the aggregate has no id to route to, so
                Dialog fullScreen — the identical pattern ExportDialog already
                uses for its own map (ExportDialog.jsx) — stands in for that
                navigation. */}
            <Dialog
                open={expanded}
                onClose={() => setExpanded(false)}
                fullScreen
                data-testid="map-aggregator-card-full-dialog"
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {aggregateRuns.length} {aggregateRuns.length === 1 ? 'ride' : 'rides'}
                    <Typography variant="body2" color="text.secondary" component="span">
                        {totalDistance} mi{photoCount != null && ` · ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`}
                    </Typography>
                    <Box sx={{ flexGrow: 1 }} />
                    <IconButton
                        onClick={() => setExpanded(false)}
                        size="small"
                        title="Exit full screen"
                        data-testid="map-aggregator-card-collapse-button"
                    >
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers sx={{ p: 0 }}>
                    <Box sx={{ height: 'calc(100vh - 120px)' }}>
                        <RouteMapFull
                            tracks={tracks}
                            runs={aggregateRuns}
                            dedupedIndex={dedupedPhotoIndex}
                            height="100%"
                            preferCanvas
                        />
                    </Box>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default React.memo(MapAggregatorCard);
