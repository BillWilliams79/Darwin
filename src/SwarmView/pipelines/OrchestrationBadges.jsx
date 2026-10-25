// OrchestrationBadges.jsx — circular orchestration badges: green the lead,
// orange a subscriber, the platform printed inside (req #3809).
//
// User directive: "Green master, Orange secondary — Mac or WSL inside". They
// sat beside the plan's name in the pipeline header until req #3908 removed
// them there (the Engine on/off control replaces them); the engine panel's
// Location section still draws its machine with this component.

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

import { BADGE_LEAD, BADGE_SUBSCRIBER } from './orchestrationHolder';

export const BADGE_SIZE = 30;
const BADGE_GAP_PX = 4;      // the group's `gap: 0.5`

// Filled and solid, so the tone reads at a glance on a dark surface; each
// label colour clears WCAG AA against its own fill.
const TONE_SX = {
    [BADGE_LEAD]: { bgcolor: '#2e7d32', color: '#fff', border: '1px solid #2e7d32' },
    [BADGE_SUBSCRIBER]: { bgcolor: '#f57c00', color: '#000', border: '1px solid #f57c00' },
};
// Stale: the orchestrator is gone, so the badge is an outline only.
const STALE_SX = { bgcolor: 'transparent', color: 'text.secondary', border: '1px dashed', borderColor: 'text.disabled' };

export default function OrchestrationBadges({ badges }) {
    if (!badges || badges.length === 0) return null;
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: `${BADGE_GAP_PX}px`, flexShrink: 0 }}
             data-testid="pipeline-orchestration-badges">
            {badges.map((b) => (
                <Tooltip key={b.key} title={b.title}>
                    <Box
                        role="img"
                        aria-label={b.title}
                        data-testid={`pipeline-orchestration-badge-${b.key}`}
                        data-tone={b.tone}
                        sx={{
                            width: BADGE_SIZE, height: BADGE_SIZE, borderRadius: '50%',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            boxSizing: 'border-box', flexShrink: 0,
                            fontSize: b.text.length > 3 ? '0.55rem' : '0.65rem',
                            fontWeight: 700, lineHeight: 1, letterSpacing: 0,
                            userSelect: 'none',
                            ...(TONE_SX[b.tone] || STALE_SX),
                        }}>
                        {b.text}
                    </Box>
                </Tooltip>
            ))}
        </Box>
    );
}
