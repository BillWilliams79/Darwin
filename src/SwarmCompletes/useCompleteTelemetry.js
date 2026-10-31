// req #4113 — `telemetry` for the stats view, read in bounded date windows
// (see telemetryWindows.js for why it cannot come back in one read).

import { useContext, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { fetchEntity } from '../hooks/factory/createEntityQueries';
import { telemetryWindows, attachTelemetry } from './telemetryWindows';

const STALE_MS = 5 * 60 * 1000;

// Returns { rows, loaded, total, error }. `rows` carries `telemetry` only once
// EVERY window has settled — a partial set would silently skew the per-phase and
// anchor figures, so the caller waits on `loaded === total`.
export default function useCompleteTelemetry(creatorFk, rows, { enabled = true } = {}) {
    const { darwinUri } = useContext(AppContext);
    const { idToken } = useContext(AuthContext);

    const windows = useMemo(() => telemetryWindows(rows), [rows]);

    const results = useQueries({
        queries: windows.map((w) => ({
            queryKey: ['swarm_completes', creatorFk, { telemetryWindow: w.start, end: w.end }],
            queryFn: () => fetchEntity(
                `${darwinUri}/swarm_completes?filter_ts=(started_at,${w.start},${w.end})&fields=id,telemetry`,
                idToken),
            enabled: enabled && !!creatorFk && !!idToken,
            staleTime: STALE_MS,
        })),
    });

    // A window counts as loaded once it HAS data, so a failed background refetch
    // never discards what already arrived; `error` is only surfaced while some
    // window has nothing to show.
    const loaded = results.filter((r) => r.data !== undefined).length;
    const error = results.find((r) => r.isError && r.data === undefined)?.error || null;
    const done = windows.length > 0 && loaded === windows.length;

    const withTelemetry = useMemo(() => {
        if (!done) return null;
        const byId = {};
        for (const r of results) for (const t of r.data || []) byId[t.id] = t.telemetry;
        return attachTelemetry(rows, byId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [done, rows, results.map((r) => r.dataUpdatedAt).join(',')]);

    return { rows: withTelemetry, loaded, total: windows.length, error };
}
