// Shared coloring for effort CHIPS (req #2916).
//
// Single source of truth so every effort chip across the app reads the same
// way — parallel to modelChipStyles.js for ai_model and
// coordinationChipStyles.js for autonomy. The hues form a thermal intensity
// ramp — grey (least effort) → red (maximum effort):
//
//   low → grey · medium → yellow · high → orange · xhigh → deep orange ·
//   ultracode → red
//
// Deliberately distinct from the AI_MODEL_COLOR amber/teal/indigo/rose and
// the COORDINATION_COLOR pinks/purples/blues/greens so an Effort chip is
// never mistaken for a Model or Autonomy chip on adjacent lines.
//
// Values are lowercase in the DB (requirements.effort / swarm_sessions.effort,
// migration 063); display labels are capitalized via effortLabel. 'ultracode'
// is the user-facing name for the CLI's top effort level (injected as
// `claude --effort max`). Pre-#2916 rows were backfilled to 'high' — the
// documented assumption for all historical data — so null/unknown falls back
// to high styling, NOT to the new-row default (xhigh).

export const EFFORT_COLOR = {
    low:       '#e0e0e0', // grey
    medium:    '#fff59d', // yellow
    high:      '#ffb74d', // orange
    xhigh:     '#ff8a65', // deep orange
    ultracode: '#e57373', // red
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
