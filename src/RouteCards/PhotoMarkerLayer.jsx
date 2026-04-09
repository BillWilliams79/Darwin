import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet-easybutton';
import Lightbox from 'yet-another-react-lightbox';
import Video from 'yet-another-react-lightbox/plugins/video';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import './PhotoMarkerLayer.css';

import { loadIndex } from '../photo-browser/handleDB.js';
import { deduplicateIndex, computeRideTimeRange, filterByTimeRange } from '../photo-browser/filterUtils.js';
import { proxyFileUrl } from '../photo-browser/ThumbnailGrid.jsx';

// ---------------------------------------------------------------------------
// Cluster icon
// ---------------------------------------------------------------------------

function clusterIconFactory(cluster) {
    const count = cluster.getChildCount();
    const cls = count >= 50 ? 'large' : count >= 10 ? 'medium' : 'small';
    const dim = cls === 'large' ? 52 : cls === 'medium' ? 44 : 36;
    return L.divIcon({
        html: `<div class="photo-cluster photo-cluster-${cls}">${count}</div>`,
        className: 'photo-marker-icon', iconSize: [dim, dim],
    });
}

// ---------------------------------------------------------------------------
// Track avoidance
// ---------------------------------------------------------------------------

function findBestPlacement(map, coordinates, margin = 16) {
    const size = map.getSize();
    const midX = size.x / 2, midY = size.y / 2;
    const counts = [0, 0, 0, 0];
    for (const c of coordinates) {
        const pt = map.latLngToContainerPoint([Number(c.latitude), Number(c.longitude)]);
        counts[(pt.y >= midY ? 2 : 0) + (pt.x >= midX ? 1 : 0)]++;
    }
    let bestQ = 0;
    for (let i = 1; i < 4; i++) { if (counts[i] < counts[bestQ]) bestQ = i; }
    return { x: (bestQ & 1) ? midX + margin : margin, y: (bestQ & 2) ? midY + margin : margin };
}

// ---------------------------------------------------------------------------
// Photo grid overlay
//
// Top-left anchored, draggable, resizable (corner handle), no scroll.
// Thumbnails auto-size to fit the user-defined container dimensions.
// ---------------------------------------------------------------------------

const GRID_GAP = 3;
const GRID_DEFAULT_COLS = 4;
const GRID_DEFAULT_THUMB = 120;

