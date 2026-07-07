// canvasSpinnerGate.js — when the Build Visualizer should show the full-canvas
// loading spinner (req #2895).
//
// The spinner MUST only appear on the very first load, before there is anything
// to draw. On any later refetch (running a build, editing a branch, toggling a
// display option) the canvas must stay mounted so KonvaBuildCanvas keeps its
// pan/zoom transform — swapping in a spinner unmounts it and forces a re-frame,
// which is the "re-center on redraw" bug this requirement fixes.
//
// Pure predicate so it can be unit-tested without a React render harness.
//
//   initialLoad — hook's `isInitialLoad` (loading AND no data yet)
//   ready       — the pattern library is ready (has an active project)
//   hasBranches — the model already has branches to draw
//
// Show the spinner only when we are still loading/not-ready AND there is nothing
// on screen yet. Once branches exist, never cover them with the spinner.
export function shouldShowCanvasSpinner({ initialLoad, ready, hasBranches }) {
    return (!!initialLoad || !ready) && !hasBranches;
}

export default shouldShowCanvasSpinner;
