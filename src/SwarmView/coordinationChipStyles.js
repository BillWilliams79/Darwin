// Shared coloring for coordination_type ICONS + CHIPS (req #2866).
//
// Single source of truth so every coordination icon and chip across the app
// reads the same way. The hues form an autonomy progression — pink (least
// autonomy, needs discussion) → green (most autonomy, ships itself):
//
//   discuss → pink · planned → purple · implemented → blue · deployed → green
//
// Used by:
//   • RequirementRow / RequirementDeleteDialog — coordination icon color
//   • RequirementDetail — autonomy selector chips
//   • SwarmCompleteDetail / SwarmUndoDetail — coordination chips
//
// Scope note: the swarm-visualizer bead-ring palette is a separate concern with
// its own "red = no setting" semantic (CalendarFC/timeSeriesSizes.js
// COORDINATION_COLORS) and is intentionally NOT driven by this module.

export const COORDINATION_COLOR = {
    discuss:     '#f48fb1', // pink
    planned:     '#ce93d8', // purple
    implemented: '#90caf9', // blue
    deployed:    '#a5d6a7', // green
};

// Icon `sx.color` for a coordination type; undefined for unknown/unset so the
// caller can fall back to its own "no setting" glyph.
export const coordinationIconColor = (ct) => COORDINATION_COLOR[ct];

// Filled-chip props for a coordination type — pastel bg + black text.
// Unknown/unset → MUI default chip styling.
export const coordinationChipProps = (ct) =>
    COORDINATION_COLOR[ct]
        ? { sx: { bgcolor: COORDINATION_COLOR[ct], color: '#000' } }
        : { color: 'default' };
