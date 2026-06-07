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

// ─── In-place reflow pan compensation (req #2741, generalized #2754) ─────────
// When the graph reflows WITHIN the same project — a filter/stagger toggle
// (req #2741) OR an add-branch / add-build data mutation (req #2754) — the
// trunk's Y (`mainY`) moves as strata/lanes are added or collapsed. To keep
// what the user was looking at fixed on screen, the pan's Y is shifted by the
// change in `mainY`; X is untouched because adding content only extends the
// graph rightward (existing X positions are stable).
//
// The discriminator for "preserve the view" vs "reframe" is PROJECT IDENTITY,
// not the data/model object reference: adding a build/branch refetches and
// produces a brand-new model object while staying on the same project, and that
// must NOT trigger a reframe. A project switch (`sameProject === false`) is left
// to `frameView`/`runFrame` instead, so this returns 0 there.
//
// Returns the Y delta to ADD to the current pan. 0 means no adjustment:
//   - project switch (sameProject false) → runFrame reframes instead
//   - project not yet framed (framed false) → initial framing owns the position
//   - either mainY is null (e.g. a transient empty layout) → nothing to compare
export function reflowPanDeltaY({ sameProject, framed, prevMainY, mainY }) {
    if (!sameProject) return 0;
    if (!framed) return 0;
    if (prevMainY == null || mainY == null) return 0;
    return prevMainY - mainY;
}
