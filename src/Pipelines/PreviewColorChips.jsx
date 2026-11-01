// PreviewColorChips.jsx — the Progress button of the Pipelines cards' previews
// (req #4063, narrowed by req #4184).
// One choice for the whole page (a preview per card is the same picture at the
// same scale). Lit = Progress colouring; pressed off = the clean look, every bead
// the 100% green. The other colour buttons (the plan visualizer's five scales and
// Flags) are gone.
//
// THE COLOUR HELP IS THE PLAN VISUALIZER'S (user, req #4063): the chip explains
// ITSELF in a hover popup under it — lit or not — a long press PINS it until
// Escape or a chip press, and the popup is the visualizer's own (`KeyPopper`,
// `useKeyHelp`), not a copy. That help is why the button stayed (req #4184).

import { useState } from 'react';
import Chip from '@mui/material/Chip';

import { toolbarChipProps } from '../SwarmView/pipelines/pipelineChipStyles';
import { useKeyHelp } from '../SwarmView/pipelines/PipelinePlanToolbar';
import { KeyGroup, KeyPopper, LegendWord } from '../SwarmView/pipelines/PlanKeyPopper';
import {
    CLEAN_MODE, PERCENT_MODE, PROGRESS_BUTTON, previewLegend,
} from './previewColor';

export default function PreviewColorChips({ mode, onChange }) {
    const [keyHover, setKeyHover] = useState(null);
    const hoverKeyProps = useKeyHelp(setKeyHover);
    const { key, label, tip, keyTitle } = PROGRESS_BUTTON;
    const on = mode === PERCENT_MODE;
    return (
        <>
            {/* No Tooltip: the colour help below explains the chip, and two
                overlays on one chip would fight (the plan toolbar's rule). */}
            <Chip label={label}
                  aria-label={`${label} — ${on ? tip : 'currently off; every epic is drawn dark green. Click to colour by progress.'}`}
                  onClick={() => onChange(on ? CLEAN_MODE : PERCENT_MODE)}
                  {...hoverKeyProps(key)}
                  {...toolbarChipProps(on)}
                  data-testid="pipelines-preview-color-percent" />
            {keyHover?.key === key && keyHover.el?.isConnected && (
                <KeyPopper anchorEl={keyHover.el} keyName={key}
                           pinned={!!keyHover.pinned} testid="pipelines-preview-color-help">
                    <KeyGroup title={keyTitle} first>
                        {previewLegend().map((e) => (
                            <LegendWord key={e.key} color={e.color} label={e.label} />))}
                    </KeyGroup>
                </KeyPopper>
            )}
        </>
    );
}
