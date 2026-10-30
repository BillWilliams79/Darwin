// previewColor.js — what colours the beads of a pipeline card's preview (req #4063).
//
// User directive: *"Set of buttons … that change the color of the things in the
// preview. Currently it is showing the locking/barrier/priority data. I'd like to
// have the same ones from the visualizer plus the default. The default is the %
// complete: 0 dark red, 1 to 25, 26 to 50, 51 to 75, 76 to 99, 100 dark green."*
//
// SIX MODES. `percent` (the default) and `flags` (what the preview drew before
// this requirement, kept as a button rather than deleted) are the preview's own.
// The other five ARE the plan visualizer's colour scales — `REQ_COLOR_SCALES` —
// and are not re-stated here: this module asks the registry for each
// requirement's colour, so a scale's hues, order and unknown swatch cannot drift
// from the plan page.
//
// A BEAD IS AN EPIC, and a scale colours REQUIREMENTS. An epic holds several, so a
// scale-coloured bead is drawn as a PIE of its gating requirements' colours
// (`beadSlices`) rather than reduced to one — a "dominant colour" would paint an
// epic with nine met requirements and one running as plain met. PURE: rows and
// views in, slices out; the component draws them.

import { REQ_COLOR_SCALES, buildReqColorViews } from '../SwarmView/pipelines/pipelinePlanLayout';

export const PERCENT_MODE = 'percent';
export const FLAGS_MODE = 'flags';
export const DEFAULT_PREVIEW_COLOR = PERCENT_MODE;

export const PREVIEW_COLOR_STORAGE_KEY = 'darwin-swarm-pipelines-preview-color';

/** The buttons, in order: the default, the visualizer's five, then the old flags view. */
export const PREVIEW_COLOR_MODES = [
    {
        key: PERCENT_MODE, label: 'Progress', keyTitle: 'Epic = % complete',
        tip: 'Colour each epic by how much of its work is closed — dark red at 0%, dark green at 100%',
    },
    ...REQ_COLOR_SCALES.map((s) => ({
        key: s.key, label: s.chipLabel,
        keyTitle: `Epic = ${s.chipLabel.toLowerCase()} of its requirements`,
        tip: `${s.chipTip.replace(/ — click again for none$/, '')} (an epic is drawn as a pie of its requirements)`,
        scale: true,
    })),
    {
        key: FLAGS_MODE, label: 'Flags', keyTitle: 'Epic ring = flags',
        tip: 'Colour each epic by its barrier, lock and run flags (the preview\'s original colouring)',
    },
];

// `Object.hasOwn`-style membership over an array: the value was read from web
// storage, where 'constructor' is a reachable string.
export const isPreviewColor = (v) => PREVIEW_COLOR_MODES.some((m) => m.key === v);
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

// ── PIES ────────────────────────────────────────────────────────────────────
/**
 * The pie of a bead: `[{color, frac}]`, fractions summing to 1, slices in the
 * scale's own legend order so two beads with the same mix draw alike. An epic
 * holding no gating requirement has no pie: it returns `[]`, and the caller draws
 * the neutral fill.
 *
 * @param {Object} row    an adapted plan row (`reqIds`, `trackingReqIds`)
 * @param {{colorOf: function(number): string, legend: Object[]}} view  one
 *        scale's view from `buildReqColorViews`
 */
export function beadSlices(row, view) {
    const tracking = new Set(row.trackingReqIds || []);
    const gating = (row.reqIds || []).filter((id) => !tracking.has(id));
    if (!gating.length || !view) return [];
    const counts = new Map();
    for (const id of gating) {
        const c = view.colorOf(id);
        counts.set(c, (counts.get(c) || 0) + 1);
    }
    const rank = (c) => {
        const i = view.legend.findIndex((e) => e.color === c);
        return i < 0 ? view.legend.length : i;
    };
    return [...counts.entries()]
        .sort((a, b) => rank(a[0]) - rank(b[0]))
        .map(([color, n]) => ({ color, frac: n / gating.length }));
}

/**
 * The key for a mode: `[{key, color, label}]`. Scale modes list every value the
 * scale can paint — built from the registry over NO requirements, so no
 * "unknown" swatch is invented before a drawn bead wears one.
 */
export function previewLegend(mode, machines = [], { sessionsKnown = true } = {}) {
    const none = { key: 'none', color: PERCENT_NONE_COLOR, label: 'no work' };
    if (mode === PERCENT_MODE) {
        return [...PERCENT_BANDS.map((b) => ({ key: b.key, color: b.color, label: b.label })), none];
    }
    const scale = REQ_COLOR_SCALES.find((s) => s.key === mode);
    if (!scale) return [];
    const legend = buildReqColorViews({ requirements: [], machines })[mode]?.legend || [];
    // Session reads still settling: every bead wears the scale's unknown colour,
    // so the key names it (the plan page lists it for the same reason).
    if (mode === 'session' && !sessionsKnown && !legend.some((e) => e.key === 'unknown')) {
        const unknown = buildReqColorViews({ requirements: [{ id: 0 }], machines,
            presentReqIds: new Set([0]) })[mode].legend.find((e) => e.key === 'unknown');
        if (unknown) legend.push(unknown);
    }
    // An epic holding no gating work is neutral in every mode.
    return [...legend, none];
}
