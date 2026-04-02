export const SOLAR_CONFIG = {
    proxyUrl: import.meta.env.VITE_ENPHASE_PROXY_URL || 'http://localhost:8089',
    productionEndpoint: '/enphase/api/v1/production',
    productionDetailEndpoint: '/enphase/production.json',
    invertersEndpoint: '/enphase/api/v1/production/inverters',
    peakCapacityWatts: 11100,
    panelCount: 32,
    gridRows: 4,
    gridCols: 8,
    defaultRatePerKwh: 0.30,
    pollIntervalMs: 15000,
};
