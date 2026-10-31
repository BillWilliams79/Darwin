// Shared parser for the per-phase token/wall breakdown embedded in the free-text
// `telemetry` column of swarm_completes AND swarm_starts (req #2811 — extracted
// from SwarmCompleteDetail so the starts stats view can reuse it without reaching
// into a completes detail module).
//
// Both skills emit a `TOKEN_TELEMETRY:` JSON blob whose `phases` object carries
// real per-phase token costs (each phase runs in its own LLM turn, so attribution
// is genuine). Completes additionally use a `COMPLETE_TOKEN_TELEMETRY:` marker for
// worker closeouts and a `PRIMARY_PHASE_TIMINGS:` wall-only blob for primary
// closeouts; this parser handles all three markers, so it works for starts
// (TOKEN_TELEMETRY only) and completes alike.

// Extract the first balanced {...} JSON object that follows `fromIndex` in
// `text`, tolerant of trailing content after the object. Returns the parsed
// object or null. Used to pull structured blobs out of the free-text telemetry
// column (which interleaves marker lines with embedded JSON).
export function extractBalancedJson(text, fromIndex) {
    const start = text.indexOf('{', fromIndex);
    if (start === -1) return null;
    let depth = 0;
    let inStr = false;   // inside a JSON string literal
    let esc = false;     // previous char was a backslash inside a string
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            // Braces inside string values must not affect brace-balance.
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                try { return JSON.parse(text.slice(start, i + 1)); }
                catch { return null; }
            }
        }
    }
    return null;
}

// The embedded token blob — COMPLETE_TOKEN_TELEMETRY (worker closeouts) wins
// over TOKEN_TELEMETRY — parsed, or null when the column carries none.
function tokenTelemetryJson(telemetry) {
    if (!telemetry || typeof telemetry !== 'string') return null;
    let markerIdx = telemetry.indexOf('COMPLETE_TOKEN_TELEMETRY:');
    if (markerIdx === -1) markerIdx = telemetry.indexOf('TOKEN_TELEMETRY:');
    return markerIdx === -1 ? null : extractBalancedJson(telemetry, markerIdx);
}

// Parse a telemetry blob into a per-phase breakdown.
//   - Worker token telemetry: the embedded TOKEN_TELEMETRY (or, for completes,
//     COMPLETE_TOKEN_TELEMETRY) JSON carries a `phases` object with real
//     per-phase TOKEN costs.
//   - Primary closeouts: the orchestrator is one Bash call (one turn), so token
//     attribution collapses; instead it emits PRIMARY_PHASE_TIMINGS with
//     deterministic per-phase WALL-CLOCK seconds.
// Returns { tokenPhases, wallPhases } — either may be empty.
export function parsePhaseBreakdown(telemetry) {
    const result = { tokenPhases: [], wallPhases: [] };
    if (!telemetry || typeof telemetry !== 'string') return result;

    const tokenJson = tokenTelemetryJson(telemetry);
    const phases = tokenJson && tokenJson.phases;
    if (phases && typeof phases === 'object') {
        for (const [phase, v] of Object.entries(phases)) {
            const input = Number(v.input) || 0;
            const output = Number(v.output) || 0;
            const cacheWrite = Number(v.cache_write) || 0;
            const cacheRead = Number(v.cache_read) || 0;
            result.tokenPhases.push({
                phase, input, output, cacheWrite, cacheRead,
                turnCount: Number(v.turn_count) || 0,
                // Per-phase wall is carried alongside the token costs in the
                // same JSON; surfaced for the stats Phase Cost Leaderboard.
                wall: Number(v.wall_seconds) || 0,
                total: input + output + cacheWrite + cacheRead,
            });
        }
    }

    const wallIdx = telemetry.indexOf('PRIMARY_PHASE_TIMINGS:');
    if (wallIdx !== -1) {
        const wallJson = extractBalancedJson(telemetry, wallIdx);
        if (wallJson && typeof wallJson === 'object') {
            for (const [phase, secs] of Object.entries(wallJson)) {
                result.wallPhases.push({ phase, wall: Number(secs) || 0 });
            }
        }
    }
    return result;
}

// Which telemetry anchor produced a row (req #4107). Req #4095 moved the
// swarm_starts / swarm_completes anchor from the turn-2 marker to the skill
// INVOCATION, so a new-anchor row also counts the skill-load turns (a
// /swarm-start's cache write goes ~10 K → ~137 K) — the two series must never be
// averaged together unawares. The row's own blob names its anchor in
// `invocation_start_source`: `skill_invocation` is the new anchor; anything else
// (`marker_file`, `swarm_start_marker`, absent, no blob) is legacy. Never the
// date: a Primary clone that has not synced keeps writing legacy rows.
export const ANCHOR_NEW = 'new';
export const ANCHOR_LEGACY = 'legacy';
export const ANCHOR_ALL = 'all';

export function parseInvocationAnchor(telemetry) {
    const tokenJson = tokenTelemetryJson(telemetry);
    return tokenJson && tokenJson.invocation_start_source === 'skill_invocation'
        ? ANCHOR_NEW
        : ANCHOR_LEGACY;
}

// { all, new, legacy } row counts — the anchor control's labels.
export function countRowsByAnchor(rows) {
    const counts = { [ANCHOR_ALL]: rows.length, [ANCHOR_NEW]: 0, [ANCHOR_LEGACY]: 0 };
    for (const row of rows) counts[parseInvocationAnchor(row.telemetry)] += 1;
    return counts;
}

// The rows the Stats views aggregate under the selected anchor filter.
export function filterRowsByAnchor(rows, anchor) {
    if (anchor !== ANCHOR_NEW && anchor !== ANCHOR_LEGACY) return rows;
    return rows.filter(row => parseInvocationAnchor(row.telemetry) === anchor);
}
