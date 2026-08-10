// Pipelines2Page.jsx — /swarm/pipelines2, the Pipeline 2.0 plan list (req #3463).
//
// ── THIS PAGE IS THE 2.0 ID PRODUCER, AND THAT IS WHY IT EXISTS ────────────
// req #3381 shipped a 2.0 CONSUMER — the plan detail page reading
// `pipeline2_compose` — with no 2.0 producer anywhere in the app. Every surface
// that could emit a plan id still emitted a 1.0 one, the id spaces are disjoint
// and nothing translates between them, so the set of ids that could REACH the
// page and the set the page could ANSWER had an empty intersection: production
// went down on every plan (req #3462).
//
// So the rule this page satisfies: A 2.0 CONSUMER MAY ONLY GO LIVE BEHIND A 2.0
// PRODUCER, IN THE SAME DEPLOY. `/swarm/pipeline2/:id` is reachable because this
// list reaches it, and it is reachable ONLY from here — `planEra.js` binds the
// route to the table, so a row of `pipeline2_pipelines` cannot be linked
// anywhere else.
//
// ── DELIBERATELY THIN, AND THIS IS NOT AN OVERSIGHT ────────────────────────
// The full-featured 2.0 plan-layer editors — `execution_mode`, the description
// dialog, `epic_status` pause/unpause, `sort_order`, the step controls — are req
// #3393's, which is a live requirement with its own session. Building a second
// copy of them here would collide with it and leave two pages to reconcile.
// What this page owes is a reachable, honest list: which plans exist, what state
// they are in, and a way in. When #3393 lands its editors, this page is either
// where they land or it is deleted in favour of the page that has them — either
// way nothing here has to be unwound.
//
// It is NOT a copy of `PipelinesPage.jsx` (view switching, chip filters, scroll
// memory, the resume gate, orchestration holders). Those are answers to
// questions a reader only asks of a list they use every day, and the 2.0 list
// has ONE row in production today.

import { useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import AuthContext from '../../Context/AuthContext';
import { useAllPipeline2Pipelines } from '../../hooks/useDataQueries';
import { formatDateTime } from '../../utils/dateFormat';
import { pipelineStatusChipProps } from './pipelineChipStyles';
import { prunePipelineStorage } from './pipelinePlace';
import { PLAN_ERA_2, planDetailPath, planEraLabel } from './planEra';

// The era of this page, stated ONCE — the same constant-not-a-prop discipline
// `PipelinesPage.jsx` uses, and for the same reason: the read this page makes
// and the route it links to are one choice, not two.
const PAGE_ERA = PLAN_ERA_2;

const NOWRAP = { whiteSpace: 'nowrap' };

export default function Pipelines2Page() {
    const navigate = useNavigate();
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: pipelines = [], isLoading, isError } =
        useAllPipeline2Pipelines(creatorFk);

    const open = (id) => {
        const to = planDetailPath(PAGE_ERA, id);
        if (to) navigate(to);
    };

    // req #3463 (code review) — THE 2.0 HALF OF THE SWEEP. `prunePipelineStorage`
    // is era-scoped precisely so the 1.0 list cannot delete 2.0 plans' cameras
    // and scroll offsets — but scoping it also means the 2.0 keys are swept by
    // nobody unless this page does it, and every
    // `darwin-viewport-pipeline2-plan-*` key would outlive its plan for the life
    // of the browser profile. This is the same call `PipelinesPage.jsx` makes,
    // with this page's own era and this page's own liveness read.
    //
    // GATED ON A SETTLED READ: an empty `pipelines` is "no plans exist" and "the
    // plans have not arrived yet" at once, and acting on the second wipes every
    // position the reader has. `prunePipelineStorage` refuses an empty live set
    // for that reason; the `isSuccess`/`!isError` gate here is the caller's half
    // of the same argument.
    useEffect(() => {
        if (isLoading || isError || pipelines.length === 0) return;
        prunePipelineStorage(pipelines.map((p) => p.id), PAGE_ERA);
    }, [isLoading, isError, pipelines]);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3 }} data-testid="pipelines2-page">
            <Typography variant="h6" sx={{ mb: 0.5 }}>
                Pipeline {planEraLabel(PAGE_ERA)} Plans
            </Typography>
            <Typography variant="caption" color="text.secondary"
                        sx={{ display: 'block', mb: 2 }}>
                {/* NAMED, not implied. Two plan surfaces are live at once and
                    their ids are disjoint, so a reader who does not know which
                    one they are looking at cannot read a plan number. */}
                Reading <code>pipeline2_pipelines</code>. Pipeline 1.0 plans are a
                separate list with separate ids — nothing translates between them.
            </Typography>

            {isError && (
                // A FAILED READ IS NOT AN EMPTY LIST (req #3463). `fetchEntity`
                // turns a 404 into `[]` and a 5xx leaves `data` undefined, so
                // without this banner a broken read renders as "no plans yet" —
                // the exact conflation that let req #3462 pass verification.
                <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
                       data-testid="pipelines2-error">
                    <AlertTitle>The Pipeline 2.0 plan list failed to load</AlertTitle>
                    This is a failed READ, not an empty table — do not read the rows
                    below (or their absence) as the state of the plan layer.
                </Alert>
            )}

            {!isError && pipelines.length === 0 && (
                <Alert severity="info" variant="outlined" sx={{ mb: 2 }}
                       data-testid="pipelines2-empty">
                    <AlertTitle>No Pipeline 2.0 plans exist</AlertTitle>
                    The read succeeded and <code>pipeline2_pipelines</code> is empty.
                    On a dev server this is what an unseeded database looks like —
                    run <code>scripts/db/seed-pipeline2-dev.py</code> before reviewing
                    any 2.0 page against it.
                </Alert>
            )}

            {pipelines.length > 0 && (
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small" data-testid="pipelines2-table">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={NOWRAP}>Id</TableCell>
                                <TableCell>Title</TableCell>
                                <TableCell sx={NOWRAP}>Status</TableCell>
                                <TableCell sx={NOWRAP}>Execution</TableCell>
                                <TableCell sx={NOWRAP}>Started</TableCell>
                                <TableCell sx={NOWRAP}>Completed</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {pipelines.map((p) => (
                                <TableRow key={p.id} hover
                                          data-testid={`pipelines2-row-${p.id}`}>
                                    <TableCell sx={{ ...NOWRAP, fontFamily: 'monospace' }}>
                                        <Link component="button" variant="body2"
                                              onClick={() => open(p.id)}
                                              data-testid={`pipelines2-open-${p.id}`}>
                                            {p.id}
                                        </Link>
                                    </TableCell>
                                    <TableCell>{p.title}</TableCell>
                                    <TableCell sx={NOWRAP}>
                                        <Chip size="small"
                                              {...pipelineStatusChipProps(p.pipeline_status)}
                                              label={p.pipeline_status} />
                                    </TableCell>
                                    <TableCell sx={NOWRAP}>{p.execution_mode}</TableCell>
                                    <TableCell sx={NOWRAP}>
                                        {p.started_at ? formatDateTime(p.started_at, timezone) : '—'}
                                    </TableCell>
                                    <TableCell sx={NOWRAP}>
                                        {p.completed_at ? formatDateTime(p.completed_at, timezone) : '—'}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
}
