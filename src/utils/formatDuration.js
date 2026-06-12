// Format a duration in seconds to a human-readable string (req #2332).
// Examples: 45 → "45s", 90 → "1m 30s", 3661 → "1h 1m", 0 → "0s",
//           null/undefined → "—"
export const formatDuration = (seconds) => {
    if (seconds == null) return '—';
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return '—';
    if (s === 0) return '0s';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) {
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    if (m > 0) {
        return r > 0 ? `${m}m ${r}s` : `${m}m`;
    }
    return `${s}s`;
};
