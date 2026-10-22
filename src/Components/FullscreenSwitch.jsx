// FullscreenSwitch.jsx — THE full screen / maximize switch every Darwin
// visualizer draws (req #3793; born on the Plan canvas, req #3658).
//
// It is the TPU 3D views' Full screen switch (`.tpu3d-fullbtn`, Topology
// systems2/styles.css, req #3568/#3600) in React: the corner-arrows glyph —
// arrows OUT when a click would go full screen, arrows IN when it would come
// back — in the TPU header's blue, on a thin rim. One component, so the Plan,
// Build and Swarm visualizers cannot drift into three looks for one control.
//
// ── WHERE IT GOES IS THE CALLER'S, BY ONE RULE (req #3793, user rule) ─────
//   · CONTROLS ON SCREEN → in the controls' title/header row, just right of the
//     row's title word, as the TPU views put it right of "▾ Controls". Use the
//     default (`variant="header"`): sized to sit among small chips, coloured
//     for the page's own light or dark theme.
//   · NO CONTROLS ON SCREEN (a page that hides its header while maximized) →
//     in the visualizer's UPPER-LEFT corner, absolutely positioned on the
//     canvas. Use `variant="floating"`: a little larger, on its own dark plate
//     with a shadow, because it floats over drawing rather than a toolbar. The
//     caller supplies the position and z-index through `sx`.
//
// It is a plain <button> with `aria-pressed` (on = full screen) and an
// explicit `aria-label`, plus a native `title` as the hover hint — the TPU
// switch's own tooltip mechanism, and no MUI Tooltip whose injected name could
// land on the wrong element (memory/view-switchable-pages.md V5).

import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';

import {
    FULLSCREEN_ENTER_PATH, FULLSCREEN_LEAVE_PATH, FULLSCREEN_SWITCH_SIZE,
} from './fullscreenSwitchGeometry';

// The TPU header's colours (dark): glyph, rim, and their hover/focus pair.
const DARK = { fg: '#7bb8de', rim: '#2d5a85', fgHot: '#cfe4f7', rimHot: '#5fa3d4' };
// The same blue family stepped DOWN for a light page: the dark glyph colour
// measures under 2.2:1 on white, so light mode uses the TPU rim's own navy for
// the glyph and a pale rim, and darkens both on hover.
const LIGHT = { fg: '#2d5a85', rim: '#9cc0de', fgHot: '#17395a', rimHot: '#2d5a85' };

const paint = (c) => ({
    color: c.fg,
    borderColor: c.rim,
    '&:hover, &:focus-visible': { color: c.fgHot, borderColor: c.rimHot, outline: 'none' },
});

/**
 * @param {Object} props
 * @param {boolean} props.on              full screen is up (the glyph turns IN)
 * @param {function} props.onToggle       the click
 * @param {string} props.testid           the switch's `data-testid`
 * @param {string} [props.enterLabel]     accessible name while off
 * @param {string} [props.leaveLabel]     accessible name while on
 * @param {string} [props.enterTitle]     hover hint while off
 * @param {string} [props.leaveTitle]     hover hint while on
 * @param {'header'|'floating'} [props.variant]
 * @param {Object} [props.sx]             merged last — position, z-index, margins
 */
// A switch that MOVES when clicked (the Plan's: header row → canvas corner and
// back) unmounts under the keyboard's focus. A click raises this flag for the
// one render it causes; the switch that mounts in that render takes the focus,
// so Tab carries on from the switch rather than from the top of the page. A
// switch that stays put keeps its focus anyway, and the flag drops on the next
// task so no later mount can take it.
let focusOnMount = false;

export default function FullscreenSwitch({
    on, onToggle, testid,
    enterLabel = 'Full screen',
    leaveLabel = 'Leave full screen',
    enterTitle = 'Full screen (Esc to exit)',
    leaveTitle = 'Leave full screen (Esc)',
    variant = 'header',
    sx,
    ...rest
}) {
    const ref = useRef(null);
    useEffect(() => {
        if (focusOnMount && ref.current) { focusOnMount = false; ref.current.focus(); }
    }, []);
    const click = (e) => {
        if (e.currentTarget === document.activeElement) {
            focusOnMount = true;
            setTimeout(() => { focusOnMount = false; }, 0);
        }
        onToggle(e);
    };
    const floating = variant === 'floating';
    const size = FULLSCREEN_SWITCH_SIZE[floating ? 'floating' : 'header'];
    return (
        <Box component="button" type="button" ref={ref}
             onClick={click}
             data-testid={testid}
             data-fullscreen-switch={variant}
             aria-pressed={!!on}
             aria-label={on ? leaveLabel : enterLabel}
             title={on ? leaveTitle : enterTitle}
             {...rest}
             sx={[
                 {
                     flexShrink: 0, width: size.w, height: size.h, p: 0, m: 0,
                     display: 'inline-flex', alignItems: 'center',
                     justifyContent: 'center', cursor: 'pointer',
                     border: '1px solid', borderRadius: floating ? '4px' : '3px',
                     background: 'none',
                 },
                 // Floating, it sits on the plan's always-dark canvas, so it is
                 // always the dark pair, on its own plate.
                 floating
                     ? {
                         ...paint(DARK),
                         background: 'rgba(13, 20, 32, 0.94)',
                         boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
                     }
                     : (theme) => paint(theme.palette.mode === 'dark' ? DARK : LIGHT),
                 ...(Array.isArray(sx) ? sx : [sx]),
             ]}>
            <svg viewBox="0 0 16 16" width={size.glyph} height={size.glyph}
                 aria-hidden="true" focusable="false">
                <path d={on ? FULLSCREEN_LEAVE_PATH : FULLSCREEN_ENTER_PATH}
                      fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
        </Box>
    );
}
