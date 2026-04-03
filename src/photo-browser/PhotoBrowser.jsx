import React, { useState, useEffect, useRef, useMemo, useCallback, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ImageSearchIcon from '@mui/icons-material/ImageSearch';
import Lightbox from 'yet-another-react-lightbox';
import Video from 'yet-another-react-lightbox/plugins/video';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';

import AuthContext from '../Context/AuthContext';
import { useMapRuns, useMapRoutes } from '../hooks/useDataQueries';
import useScanStore from './useScanStore.js';
import { loadIndex } from './handleDB.js';
import { PHOTOS_PROXY_URL } from './proxyConfig.js';
import ThumbnailGrid, { proxyFileUrl } from './ThumbnailGrid.jsx';

/** Format a Date to "YYYY-MM-DDTHH:MM" for datetime-local input */
function toDatetimeLocal(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse a datetime-local string to a Date, or null */
function fromDatetimeLocal(str) {
    return str ? new Date(str) : null;
}

const BEFORE_OPTIONS = [
    { value: 0, label: 'Exact start' },
    { value: 30, label: '30 min' },
    { value: 60, label: '1 hour' },
    { value: 120, label: '2 hours' },
    { value: 240, label: '4 hours' },
];

const AFTER_OPTIONS = [
    { value: 0, label: 'Exact finish' },
    { value: 30, label: '30 min' },
    { value: 60, label: '1 hour' },
    { value: 120, label: '2 hours' },
    { value: 240, label: '4 hours' },
];

const PhotoBrowser = () => {
    const { runId } = useParams();
    const navigate = useNavigate();
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.id;

    const { data: allRuns = [], isLoading: runsLoading } = useMapRuns(creatorFk);
    const { data: routes = [] } = useMapRoutes(creatorFk);
    const run = allRuns.find((r) => String(r.id) === String(runId));
    const routeName = run ? routes.find((rt) => rt.id === run.map_route_fk)?.name : null;

    // Scan store
    const index = useScanStore((s) => s.index);
    const setIndex = useScanStore((s) => s.setIndex);

    // Time buffer state (minutes before/after activity, 0 = exact)
    const [beforeMin, setBeforeMin] = useState(0);
    const [afterMin, setAfterMin] = useState(0);

    // Computed filter dates from run + buffers
    const filterDates = useMemo(() => {
        if (!run) return { startDate: '', endDate: '' };
        const startUtc = new Date(run.start_time.endsWith('Z') ? run.start_time : run.start_time + 'Z');
        const endUtc = new Date(startUtc.getTime() + ((run.run_time_sec || 0) + (run.stopped_time_sec || 0)) * 1000);
        const filterStart = new Date(startUtc.getTime() - beforeMin * 60 * 1000);
        const filterEnd = new Date(endUtc.getTime() + afterMin * 60 * 1000);
        return {
            startDate: toDatetimeLocal(filterStart),
            endDate: toDatetimeLocal(filterEnd),
        };
    }, [run?.id, run?.start_time, run?.run_time_sec, run?.stopped_time_sec, beforeMin, afterMin]);

    const [loadingIndex, setLoadingIndex] = useState(true);

    // Lightbox state
    const [lightboxIndex, setLightboxIndex] = useState(-1);
    const [lightboxSlides, setLightboxSlides] = useState([]);
    const lightboxSlidesRef = useRef([]);

    // On mount: load index from IDB
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const savedIndex = await loadIndex();
            if (cancelled) return;

            if (savedIndex && savedIndex.length > 0) {
                setIndex(savedIndex);
            } else {
                navigate('/maps/settings/photos', { replace: true });
                return;
            }
            setLoadingIndex(false);
        })();
        return () => { cancelled = true; };
    }, []);

    // Cleanup lightbox blob URLs on unmount
    useEffect(() => {
        return () => {
            for (const s of lightboxSlidesRef.current) {
                if (s._blobUrl) URL.revokeObjectURL(s._blobUrl);
            }
        };
    }, []);

    // Deduplicate + sort index
    const dedupedIndex = useMemo(() => {
        const EXT_PREF = { '.jpeg': 0, '.jpg': 0, '.png': 1, '.heic': 2, '.heif': 2, '.mov': 3, '.mp4': 3, '.m4v': 3, '.tiff': 4, '.webp': 1, '.avi': 5 };
        const isOriginal = (path) => path.includes('/originals/');

        const byKey = new Map();
        for (const item of index) {
            const dotIdx = item.name.lastIndexOf('.');
            const stem = dotIdx >= 0 ? item.name.slice(0, dotIdx) : item.name;
            const ext = dotIdx >= 0 ? item.name.slice(dotIdx).toLowerCase() : '';
            const uuid = stem.length >= 36 ? stem.slice(0, 36).toUpperCase() : stem.toLowerCase();

            const existing = byKey.get(uuid);
            if (!existing) {
                byKey.set(uuid, { item, ext });
            } else {
                const newPref = EXT_PREF[ext] ?? 9;
                const oldPref = EXT_PREF[existing.ext] ?? 9;
                if (newPref < oldPref) {
                    const merged = { ...item };
                    if (!merged.dateTaken && existing.item.dateTaken) merged.dateTaken = existing.item.dateTaken;
                    if (existing.item.lat != null && merged.lat == null) { merged.lat = existing.item.lat; merged.lon = existing.item.lon; }
                    byKey.set(uuid, { item: merged, ext });
                } else if (newPref === oldPref && isOriginal(item.path) && !isOriginal(existing.item.path)) {
                    byKey.set(uuid, { item, ext });
                } else {
                    if (isOriginal(item.path) && item.dateTaken && !existing.item.dateTaken) existing.item.dateTaken = item.dateTaken;
                    if (item.lat != null && existing.item.lat == null) { existing.item.lat = item.lat; existing.item.lon = item.lon; }
                }
            }
        }
        const deduped = [...byKey.values()].map((v) => v.item);
        deduped.sort((a, b) => {
            const da = a.dateTaken ? new Date(a.dateTaken).getTime() : 0;
            const db = b.dateTaken ? new Date(b.dateTaken).getTime() : 0;
            return da - db;
        });
        return deduped;
    }, [index]);

    // Filter by date range — auto-updates when buffers change
    const filteredItems = useMemo(() => {
        const start = fromDatetimeLocal(filterDates.startDate);
        const end = fromDatetimeLocal(filterDates.endDate);
        if (!start && !end) return dedupedIndex;

        return dedupedIndex.filter((item) => {
            if (!item.dateTaken) return false;
            const d = new Date(item.dateTaken);
            if (start && d < start) return false;
            if (end && d > end) return false;
            return true;
        });
    }, [dedupedIndex, filterDates]);

    const handleOpenLightbox = useCallback(async (idx) => {
        for (const s of lightboxSlidesRef.current) {
            if (s._blobUrl) URL.revokeObjectURL(s._blobUrl);
        }

        const slides = await Promise.all(filteredItems.map(async (item) => {
            const url = proxyFileUrl(item.path, { quality: 'full' });
            try {
                const resp = await fetch(url);
                if (!resp.ok) return { src: '' };
                const blob = await resp.blob();
                const blobUrl = URL.createObjectURL(blob);
                if (blob.type.startsWith('video/')) {
                    return { type: 'video', sources: [{ src: blobUrl, type: blob.type }], _blobUrl: blobUrl };
                }
                return { src: blobUrl, _blobUrl: blobUrl };
            } catch {
                return { src: '' };
            }
        }));

        lightboxSlidesRef.current = slides;
        setLightboxSlides(slides);
        setLightboxIndex(idx);
    }, [filteredItems]);

    const handleCloseLightbox = useCallback(() => {
        setLightboxIndex(-1);
        setTimeout(() => {
            for (const s of lightboxSlidesRef.current) {
                if (s._blobUrl) URL.revokeObjectURL(s._blobUrl);
            }
            lightboxSlidesRef.current = [];
            setLightboxSlides([]);
        }, 500);
    }, []);

    // Open Photos.app to earliest photo in time range via proxy spotlight
    const handlePhotosSpotlight = useCallback(async () => {
        if (!run) return;
        const startUtc = new Date(run.start_time.endsWith('Z') ? run.start_time : run.start_time + 'Z');
        const endUtc = new Date(startUtc.getTime() + ((run.run_time_sec || 0) + (run.stopped_time_sec || 0)) * 1000);
        const filterStart = new Date(startUtc.getTime() - beforeMin * 60 * 1000);
        const filterEnd = new Date(endUtc.getTime() + afterMin * 60 * 1000);
        const fmt = (d) => d.toISOString().slice(0, 19);
        try {
            await fetch(`${PHOTOS_PROXY_URL}/photos/spotlight?start=${fmt(filterStart)}&end=${fmt(filterEnd)}`);
        } catch {
            // Proxy not running — silently fail
        }
    }, [run, beforeMin, afterMin]);

    // Build title: "{Route Name} {Activity Type} on Wednesday, March 21, 2026"
    const pageTitle = useMemo(() => {
        if (!run) return 'Photos';
        const name = routeName || run.activity_name || 'Activity';
        const d = new Date(run.start_time.endsWith('Z') ? run.start_time : run.start_time + 'Z');
        const dateStr = d.toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });
        return `${name} on ${dateStr}`;
    }, [run, routeName]);

    if (runsLoading || loadingIndex) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ mt: 2, px: 2, pb: 4 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} size="small">
                    Maps
                </Button>
            </Box>

            {/* Title + activity time as subtitle */}
            <Typography variant="h5">{pageTitle}</Typography>
            {run && (() => {
                const s = new Date(run.start_time.endsWith('Z') ? run.start_time : run.start_time + 'Z');
                const e = new Date(s.getTime() + ((run.run_time_sec || 0) + (run.stopped_time_sec || 0)) * 1000);
                const fmt = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                return (
                    <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 2 }}>
                        {fmt(s)} – {fmt(e)}
                    </Typography>
                );
            })()}

            {/* Images displayed control panel */}
            {index.length > 0 && run && (
                <>
                    <Paper variant="outlined" sx={{ pt: 1, px: 2, pb: 2, mb: 2, borderRadius: 2, display: 'inline-block' }}>
                        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 'bold' }}>
                            Images displayed
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                            <TextField
                                select
                                size="small"
                                label="Before activity"
                                value={beforeMin}
                                onChange={(e) => setBeforeMin(Number(e.target.value))}
                                sx={{ width: 140 }}
                            >
                                {BEFORE_OPTIONS.map((opt) => (
                                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                                ))}
                            </TextField>
                            <TextField
                                select
                                size="small"
                                label="After activity"
                                value={afterMin}
                                onChange={(e) => setAfterMin(Number(e.target.value))}
                                sx={{ width: 140 }}
                            >
                                {AFTER_OPTIONS.map((opt) => (
                                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                                ))}
                            </TextField>
                            <Tooltip title="Open first photo in Apple Photos" arrow>
                                <IconButton onClick={handlePhotosSpotlight}>
                                    <ImageSearchIcon sx={{ fontSize: 28 }} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                        <Divider sx={{ my: 1.5 }} />
                        <Typography variant="body2" color="text.secondary">
                            {filteredItems.length} photos &amp; videos
                        </Typography>
                    </Paper>

                    <ThumbnailGrid
                        items={filteredItems}
                        selectedPaths={new Set()}
                        onToggleSelect={() => {}}
                        onOpenLightbox={handleOpenLightbox}
                    />
                </>
            )}

            {/* YARL Lightbox */}
            <Lightbox
                open={lightboxIndex >= 0}
                index={lightboxIndex}
                slides={lightboxSlides}
                close={handleCloseLightbox}
                plugins={[Video, Zoom]}
            />
        </Box>
    );
};

export default PhotoBrowser;
