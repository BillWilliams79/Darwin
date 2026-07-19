// Standard color set for ChipFilter options (req #2992).
//
// Dimensions with a fixed, meaningful vocabulary (session status, requirement
// status, model, effort) bring their own chip-props function — those colors
// carry semantics and must not be reassigned. This palette serves the other
// case: dimensions whose values are DATA, not vocabulary (machines, projects,
// categories), where any stable, distinguishable color will do.
//
// Requirements the palette has to meet:
//   - deterministic: the same option value always gets the same color, in every
//     view and across reloads, so users build muscle memory
//   - legible: each entry ships its own foreground color, already contrast-
//     checked against its background
//   - overridable: users may pin any option to any color (see FILTER_COLOR_*)

// Eight hues, evenly spread and distinguishable in both MUI light and dark
// themes. Foreground is black on light backgrounds, white on dark ones.
export const FILTER_PALETTE = [
    { bg: '#5c6bc0', fg: '#fff' },  // indigo
    { bg: '#26a69a', fg: '#000' },  // teal
    { bg: '#ef5350', fg: '#fff' },  // red
    { bg: '#ffa726', fg: '#000' },  // orange
    { bg: '#7e57c2', fg: '#fff' },  // deep purple
    { bg: '#66bb6a', fg: '#000' },  // green
    { bg: '#42a5f5', fg: '#000' },  // blue
    { bg: '#ec407a', fg: '#fff' },  // pink
];

// Reserved slot for options that represent absence (null machine, no category).
// Deliberately outside FILTER_PALETTE so "unassigned" never collides with a
// real value's color.
export const UNASSIGNED_COLOR = { bg: '#9e9e9e', fg: '#000' };

/**
 * Stable index into FILTER_PALETTE for an arbitrary option value.
 *
 * Numeric values (database ids) index directly, so ids 1..8 walk the palette in
 * order and read as intentional rather than random. Strings hash. Negative and
 * non-integer numbers fall through to the string path rather than producing a
 * negative or fractional index.
 */
export const paletteIndexFor = (value) => {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return value % FILTER_PALETTE.length;
    }
    const str = String(value);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % FILTER_PALETTE.length;
};

/**
 * Resolve the color for an option value.
 *
 * @param value      the option's value
 * @param overrides  optional { [value]: { bg, fg } } user customization map
 * @returns { bg, fg }
 */
export const filterColorFor = (value, overrides) => {
    if (value == null) return UNASSIGNED_COLOR;
    const override = overrides?.[value];
    // A partial override ({ bg } with no { fg }) is legal — fill the gap from
    // the palette default rather than rendering transparent text.
    if (override?.bg) {
        return { bg: override.bg, fg: override.fg || FILTER_PALETTE[paletteIndexFor(value)].fg };
    }
    return FILTER_PALETTE[paletteIndexFor(value)];
};

/**
 * MUI Chip props for an option value — the shape ChipFilter expects from any
 * chip-props function, matching swarmStatusChipProps et al.
 */
export const filterChipProps = (value, overrides) => {
    const { bg, fg } = filterColorFor(value, overrides);
    return { sx: { bgcolor: bg, color: fg } };
};
