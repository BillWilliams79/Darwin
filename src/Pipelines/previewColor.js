// previewColor.js — what colours the beads of a pipeline card's preview (req #4063,
// narrowed by req #4184).
//
// Req #4063 gave the preview six colourings (Progress, the plan visualizer's five
// scales, and the old Flags view). Req #4184 (user): *"Leave the progress button so
// we can show the help for it. If you disable progress you would get an all green
// circle (same as all requirements completed) for every bubble in the preview — so
// a clean look or progress only — and remove the rest."*
//
// TWO MODES now. `percent` (the default) is % complete: 0 dark red … 100 dark green.
// `clean` is what the Progress button's OFF state draws — every bead the 100% green,
// a quiet preview that says nothing about progress. The five scales, the Flags view,
// the pie-slice drawing and their key are gone.

export const PERCENT_MODE = 'percent';
export const CLEAN_MODE = 'clean';
export const DEFAULT_PREVIEW_COLOR = PERCENT_MODE;

export const PREVIEW_COLOR_STORAGE_KEY = 'darwin-swarm-pipelines-preview-color';

/** The one button: Progress. Its help explains the band colours. */
export const PROGRESS_BUTTON = {
    key: PERCENT_MODE, label: 'Progress', keyTitle: 'Epic = % complete',
    tip: 'Colour each epic by how much of its work is closed — dark red at 0%, dark green at 100%. Click to turn off: every epic is drawn dark green.',
};

// Membership over the two modes: the value was read from web storage, where
// 'constructor' is a reachable string. A stored value from the retired modes
// (a scale key, 'flags') is simply not a mode and falls to the default.
export const isPreviewColor = (v) => v === PERCENT_MODE || v === CLEAN_MODE;
export const normalizePreviewColor = (v) => (isPreviewColor(v) ? v : DEFAULT_PREVIEW_COLOR);

// ── PROGRESS ────────────────────────────────────────────────────────────────
// The six bands the user named. 'dark green' and 'dark red' are the two ends; the
// four between run orange → amber → yellow-green → green so the ladder reads in
// order. No data (an epic holding no gating requirement) is neutral grey — it is
// neither 0% nor 100%, and painting it either would claim a fact nobody has.
export const PERCENT_BANDS = [
    { key: 'p0',   label: '0%',     color: '#a31515', test: (p) => p === 0 },
    { key: 'p25',  label: '1–25%',  color: '#e0652b', test: (p) => p > 0 && p <= 25 },
    { key: 'p50',  label: '26–50%', color: '#e8a73a', test: (p) => p > 25 && p <= 50 },
    { key: 'p75',  label: '51–75%', color: '#c2cf46', test: (p) => p > 50 && p <= 75 },
    { key: 'p99',  label: '76–99%', color: '#5cb85c', test: (p) => p > 75 && p < 100 },
    { key: 'p100', label: '100%',   color: '#14692b', test: (p) => p >= 100 },
];
export const PERCENT_NONE_COLOR = '#6b7686';

/** The epic's closed share of its gating work, 0–100, or null when it holds none. */
export function epicPercent(row) {
    const tracking = new Set(row.trackingReqIds || []);
    const gating = (row.reqIds || []).filter((id) => !tracking.has(id));
    if (!gating.length) return null;
    // `openReqIds` is the server's fact (gating, non-terminal) — read, never recomputed.
    const open = new Set(row.openReqIds || []);
    const closed = gating.filter((id) => !open.has(id)).length;
    // Not rounded: 1 closed of 300 is "some" (1–25), never a 0 that paints dark red.
    return (closed / gating.length) * 100;
}

/** The band colour for a percentage; neutral for null. */
export function percentColor(pct) {
    if (pct == null) return PERCENT_NONE_COLOR;
    return (PERCENT_BANDS.find((b) => b.test(pct)) || PERCENT_BANDS[0]).color;
}

/** The clean look: every bead wears the 100% colour. */
export const CLEAN_COLOR = PERCENT_BANDS[PERCENT_BANDS.length - 1].color;

/** The key for the Progress help: the six bands and the no-work swatch. */
export function previewLegend() {
    return [
        ...PERCENT_BANDS.map((b) => ({ key: b.key, color: b.color, label: b.label })),
        { key: 'none', color: PERCENT_NONE_COLOR, label: 'no work' },
    ];
}
