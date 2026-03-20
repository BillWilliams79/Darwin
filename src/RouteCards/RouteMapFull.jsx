import React from 'react';
import L from 'leaflet';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { MapContainer, TileLayer, Polyline, useMap, ScaleControl, ZoomControl, LayersControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Plugin CSS
import 'leaflet-fullscreen/dist/leaflet.fullscreen.css';
import 'leaflet.locatecontrol/dist/L.Control.Locate.css';
import 'leaflet-minimap/dist/Control.MiniMap.min.css';
import 'leaflet-easybutton/src/easy-button.css';

// Plugin JS
import 'leaflet-fullscreen';
import { LocateControl as LeafletLocateControl } from 'leaflet.locatecontrol';
import 'leaflet-minimap';
import 'leaflet-easybutton';

// --- API keys (from .env.development.local, gitignored) ---
const THUNDERFOREST_KEY = import.meta.env.VITE_THUNDERFOREST_KEY || '';
const OWM_KEY = import.meta.env.VITE_OPENWEATHERMAP_KEY || '';

// --- Base layers (no key required) ---
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const TOPO_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const TOPO_ATTR = '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>';

const CYCLOSM_URL = 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png';
const CYCLOSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://www.cyclosm.org">CyclOSM</a>';

const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = '&copy; Esri, Maxar, Earthstar Geographics';

const CARTO_LIGHT_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const CARTO_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

const CARTO_DARK_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

const CARTO_VOYAGER_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

const ESRI_TOPO_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
const ESRI_TOPO_ATTR = '&copy; Esri, HERE, Garmin, USGS';

const ESRI_NATGEO_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}';
const ESRI_NATGEO_ATTR = '&copy; Esri, National Geographic';

const ESRI_HILLSHADE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';
const ESRI_HILLSHADE_ATTR = '&copy; Esri, USGS';

// --- Base layers (Thunderforest — free 150K tiles/mo) ---
const TF_CYCLE_URL = `https://tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=${THUNDERFOREST_KEY}`;
const TF_OUTDOORS_URL = `https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=${THUNDERFOREST_KEY}`;
const TF_LANDSCAPE_URL = `https://tile.thunderforest.com/landscape/{z}/{x}/{y}.png?apikey=${THUNDERFOREST_KEY}`;
const TF_ATTR = '&copy; <a href="https://www.thunderforest.com/">Thunderforest</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// --- Overlays (no key required) ---
const WAYMARKED_CYCLING_URL = 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png';
const WAYMARKED_HIKING_URL = 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png';
const WAYMARKED_MTB_URL = 'https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png';
const WAYMARKED_ATTR = '&copy; <a href="https://waymarkedtrails.org">Waymarked Trails</a>';

const CYCLOSM_LITE_URL = 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png';

const CARTO_LABELS_URL = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';

// --- Overlays (OpenWeatherMap — free 1M calls/mo) ---
const OWM_PRECIP_URL = `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`;
const OWM_CLOUDS_URL = `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`;
const OWM_TEMP_URL = `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`;
const OWM_WIND_URL = `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`;
const OWM_ATTR = '&copy; <a href="https://openweathermap.org">OpenWeatherMap</a>';

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

