// req #2694 / #2720 — theme palettes for the Build Visualizer SVG canvas.
//
// Applied directly to SVG elements by the React renderer. Each variant
// defines colors for backgrounds, lines, labels, dots, and version text.
// Keep keys/values in lock-step with the `:root[data-theme="…"]` blocks in
// styles.css and the THEME_VARIANTS list in themeVariants.js.

const LIGHT = {
    bg:            '#ffffff',
    line:          '#2c2c2c',
    lineWhispy:    '#b0b0b0',
    label:         '#1a1a1a',
    version:       '#444',
    dotDefault:   { fill: '#ffffff', stroke: '#2c2c2c' },
    dotGreen:     { fill: '#22c55e', stroke: '#15803d' },
    dotRed:       { fill: '#e53935', stroke: '#b71c1c' },
    dotYellow:    { fill: '#fdd835', stroke: '#c7a800' },
    dotGray:      { fill: '#b9b9b9', stroke: '#7a7a7a' },
    dotApproved:  { fill: '#22c55e', stroke: '#15803d' },
    labelFont:    '"Calibri", "Segoe UI", Arial, sans-serif',
    versionFont:  '"Consolas", "Menlo", monospace',
};

const CHARCOAL_DARK = {
    bg:            '#141210',
    line:          '#d9d0c4',
    lineWhispy:    '#6a6359',
    label:         '#e8e1d5',
    version:       '#a39a8d',
    dotDefault:   { fill: '#2a2723', stroke: '#d9d0c4' },
    dotGreen:     { fill: '#22c55e', stroke: '#86efac' },
    dotRed:       { fill: '#ef4444', stroke: '#fca5a5' },
    dotYellow:    { fill: '#facc15', stroke: '#fde68a' },
    dotGray:      { fill: '#6b6b6b', stroke: '#a39a8d' },
    dotApproved:  { fill: '#4ade80', stroke: '#86efac' },
    labelFont:    '"Calibri", "Segoe UI", Arial, sans-serif',
    versionFont:  '"Consolas", "Menlo", monospace',
};

const MIDNIGHT = {
    bg:            '#0a1929',
    line:          '#8ecae6',
    lineWhispy:    '#3f5e7a',
    label:         '#caf0f8',
    version:       '#7fb3d5',
    dotDefault:   { fill: '#102a43', stroke: '#8ecae6' },
    dotGreen:     { fill: '#2dd4bf', stroke: '#99f6e4' },
    dotRed:       { fill: '#f87171', stroke: '#fecaca' },
    dotYellow:    { fill: '#ffd166', stroke: '#fde68a' },
    dotGray:      { fill: '#5b7387', stroke: '#8ecae6' },
    dotApproved:  { fill: '#2dd4bf', stroke: '#99f6e4' },
    labelFont:    '"Calibri", "Segoe UI", Arial, sans-serif',
    versionFont:  '"Consolas", "Menlo", monospace',
};

const MOCHA = {
    bg:            '#1a120c',
    line:          '#d4a373',
    lineWhispy:    '#6b513a',
    label:         '#e8d4ad',
    version:       '#a8835f',
    dotDefault:   { fill: '#2a1f17', stroke: '#d4a373' },
    dotGreen:     { fill: '#6ec77a', stroke: '#b6e8bd' },
    dotRed:       { fill: '#e76f51', stroke: '#f4a191' },
    dotYellow:    { fill: '#ffd166', stroke: '#ffe9b3' },
    dotGray:      { fill: '#8a755e', stroke: '#c4ad8e' },
    dotApproved:  { fill: '#6ec77a', stroke: '#b6e8bd' },
    labelFont:    '"Calibri", "Segoe UI", Arial, sans-serif',
    versionFont:  '"Consolas", "Menlo", monospace',
};

const MATRIX = {
    bg:            '#000000',
    line:          '#33ff77',
    lineWhispy:    '#1a5a30',
    label:         '#33ff77',
    version:       '#28cc66',
    dotDefault:   { fill: '#001a08', stroke: '#33ff77' },
    dotGreen:     { fill: '#66ff8c', stroke: '#b4ffce' },
    dotRed:       { fill: '#ff5577', stroke: '#ff9bb0' },
    dotYellow:    { fill: '#ffe156', stroke: '#fff099' },
    dotGray:      { fill: '#4a6a55', stroke: '#7fae8e' },
    dotApproved:  { fill: '#66ff8c', stroke: '#b4ffce' },
    labelFont:    '"Consolas", "Menlo", "Courier New", monospace',
    versionFont:  '"Consolas", "Menlo", monospace',
};

const BY_VARIANT = {
    light:           LIGHT,
    'charcoal-dark': CHARCOAL_DARK,
    midnight:        MIDNIGHT,
    mocha:           MOCHA,
    matrix:          MATRIX,
};

export function paletteFor(variant) {
    return BY_VARIANT[variant] || LIGHT;
}

export default paletteFor;
