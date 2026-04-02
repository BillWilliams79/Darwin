import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchProduction, fetchProductionDetail, fetchInverters } from '../services/enphaseService';
import { SOLAR_CONFIG } from '../config/solar';

export default function useSolarPolling(intervalMs = SOLAR_CONFIG.pollIntervalMs) {
    const [production, setProduction] = useState(null);
    const [productionDetail, setProductionDetail] = useState(null);
    const [inverters, setInverters] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);
    const mountedRef = useRef(true);

    const poll = useCallback(async () => {
        const results = await Promise.allSettled([
            fetchProduction(),
            fetchProductionDetail(),
            fetchInverters(),
        ]);

        if (!mountedRef.current) return;

        const [prodResult, detailResult, invResult] = results;

        let anySuccess = false;

        if (prodResult.status === 'fulfilled') {
            setProduction(prodResult.value);
            anySuccess = true;
        }
        if (detailResult.status === 'fulfilled') {
            setProductionDetail(detailResult.value);
            anySuccess = true;
        }
        if (invResult.status === 'fulfilled') {
            setInverters(invResult.value);
            anySuccess = true;
        }

        if (anySuccess) {
            setError(null);
            setLastUpdated(Date.now());
        } else {
            const msg = prodResult.reason?.message || 'Solar data unavailable — proxy may not be running';
            setError(msg);
        }

        setLoading(false);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        poll();
        const id = setInterval(poll, intervalMs);
        return () => {
            mountedRef.current = false;
            clearInterval(id);
        };
    }, [poll, intervalMs]);

    return { production, productionDetail, inverters, error, loading, lastUpdated };
}
