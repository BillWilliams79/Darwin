import { darken } from '@mui/material/styles';

// Shared coloring for effort CHIPS (req #2916; recolored #3044; light-surface
// fix #3053).
//
// Single source of truth so every effort chip across the app reads the same
// way — parallel to modelChipStyles.js for ai_model and
// coordinationChipStyles.js for autonomy. The hues form a red → green
// intensity ramp — red (least effort) climbing to dark green (maximum effort),
// with the top two rungs both green (per req #3044: "top setting dark green
// ... XHigh a lighter green"):
//
//   low → red · medium → orange · high → amber · xhigh → light green ·
//   ultracode → dark green
//
// This red→green ramp is intentionally SHARED with the model palette
// (AI_MODEL_COLOR) — the requirement asked both axes to read the same way — but
// stays distinct from the COORDINATION_COLOR pinks/purples/blues/green so an
// Effort chip is never mistaken for an Autonomy chip. Chips are told apart by
// their label ("XHigh" vs "Opus") and tooltip, not by hue alone.
//
// Every rung keeps black text: the darkest stop (#388e3c) clears ~5:1 contrast
// on black, so effortChipProps hardcodes color:'#000' as before.
//
// Values are lowercase in the DB (requirements.effort / swarm_sessions.effort,
// migration 063); display labels are capitalized via effortLabel. 'ultracode'
// is the user-facing name for the CLI's top effort level (injected as
// `claude --effort max`). Pre-#2916 rows were backfilled to 'high' — the
// documented assumption for all historical data — so null/unknown falls back
// to high styling, which is also the new-row default (req #3007).

export const EFFORT_COLOR = {
    low:       '#e57373', // red
    medium:    '#ffb74d', // orange
    high:      '#ffd54f', // amber
    xhigh:     '#81c784', // light green
    ultracode: '#388e3c', // dark green
};

// req #3053: on a white/light card, four of the five rungs measure well under
// the 3:1 mark-vs-surface floor (low 2.99, medium 1.73, high 1.41, xhigh 2.01 —
// verified with dataviz's validate_palette.js `contrast()`), because they're
// MUI's shade-300 (pastel) step of their hue. The fill reads as a washed-out,
// near-neutral patch on a light card — easily perceived as "grey" — even
// though the black text drawn ON it is independently high-contrast. Ultracode
// already sits at shade-700 (deliberately dark per req #3044) and clears 4.1:1
// as-is, so it's excluded here.
//
// `darken(hex, coef)` is MUI's own color-manipulation utility, not an
// eyeballed value. The coefficient is PER RUNG — the smallest value that
// lands that rung's fill at ~3.3:1 on white — rather than one blanket value
// sized for the palest rung (amber/high): a shared 0.35 would clear the
// surface floor for every rung but needlessly over-darken low/medium/xhigh,
// dragging their own black-text-on-fill contrast down toward the 3:1 floor.
// Tuned per rung, every fill keeps black text at ~6.3:1 instead. Dark mode is
// unaffected: the original EFFORT_COLOR rungs already clear 3.6–10.5:1
// against the dark card surface.
const LIGHT_SURFACE_DARKEN = { low: 0.05, medium: 0.28, high: 0.35, xhigh: 0.23 };
const EFFORT_COLOR_LIGHT = {
    ...EFFORT_COLOR,
    low:    darken(EFFORT_COLOR.low, LIGHT_SURFACE_DARKEN.low),
    medium: darken(EFFORT_COLOR.medium, LIGHT_SURFACE_DARKEN.medium),
    high:   darken(EFFORT_COLOR.high, LIGHT_SURFACE_DARKEN.high),
    xhigh:  darken(EFFORT_COLOR.xhigh, LIGHT_SURFACE_DARKEN.xhigh),
};

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'ultracode'];

// Display labels — 'xhigh' renders as 'XHigh' (not 'Xhigh'); the rest are
// simple capitalization. Falls back to 'High' for null/unknown — every
// pre-migration row is high by definition (req #2916 backfill rule).
const EFFORT_LABEL = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'XHigh',
    ultracode: 'Ultracode',
};

export const effortLabel = (e) => EFFORT_LABEL[e] || 'High';

// Mode-aware fill resolver (req #3053) — light mode uses the darkened,
// surface-legible variant; dark mode uses the original ramp unchanged.
export const effortFillColor = (e, mode) => {
    const map = mode === 'light' ? EFFORT_COLOR_LIGHT : EFFORT_COLOR;
    return map[e] || map.high;
};

// Filled-chip props for an effort — pastel bg + black text.
// Null/unknown → high styling (the backfill default), never unstyled.
export const effortChipProps = (e) => ({
    sx: (theme) => ({ bgcolor: effortFillColor(e, theme.palette.mode), color: '#000' }),
});

// Icon `color` for an effort glyph — the ramp hex used as the glyph FILL (req
// #3046, where Effort joined Status/Autonomy as a small icon instead of a pill).
// Parallel to coordinationIconColor. Null/unknown → high color (the backfill
// default), so the glyph is never unstyled.
export const effortIconColor = (e) => EFFORT_COLOR[e] || EFFORT_COLOR.high;
