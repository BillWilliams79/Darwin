// req #4113 — bounded date windows for reading `swarm_completes.telemetry`.
//
// The telemetry blob is ~8 KB a row, and Lambda caps a synchronous response at
// 6 MB, so the whole table can never come back in one read (it is what made the
// page empty). The stats view reads it in windows over `started_at` instead,
// each far below the cap: the busiest day on record is 63 rows, so a
// WINDOW_DAYS-day window is ~1.6 MB at worst and the budget grows with the table
// only in the NUMBER of windows, never in the size of one.

export const WINDOW_DAYS = 3;

const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');

// The gateway's filter_ts compares the column to these strings as given
// (BETWEEN, inclusive); `started_at` is stored as UTC wall-clock without a zone.
const fmt = (ms) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
        + `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

const dayStart = (startedAt) => {
    const ms = Date.parse(`${String(startedAt).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(ms) ? null : ms;
};

// rows → [{start, end}] covering every row's started_at, newest window first.
export function telemetryWindows(rows, windowDays = WINDOW_DAYS) {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows || []) {
        const ms = r?.started_at ? dayStart(r.started_at) : null;
        if (ms === null) continue;
        if (ms < min) min = ms;
        if (ms > max) max = ms;
    }
    if (min === Infinity) return [];
    const out = [];
    for (let t = min; t <= max; t += windowDays * DAY_MS) {
        out.push({ start: fmt(t), end: fmt(t + windowDays * DAY_MS - 1000) });
    }
    return out.reverse();
}

// rows + {id: telemetry} → rows with `telemetry` attached (null where absent).
export function attachTelemetry(rows, telemetryById) {
    return (rows || []).map((r) => ({ ...r, telemetry: telemetryById[r.id] ?? null }));
}
