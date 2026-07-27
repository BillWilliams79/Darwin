// PipelineCardsView.jsx — the Cards half of /swarm/pipelines (req #3114).
//
// One card per pipeline: title, status chip, machine, step count and the
// done/running/pending mini-summary. Every number on a card is DERIVED from the
// same four bounded list reads the detail page uses (design rule 1: no step
// carries a hand-set state; design rule 5: no per-pipeline fetch). Cards carry no
// session data (design rule 9).

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { pipelineStatusChipProps } from './pipelineChipStyles';
import { machineTitle } from './pipelineViewModel';

const EMPTY_SUMMARY = { total: 0, done: 0, running: 0, pending: 0 };

export default function PipelineCardsView({ pipelines, summaries, machines, onOpen,
    filtered = false }) {
    if (!pipelines.length) {
        // "No pipelines yet" is a claim about the DATA, and it is false whenever
        // a status filter is what emptied the view — the page's own accounting
        // line says "0 of 2" two inches above it. Distinguish the two; an empty
        // result the user caused should say so, and say how to undo it.
        return (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 3 }}
                        data-testid="pipelines-cards-empty">
                {filtered
                    ? 'No pipelines match this status filter — choose All to see them.'
                    : 'No pipelines yet.'}
            </Typography>
        );
    }

    return (
        <Box className="card" data-testid="pipelines-cards-view">
            {pipelines.map((p) => {
                const s = summaries.get(p.id) || EMPTY_SUMMARY;
                const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
                return (
                    <Card key={p.id} variant="outlined" data-testid={`pipeline-card-${p.id}`}>
                        <CardActionArea onClick={() => onOpen(p.id)}>
                            <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start',
                                            gap: 1, mb: 1 }}>
                                    <Typography variant="subtitle1" sx={{ flex: 1,
                                                                          fontWeight: 600 }}>
                                        {p.title}
                                    </Typography>
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
                                </Stack>

                                {/* Progress is the done fraction of a derived state —
                                    never a stored percentage. */}
                                <LinearProgress variant="determinate" value={pct}
                                                sx={{ height: 6, borderRadius: 3, mb: 1 }} />
                                <Typography variant="caption" color="text.secondary"
                                            data-testid={`pipeline-card-summary-${p.id}`}>
                                    {s.done} complete · {s.running} running ·{' '}
                                    {s.pending} scheduled
                                </Typography>
                            </CardContent>
                        </CardActionArea>
                    </Card>
                );
            })}
        </Box>
    );
}