function createPhotoGridOverlay(map, latlng, initialItems, blobCache, popupBlobs, coordinates, onOpenLightbox) {
    let items = initialItems;
    let anchorLatLng = latlng;
    let thumbSize = GRID_DEFAULT_THUMB;
    let cols = Math.min(GRID_DEFAULT_COLS, items.length);
    let referenceZoom = map.getZoom();
    let currentScale = 1;
    let innerEl = null;

    // Wrapper — pointer-events:none so it doesn't block map clicks,
    // children set pointer-events:auto individually
    const el = document.createElement('div');
    el.className = 'photo-grid-overlay';

    function applyZoomScale() {
        if (!innerEl) return;
        currentScale = Math.pow(2, map.getZoom() - referenceZoom);
        currentScale = Math.min(4, Math.max(0.25, currentScale));
        innerEl.style.transform = `scale(${currentScale})`;
    }

    function bakeScale() {
        if (currentScale === 1) return;
        thumbSize = Math.max(40, Math.round(thumbSize * currentScale));
        referenceZoom = map.getZoom();
        currentScale = 1;
        if (innerEl) innerEl.style.transform = 'scale(1)';
    }

    function positionAt(containerPt) {
        const layerPt = map.containerPointToLayerPoint(L.point(containerPt.x, containerPt.y));
        el.style.left = layerPt.x + 'px';
        el.style.top = layerPt.y + 'px';
    }

    function updatePosition() {
        positionAt(map.latLngToContainerPoint(anchorLatLng));
        applyZoomScale();
    }

    // --- Drag (top bar) ---
    function setupDrag(controls) {
        let dragging = false, startX, startY;
        const onMouseMove = (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX, dy = e.clientY - startY;
            startX = e.clientX; startY = e.clientY;
            const pt = map.latLngToContainerPoint(anchorLatLng);
            anchorLatLng = map.containerPointToLatLng(L.point(pt.x + dx, pt.y + dy));
            positionAt({ x: pt.x + dx, y: pt.y + dy });
        };
        const onMouseUp = () => {
            dragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            controls.style.cursor = 'grab';
        };
        controls.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true; startX = e.clientX; startY = e.clientY;
            controls.style.cursor = 'grabbing';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });
        controls.style.cursor = 'grab';
    }

    // --- Resize (all four corners) ---
    // corner: 'br' | 'bl' | 'tr' | 'tl'
    // br/tr: width grows rightward. bl/tl: width grows leftward (anchor shifts).
    // br/bl: height grows downward. tr/tl: height grows upward (anchor shifts).
    function setupCornerResize(zone, gridEl, corner) {
        let resizing = false, startX, startY, startW;
        const growsLeft = corner === 'bl' || corner === 'tl';

        const onMouseMove = (e) => {
            if (!resizing) return;
            const dx = e.clientX - startX;
            const deltaW = growsLeft ? -dx : dx;
            const newW = Math.max(80, startW + deltaW);
            const newThumb = Math.max(40, Math.floor((newW - (cols - 1) * GRID_GAP) / cols));
            thumbSize = newThumb;
            gridEl.style.gridTemplateColumns = `repeat(${cols}, ${newThumb}px)`;
            gridEl.querySelectorAll('.photo-grid-cell').forEach(cell => {
                cell.style.width = `${newThumb}px`;
                cell.style.height = `${newThumb}px`;
            });
            // If growing left, shift the anchor so the right edge stays fixed
            if (growsLeft) {
                const pt = map.latLngToContainerPoint(anchorLatLng);
                anchorLatLng = map.containerPointToLatLng(L.point(pt.x + dx, pt.y));
                positionAt({ x: pt.x + dx, y: pt.y });
                startX = e.clientX;
                startW = newW;
            }
        };
        const onMouseUp = () => {
            resizing = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        zone.addEventListener('mousedown', (e) => {
            // Bake current zoom scale into thumbSize so resize works at 1:1
            bakeScale();
            gridEl.style.gridTemplateColumns = `repeat(${cols}, ${thumbSize}px)`;
            gridEl.querySelectorAll('.photo-grid-cell').forEach(cell => {
                cell.style.width = `${thumbSize}px`;
                cell.style.height = `${thumbSize}px`;
            });

            resizing = true;
            startX = e.clientX; startY = e.clientY;
            startW = gridEl.getBoundingClientRect().width;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
            e.stopPropagation();
        });
    }

    function render() {
        el.innerHTML = '';
        cols = Math.min(GRID_DEFAULT_COLS, items.length);

        // Inner wrapper — receives pointer events
        const inner = document.createElement('div');
        inner.className = 'photo-grid-inner';
        L.DomEvent.disableClickPropagation(inner);
        L.DomEvent.disableScrollPropagation(inner);

        // Controls bar
        const controls = document.createElement('div');
        controls.className = 'photo-grid-controls';
        controls.innerHTML = `
            <span class="photo-grid-drag-hint">\u2630</span>
            <span class="photo-grid-count">${items.length} photo${items.length !== 1 ? 's' : ''}</span>
            <span class="photo-grid-spacer"></span>
            <button class="photo-grid-close" data-action="close">\u00d7</button>
        `;
        controls.querySelector('[data-action="close"]').addEventListener('click', e => {
            e.stopPropagation(); remove();
        });
        setupDrag(controls);
        inner.appendChild(controls);

        // Photo grid
        const grid = document.createElement('div');
        grid.className = 'photo-grid';
        grid.style.gridTemplateColumns = `repeat(${cols}, ${thumbSize}px)`;
        grid.style.gap = `${GRID_GAP}px`;

        items.forEach((item, idx) => {
            const cell = document.createElement('div');
            cell.className = 'photo-grid-cell';
            cell.style.width = `${thumbSize}px`;
            cell.style.height = `${thumbSize}px`;

            const cached = blobCache.current.get(item.path);
            if (cached) {
                cell.style.backgroundImage = `url('${cached}')`;
                cell.classList.add('photo-grid-cell-loaded');
            } else {
                cell.innerHTML = '<div class="photo-popup-spinner"></div>';
                fetch(proxyFileUrl(item.path))
                    .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
                    .then(blob => {
                        const url = URL.createObjectURL(blob);
                        blobCache.current.set(item.path, url);
                        cell.innerHTML = '';
                        cell.style.backgroundImage = `url('${url}')`;
                        cell.classList.add('photo-grid-cell-loaded');
                    })
                    .catch(() => { cell.innerHTML = '<span class="photo-popup-error">\u00d7</span>'; });
            }

            if (item.mediaType === 'video') {
                const badge = document.createElement('div');
                badge.className = 'photo-grid-video-badge';
                badge.innerHTML = '&#9654;';
                cell.appendChild(badge);
            }

            cell.addEventListener('click', e => {
                e.stopPropagation();
                onOpenLightbox(idx);
            });

            grid.appendChild(cell);
        });

        inner.appendChild(grid);

        // Four corner resize zones — all invisible hotspots, br has visible thumb
        for (const corner of ['tl', 'tr', 'bl', 'br']) {
            const zone = document.createElement('div');
            zone.className = `photo-grid-resize-zone photo-grid-resize-${corner}`;
            setupCornerResize(zone, grid, corner);
            inner.appendChild(zone);
        }

        el.appendChild(inner);
        innerEl = inner;
        applyZoomScale();
    }

    map.getPane('popupPane').appendChild(el);

    const bestPt = findBestPlacement(map, coordinates);
    anchorLatLng = map.containerPointToLatLng(L.point(bestPt.x, bestPt.y));

    const onMove = () => updatePosition();
    map.on('move zoom viewreset', onMove);

    render();
    updatePosition();

    function remove() {
        map.off('move zoom viewreset', onMove);
        if (el.parentNode) el.parentNode.removeChild(el);
    }

    function setItems(newItems) {
        items = newItems;
        referenceZoom = map.getZoom();
        currentScale = 1;
        render();
    }

    function getItems() { return items; }

    return { el, remove, updatePosition, setItems, getItems };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PhotoMarkerLayer = ({ run, coordinates }) => {
    const map = useMap();
    const rawIndexRef = useRef(null);
    const blobCache = useRef(new Map());
    const popupBlobs = useRef([]);
    const clusterRef = useRef(null);
    const toggleBtnRef = useRef(null);
    const gridOverlayRef = useRef(null);
    const indexLoaded = useRef(false);
    const [, forceUpdate] = useState(0);

    const [lightboxIndex, setLightboxIndex] = useState(-1);
    const [lightboxSlides, setLightboxSlides] = useState([]);
    const lightboxSlidesRef = useRef([]);

    useEffect(() => {
        let cancelled = false;
        loadIndex().then(idx => {
            if (!cancelled && idx) {
                rawIndexRef.current = idx;
                indexLoaded.current = true;
                forceUpdate(n => n + 1);
            }
        });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => () => {
        for (const s of lightboxSlidesRef.current) {
            if (s._blobUrl) URL.revokeObjectURL(s._blobUrl);
        }
    }, []);

    const gpsPhotos = useMemo(() => {
        if (!rawIndexRef.current || !run) return [];
        const deduped = deduplicateIndex(rawIndexRef.current);
        const range = computeRideTimeRange(run);
        if (!range) return [];
        return filterByTimeRange(deduped, range.filterStart, range.filterEnd)
            .filter(i => i.lat != null && i.lon != null);
    }, [indexLoaded.current, run?.id, run?.start_time, run?.run_time_sec, run?.stopped_time_sec]);

    const handleOpenLightbox = useCallback(async (idx) => {
        for (const s of lightboxSlidesRef.current) {
            if (s._blobUrl) URL.revokeObjectURL(s._blobUrl);
        }
        const gridItems = gridOverlayRef.current?.getItems() || [];
        const slides = await Promise.all(gridItems.map(async (item) => {
            try {
                const resp = await fetch(proxyFileUrl(item.path, { quality: 'full' }));
                if (!resp.ok) return { src: '' };
                const blob = await resp.blob();
                const blobUrl = URL.createObjectURL(blob);
                if (blob.type.startsWith('video/')) {
                    return { type: 'video', sources: [{ src: blobUrl, type: blob.type }], _blobUrl: blobUrl };
                }
                return { src: blobUrl, _blobUrl: blobUrl };
            } catch { return { src: '' }; }
        }));
        lightboxSlidesRef.current = slides;
        setLightboxSlides(slides);
        setLightboxIndex(idx);
    }, []);

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

    // Toggle button
    useEffect(() => {
        if (!map || gpsPhotos.length === 0) return;
        const toggle = L.easyButton({
            position: 'topleft',
            states: [{
                stateName: 'photos-on', icon: '&#128247;',
                title: 'Hide photo markers',
                onClick: () => {
                    if (clusterRef.current && map.hasLayer(clusterRef.current))
                        map.removeLayer(clusterRef.current);
                    if (gridOverlayRef.current) {
                        gridOverlayRef.current.remove();
                        gridOverlayRef.current = null;
                    }
                    toggle.state('photos-off');
                },
            }, {
                stateName: 'photos-off', icon: '&#128247;',
                title: 'Show photo markers',
                onClick: () => {
                    if (clusterRef.current && !map.hasLayer(clusterRef.current))
                        map.addLayer(clusterRef.current);
                    toggle.state('photos-on');
                },
            }],
        });
        toggle.addTo(map);
        toggleBtnRef.current = toggle;
        return () => { toggle.remove(); toggleBtnRef.current = null; };
    }, [map, gpsPhotos.length > 0]);

    // Build cluster group
    useEffect(() => {
        if (!map || gpsPhotos.length === 0) return;
        let cancelled = false;
        const markerItemMap = new Map();

        const group = L.markerClusterGroup({
            maxClusterRadius: 50,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: false,
            spiderfyOnMaxZoom: false,
            iconCreateFunction: clusterIconFactory,
            singleMarkerMode: true,
        });

        const placeholder = L.divIcon({ html: '<div></div>', className: 'photo-marker-icon', iconSize: [1, 1] });

        const markers = gpsPhotos.map(item => {
            const marker = L.marker([item.lat, item.lon], { icon: placeholder });
            markerItemMap.set(marker, item);
            if (!blobCache.current.has(item.path)) {
                fetch(proxyFileUrl(item.path))
                    .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
                    .then(blob => {
                        if (cancelled) return;
                        blobCache.current.set(item.path, URL.createObjectURL(blob));
                    })
                    .catch(() => {});
            }
            return marker;
        });

        group.addLayers(markers);
        map.addLayer(group);
        clusterRef.current = group;

        const openGrid = (latlng, items) => {
            if (items.length === 0) return;
            // Check if overlay still exists in the DOM (user may have closed it)
            if (gridOverlayRef.current && gridOverlayRef.current.el.parentNode) {
                gridOverlayRef.current.setItems(items);
            } else {
                gridOverlayRef.current = createPhotoGridOverlay(
                    map, latlng, items, blobCache, popupBlobs,
                    coordinates || [], handleOpenLightbox
                );
            }
        };

        group.on('clusterclick', e => {
            console.log('[PhotoMarkerLayer] clusterclick, children:', e.layer.getChildCount());
            const items = e.layer.getAllChildMarkers()
                .map(m => markerItemMap.get(m))
                .filter(Boolean)
                .sort((a, b) => {
                    const da = a.dateTaken ? new Date(a.dateTaken).getTime() : 0;
                    const db = b.dateTaken ? new Date(b.dateTaken).getTime() : 0;
                    return da - db;
                });
            console.log('[PhotoMarkerLayer] resolved items:', items.length);
            openGrid(e.layer.getLatLng(), items);
        });

        group.on('click', e => {
            console.log('[PhotoMarkerLayer] marker click');
            const item = markerItemMap.get(e.layer);
            if (item) openGrid(e.layer.getLatLng(), [item]);
        });

        // Telemetry: log when cluster group is re-added or events are rebound after zoom
        map.on('zoomend', () => {
            if (cancelled) return;
            const hasGroup = map.hasLayer(group);
            const listenerCount = group.listens('clusterclick');
            console.log('[PhotoMarkerLayer] zoomend — group on map:', hasGroup, 'clusterclick listeners:', listenerCount);
        });

        return () => {
            cancelled = true;
            if (gridOverlayRef.current) {
                gridOverlayRef.current.remove();
                gridOverlayRef.current = null;
            }
            if (map.hasLayer(group)) map.removeLayer(group);
            group.clearLayers();
            clusterRef.current = null;
            for (const url of popupBlobs.current) URL.revokeObjectURL(url);
            popupBlobs.current = [];
        };
    }, [map, gpsPhotos, handleOpenLightbox]);

    useEffect(() => () => {
        for (const url of blobCache.current.values()) URL.revokeObjectURL(url);
        blobCache.current.clear();
        for (const url of popupBlobs.current) URL.revokeObjectURL(url);
        popupBlobs.current = [];
    }, []);

    return (
        <Lightbox
            open={lightboxIndex >= 0}
            index={lightboxIndex}
            slides={lightboxSlides}
            close={handleCloseLightbox}
            plugins={[Video, Zoom]}
        />
    );
};

export default PhotoMarkerLayer;
