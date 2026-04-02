import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchProduction, fetchProductionDetail, fetchInverters } from '../enphaseService';

const PROXY_URL = 'http://localhost:8089';

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('fetchProduction', () => {
    it('returns parsed production data on success', async () => {
        const mockData = { wattHoursToday: 8126, wattHoursSevenDays: 369263, wattHoursLifetime: 8071061, wattsNow: 262 };
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve(mockData) });

        const result = await fetchProduction(PROXY_URL);
        expect(result).toEqual(mockData);
        expect(fetch).toHaveBeenCalledWith(
            `${PROXY_URL}/enphase/api/v1/production`,
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
    });

    it('throws on non-200 response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 502 });
        await expect(fetchProduction(PROXY_URL)).rejects.toThrow('Enphase API error (502)');
    });

    it('throws on network error', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(fetchProduction(PROXY_URL)).rejects.toThrow('Failed to fetch');
    });
});

describe('fetchProductionDetail', () => {
    it('extracts EIM data from production.json response', async () => {
        const mockResponse = {
            production: [
                { type: 'inverters', activeCount: 32 },
                { type: 'eim', wNow: 251.6, whToday: 8129, whLifetime: 8071064, rmsVoltage: 244.4, rmsCurrent: 22.6, pwrFactor: 0.09, reactPwr: -37.4, apprntPwr: 2760 },
            ],
            consumption: [],
        };
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) });

        const result = await fetchProductionDetail(PROXY_URL);
        expect(result).toEqual({
            wNow: 251.6,
            whToday: 8129,
            whLifetime: 8071064,
            rmsVoltage: 244.4,
            rmsCurrent: 22.6,
            pwrFactor: 0.09,
            reactPwr: -37.4,
            apprntPwr: 2760,
        });
    });

    it('throws when no EIM data found', async () => {
        const mockResponse = { production: [{ type: 'inverters' }] };
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResponse) });
        await expect(fetchProductionDetail(PROXY_URL)).rejects.toThrow('No production EIM data found');
    });

    it('throws on non-200 response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 });
        await expect(fetchProductionDetail(PROXY_URL)).rejects.toThrow('Enphase API error (401)');
    });
});

describe('fetchInverters', () => {
    it('returns inverter array on success', async () => {
        const mockInverters = [
            { serialNumber: '202308154676', lastReportDate: 1775007673, devType: 1, lastReportWatts: 20, maxReportWatts: 347 },
            { serialNumber: '202308154677', lastReportDate: 1775007673, devType: 1, lastReportWatts: 300, maxReportWatts: 356 },
        ];
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve(mockInverters) });

        const result = await fetchInverters(PROXY_URL);
        expect(result).toHaveLength(2);
        expect(result[0].serialNumber).toBe('202308154676');
    });

    it('throws on non-200 response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 });
        await expect(fetchInverters(PROXY_URL)).rejects.toThrow('Enphase API error (500)');
    });

    it('throws on network error', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network failure'));
        await expect(fetchInverters(PROXY_URL)).rejects.toThrow('Network failure');
    });
});
