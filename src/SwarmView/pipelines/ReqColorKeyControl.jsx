// ReqColorKeyControl.jsx — the "Color: State · Session · Autonomy · Machine"
// chip group, ONE component for the two surfaces that colour requirements by a
// scale: the plan toolbar (PipelinePlanToolbar.jsx) and the Requirements page
// header (SwarmView.jsx, req #3644). Extracted rather than copied so the two
// cannot drift. The chips map a SCALE LIST: the plan's `REQ_COLOR_SCALES` by
// default, or the host's own (`scales`) — the Requirements page passes
// `REQUIREMENT_COLOR_SCALES`, the original row's display elements.
//
// N+1 POSITIONS FROM N CHIPS: clicking the pressed chip again selects 'none',
// the neutral position (`useViewPreference` ignores null, which is why 'none'
// is a string). See PipelinePlanToolbar.jsx for the history of that gesture.
//
// THE HOVER KEY (req #3644). A host that passes `renderKey` gets that scale's
// key popped out BELOW the hovered chip (MUI Popper + Grow) instead of a
// one-line tooltip — the Requirements page's key used to be a strip across the
// page, and the user asked for it as a hover pop. It shows while the pointer is
// on the chip, and closes on pointer-off or Esc. The pop itself takes no
// pointer events, so it can never sit between the pointer and the chip and
// flicker itself shut. Without `renderKey` (the plan toolbar, whose key lives
// on its canvas) the chips keep their tooltips.

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grow from '@mui/material/Grow';
import Popper from '@mui/material/Popper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';

import { TOOLBAR_CAPTION_SX } from '../../Components/toolbarStyles';
import { REQ_COLOR_SCALES } from './pipelinePlanLayout';
import { toolbarChipProps } from './pipelineChipStyles';

/**
 * @param {Object} props
 * @param {string} props.colorKey          a REQ_COLOR_KEYS value
 * @param {function} props.onChangeColorKey receives a REQ_COLOR_KEYS value
 * @param {string} props.testIdPrefix      `<prefix>-colorkey-toggle` / `-<key>`
 * @param {Object} [props.captionSx]       caption style override (the caption
 *                                         must read on the host's background)
 * @param {Object[]} [props.scales]      the scale list (REQ_COLOR_SCALES shape)
 * @param {function(string): ReactNode} [props.renderKey]  the hover key for a
 *                                         scale; omitted = plain tooltips
 */
export default function ReqColorKeyControl({
    colorKey, onChangeColorKey, testIdPrefix, captionSx, renderKey,
    scales = REQ_COLOR_SCALES,
}) {
    // { key, anchor } of the chip being hovered, or null.
    const [hover, setHover] = useState(null);
    const close = () => setHover(null);

    // Esc dismisses. Listened for only while open, on the document, because
    // the pointer — not keyboard focus — is what opened it.
    useEffect(() => {
        if (!hover) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setHover(null); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [hover]);

    return (
        <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
               sx={{ flexShrink: 0 }}
               data-testid={`${testIdPrefix}-colorkey-toggle`}>
            <Box component="span" sx={{ ...TOOLBAR_CAPTION_SX, ...captionSx }}>Color:</Box>
            {scales.map(({ key, chipLabel, chipTip, chipName }) => {
                const on = colorKey === key;
                const chip = (
                    <Chip
                        label={chipLabel}
                        aria-label={chipName}
                        onClick={() => onChangeColorKey(on ? 'none' : key)}
                        {...(renderKey && {
                            onMouseEnter: (e) => setHover({ key, anchor: e.currentTarget }),
                            onMouseLeave: close,
                        })}
                        {...toolbarChipProps(on)}
                        data-testid={`${testIdPrefix}-colorkey-${key}`}
                    />
                );
                return renderKey
                    ? <Box key={key} component="span" sx={{ display: 'inline-flex' }}>{chip}</Box>
                    : <Tooltip key={key} title={chipTip}>{chip}</Tooltip>;
            })}
            {renderKey && (
                <Popper open={!!hover} anchorEl={hover?.anchor}
                        placement="bottom-start" transition
                        modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}
                        sx={{ zIndex: 'tooltip', pointerEvents: 'none' }}
                        data-testid={`${testIdPrefix}-colorkey-pop`}>
                    {({ TransitionProps }) => (
                        <Grow {...TransitionProps} timeout={180}
                              style={{ transformOrigin: 'top left' }}>
                            <Box>{hover && renderKey(hover.key)}</Box>
                        </Grow>
                    )}
                </Popper>
            )}
        </Stack>
    );
}
