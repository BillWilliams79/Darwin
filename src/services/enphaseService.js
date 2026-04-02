import { SOLAR_CONFIG } from '../config/solar';

const TIMEOUT_MS = 10000;

async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            throw new Error(`Enphase API error (${res.status})`);
        }
        return await res.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function fetchProduction(proxyUrl = SOLAR_CONFIG.proxyUrl) {
    return fetchWithTimeout(`${proxyUrl}${SOLAR_CONFIG.productionEndpoint}`);
}

export async function fetchProductionDetail(proxyUrl = SOLAR_CONFIG.proxyUrl) {
    const data = await fetchWithTimeout(`${proxyUrl}${SOLAR_CONFIG.productionDetailEndpoint}`);
    const eim = data.production?.find(p => p.type === 'eim');
    if (!eim) {
        throw new Error('No production EIM data found');
    }
    return {
        wNow: eim.wNow,
        whToday: eim.whToday,
        whLifetime: eim.whLifetime,
        rmsVoltage: eim.rmsVoltage,
        rmsCurrent: eim.rmsCurrent,
        pwrFactor: eim.pwrFactor,
        reactPwr: eim.reactPwr,
        apprntPwr: eim.apprntPwr,
    };
}

export async function fetchInverters(proxyUrl = SOLAR_CONFIG.proxyUrl) {
    return fetchWithTimeout(`${proxyUrl}${SOLAR_CONFIG.invertersEndpoint}`);
}
