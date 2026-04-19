import React from 'react';
import L from 'leaflet';
import Box from '@mui/material/Box';
import { MapContainer, TileLayer, Polyline, useMap, ScaleControl, ZoomControl, LayersControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import 'leaflet-fullscreen/dist/leaflet.fullscreen.css';
import 'leaflet.locatecontrol/dist/L.Control.Locate.css';
import 'leaflet-easybutton/src/easy-button.css';

import 'leaflet-fullscreen';
import { LocateControl as LeafletLocateControl } from 'leaflet.locatecontrol';
import 'leaflet-easybutton';

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
const WAYMARKED_CYCLING_URL = 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png';
const WAYMARKED_ATTR = '&copy; <a href="https://waymarkedtrails.org">Waymarked Trails</a>';
const CARTO_LABELS_URL = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';

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

const SatelliteLabelsOverlay = () => {
    const baseLayer = useBaseLayerName();
    if (baseLayer !== 'Satellite') return null;
    return (
        <LayersControl.Overlay name="Labels">
            <TileLayer url={CARTO_LABELS_URL} attribution={CARTO_ATTR} />
        </LayersControl.Overlay>
    );
};

const FitBounds = ({ allPositions }) => {
    const map = useMap();
    React.useEffect(() => {
        const flat = allPositions.flat();
        if (flat.length > 1) {
            map.fitBounds(flat, { padding: [30, 30] });
        }
    }, [map, allPositions]);
    return null;
};

/** Fix Leaflet tiles not rendering when map is inside a dialog or resizing container */
const InvalidateSize = () => {
    const map = useMap();
    React.useEffect(() => {
        // Delay to allow dialog open animation to finish
        const t1 = setTimeout(() => map.invalidateSize(), 100);
        const t2 = setTimeout(() => map.invalidateSize(), 400);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [map]);
    return null;
};

const FullscreenControl = () => {
    const map = useMap();
    React.useEffect(() => {
        const ctrl = L.control.fullscreen({ position: 'topleft', pseudoFullscreen: true });
        ctrl.addTo(map);
        return () => ctrl.remove();
    }, [map]);
    return null;
};

const LocateCtrl = () => {
    const map = useMap();
    React.useEffect(() => {
        const ctrl = new LeafletLocateControl({ position: 'topleft', strings: { title: 'Show my location' }, flyTo: true });
        ctrl.addTo(map);
        return () => ctrl.remove();
    }, [map]);
    return null;
};

const ResetViewControl = ({ allPositions }) => {
    const map = useMap();
    React.useEffect(() => {
        const flat = allPositions.flat();
        const btn = L.easyButton('&#8634;', () => {
            if (flat.length > 1) {
                map.fitBounds(flat, { padding: [30, 30] });
            }
        }, 'Reset view');
        btn.addTo(map);
        return () => btn.remove();
    }, [map, allPositions]);
    return null;
};

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
        return () => { map.off('mousemove', onMove); ctrl.remove(); };
    }, [map]);
    return null;
};

const ExportMapPreview = ({ routeCoordinates, height = 'calc(100vh - 200px)', compact = false }) => {
    if (!routeCoordinates || routeCoordinates.length === 0) return null;

    const allPositions = routeCoordinates.map(coords =>
        coords.map(c => [Number(c.latitude), Number(c.longitude)])
    ).filter(positions => positions.length > 0);

    if (allPositions.length === 0) return null;

    const firstPoint = allPositions[0][0];

    return (
        <Box sx={{ height, width: '100%' }}>
            <MapContainer
                center={firstPoint}
                zoom={10}
                style={{ height: '100%', width: '100%', borderRadius: 4 }}
                zoomControl={false}
                scrollWheelZoom={!compact}
                doubleClickZoom={!compact}
                dragging={!compact}
                touchZoom={!compact}
                boxZoom={!compact}
                keyboard={!compact}
            >
                {compact ? (
                    /* Compact: single tile layer, no controls */
                    <TileLayer url={ESRI_TOPO_URL} attribution={ESRI_TOPO_ATTR} />
                ) : (
                    <LayersControl position="topright">
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

                        <LayersControl.Overlay name="Cycling Routes">
                            <TileLayer url={WAYMARKED_CYCLING_URL} attribution={WAYMARKED_ATTR} />
                        </LayersControl.Overlay>
                        <SatelliteLabelsOverlay />
                    </LayersControl>
                )}

                {allPositions.map((positions, i) => (
                    <Polyline
                        key={i}
                        positions={positions}
                        pathOptions={{ color: '#4285F4', weight: 3 }}
                    />
                ))}
                <FitBounds allPositions={allPositions} />
                <InvalidateSize />

                {!compact && (
                    <>
                        <ZoomControl position="topleft" />
                        <ScaleControl position="bottomleft" metric={false} />
                        <FullscreenControl />
                        <LocateCtrl />
                        <ResetViewControl allPositions={allPositions} />
                        <CoordinateDisplay />
                    </>
                )}
            </MapContainer>
        </Box>
    );
};

export default ExportMapPreview;
