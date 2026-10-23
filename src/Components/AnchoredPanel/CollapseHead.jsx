// CollapseHead.jsx — Darwin's ONE collapse control (req #3643; first drawn by
// the Topology visualizer's TPU 3D head, req #3570, then by the plan page,
// req #3650). Pattern doc: memory/anchored-collapse-pattern.md.
//
// A chevron that turns a quarter-turn when folded, then the panel's name in
// small uppercase type — one button. The NAME is fixed and `aria-expanded`
// carries the state, so a reader hears "Controls, collapsed" rather than the
// state twice; the hover tooltip says what a click will do.
//
// THE HEAD IS THE ANCHOR: whatever it folds, folds INTO it — the head never
// moves when it is clicked. In normal flow that holds by putting the head
// first in its panel; an Action Popup gets it from AnchoredPanel.

import Box from '@mui/material/Box';

/**
 * @param {Object} props
 * @param {boolean} props.open        the panel is showing its body
 * @param {function} props.onToggle   the click
 * @param {string} props.name         the panel's name
 * @param {string} [props.testid]
 * @param {string} [props.color]      resting colour (theme key or CSS colour)
 * @param {string} [props.hoverColor]
 * @param {string} [props.fontSize]   the TPU head's 10px unless the host scales
 * @param {boolean} [props.showName]  false = the ▾ alone, for a head row that
 *   sets its title apart (AnchoredPanel: ▾ · badge · title); the name is still
 *   the button's accessible name
 */
export default function CollapseHead({
    open, onToggle, name, testid,
    color = 'text.secondary', hoverColor = 'text.primary', fontSize = '10px',
    showName = true,
}) {
    const tip = `${open ? 'Collapse' : 'Expand'} ${name.toLowerCase()}`;
    return (
        <Box component="button" type="button"
             onClick={onToggle}
             aria-expanded={open}
             aria-label={name}
             title={tip}
             data-testid={testid}
             sx={{
                 display: 'flex', alignItems: 'center', gap: '0.5em', flexShrink: 0,
                 m: 0, p: 0, background: 'none', border: 'none',
                 color, fontFamily: 'inherit',
                 fontSize, fontWeight: 700, lineHeight: 1.4,
                 letterSpacing: '0.06em', textTransform: 'uppercase',
                 textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer',
                 '&:hover': { color: hoverColor },
             }}>
            <Box component="span" aria-hidden="true"
                 sx={{
                     display: 'inline-block', width: '1em', textAlign: 'center',
                     transition: 'transform 0.15s',
                     transform: open ? 'none' : 'rotate(-90deg)',
                     '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                 }}>
                ▾
            </Box>
            {showName && name}
        </Box>
    );
}
