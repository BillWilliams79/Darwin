// Shared coloring for ai_model CHIPS (req #2909).
//
// Single source of truth so every model chip across the app reads the same
// way — parallel to coordinationChipStyles.js for autonomy. The hues form a
// capability progression — amber (smallest/fastest) → rose (frontier):
//
//   haiku → amber · sonnet → teal · opus → indigo · fable → rose
//
// Deliberately distinct from the COORDINATION_COLOR pinks/purples/blues/greens
// so a Model chip is never mistaken for an Autonomy chip when they sit on
// adjacent lines.
//
// Values are lowercase in the DB (requirements.ai_model / swarm_sessions.ai_model,
// migration 062); display labels are capitalized via aiModelLabel. Pre-#2909
// rows were backfilled to 'opus'.

export const AI_MODEL_COLOR = {
    haiku:  '#ffcc80', // amber
    sonnet: '#80cbc4', // teal
    opus:   '#9fa8da', // indigo
    fable:  '#ef9a9a', // rose
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
