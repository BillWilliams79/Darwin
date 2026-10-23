// OrchestrationBadges.jsx — who is orchestrating this plan, as circular badges
// beside its name (req #3809).
//
// User directive: "a circular badge to the right of your pipeline name — Green
// master, Orange secondary — Mac or WSL inside"; req #3820 moved the group to
// the LEFT of the name and cut the tooltip to "Mac Mini is the master.
// Orchestrating for 2h 05m". The derivation (one badge per
// machine, which tone, the tooltip sentence) is `orchestrationBadges` in
// orchestrationHolder.js; this file only draws it.

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

import { BADGE_LEAD, BADGE_SUBSCRIBER } from './orchestrationHolder';

export const BADGE_SIZE = 30;
const BADGE_GAP_PX = 4;      // the group's `gap: 0.5`
const SLOT_GAP_PX = 8;       // the title slot's `gap: 1`, between group and name

/** The px the badge group adds to the title slot — 0 when it draws nothing. */
export function orchestrationBadgesWidth(count) {
    if (!count) return 0;
    return SLOT_GAP_PX + count * BADGE_SIZE + (count - 1) * BADGE_GAP_PX;
}

// Filled and solid, so the tone reads at a glance on the dark header; each
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
