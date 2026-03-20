import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import { useMapCoordinates } from '../hooks/useDataQueries';

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
const TILE_ATTRIBUTION = '&copy; Esri, HERE, Garmin, USGS';

/** Auto-fit map bounds to the polyline */
const FitBounds = ({ positions }) => {
    const map = useMap();
    React.useEffect(() => {
        if (positions.length > 1) {
            map.fitBounds(positions, { padding: [10, 10] });
        }
    }, [map, positions]);
    return null;
};

const RouteMapThumbnail = ({ runId }) => {
    const { data: coords = [], isLoading } = useMapCoordinates(runId);

    if (isLoading) {
        return (
            <Box sx={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress size={24} />
            </Box>
        );
    }

    if (coords.length === 0) {
        return (
            <Box sx={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover' }}>
                No map data
            </Box>
        );
    }

    const positions = coords.map(c => [Number(c.latitude), Number(c.longitude)]);

    return (
        <MapContainer
            center={positions[0]}
            zoom={13}
            style={{ height: 180, width: '100%' }}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
            zoomControl={false}
            attributionControl={false}
        >
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
            <Polyline positions={positions} pathOptions={{ color: '#4285F4', weight: 3 }} />
            <FitBounds positions={positions} />
        </MapContainer>
    );
};

export default RouteMapThumbnail;
