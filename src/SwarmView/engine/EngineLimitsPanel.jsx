// EngineLimitsPanel.jsx — the slots an engine schedules into (rule R8):
// ceiling, live sessions, reserved (announced, not yet landed) and free
// (req #3760). Null members mean capacity was unknown that cycle, and the
// panel says so rather than drawing zeros.

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { DEFAULT_PLAN_PALETTE, planPalette } from '../pipelines/pipelinePlanLayout';
import { PanelTitle } from './enginePanelParts';

const S = planPalette(DEFAULT_PLAN_PALETTE).status;
const SEGMENTS = [
    { key: 'live', label: 'live', color: S.development, words: 'sessions running on this machine' },
    { key: 'reserved', label: 'reserved', color: S.swarm_ready,
        words: 'announced by an engine on this machine, not yet started' },
    { key: 'free', label: 'free', color: S.met, words: 'slots this cycle could fill' },
];

export default function EngineLimitsPanel({ engine, limits, source }) {
    const l = limits || {};
    const known = l.ceiling != null && l.live != null;
    const ceiling = Math.max(l.ceiling || 0, (l.live || 0) + (l.reserved || 0) + (l.free || 0), 1);
    return (
        <Box data-testid={`engine-limits-${engine.id}`}>
            <PanelTitle>Limits{source ? ` · ${source}` : ''}</PanelTitle>
            {!known ? (
                <Typography variant="body2" color="error" data-testid={`engine-limits-unknown-${engine.id}`}>
                    Capacity unknown this cycle — the ceiling or the live count could not be read,
                    so nothing is admitted.
                </Typography>
            ) : (
                <>
                    <Box sx={{ display: 'flex', height: 12, borderRadius: 1, overflow: 'hidden',
                               bgcolor: 'action.hover', mb: 0.75 }}>
                        {SEGMENTS.map((s) => (l[s.key] ? (
                            <Tooltip key={s.key} title={`${l[s.key]} ${s.label} — ${s.words}`}>
                                <Box sx={{ width: `${(100 * l[s.key]) / ceiling}%`, bgcolor: s.color }} />
                            </Tooltip>
                        ) : null))}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <Typography variant="body2" data-testid={`engine-limit-ceiling-${engine.id}`}>
                            ceiling <b>{l.ceiling}</b>
                        </Typography>
                        {SEGMENTS.map((s) => (
                            <Typography key={s.key} variant="body2"
                                        data-testid={`engine-limit-${s.key}-${engine.id}`}>
                                <Box component="span" sx={{ display: 'inline-block', width: 8, height: 8,
                                    borderRadius: '50%', bgcolor: s.color, mr: 0.5 }} />
                                {s.label} <b>{l[s.key] ?? '—'}</b>
                            </Typography>
                        ))}
                    </Box>
                </>
            )}
        </Box>
    );
}
