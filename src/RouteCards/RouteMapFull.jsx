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

const ESRI_NATGEO_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}';
const ESRI_NATGEO_ATTR = '&copy; Esri, National Geographic';

// --- Overlays (no key required) ---
const WAYMARKED_CYCLING_URL = 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png';
const WAYMARKED_ATTR = '&copy; <a href="https://waymarkedtrails.org">Waymarked Trails</a>';

const CARTO_LABELS_URL = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';

/** Track active base layer name — drives conditional overlay visibility */
const useBaseLayerName = () => {
    const map = useMap();
    const [name, setName] = React.useState('Topographic');
    React.useEffect(() => {
        const handler = (e) => setName(e.name);
        map.on('baselayerchange', handler);
        return () => map.off('baselayerchange', handler);
    }, [map]);
    return name;
};

/** Conditional Labels overlay — only shown when Satellite base layer is active */
const SatelliteLabelsOverlay = () => {
    const baseLayer = useBaseLayerName();
    if (baseLayer !== 'Satellite') return null;
    return (
        <LayersControl.Overlay name="Labels">
            <TileLayer url={CARTO_LABELS_URL} attribution={CARTO_ATTR} />
        </LayersControl.Overlay>
    );
};

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

/** Reset View button — fits back to the route bounds */
const ResetViewControl = ({ positions }) => {
    const map = useMap();
    React.useEffect(() => {
        const btn = L.easyButton('&#8634;', () => {
            if (positions.length > 1) {
                map.fitBounds(positions, { padding: [30, 30] });
            }
        }, 'Reset view to route');
        btn.addTo(map);
        return () => btn.remove();
    }, [map, positions]);
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
            <LayersControl position="topright">
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
                <LayersControl.BaseLayer name="National Geographic">
                    <TileLayer url={ESRI_NATGEO_URL} attribution={ESRI_NATGEO_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Voyager">
                    <TileLayer url={CARTO_VOYAGER_URL} attribution={CARTO_ATTR} />
                </LayersControl.BaseLayer>

                {/* --- Overlays --- */}
                <LayersControl.Overlay name="Cycling Routes">
                    <TileLayer url={WAYMARKED_CYCLING_URL} attribution={WAYMARKED_ATTR} />
                </LayersControl.Overlay>
                <SatelliteLabelsOverlay />
            </LayersControl>

            <Polyline positions={positions} pathOptions={{ color: '#4285F4', weight: 3 }} />
            <FitBounds positions={positions} />

            <ZoomControl position="topleft" />
            <ScaleControl position="bottomleft" metric={false} />

            <FullscreenControl />
            <LocateCtrl />
            <ResetViewControl positions={positions} />
            <CoordinateDisplay />
            {photoMarkersEnabled && run && <PhotoMarkerLayer run={run} coordinates={coordinates} />}
            {run && <MapStatsCard run={run} routeName={routeName} partners={partners} runPartners={runPartners} />}
        </MapContainer>
    );
};

export default RouteMapFull;
