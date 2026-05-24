// Build Visualizer dark-mode variants (req #2621). Single source of truth
// shared by the React shell (BuildVisualizerPage, BuildVisualizerControls)
// and the iframe via the bv:set-theme postMessage payload. Keep this list in
// sync with Topology/build-visualizer/styles.css ([data-theme="..."] blocks)
// and memory/build-visualizer-design.md.
//
// The picker is **dark-mode-only**. When Darwin's app theme is light, the
// Build Visualizer always shows the (un-themed) light canvas; the chip is
// hidden and this list is never surfaced to the user. The 'light' value
// still exists in the iframe as a transport-level value the React shell
// posts to undo any data-theme attribute — it is not a user-selectable
// variant.
//
// `swatch` is a representative bg color used in the picker UI so each option
// shows the actual canvas color it produces. `accent` is the connector color
// so the swatch dot stays visible against the swatch background.

export const THEME_VARIANT_MIDNIGHT = 'midnight';
export const THEME_VARIANT_CHARCOAL_DARK = 'charcoal-dark';
export const THEME_VARIANT_MOCHA = 'mocha';
export const THEME_VARIANT_MATRIX = 'matrix';

// Menu order: default first, then a gentle palette tour
// (cool-chromatic → neutral-warm → warm-chromatic → high-chroma).
export const THEME_VARIANTS = [
    THEME_VARIANT_MIDNIGHT,
    THEME_VARIANT_CHARCOAL_DARK,
    THEME_VARIANT_MOCHA,
    THEME_VARIANT_MATRIX,
];

export const DEFAULT_DARK_VARIANT = THEME_VARIANT_MIDNIGHT;

// Transport-only sentinel posted to the iframe when Darwin's app theme is
// light — the iframe removes `data-theme` from <html> and reverts to its
// :root defaults. Not a user-selectable variant; never appears in the menu.
export const LIGHT_TRANSPORT_VARIANT = 'light';

const META = {
    [THEME_VARIANT_MIDNIGHT]: {
        label: 'Midnight',
        tagline: 'Engineering blueprint (default)',
        swatch: '#0a1929',
        accent: '#8ecae6',
        border: 'rgba(142,202,230,0.40)',
    },
    [THEME_VARIANT_CHARCOAL_DARK]: {
        label: 'Charcoal',
        tagline: 'Warm dark, matches Darwin',
        swatch: '#141210',
        accent: '#d9d0c4',
        border: 'rgba(255,255,255,0.20)',
    },
    [THEME_VARIANT_MOCHA]: {
        label: 'Mocha',
        tagline: 'Coffee — espresso & latte cream',
        swatch: '#1a120c',
        accent: '#d4a373',
        border: 'rgba(212,163,115,0.40)',
    },
    [THEME_VARIANT_MATRIX]: {
        label: 'Matrix',
        tagline: 'Terminal green-on-black',
        swatch: '#000000',
        accent: '#33ff77',
        border: '#33ff77',
    },
};

export const themeVariantLabel = (variant) => META[variant]?.label || variant;
export const themeVariantTagline = (variant) => META[variant]?.tagline || '';
export const themeVariantSwatch = (variant) => META[variant]?.swatch || '#0a1929';
export const themeVariantAccent = (variant) => META[variant]?.accent || '#8ecae6';
export const themeVariantBorder = (variant) => META[variant]?.border || 'rgba(142,202,230,0.40)';

export const isThemeVariant = (value) =>
    typeof value === 'string' && THEME_VARIANTS.includes(value);
