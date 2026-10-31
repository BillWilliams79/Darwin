// Telemetry-anchor control for the Swarm Starts / Swarm Completes Stats views
// (req #4107). Req #4095 moved the token anchor to the skill invocation, so the
// two series differ by the skill-load turns; this control makes the cutover
// visible — All / New anchor / Legacy, each with its row count — and the view
// aggregates only the selected rows. The rule that classifies a row lives in
// `utils/phaseTelemetry.js` (`parseInvocationAnchor`), not here.

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { ANCHOR_ALL, ANCHOR_NEW, ANCHOR_LEGACY } from '../utils/phaseTelemetry';

const OPTIONS = [
    { value: ANCHOR_ALL,    label: 'All' },
    { value: ANCHOR_NEW,    label: 'New anchor' },
    { value: ANCHOR_LEGACY, label: 'Legacy' },
];

export default function AnchorFilterToggle({ value, counts, onChange, testIdPrefix }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2 }}
             data-testid={`${testIdPrefix}-anchor-filter`}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Telemetry anchor
            </Typography>
            <ToggleButtonGroup
                value={value}
                exclusive
                size="small"
                onChange={(_e, v) => { if (v) onChange(v); }}
            >
                {OPTIONS.map(o => (
                    <ToggleButton key={o.value} value={o.value}
                                  sx={{ px: 1.25, py: 0.25, fontSize: '0.7rem' }}
                                  data-testid={`${testIdPrefix}-anchor-${o.value}`}>
                        {o.label} ({counts[o.value] ?? 0})
                    </ToggleButton>
                ))}
            </ToggleButtonGroup>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                New anchor counts the skill-load turns (req #4095) — don't compare across the two.
            </Typography>
        </Box>
    );
}
