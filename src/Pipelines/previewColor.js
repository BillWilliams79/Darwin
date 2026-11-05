// previewColor.js — what colours the beads of a pipeline card's preview (req #4063,
// narrowed by req #4184, the on/off button removed by req #4196).
//
// ONE colouring: % complete, 0 dark red … 100 dark green. The Progress button that
// used to switch it off (to an all-green "clean" look) is gone — req #4196 (user):
// *"show the progress definitions as the help popup … then delete the progress
// on/off button. Feature not needed. Confusing."* The band definitions live on as the
// help popup (`PreviewProgressHelp`).

/** The help's identity and copy: what the bead colours mean. */
export const PROGRESS_HELP = {
    key: 'percent', label: 'Progress', keyTitle: 'Epic = % complete',
    tip: 'Each epic is coloured by how much of its work is closed — dark red at 0%, dark green at 100%.',
};

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

/** The key for the Progress help: the six bands and the no-work swatch. */
export function previewLegend() {
    return [
        ...PERCENT_BANDS.map((b) => ({ key: b.key, color: b.color, label: b.label })),
        { key: 'none', color: PERCENT_NONE_COLOR, label: 'no work' },
    ];
}
