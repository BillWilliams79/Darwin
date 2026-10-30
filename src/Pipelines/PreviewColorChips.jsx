// PreviewColorChips.jsx — the buttons that choose what colours the beads of the
// Pipelines cards' previews (req #4063).
// One choice for the whole page (a preview per card is the same picture at the
// same scale, and a per-card setting would make two cards unreadable side by
// side). Lit chip = the active mode; clicking it again returns to the default
// (Progress), the way the plan toolbar's colour chips return to "none".
//
// THE COLOUR HELP IS THE PLAN VISUALIZER'S (user, req #4063: "the color help
// should work like the color buttons in the pipeline visualizer"): each chip
// explains ITSELF in a hover popup under it — active or not — a long press PINS
// it until Escape or a chip press, and the popup is the visualizer's own
// (`KeyPopper`, `useKeyHelp`), not a copy. There is no standing key beside the
// chips.

import { useState } from 'react';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { toolbarChipProps } from '../SwarmView/pipelines/pipelineChipStyles';
import { PLAN_VIZ_PALETTE as P } from '../SwarmView/pipelines/pipelinePlanLayout';
import { useKeyHelp } from '../SwarmView/pipelines/PipelinePlanToolbar';
import { KeyGroup, KeyPopper, LegendWord } from '../SwarmView/pipelines/PlanKeyPopper';
import {
    DEFAULT_PREVIEW_COLOR, FLAGS_MODE, PREVIEW_COLOR_MODES, previewLegend,
} from './previewColor';

// The Flags mode's ring words — the epic colour, in the order the plan's own
// key states them (locked outranks manual outranks barrier).
const FLAG_WORDS = [
    [P.lockedFrame, 'Locked'], [P.epicManual, 'Manual'],
    [P.epicBarrier, 'Barrier'], [P.epicWillRun, 'Will run'],
];

export default function PreviewColorChips({ mode, onChange, machines = [], sessionsKnown = true }) {
    const [keyHover, setKeyHover] = useState(null);
    const hoverKeyProps = useKeyHelp(setKeyHover);
    const helpMode = keyHover && PREVIEW_COLOR_MODES.find((m) => m.key === keyHover.key);
    const entries = helpMode && helpMode.key !== FLAGS_MODE
        ? previewLegend(helpMode.key, machines, { sessionsKnown })
        : null;
    return (
        <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
               sx={{ flexWrap: 'wrap', rowGap: 0.75 }}
               data-testid="pipelines-preview-color">
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                Preview colour
            </Typography>
            {/* No Tooltip: the colour help below explains the chip, and two
                overlays on one chip would fight (the plan toolbar's rule). */}
            {PREVIEW_COLOR_MODES.map(({ key, label, tip }) => {
                const on = mode === key;
                return (
                    <Chip key={key} label={label}
                          aria-label={`${label} — ${tip}`}
                          onClick={() => onChange(on ? DEFAULT_PREVIEW_COLOR : key)}
                          {...hoverKeyProps(key)}
                          {...toolbarChipProps(on)}
                          data-testid={`pipelines-preview-color-${key}`} />
                );
            })}
            {helpMode && keyHover.el?.isConnected && (
                <KeyPopper anchorEl={keyHover.el} keyName={helpMode.key}
                           pinned={!!keyHover.pinned} testid="pipelines-preview-color-help">
                    <KeyGroup title={helpMode.keyTitle} first>
                        {entries
                            ? entries.map((e) => (
                                <LegendWord key={e.key} color={e.color} label={e.label} />))
                            : FLAG_WORDS.map(([color, label]) => (
                                <LegendWord key={label} color={color} label={label} />))}
                    </KeyGroup>
                </KeyPopper>
            )}
        </Stack>
    );
}
