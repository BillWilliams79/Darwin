// PreviewProgressHelp.jsx — the help for the Pipelines cards' preview colours
// (req #4196; it was the Progress on/off button of req #4063 / #4184).
// The preview is always coloured by progress; there is no toggle. What stays is the
// help: a small "?" icon whose hover popup explains the bead colours — the plan
// visualizer's own popup (`KeyPopper`, `useKeyHelp`), not a copy. A long press PINS
// it until Escape or a press elsewhere.

import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import { useKeyHelp } from '../SwarmView/pipelines/PipelinePlanToolbar';
import { KeyGroup, KeyPopper, LegendWord } from '../SwarmView/pipelines/PlanKeyPopper';
import { PROGRESS_HELP, previewLegend } from './previewColor';

export default function PreviewProgressHelp() {
    const [keyHover, setKeyHover] = useState(null);
    const hoverKeyProps = useKeyHelp(setKeyHover);
    const { key, label, tip, keyTitle } = PROGRESS_HELP;
    return (
        <>
            {/* No Tooltip: the popup below is the explanation; two overlays on
                one control would fight (the plan toolbar's rule). */}
            <IconButton size="small" aria-label={`${label} — ${tip}`}
                        {...hoverKeyProps(key)}
                        data-testid="pipelines-preview-progress-help-button">
                <HelpOutlineIcon fontSize="small" />
            </IconButton>
            {keyHover?.key === key && keyHover.el?.isConnected && (
                <KeyPopper anchorEl={keyHover.el} keyName={key}
                           pinned={!!keyHover.pinned} testid="pipelines-preview-progress-help">
                    <KeyGroup title={keyTitle} first>
                        {previewLegend().map((e) => (
                            <LegendWord key={e.key} color={e.color} label={e.label} />))}
                    </KeyGroup>
                </KeyPopper>
            )}
        </>
    );
}
