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
// req #4169 — a badge carrying a machine `color` is filled with it; the letter
// takes black or white, whichever contrasts more.
function inkFor(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.179 ? '#000' : '#fff';
}
const STALE_SX = { bgcolor: 'transparent', color: 'text.secondary', border: '1px dashed', borderColor: 'text.disabled' };

// `size`, `fontSize` and the test ids are the pipelines card's (req #3973): a
// smaller badge with one larger letter, M or W.
export default function OrchestrationBadges({ badges, size = BADGE_SIZE, fontSize,
    testId = 'pipeline-orchestration-badges', badgeTestIdPrefix = 'pipeline-orchestration-badge' }) {
    if (!badges || badges.length === 0) return null;
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: `${BADGE_GAP_PX}px`, flexShrink: 0 }}
             data-testid={testId}>
            {badges.map((b) => (
                <Tooltip key={b.key} title={b.title}>
                    <Box
                        role="img"
                        aria-label={b.title}
                        data-testid={`${badgeTestIdPrefix}-${b.key}`}
                        data-tone={b.tone}
                        sx={{
                            width: size, height: size, borderRadius: '50%',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            boxSizing: 'border-box', flexShrink: 0,
                            fontSize: fontSize || (b.text.length > 3 ? '0.55rem' : '0.65rem'),
                            fontWeight: 700, lineHeight: 1, letterSpacing: 0,
                            userSelect: 'none',
                            ...(TONE_SX[b.tone] || STALE_SX),
                            ...(b.color && b.tone !== 'stale' && {
                                bgcolor: b.color, color: inkFor(b.color), border: `1px solid ${b.color}`,
                            }),
                            ...(b.color && b.tone === 'stale' && { borderColor: b.color, color: b.color }),
                        }}>
                        {b.text}
                    </Box>
                </Tooltip>
            ))}
        </Box>
    );
}
