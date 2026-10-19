// StatusCountPill.jsx — the Swarm-Start card's status selector, as ONE pill
// per status: the count first, in a circle, then the status name (req #3644,
// user directive: "a pill with the number first in a circle of one color
// followed by the value name ... a single pill ... with maybe a small gap
// around the circle ... that is transparent").
//
// It replaced an MUI Badge clamped onto the corner of a Chip — two elements,
// the count overlapping the chip's edge.
//
// THE GAP IS REALLY TRANSPARENT, not painted. A ring drawn in the card's colour
// would be right on one background and wrong on every other (and on the pill's
// own hover tint). Instead the pill is MASKED: a radial gradient centred on the
// circle keeps the circle, cuts a `GAP`-wide ring out of the pill, and keeps
// the rest — so whatever is behind the pill shows through the ring.
//
// ONE circle colour for every status (the plan's near-black field, light
// numerals), so the counts read as one column of data across the row. The
// pill itself carries the status colour: SOLID when selected, a TINT when not.

import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';

import { REQ_CARD_MONO, REQ_CARD_THEME as T } from './requirementCardTheme';

const H = 26;          // pill height, px
const INSET = 3;       // circle's inset from the pill's left edge, px
const D = H - 2 * INSET; // circle diameter, px
const GAP = 2;         // the transparent ring between circle and pill, px
const R = D / 2;
const CX = INSET + R;  // circle centre, from the pill's left edge

// Keep the circle (≤ R), cut the ring (R .. R+GAP), keep the pill beyond it.
// The half-pixel steps antialias the two edges instead of stair-stepping them.
const RING_MASK = `radial-gradient(circle at ${CX}px 50%, #000 ${R - 0.25}px, `
    + `transparent ${R + 0.25}px, transparent ${R + GAP - 0.25}px, #000 ${R + GAP + 0.25}px)`;

/** MUI Badge's own clamp, kept: the Met total runs to four digits. */
export const formatPillCount = (n) => (n > 99 ? '99+' : String(n ?? 0));

/**
 * @param {Object} props
 * @param {string} props.label        the status name
 * @param {number} props.count
 * @param {string} props.color        the status colour
 * @param {boolean} props.selected
 * @param {function} props.onClick
 * @param {string} props.testId       the pill's testid (the clickable)
 * @param {string} props.countTestId  the circle's testid
 */
export default function StatusCountPill({ label, count, color, selected, onClick, testId, countTestId }) {
    const text = formatPillCount(count);
    return (
        <Box component="button" type="button"
             onClick={onClick}
             aria-pressed={selected ? 'true' : 'false'}
             aria-label={`${label}, ${count ?? 0}`}
             data-testid={testId}
             sx={{
                 display: 'inline-flex', alignItems: 'center', gap: '7px',
                 height: H, pl: `${INSET}px`, pr: '11px',
                 border: 'none', borderRadius: `${H / 2}px`, cursor: 'pointer',
                 fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600,
                 textTransform: 'capitalize', whiteSpace: 'nowrap',
                 bgcolor: selected ? color : alpha(color, 0.16),
                 color: selected ? T.field : color,
                 WebkitMaskImage: RING_MASK, maskImage: RING_MASK,
                 transition: 'background-color 160ms ease, color 160ms ease',
                 '&:hover': { bgcolor: selected ? color : alpha(color, 0.28) },
                 '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: '2px' },
             }}>
            <Box component="span" data-testid={countTestId}
                 sx={{ width: D, height: D, borderRadius: '50%', flexShrink: 0,
                       display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                       bgcolor: T.field, color: T.text, fontFamily: REQ_CARD_MONO,
                       fontSize: text.length > 2 ? '0.58rem' : '0.68rem', fontWeight: 700,
                       letterSpacing: text.length > 2 ? '-0.04em' : 0 }}>
                {text}
            </Box>
            <Box component="span">{label}</Box>
        </Box>
    );
}
