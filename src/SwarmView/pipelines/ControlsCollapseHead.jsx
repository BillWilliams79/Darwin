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

import Box from '@mui/material/Box';

/**
 * @param {Object} props
 * @param {boolean} props.open      the options are showing
 * @param {function} props.onToggle the click
 * @param {string} [props.name]     the panel's name, as on the TPU head
 */
export default function ControlsCollapseHead({ open, onToggle, name = 'Controls' }) {
    // The NAME is fixed and `aria-expanded` carries the state, so a reader
    // hears "Controls, collapsed" rather than the state twice; the hover
    // tooltip says what a click will do, as the TPU head's `title` does.
    const tip = `${open ? 'Collapse' : 'Expand'} ${name.toLowerCase()}`;
    return (
        <Box component="button" type="button"
             onClick={onToggle}
             aria-expanded={open}
             aria-label={name}
             title={tip}
             data-testid="pipeline-controls-collapse"
             sx={{
                 display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0,
                 m: 0, p: 0, background: 'none', border: 'none',
                 color: 'text.secondary', fontFamily: 'inherit',
                 fontSize: '10px', fontWeight: 700, lineHeight: '14px',
                 letterSpacing: '0.06em', textTransform: 'uppercase',
                 textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer',
                 '&:hover': { color: 'text.primary' },
             }}>
            <Box component="span" aria-hidden="true"
                 sx={{
                     display: 'inline-block', width: '10px', textAlign: 'center',
                     transition: 'transform 0.15s',
                     transform: open ? 'none' : 'rotate(-90deg)',
                     '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                 }}>
                ▾
            </Box>
            {name}
        </Box>
    );
}
