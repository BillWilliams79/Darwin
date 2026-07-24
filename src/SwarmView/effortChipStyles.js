// Shared coloring for effort CHIPS (req #2916; recolored #3044).
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

// Filled-chip props for an effort — pastel bg + black text.
// Null/unknown → high styling (the backfill default), never unstyled.
export const effortChipProps = (e) => ({
    sx: { bgcolor: EFFORT_COLOR[e] || EFFORT_COLOR.high, color: '#000' },
});

// Icon `color` for an effort glyph — the ramp hex used as the glyph FILL (req
// #3046, where Effort joined Status/Autonomy as a small icon instead of a pill).
// Parallel to coordinationIconColor. Null/unknown → high color (the backfill
// default), so the glyph is never unstyled.
export const effortIconColor = (e) => EFFORT_COLOR[e] || EFFORT_COLOR.high;
