// PipelinesCardsView.jsx — the Cards view of /swarm/pipelines (req #3393).
//
// Adapted from `Darwin/src/SwarmView/pipelines/PipelineCardsView.jsx`, not
// imported: the two eras share no COMPONENT (PLAN.md's file-isolation rule),
// but this one reuses several of that file's own dependencies directly —
// `pipelineStatusChipProps`, `machineTitle`, `pipelinesEmptyMessage`,
// `claimForPipeline`/`holderView` — because those are pure, era-agnostic
// vocabulary functions, and req #3463 already established importing them
// straight from the 1.0 files as the convention rather than duplicating them.
//
// Differences from the 1.0 card, both schema-driven:
//   - execution_mode chip (parallel|serial, req #3388) — a field 1.0 cards
//     never show, since it has no equivalent read anywhere else either.
//
// ── COMPLETENESS IS MEASURED ON REQUIREMENTS, NOT ON STEPS (req #3365) ──────
// User directive: *"let's just drop deriving and showing the step value and
// place our level of completeness on requirements for now … requirements have
// meaning and actual status values."*
//
// The card used to draw a two-state done/open bar over STEPS, counted by
// `if (step.completed_at)`. That is not a state a step reliably has:
// `pipeline_steps` carries no status column at all (verified — its ten columns
// are id, epic_fk, title, notes, run, not_before, completed_at, create_ts,
// update_ts, creator_fk), a step's state is DERIVED from its requirements on
// every read (design rule 1), and `completed_at` is stamped only where a step
// has NO gating requirements. Measured on plan 7: **0 of 71 steps carried
// one**, so the card read "0 complete · 71 open" for a plan whose real state
// was 49 done / 21 pending / 1 running.
//
// A REQUIREMENT'S STATUS IS STORED, so counting it is a join rather than a
// derivation — `pipelineRequirementCounts` needs no engine, no second
// implementation of design rule 1, and cannot drift from the server's answer
// because it is not answering the same question. The step COUNT stays on the
// card (a count is honest); only the step STATE is gone.

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
import { claimForPipeline, holderView } from '../SwarmView/pipelines/orchestrationHolder';
import PipelinePlanThumbnail from './PipelinePlanThumbnail';

const EMPTY_SUMMARY = { total: 0, done: 0, open: 0 };

// `lastOpenedId` is GONE (req #3365 user directive — "Remove 'last viewed'
// entirely"). It drove a chip in the title row AND a primary-coloured border
// on the whole card; both are removed, so the prop is dropped rather than left
// accepted-and-ignored. The RESUME behaviour it decorated is untouched —
// `pipelinePlace.js` still records the plan and `/swarm/pipelines` still
// redirects to it; what is gone is the card advertising which one it was.
export default function PipelinesCardsView({ pipelines, summaries, reqCounts,
    showReqCounts = false, machines, claims = [], onOpen,
    hiddenStatusCounts = [] }) {
    if (!pipelines.length) {
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
                const holder = holderView(claimForPipeline(claims, p.id), machines);
                const counts = showReqCounts ? reqCounts?.get(p.id) : null;
                // Completeness is the REQUIREMENT tally now, not a step one.
                const pct = counts && counts.total
                    ? Math.round((counts.met / counts.total) * 100) : 0;
                return (
                    <Card key={p.id} variant="outlined" data-testid={`pipelines-card-${p.id}`}>
                        <CardActionArea onClick={() => onOpen(p.id)}>
                            <CardContent>
                                {/* THE TITLE IS THE PLAN'S NAME AND NOTHING ELSE
                                    (req #3365 user directive). It carried the
                                    requirement tally as a bare " 73/115" glued
                                    to the end, which read as part of the name;
                                    that number has moved to the accounting line
                                    at the foot of the card, where it sits with
                                    the bar that draws it. The status chip has
                                    moved DOWN into the pill row for the same
                                    reason — the row is now one uninterrupted
                                    line of plan facts instead of one fact
                                    stranded up here beside the title. */}
                                <Box sx={{ display: 'flex', alignItems: 'flex-start',
                                            gap: 1, mb: 1 }}>
                                    <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0,
                                                                          fontWeight: 600 }}>
                                        {p.title}
                                    </Typography>
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

                                {/* THE PLAN, DRAWN SMALL (req #3365 user
                                    directive). It sits directly under the name
                                    and description, ABOVE the pills (a second
                                    directive, which moved it up past them): the
                                    card reads top-down as identity → what it
                                    LOOKS like → what it is → how far along, so
                                    the picture answers "which plan is this?"
                                    while the eye is still on the title, and the
                                    pills and the bar below it are read as one
                                    block of plan facts rather than being split
                                    by the image. */}
                                <PipelinePlanThumbnail pipelineId={p.id}
                                                       machines={machines} />

                                <Stack direction="row" spacing={1} sx={{ mb: 1.5,
                                                                          flexWrap: 'wrap',
                                                                          rowGap: 1 }}>
                                    {/* STATUS LEADS THIS ROW (req #3365 user
                                        directive — "put the status chip in the
                                        same row as the pills"). First rather
                                        than appended: it is the only pill here
                                        that says what the plan is DOING, and
                                        the three after it are properties it
                                        has. `rowGap` above is not decoration —
                                        `Stack`'s `spacing` becomes a margin
                                        that does not apply between WRAPPED
                                        lines, so a fourth chip used to wrap
                                        flush against the row above it. */}
                                    <Chip size="small" label={p.pipeline_status}
                                          {...pipelineStatusChipProps(p.pipeline_status)}
                                          data-testid={`pipelines-card-status-${p.id}`} />
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
                                                  data-testid={`pipelines-card-holder-${p.id}`} />
                                        </Tooltip>
                                    )}
                                </Stack>

                                {/* THE ACCOUNTING LINE — requirements met, which
                                    is a STORED status, and the bar that draws
                                    the same number. See this file's header for
                                    why this is no longer a step tally.

                                    Rendered only when there is a tally to
                                    render: with no requirements seated on any
                                    step, `total` is 0 and a full-width empty
                                    bar over "0 of 0" claims a measurement
                                    nobody made. */}
                                {counts && counts.total > 0 && (
                                    <>
                                        <LinearProgress
                                            variant="determinate" value={pct}
                                            sx={{ height: 6, borderRadius: 3, mb: 1 }}
                                            aria-label={`${counts.met} of ${counts.total} `
                                                + 'requirements met'} />
                                        <Typography variant="caption" color="text.secondary"
                                                    data-testid={`pipelines-card-summary-${p.id}`}>
                                            {counts.met} of {counts.total} requirements met
                                        </Typography>
                                    </>
                                )}
                            </CardContent>
                        </CardActionArea>
                    </Card>
                );
            })}
        </Box>
    );
}
