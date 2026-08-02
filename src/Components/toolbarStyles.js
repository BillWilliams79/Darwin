// toolbarStyles.js — the caption that names a control GROUP on a toolbar
// (req #3261).
//
// ONE HOME FOR ONE VOICE. `SemanticLevelControl` has rendered a "Detail:"
// caption since req #3168, and req #3261 gave the plan page's Width and Colour
// groups captions of their own so that a group's NAME stops living inside its
// first option ("Width: S | M | L" read as a control named by its first value —
// P9). Three captions in the same row have to be ONE voice, and a second inline
// copy of the same three properties is exactly the drift S9 exists to prevent:
// two places to change a thing that must not diverge, where the divergence is
// invisible on either surface alone.
//
// A PURE MODULE, not an export bolted onto `SemanticLevelControl.jsx`: mixing
// non-component exports into a component file drops that file out of React Fast
// Refresh (the `instructionSort.js` lesson, recorded in `pipelineChipStyles.js`).
//
// It lives in `Components/` rather than beside the plan page because the plan
// page is only one of its two consumers — the Build Visualizer renders the same
// control, and a shared component reaching into `SwarmView/pipelines/` for its
// own caption style would invert the dependency.
//
// `flexShrink: 0` and `whiteSpace: 'nowrap'` are here rather than at the call
// site because a caption that wraps or compresses stops naming its group: on a
// canvas toolbar the row scrolls its own band (S13) and every control keeps its
// natural size, so a caption must too. They are inert wherever the caption is
// not a flex item.
export const TOOLBAR_CAPTION_SX = {
    fontSize: '0.75rem',
    color: 'text.secondary',
    mr: 0.25,
    flexShrink: 0,
    whiteSpace: 'nowrap',
};

export default TOOLBAR_CAPTION_SX;
