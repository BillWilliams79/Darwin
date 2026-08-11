// Pipelines2CardsView.jsx — the Cards view of /swarm/pipelines2 (req #3393).
//
// Adapted from `Darwin/src/SwarmView/pipelines/PipelineCardsView.jsx`, not
// imported: the two eras share no COMPONENT (PLAN.md's file-isolation rule),
// but this one reuses several of that file's own dependencies directly —
// `pipelineStatusChipProps`, `machineTitle`, `pipelinesEmptyMessage`,
// `claimForPipeline2`/`holderView` — because those are pure, era-agnostic
// vocabulary functions, and req #3463 already established importing them
// straight from the 1.0 files as the convention rather than duplicating them.
//
// Differences from the 1.0 card, both schema-driven:
//   - execution_mode chip (parallel|serial, req #3388) — a field 1.0 cards
//     never show, since it has no equivalent read anywhere else either.
//   - The progress bar and mini-summary are TWO-STATE (done/open), not 1.0's
//     three-state done/running/pending — see pipeline2ViewModel.js's header
//     for why a third, unverified state is not fabricated here.

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import {
    pipelineStatusChipProps,
    executionModeChipProps,
    executionModeLabel,
} from '../SwarmView/pipelines/pipelineChipStyles';
import { machineTitle, pipelinesEmptyMessage } from '../SwarmView/pipelines/pipelineViewModel';
import { claimForPipeline2, holderView } from '../SwarmView/pipelines/orchestrationHolder';

const EMPTY_SUMMARY = { total: 0, done: 0, open: 0 };

export default function Pipelines2CardsView({ pipelines, summaries, reqCounts,
    showReqCounts = false, machines, claims = [], onOpen, lastOpenedId = null,
    hiddenStatusCounts = [] }) {
    if (!pipelines.length) {
        return (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 3 }}
                        data-testid="pipelines2-cards-empty">
                {pipelinesEmptyMessage(hiddenStatusCounts)}
            </Typography>
        );
    }

    return (
        <Box className="card" data-testid="pipelines2-cards-view">
            {pipelines.map((p) => {
                const s = summaries.get(p.id) || EMPTY_SUMMARY;
                const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
                const holder = holderView(claimForPipeline2(claims, p.id), machines);
                const counts = showReqCounts ? reqCounts?.get(p.id) : null;
                const lastViewed = p.id === lastOpenedId;
                return (
                    <Card key={p.id} variant="outlined" data-testid={`pipeline2-card-${p.id}`}
                          sx={lastViewed ? {
                              borderColor: 'primary.main',
                              boxShadow: (theme) => `0 0 0 1px ${theme.palette.primary.main}`,
                          } : undefined}>
                        <CardActionArea onClick={() => onOpen(p.id)}>
                            <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start',
                                            gap: 1, mb: 1 }}>
                                    <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0,
                                                                          fontWeight: 600 }}>
                                        {p.title}
                                        {counts ? ` ${counts.met}/${counts.total}` : ''}
                                    </Typography>
                                    {lastViewed && (
                                        <Chip size="small" color="primary" variant="outlined"
                                              label="Last viewed" sx={{ flexShrink: 0 }}
                                              data-testid={`pipeline2-card-lastviewed-${p.id}`} />
                                    )}
                                    <Chip size="small" label={p.pipeline_status}
                                          {...pipelineStatusChipProps(p.pipeline_status)} />
                                </Box>

                                {p.description && (
                                    <Typography variant="body2" color="text.secondary"
                                                sx={{ mb: 1.5,
                                                       display: '-webkit-box',
                                                       WebkitLineClamp: 2,
                                                       WebkitBoxOrient: 'vertical',
                                                       overflow: 'hidden' }}>
                                        {p.description}
                                    </Typography>
                                )}

                                <Stack direction="row" spacing={1} sx={{ mb: 1.5,
                                                                          flexWrap: 'wrap' }}>
                                    <Chip size="small" variant="outlined"
                                          label={machineTitle(p.machine_fk, machines)} />
                                    <Chip size="small" variant="outlined"
                                          label={`${s.total} step${s.total === 1 ? '' : 's'}`} />
                                    <Tooltip title={p.execution_mode === 'serial'
                                        ? 'Serial — one epic at a time, in sort_order'
                                        : 'Parallel — every epic runs at once'}>
                                        <Chip size="small"
                                              {...executionModeChipProps(p.execution_mode)}
                                              label={executionModeLabel(p.execution_mode)} />
                                    </Tooltip>
                                    {holder && (
                                        <Tooltip title={holder.title}>
                                            <Chip size="small"
                                                  color={holder.stale ? 'warning' : 'success'}
                                                  variant={holder.stale ? 'outlined' : 'filled'}
                                                  label={holder.label}
                                                  data-testid={`pipeline2-card-holder-${p.id}`} />
                                        </Tooltip>
                                    )}
                                </Stack>

                                {/* Two-state (done/open) — see this file's header
                                    for why a third "running" state is not shown. */}
                                <LinearProgress variant="determinate" value={pct}
                                                sx={{ height: 6, borderRadius: 3, mb: 1 }} />
                                <Typography variant="caption" color="text.secondary"
                                            data-testid={`pipeline2-card-summary-${p.id}`}>
                                    {s.done} complete · {s.open} open
                                </Typography>
                            </CardContent>
                        </CardActionArea>
                    </Card>
                );
            })}
        </Box>
    );
}
