// Shared "ghost" field styling: a control renders as plain text with a subtle
// hover/focus underline affordance, so it looks read-only until the user clicks into
// it. Used by the shared GhostTextField (Components/GhostField) and by the two ghost
// controls that are NOT text fields — the route/activity Select and the partners
// Autocomplete in the Maps card and table views. Defined once here to prevent drift.
//
// THESE ARE THEME FUNCTIONS, not plain objects (req #3073). They used to be a literal
// with `borderBottomColor: 'rgba(0,0,0,0.3)'` baked in, which is invisible against a
// dark background — every ghost field in the app lost its hover affordance in dark
// mode. Req #3063 spotted it and worked around it locally inside GhostTextField rather
// than change an object it shared with the Maps views; this is the fix at the source.
//
// MUI's `sx` accepts a function of the theme, so `sx={ghostBase}` works directly and a
// caller composing its own styles spreads `...ghostBase(theme)` from inside its own sx
// callback.

/**
 * The hover underline. Not `theme.palette.divider` — that is a 12%-alpha hairline meant
 * to separate regions, and as a hover affordance it reads as nothing happening.
 */
export const ghostUnderlineHover = (theme) => (
    theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)'
);

/** The base ghost styling for an InputBase-shaped control. */
export const ghostBase = (theme) => ({
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
        '&:hover': { borderBottomColor: ghostUnderlineHover(theme) },
        '&:focus': { outline: 'none', borderBottomColor: theme.palette.primary.main },
    },
});

/**
 * The same affordance for a `variant="standard"` Select. A Select paints its underline
 * with ::before/::after pseudo-elements rather than a border on the input, so it cannot
 * share `ghostBase` — only the colour rule is common, which is the part that was wrong
 * in dark mode.
 */
export const ghostSelectBase = (theme) => ({
    fontSize: 'inherit',
    '& .MuiSelect-select': { py: 0, pr: '0 !important' },
    '&:before': { borderBottomColor: 'transparent' },
    '&:hover:not(.Mui-disabled):before': { borderBottomColor: ghostUnderlineHover(theme) },
});

/**
 * The same affordance for the `variant="standard"` TextField that an Autocomplete
 * renders as its input.
 */
export const ghostAutocompleteInputBase = (theme, { placeholderFontSize } = {}) => ({
    '& .MuiInput-underline:before': { borderBottomColor: 'transparent' },
    '& .MuiInput-underline:hover:not(.Mui-disabled, .Mui-error):before': {
        borderBottomColor: ghostUnderlineHover(theme),
    },
    '& .MuiInputBase-input::placeholder': {
        color: theme.palette.text.disabled,
        opacity: 1,
        // The card and the table sit at different type scales, and the placeholder
        // is the one part of this that does not inherit.
        ...(placeholderFontSize && { fontSize: placeholderFontSize }),
    },
    '& .MuiInputBase-root': { flexWrap: 'wrap', gap: 0.5 },
});
