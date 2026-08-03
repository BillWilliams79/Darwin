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
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { pipelineStatusChipProps } from './pipelineChipStyles';
import { machineTitle, pipelinesEmptyMessage } from './pipelineViewModel';
import { claimForPipeline, holderView } from './orchestrationHolder';

const EMPTY_SUMMARY = { total: 0, done: 0, running: 0, pending: 0 };

export default function PipelineCardsView({ pipelines, summaries, reqCounts,
    showReqCounts = false, machines, claims = [], onOpen, lastOpenedId = null,
    hiddenStatusCounts = [] }) {
    if (!pipelines.length) {
        // "No pipelines yet" is a claim about the DATA, and it is false whenever
        // a status filter is what emptied the view — the page's own accounting
        // line says "0 of 2" two inches above it. Distinguish the two; an empty
        // result the user caused should say so, and name WHICH statuses it hid
        // (req #3220) rather than pointing at a since-removed "All" chip.
        return (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 3 }}
                        data-testid="pipelines-cards-empty">
                {pipelinesEmptyMessage(hiddenStatusCounts)}
            </Typography>
        );
    }

    return (
        <Box className="card" data-testid="pipelines-cards-view">
            {pipelines.map((p) => {
                const s = summaries.get(p.id) || EMPTY_SUMMARY;
                const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
                // req #3224 — the whole-plan reservation, if one is held.
                const holder = holderView(claimForPipeline(claims, p.id), machines);
                // req #3225 — behind the shared toggle. `pipelineRequirementCounts`
                // sets an entry for EVERY pipeline, even {met:0,total:0}. Contrast
                // the per-epic buckets, which `requirementCounts` (pipelineModel.js)
                // builds lazily and leaves absent for an epic with no counted
                // requirement — pipelinePlanLayout.js's `epicBandLabelText`
                // degrades that miss to the plain name. So a plan legitimately
                // shows "0/0" rather than the name alone: at the plan level, "no
                // counted requirements" IS an answer, not a missing one.
                const counts = showReqCounts ? reqCounts?.get(p.id) : null;
                // req #3311 — "remember my last selected pipeline". The mark is
                // the visible half of that memory: a reader who comes back to
                // this list should be able to SEE which plan they were working
                // on, not merely have it recorded somewhere. It is deliberately
                // an ACCENT and not a selection state — the card is still a plain
                // link, nothing is pre-selected, and the browser's Back is
                // untouched.
                const lastViewed = p.id === lastOpenedId;
                return (
                    <Card key={p.id} variant="outlined" data-testid={`pipeline-card-${p.id}`}
                          sx={lastViewed ? {
                              borderColor: 'primary.main',
                              // The border is what carries the mark on a card
                              // whose chips are already carrying status, machine
                              // and holder. A second colour fill would compete
                              // with the status chip, which is the one thing on a
                              // card that MUST read first.
                              boxShadow: (theme) => `0 0 0 1px ${theme.palette.primary.main}`,
                          } : undefined}>
                        <CardActionArea onClick={() => onOpen(p.id)}>
                            <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start',
                                            gap: 1, mb: 1 }}>
                                    {/* `minWidth: 0` so the title ABSORBS the
                                        mark's width instead of being pushed
                                        into an extra wrapped line by it. A flex
                                        item defaults to `min-width: auto` —
                                        "never below your content" — and cards
                                        share a grid row, so one card growing
                                        taller grows the whole row. */}
                                    <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0,
                                                                          fontWeight: 600 }}>
                                        {p.title}
                                        {counts ? ` ${counts.met}/${counts.total}` : ''}
                                    </Typography>
                                    {lastViewed && (
                                        <Chip size="small" color="primary" variant="outlined"
                                              label="Last viewed" sx={{ flexShrink: 0 }}
                                              data-testid={`pipeline-card-lastviewed-${p.id}`} />
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
                                    {/* req #3224 — a card says WHO is
                                        orchestrating this plan and from where,
                                        so a user can tell it is running on the
                                        other machine without leaving the page.
                                        Absent when nobody holds it: an empty
                                        chip would be a claim, not a blank. */}
                                    {holder && (
                                        <Tooltip title={holder.title}>
                                            <Chip size="small"
                                                  color={holder.stale ? 'warning' : 'success'}
                                                  variant={holder.stale ? 'outlined' : 'filled'}
                                                  label={holder.label}
                                                  data-testid={`pipeline-card-holder-${p.id}`} />
                                        </Tooltip>
                                    )}
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
