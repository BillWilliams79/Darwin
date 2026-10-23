// PlanCollapseHead.jsx — the fold on every initiative chip and every step card of the
// plan canvas (req #3650).
//
// It is the TPU 3D visualizer's collapse head (`tpu3dCollapsible` in
// Topology/systems2/tpu3d.js, styled by `.tpu3d-head` in styles.css) rendered
// in React: a ▾ that turns a quarter-turn when folded. The TPU head follows it
// with a small uppercase name of what it folds; on the plan canvas both callers
// pass `label={null}` since req #3648 (user directives: no "Reqs", no "Steps"),
// so the head is the chevron and its name is for assistive tech alone. The TPU head's colours are used as they are — they
// were chosen for a dark navy stage, and this panel is one (`PLAN_VIZ_PALETTE`
// has no light mode). Its geometry is written in `em` so the same head serves
// the initiative chip at the TPU head's own 10px and the step card at the card's
// zoomed type size: 10px type, 14px line, 10px chevron, 5px gap, 0.06em tracking.
//
// A click folds or unfolds THIS box and nothing else, and stops there: the chip
// and the card both have handlers of their own (zoom, focus the step) that must
// not also fire.

import Box from '@mui/material/Box';

const HEAD_SX = {
    display: 'flex', alignItems: 'center', gap: '0.5em', flexShrink: 0,
    m: 0, p: 0, background: 'none', border: 'none',
    color: '#7bb8de', fontFamily: 'inherit', fontWeight: 700,
    lineHeight: 1.4, letterSpacing: '0.06em', textTransform: 'uppercase',
    textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden',
    cursor: 'pointer', pointerEvents: 'auto',
    '&:hover, &:focus-visible': { color: '#cfe4f7', background: 'none', outline: 'none' },
    // A visible focus ring (req #3648): on a step card the head is the chevron
    // alone, and a colour change on one glyph is not a focus indicator.
    '&:focus-visible': { outline: '1px solid #cfe4f7', outlineOffset: '1px', borderRadius: '3px' },
    '& .plan-collapse-chev': {
        display: 'inline-block', width: '1em', textAlign: 'center',
        transition: 'transform 0.15s',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
    },
    '&[aria-expanded="false"] .plan-collapse-chev': { transform: 'rotate(-90deg)' },
};

/**
 * @param {Object} props
 * @param {boolean} props.open      the box's body is showing
 * @param {function} props.onToggle the click
 * @param {?string} props.label    a visible word after the chevron, or null
 *                                  for the chevron alone (both plan callers)
 * @param {string} props.name       the accessible name — what folds and whose
 *                                  ("Steps of initiative Foo"); fixed, so the state is
 *                                  `aria-expanded`'s alone
 * @param {string} props.testId
 * @param {Object} [props.style]    position / size / fontSize, per frame
 */
export default function PlanCollapseHead({ open, onToggle, label, name, testId, style }) {
    return (
        <Box component="button" type="button"
             aria-expanded={open}
             aria-label={name}
             title={`${open ? 'Collapse' : 'Expand'} ${name}`}
             data-testid={testId}
             onClick={(ev) => { ev.stopPropagation(); onToggle(); }}
             onDoubleClick={(ev) => ev.stopPropagation()}
             style={style}
             sx={HEAD_SX}>
            <span className="plan-collapse-chev" aria-hidden="true">▾</span>
            {label}
        </Box>
    );
}
