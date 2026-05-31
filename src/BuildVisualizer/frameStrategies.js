// ─── View framing — single source of truth (req #2741) ─────────────────────
// Extracted from BuildVisualizerCanvas for testability. SINGLE place the SVG's
// pan offset is computed. Every caller routes through `frameView()`.
//
// Horizontal (all strategies): anchor the SVG's left edge (x=0) at the
// viewport's left edge. The layout reserves `leftPad` (240px) on the left for
// the stratum/swim-lane labels.

export const FRAME_STRATEGIES = {
    // centerMain (default): pin the main trunk at the EXACT vertical center of
    // the viewport, regardless of graph size.
    centerMain: (layout, viewport) => {
        const mainY = layout?.mainY || 0;
        return { x: 0, y: Math.round(viewport.height / 2 - mainY) };
    },
};

export const DEFAULT_FRAME_STRATEGY = 'centerMain';

export function frameView(layout, viewport, strategy = DEFAULT_FRAME_STRATEGY) {
    const fn = FRAME_STRATEGIES[strategy] || FRAME_STRATEGIES[DEFAULT_FRAME_STRATEGY];
    return fn(layout, viewport);
}
