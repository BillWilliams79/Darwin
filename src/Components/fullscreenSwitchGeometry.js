// fullscreenSwitchGeometry.js — the full screen switch's glyph and sizes
// (req #3793), apart from `FullscreenSwitch.jsx` so that file exports only its
// component (a component file with other exports drops out of React Fast
// Refresh) and so a pure module — the Plan's corner arithmetic — can read the
// size without importing React.

/** The corner-arrows glyph, OUT — "go full screen". viewBox 0 0 16 16. */
export const FULLSCREEN_ENTER_PATH = 'M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5';
/** The corner-arrows glyph, IN — "come back". viewBox 0 0 16 16. */
export const FULLSCREEN_LEAVE_PATH = 'M6 1v5H1M15 6h-5V1M10 15v-5h5M1 10h5v5';

/** Sizes, px: the button box and the glyph inside it. */
export const FULLSCREEN_SWITCH_SIZE = Object.freeze({
    header: Object.freeze({ w: 22, h: 20, glyph: 12 }),
    floating: Object.freeze({ w: 28, h: 26, glyph: 14 }),
});
