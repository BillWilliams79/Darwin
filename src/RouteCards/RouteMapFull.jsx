import React from 'react';
import L from 'leaflet';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { MapContainer, TileLayer, Polyline, useMap, ScaleControl, ZoomControl, LayersControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Plugin CSS
import 'leaflet-fullscreen/dist/leaflet.fullscreen.css';
import 'leaflet.locatecontrol/dist/L.Control.Locate.css';
import 'leaflet-easybutton/src/easy-button.css';

// Plugin JS
import 'leaflet-fullscreen';
import { LocateControl as LeafletLocateControl } from 'leaflet.locatecontrol';
import 'leaflet-easybutton';

import MapStatsCard from './MapStatsCard';
import { IS_MACOS } from '../photo-browser/proxyConfig.js';
import PhotoMarkerLayer from './PhotoMarkerLayer';
import './RouteMapFull.css';

// --- Base layers (no key required) ---
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const CYCLOSM_URL = 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png';
const CYCLOSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://www.cyclosm.org">CyclOSM</a>';

const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = '&copy; Esri, Maxar, Earthstar Geographics';

const CARTO_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

const CARTO_VOYAGER_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

const ESRI_TOPO_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
const ESRI_TOPO_ATTR = '&copy; Esri, HERE, Garmin, USGS';

// --- Overlays (no key required) ---
const WAYMARKED_CYCLING_URL = 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png';
const WAYMARKED_ATTR = '&copy; <a href="https://waymarkedtrails.org">Waymarked Trails</a>';

const CARTO_LABELS_URL = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';

/** Auto-fit map bounds to the polyline */
const FitBounds = ({ positions }) => {
    const map = useMap();
    const posRef = React.useRef(positions);
    posRef.current = positions;

    React.useEffect(() => {
        if (posRef.current.length > 1) {
            map.fitBounds(posRef.current, { padding: [30, 30] });
        }
    }, [map]);
    return null;
};

/** Fullscreen toggle — uses CSS pseudo-fullscreen (no browser API needed) */
const FullscreenControl = () => {
    const map = useMap();
    React.useEffect(() => {
        const ctrl = L.control.fullscreen({
            position: 'topleft',
            pseudoFullscreen: true,
        });
        ctrl.addTo(map);
        return () => ctrl.remove();
    }, [map]);
    return null;
};

/** GPS locate */
const LocateCtrl = () => {
    const map = useMap();
    React.useEffect(() => {
        const ctrl = new LeafletLocateControl({
            position: 'topleft',
            strings: { title: 'Show my location' },
            flyTo: true,
        });
        ctrl.addTo(map);
        return () => ctrl.remove();
    }, [map]);
    return null;
};

/**
 * Reset View ("show track") button — fits the map back to the route bounds.
 * Uses a folded-map SVG (MUI "Map" icon path) so the control reads as a map,
 * not the earlier ↺ squiggle. See req #2236.
 */
const SHOW_TRACK_ICON_HTML = (
    '<svg class="show-track-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 ' +
    '.28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-' +
    '.28-.22-.5-.5-.5zM10 5.47l4 1.4v11.66l-4-1.4V5.47zm-5 .99l3-1.01v11.7l-' +
    '3 1.16V6.46zm14 11.08l-3 1.01V6.86l3-1.16v11.84z"/></svg>'
);

const ResetViewControl = ({ positions }) => {
    const map = useMap();
    React.useEffect(() => {
        const btn = L.easyButton(SHOW_TRACK_ICON_HTML, () => {
            if (positions.length > 1) {
                map.fitBounds(positions, { padding: [30, 30] });
            }
        }, 'Show track — reset view to route');
        btn.addTo(map);
        return () => btn.remove();
    }, [map, positions]);
    return null;
};

/**
 * PersistentLayers — the layers panel opens only on click (no hover-open),
 * stays open while the user clicks base-layer radios and overlay checkboxes,
 * and collapses only when the user clicks outside the panel.
 *
 * Default Leaflet 1.9 behavior (collapsed=true) registers three auto-collapse
 * triggers in Control.Layers._initLayout:
 *   - map.on('click', collapse)
 *   - mouseenter on container → _expandSafely (hover-open)
 *   - mouseleave on container → collapse (hover-close)
 * We remove all three via the control's own stored references (matching the
 * stamps that L.DomEvent.on recorded), leaving only the link-click handler on
 * the toggle anchor (which still expands on click). We add a document click
 * listener for outside-click collapse and filter inside clicks with
 * container.contains(e.target). (Leaflet's disableClickPropagation stops
 * mousedown/touchstart/dblclick/contextmenu propagation but NOT click, so
 * inside clicks do reach document — the contains() check is what keeps them
 * from triggering collapse.)
 *
 * Removing map.on('click', collapse) leaves the document-level outside-click
 * listener as the single source of truth for "click outside → close". Map
 * clicks still collapse the panel because they bubble to document.
 */
const PersistentLayers = ({ controlRef }) => {
    const map = useMap();
    React.useEffect(() => {
        const control = controlRef.current;
        if (!control) return undefined;
        const container = control._container;
        if (!container) return undefined;

        map.off('click', control.collapse, control);
        L.DomEvent.off(container, 'mouseenter', control._expandSafely, control);
        L.DomEvent.off(container, 'mouseleave', control.collapse, control);

        const handleOutsideClick = (e) => {
            if (!container.contains(e.target)) {
                control.collapse();
            }
        };
        document.addEventListener('click', handleOutsideClick);

        return () => {
            document.removeEventListener('click', handleOutsideClick);
        };
    }, [map, controlRef]);
    return null;
};

/** Coordinate display — shows lat/lng at cursor position */
const CoordinateDisplay = () => {
    const map = useMap();
    React.useEffect(() => {
        const CoordCtrl = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd() {
                this._div = L.DomUtil.create('div', 'leaflet-control-coordinates');
                this._div.style.cssText = 'background:rgba(255,255,255,0.85);padding:3px 8px;font-size:11px;border-radius:3px;color:#333;';
                this._div.innerHTML = 'Move cursor over map';
                return this._div;
            },
        });
        const ctrl = new CoordCtrl();
        ctrl.addTo(map);

        const onMove = (e) => {
            ctrl._div.innerHTML = `Lat: ${e.latlng.lat.toFixed(5)} &nbsp; Lng: ${e.latlng.lng.toFixed(5)}`;
        };
        map.on('mousemove', onMove);

        return () => {
            map.off('mousemove', onMove);
            ctrl.remove();
        };
    }, [map]);
    return null;
};

