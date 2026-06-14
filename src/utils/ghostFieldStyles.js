// Shared "ghost" InputBase styling: renders as plain text with a subtle hover/focus
// underline affordance, so a field looks read-only until the user clicks into it.
// Used by both the map Cards (RouteCard) and the Table view inline editors
// (MapRuns/GhostCellEditors) so the in-place editing design is pixel-identical
// across both views. Defined once here to prevent visual drift.
export const ghostBase = {
    display: 'inline-flex',
    verticalAlign: 'baseline',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    color: 'inherit',
    letterSpacing: 'inherit',
    '& .MuiInputBase-input': {
        p: 0,
        height: 'auto',
        fontSize: 'inherit',
        fontFamily: 'inherit',
        lineHeight: 'inherit',
        color: 'inherit',
        letterSpacing: 'inherit',
        borderBottom: '1px solid transparent',
        transition: 'border-bottom-color 150ms',
        '&:hover': { borderBottomColor: 'rgba(0,0,0,0.3)' },
        '&:focus': { outline: 'none', borderBottomColor: 'primary.main' },
    },
};