/** Minimap — bottom-right corner overview */
const MiniMapControl = () => {
    const map = useMap();
    React.useEffect(() => {
        const miniLayer = L.tileLayer(OSM_URL, { attribution: OSM_ATTR });
        const ctrl = new L.Control.MiniMap(miniLayer, {
            position: 'bottomright',
            toggleDisplay: true,
            minimized: false,
            width: 150,
            height: 150,
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

const RouteMapFull = ({ coordinates, isLoading }) => {
    if (isLoading) {
        return (
            <Box sx={{ height: 'calc(100vh - 200px)', minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!coordinates || coordinates.length === 0) {
        return (
            <Box sx={{ height: 'calc(100vh - 200px)', minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
                No map data available
            </Box>
        );
    }

    const positions = coordinates.map(c => [Number(c.latitude), Number(c.longitude)]);

    return (
        <MapContainer
            center={positions[0]}
            zoom={13}
            style={{ height: 'calc(100vh - 200px)', minHeight: 400, width: '100%', borderRadius: 4 }}
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
                <LayersControl.BaseLayer checked name="Street">
                    <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Cycling (CyclOSM)">
                    <TileLayer url={CYCLOSM_URL} attribution={CYCLOSM_ATTR} />
                </LayersControl.BaseLayer>
                {THUNDERFOREST_KEY && (
                    <LayersControl.BaseLayer name="OpenCycleMap">
                        <TileLayer url={TF_CYCLE_URL} attribution={TF_ATTR} />
                    </LayersControl.BaseLayer>
                )}
                {THUNDERFOREST_KEY && (
                    <LayersControl.BaseLayer name="Outdoors (TF)">
                        <TileLayer url={TF_OUTDOORS_URL} attribution={TF_ATTR} />
                    </LayersControl.BaseLayer>
                )}
                {THUNDERFOREST_KEY && (
                    <LayersControl.BaseLayer name="Landscape (TF)">
                        <TileLayer url={TF_LANDSCAPE_URL} attribution={TF_ATTR} />
                    </LayersControl.BaseLayer>
                )}
                <LayersControl.BaseLayer name="Topographic">
                    <TileLayer url={TOPO_URL} attribution={TOPO_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Satellite">
                    <TileLayer url={ESRI_URL} attribution={ESRI_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Esri Topo">
                    <TileLayer url={ESRI_TOPO_URL} attribution={ESRI_TOPO_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="National Geographic">
                    <TileLayer url={ESRI_NATGEO_URL} attribution={ESRI_NATGEO_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Hillshade">
                    <TileLayer url={ESRI_HILLSHADE_URL} attribution={ESRI_HILLSHADE_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Voyager">
                    <TileLayer url={CARTO_VOYAGER_URL} attribution={CARTO_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Light">
                    <TileLayer url={CARTO_LIGHT_URL} attribution={CARTO_ATTR} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Dark">
                    <TileLayer url={CARTO_DARK_URL} attribution={CARTO_ATTR} />
                </LayersControl.BaseLayer>

                {/* --- Trail overlays --- */}
                <LayersControl.Overlay name="Cycling Routes">
                    <TileLayer url={WAYMARKED_CYCLING_URL} attribution={WAYMARKED_ATTR} />
                </LayersControl.Overlay>
                <LayersControl.Overlay name="Hiking Trails">
                    <TileLayer url={WAYMARKED_HIKING_URL} attribution={WAYMARKED_ATTR} />
                </LayersControl.Overlay>
                <LayersControl.Overlay name="MTB Trails">
                    <TileLayer url={WAYMARKED_MTB_URL} attribution={WAYMARKED_ATTR} />
                </LayersControl.Overlay>
                <LayersControl.Overlay name="Hillshade Overlay">
                    <TileLayer url={ESRI_HILLSHADE_URL} attribution={ESRI_HILLSHADE_ATTR} opacity={0.4} />
                </LayersControl.Overlay>
                <LayersControl.Overlay name="Bike Infrastructure">
                    <TileLayer url={CYCLOSM_LITE_URL} attribution={CYCLOSM_ATTR} />
                </LayersControl.Overlay>
                <LayersControl.Overlay name="Labels">
                    <TileLayer url={CARTO_LABELS_URL} attribution={CARTO_ATTR} />
                </LayersControl.Overlay>

                {/* --- Weather overlays (live/current) --- */}
                {OWM_KEY && (
                    <LayersControl.Overlay name="Precipitation">
                        <TileLayer url={OWM_PRECIP_URL} attribution={OWM_ATTR} opacity={0.6} crossOrigin="" />
                    </LayersControl.Overlay>
                )}
                {OWM_KEY && (
                    <LayersControl.Overlay name="Clouds">
                        <TileLayer url={OWM_CLOUDS_URL} attribution={OWM_ATTR} opacity={0.5} crossOrigin="" />
                    </LayersControl.Overlay>
                )}
                {OWM_KEY && (
                    <LayersControl.Overlay name="Temperature">
                        <TileLayer url={OWM_TEMP_URL} attribution={OWM_ATTR} opacity={0.5} crossOrigin="" />
                    </LayersControl.Overlay>
                )}
                {OWM_KEY && (
                    <LayersControl.Overlay name="Wind">
                        <TileLayer url={OWM_WIND_URL} attribution={OWM_ATTR} opacity={0.5} crossOrigin="" />
                    </LayersControl.Overlay>
                )}
            </LayersControl>

            <Polyline positions={positions} pathOptions={{ color: '#4285F4', weight: 3 }} />
            <FitBounds positions={positions} />

            <ZoomControl position="topleft" />
            <ScaleControl position="bottomleft" metric={false} />

            <FullscreenControl />
            <LocateCtrl />
            <MiniMapControl />
            <ResetViewControl positions={positions} />
            <CoordinateDisplay />
        </MapContainer>
    );
};

export default RouteMapFull;