const RouteMapFull = ({ coordinates, isLoading, run, routeName, partners, runPartners }) => {
    const photoMarkersEnabled = IS_MACOS && localStorage.getItem('photo-browser-enabled') !== 'false';
    const layersControlRef = React.useRef(null);
    if (isLoading) {
        return (
            <Box sx={{ height: 'calc(100vh - 120px)', minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!coordinates || coordinates.length === 0) {
        return (
            <Box sx={{ height: 'calc(100vh - 120px)', minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
                No map data available
            </Box>
        );
    }

    const positions = coordinates.map(c => [Number(c.latitude), Number(c.longitude)]);

    return (
        <MapContainer
            className="route-map-full"
            center={positions[0]}
            zoom={13}
            style={{ height: 'calc(100vh - 120px)', minHeight: 400, width: '100%', borderRadius: 4 }}
            zoomControl={false}
            scrollWheelZoom={true}
            doubleClickZoom={true}
            dragging={true}
            touchZoom={true}
            boxZoom={true}
            keyboard={true}
        >
            <LayersControl ref={layersControlRef} position="topleft">
                {/* --- Base layers --- */}
                <LayersControl.BaseLayer checked name="Topographic">
                    <TileLayer url={ESRI_TOPO_URL} attribution={ESRI_TOPO_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Satellite">
                    <TileLayer url={ESRI_URL} attribution={ESRI_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Street">
                    <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Cycling (CyclOSM)">
                    <TileLayer url={CYCLOSM_URL} attribution={CYCLOSM_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Voyager">
                    <TileLayer url={CARTO_VOYAGER_URL} attribution={CARTO_ATTR} />
                </LayersControl.BaseLayer>

                {/* --- Overlays --- */}
                <LayersControl.Overlay name="Cycling Routes">
                    <TileLayer url={WAYMARKED_CYCLING_URL} attribution={WAYMARKED_ATTR} />
                </LayersControl.Overlay>
                <LayersControl.Overlay name="Labels">
                    <TileLayer url={CARTO_LABELS_URL} attribution={CARTO_ATTR} />
                </LayersControl.Overlay>
            </LayersControl>

            <Polyline positions={positions} pathOptions={{ color: '#4285F4', weight: 3 }} />
            <FitBounds positions={positions} />

            <ZoomControl position="topleft" />
            <ScaleControl position="bottomleft" metric={false} />

            <FullscreenControl />
            <LocateCtrl />
            <ResetViewControl positions={positions} />
            <PersistentLayers controlRef={layersControlRef} />
            <CoordinateDisplay />
            {photoMarkersEnabled && run && <PhotoMarkerLayer run={run} coordinates={coordinates} />}
            {run && <MapStatsCard run={run} routeName={routeName} partners={partners} runPartners={runPartners} />}
        </MapContainer>
    );
};

export default RouteMapFull;
