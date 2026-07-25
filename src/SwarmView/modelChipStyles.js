import { darken } from '@mui/material/styles';

// Shared coloring for ai_model CHIPS (req #2909; recolored #3044; light-surface
// fix #3053).
//
// Single source of truth so every model chip across the app reads the same
// way — parallel to coordinationChipStyles.js for autonomy. The hues form a
// red → green capability ramp — red (smallest/least capable) climbing to dark
// green (the frontier), with the top two rungs both green (per req #3044:
// "top setting dark green ... Opus a lighter green"):
//
//   haiku → red · sonnet → amber · opus → light green · fable → dark green
//
// This red→green ramp is intentionally SHARED with the effort palette
// (EFFORT_COLOR) — the requirement asked both axes to read the same way — but
// stays distinct from the COORDINATION_COLOR pinks/purples/blues/green so a
// Model chip is never mistaken for an Autonomy chip. Chips are told apart by
// their label ("Opus" vs "XHigh") and tooltip, not by hue alone.
//
// Every rung keeps black text: the darkest stop (#388e3c) clears ~5:1 contrast
// on black, so aiModelChipProps hardcodes color:'#000' as before.
//
// Values are lowercase in the DB (requirements.ai_model / swarm_sessions.ai_model,
// migration 062); display labels are capitalized via aiModelLabel. Pre-#2909
// rows were backfilled to 'opus'.

export const AI_MODEL_COLOR = {
    haiku:  '#e57373', // red
    sonnet: '#ffd54f', // amber
    opus:   '#81c784', // light green
    fable:  '#388e3c', // dark green
};

// req #3053: same fix as EFFORT_COLOR_LIGHT (effortChipStyles.js) — haiku/
// sonnet/opus are MUI's shade-300 pastel step and measure well under 3:1
// against a white/light card (verified with dataviz's validate_palette.js
// `contrast()`), reading as a washed-out, near-grey fill even with fully
// legible black text on top. Fable already sits at shade-700 (deliberately
// dark per req #3044) and clears 4.1:1 as-is, so it's excluded. Dark mode is
// unaffected — the original AI_MODEL_COLOR rungs already clear 3.6–10.5:1
// against the dark card surface.
//
// Coefficient is PER RUNG (same values as EFFORT_COLOR_LIGHT's identical
// hues) — the smallest darken() that clears ~3.3:1 on white for that specific
// rung, so black-text-on-fill contrast stays ~6.3:1 instead of sagging toward
// 3:1 under one blanket coefficient sized for the palest rung.
const LIGHT_SURFACE_DARKEN = { haiku: 0.05, sonnet: 0.35, opus: 0.23 };
const AI_MODEL_COLOR_LIGHT = {
    ...AI_MODEL_COLOR,
    haiku:  darken(AI_MODEL_COLOR.haiku, LIGHT_SURFACE_DARKEN.haiku),
    sonnet: darken(AI_MODEL_COLOR.sonnet, LIGHT_SURFACE_DARKEN.sonnet),
    opus:   darken(AI_MODEL_COLOR.opus, LIGHT_SURFACE_DARKEN.opus),
};

export const AI_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];

// Capitalized display label; falls back to 'Opus' for null/unknown — every
// pre-migration row is opus by definition (req #2909 backfill rule).
export const aiModelLabel = (m) =>
    AI_MODEL_COLOR[m] ? m.charAt(0).toUpperCase() + m.slice(1) : 'Opus';

// Mode-aware fill resolver (req #3053) — light mode uses the darkened,
// surface-legible variant; dark mode uses the original ramp unchanged. Shared
// with agentRegistryUtils.js's agentModelChipProps (registry agents pin the
// same ramp, keyed off the base model name).
export const modelFillColor = (m, mode) => {
    const map = mode === 'light' ? AI_MODEL_COLOR_LIGHT : AI_MODEL_COLOR;
    return map[m] || map.opus;
};

// Filled-chip props for a model — pastel bg + black text.
// Null/unknown → opus styling (the backfill default), never unstyled.
export const aiModelChipProps = (m) => ({
    sx: (theme) => ({ bgcolor: modelFillColor(m, theme.palette.mode), color: '#000' }),
});

// Icon `color` for a model glyph — the ramp hex used as the glyph FILL (req
// #3046, where Model joined Status/Autonomy as a small icon instead of a pill).
// Parallel to coordinationIconColor. Null/unknown → opus color (the backfill
// default), so the glyph is never unstyled.
export const aiModelIconColor = (m) => AI_MODEL_COLOR[m] || AI_MODEL_COLOR.opus;
