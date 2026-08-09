// Render helpers for the SHARED TELEMETRY ENVELOPE (req #3202).
//
// The envelope is the one measurement record every container of "a Claude run
// happened" carries — `swarm_sessions`, `swarm_starts`, `swarm_completes` and
// `agent_telemetry_runs`, identical column names on all four. Its definition
// lives in `scripts/telemetry/envelope.py`; this file is only how it is DISPLAYED.
//
// THE ONE RULE THESE HELPERS EXIST TO ENFORCE
// -------------------------------------------
// **NULL means NOT MEASURED. It must never render as 0.** Every envelope column
// is nullable and roughly 1,900 pre-#3202 rows carry NULL in all of them, with no
// backfill possible (their transcripts are rotated or deleted, so any number
// written now would be fabricated). A page that prints "0 tokens" for one of
// those rows is making a false claim about a real run, and — worse — a total that
// sums NULLs as zeros silently understates every aggregate it appears in.
//
// So: a helper returns `null` when nothing was measured, the caller renders the
// em-dash, and `envelopeCost()` reports `measured` separately from `total` so a
// genuine zero stays distinguishable from an absent measurement.

import { formatDuration } from './formatDuration';

// The four priced token types, in the order the envelope declares them.
export const TOKEN_FIELDS = [
    'tokens_input',
    'tokens_cache_write',
    'tokens_cache_read',
    'tokens_output',
];

export const TOKEN_LABELS = {
    tokens_input: 'Input',
    tokens_cache_write: 'Cache write',
    tokens_cache_read: 'Cache read',
    tokens_output: 'Output',
};

// What a not-measured value looks like. One constant so every surface agrees.
export const NOT_MEASURED = '—';

/**
 * Milliseconds → a human duration. The envelope's wall clock is in ms — the ONE
 * unit across both telemetry domains — but a reader wants "4m 12s", not 252431.
 *
 * Sub-second runs keep their milliseconds rather than collapsing to "0s": an
 * agent's boot latency is a real sub-second measurement (it was `boot_time_ms`
 * precisely because seconds would destroy it), and rounding it away here would
 * undo the reason the envelope chose the finer unit.
 */
export function formatWallMs(ms) {
    if (ms == null) return NOT_MEASURED;
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return NOT_MEASURED;
    if (n < 1000) return `${Math.round(n)}ms`;
    return formatDuration(Math.round(n / 1000));
}

/** Compact token count (12.3M / 45.6k / 789). Null stays null-shaped. */
export function formatTokenCount(v) {
    if (v == null) return NOT_MEASURED;
    const n = Number(v);
    if (!Number.isFinite(n)) return NOT_MEASURED;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return n.toLocaleString('en-US');
}

/**
 * The four-way token usage on a row, plus whether ANY of it was measured.
 *
 * `measured: false` (with `total: null`) is the important case and the reason
 * this returns an object rather than a number: a caller must be able to tell
 * "this run cost nothing measurable" apart from "nobody measured this run", and
 * a bare 0 collapses the two.
 *
 * `total` sums only the types that ARE present, so a partial capture — say a
 * transcript that yielded output but no cache figures — reports the part it
 * knows instead of nothing at all.
 */
export function envelopeCost(row) {
    const parts = {};
    let total = null;
    for (const field of TOKEN_FIELDS) {
        const raw = row?.[field];
        if (raw == null) {
            parts[field] = null;
            continue;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) {
            parts[field] = null;
            continue;
        }
        parts[field] = n;
        total = (total ?? 0) + n;
    }
    return { parts, total, measured: total !== null };
}

/**
 * The prompt as it should be shown: the stored text is a bounded 2000-char
 * PREFIX, so a reader must be able to see that it is a prefix.
 *
 * `truncated` is derived by comparing the stored text's length against
 * `prompt_chars` (the FULL length) rather than against the cap — the cap is a
 * writer-side constant and a row written under a different one must still
 * describe itself honestly.
 */
export function envelopePrompt(row) {
    const text = row?.prompt_text;
    if (!text) return null;
    const chars = row?.prompt_chars == null ? null : Number(row.prompt_chars);
    const truncated = chars != null && Number.isFinite(chars) && chars > text.length;
    return {
        text,
        chars: Number.isFinite(chars) ? chars : null,
        truncated,
        sha256: row?.prompt_sha256 || null,
        // The first 12 hex chars are plenty to eyeball "same prompt?" between two
        // runs; the full digest stays available for an exact comparison.
        shaShort: row?.prompt_sha256 ? String(row.prompt_sha256).slice(0, 12) : null,
    };
}

/**
 * True when a row carries no envelope measurement at all — every token type
 * NULL, no wall clock, no prompt. Lets a surface omit the whole block for a
 * pre-#3202 row rather than render a panel of em-dashes.
 */
export function hasEnvelope(row) {
    if (!row) return false;
    if (row.wall_ms != null) return true;
    if (row.prompt_text || row.prompt_sha256 || row.prompt_chars != null) return true;
    return TOKEN_FIELDS.some((field) => row[field] != null);
}
