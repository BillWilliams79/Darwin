// Shared coloring for ai_model CHIPS (req #2909; recolored #3044).
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

export const AI_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];

// Capitalized display label; falls back to 'Opus' for null/unknown — every
// pre-migration row is opus by definition (req #2909 backfill rule).
export const aiModelLabel = (m) =>
    AI_MODEL_COLOR[m] ? m.charAt(0).toUpperCase() + m.slice(1) : 'Opus';

// Filled-chip props for a model — pastel bg + black text.
// Null/unknown → opus styling (the backfill default), never unstyled.
export const aiModelChipProps = (m) => ({
    sx: { bgcolor: AI_MODEL_COLOR[m] || AI_MODEL_COLOR.opus, color: '#000' },
});
