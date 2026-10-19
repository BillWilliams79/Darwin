// RequirementColorKeyLegend.jsx — the Requirements page's colour key (req
// #3644): what each requirement's text colour MEANS under one scale.
//
// A HOVER POP, not a band (user directive: the key "is consuming a band of the
// screen vertically. let's make it a hover pop"). `ReqColorKeyControl` renders
// it inside a Popper under the Color chip being hovered, so it names the scale
// the reader is pointing at — which need not be the active one, and that is
// how a reader previews a scale before choosing it.
//
// The entries are the scale's own legend (`reqIdKeyEntries`, every value the
// scale can paint — req #3621), built over NO rows, so the key never depends on
// which requirements a card happens to hold.

import { useMemo } from 'react';
import Box from '@mui/material/Box';

import { REQ_CARD_MONO, REQ_CARD_THEME as T, requirementColorViews,
    requirementKeyLegend } from './requirementCardTheme';

/** @param {{colorKey: string}} props  the scale to key (a REQUIREMENT_COLOR_KEYS value) */
export default function RequirementColorKeyLegend({ colorKey }) {
    const legend = useMemo(
        () => requirementKeyLegend({ colorKey, views: requirementColorViews() }),
        [colorKey]);
    if (!legend) return null;
    return (
        <Box data-testid="swarm-req-color-legend"
             sx={{ display: 'flex', flexDirection: 'column', gap: 0.6,
                   minWidth: 150, px: 1.5, py: 1.1,
                   bgcolor: T.panel, border: `1px solid ${T.line}`,
                   borderRadius: '10px', fontFamily: REQ_CARD_MONO,
                   fontSize: '0.78rem', color: T.text,
                   boxShadow: '0 10px 28px rgba(0, 0, 0, 0.45)' }}>
            <Box component="span" sx={{ color: T.dim, textTransform: 'uppercase',
                                        letterSpacing: '0.08em', fontSize: '0.68rem', mb: 0.25 }}>
                {legend.title}
            </Box>
            {legend.entries.map((e) => (
                <Box key={e.key} component="span"
                     data-testid={`swarm-req-color-legend-${e.key}`}
                     sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box component="span"
                         sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: e.color,
                               flexShrink: 0 }} />
                    <Box component="span" sx={{ color: e.color, fontWeight: 600 }}>{e.label}</Box>
                </Box>
            ))}
        </Box>
    );
}
