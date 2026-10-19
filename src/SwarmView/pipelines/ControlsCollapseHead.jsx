// ControlsCollapseHead.jsx — the plan page's ONE collapse control (req #3650).
//
// User direction: "pipeline and step should both have UI options in a single
// button to collapse or expand their view. the small one we had in the
// topology TPU 3D visualizer was nice and we could use that here and keep it
// in the upper left corner as in TPU 3D Vis."
//
// So this is the TPU 3D head (`Topology/systems2/tpu3d.js` tpu3dCollapsible,
// req #3570, styled by `.tpu3d-head` in styles.css) rendered in React: a
// chevron that turns a quarter-turn when folded, then a small uppercase name.
// It leads the header row, which puts it in the page's upper-left corner, and
// it folds the options of WHICHEVER mode is showing — the Plan view's toolbar
// and the Table (steps) view's Time/Tokens alike — so the page has one control
// for both, not one per mode.
//
// The TPU head's colours are for its own dark stage; here the two states take
// the theme's secondary/primary text so the control reads in light and dark.
// The geometry, type and motion are the TPU head's, unchanged.

// Since req #3643 the head itself is the shared CollapseHead
// (Components/AnchoredPanel; pattern doc memory/anchored-collapse-pattern.md);
// this file pins the plan page's name, theme colours and test id onto it.

import CollapseHead from '../../Components/AnchoredPanel/CollapseHead';

/**
 * @param {Object} props
 * @param {boolean} props.open      the options are showing
 * @param {function} props.onToggle the click
 * @param {string} [props.name]     the panel's name, as on the TPU head
 */
export default function ControlsCollapseHead({ open, onToggle, name = 'Controls' }) {
    return (
        <CollapseHead open={open} onToggle={onToggle} name={name}
                      testid="pipeline-controls-collapse"
                      color="text.secondary" hoverColor="text.primary" fontSize="10px" />
    );
}
