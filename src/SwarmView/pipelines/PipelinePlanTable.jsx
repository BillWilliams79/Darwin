// PipelinePlanTable.jsx — THE PLAN-ROWS TABLE (req #3114), the product form of
// the POC's generate.py archived in req #3080.
//
// ── Why a plain <Table> and not a DataGrid ─────────────────────────────────
// memory/table-design.md makes DataGrid the default for tabular data, and the
// pipelines LIST page uses one. This table is the documented exception, for three
// reasons that are all the same reason:
//
//   1. The row order is not the user's to change. It is displayOrder()'s output —
//      topological, then absolute state bands, then execution streams — and
//      verifyOrder() self-checks it (design rule 3, which exists because four
//      ordering regressions shipped in one day). A sortable grid hands the user a
//      one-click way to produce an order the invariants forbid, with no way for
//      the renderer to object.
//   2. Launch-batch banner rows (design rule 8) are full-width rows that must sit
//      immediately above their members. A grid row is a record; a banner is not.
//   3. Epic/Feature render once per contiguous group — a property OF THE ORDER,
//      which re-sorting or filtering silently falsifies.
//
// Everything in table-design.md that still applies is applied: compact density,
// no cell wrap on the narrow columns, widths sized to the widest realistic value,
// a single flexible prose column, testids on every interactive element.
//
// ── No session data ────────────────────────────────────────────────────────
// Design rule 9: every mark here derives from requirements and the plan
// hierarchy. Session/phase detail belongs to the Swarm visualizer.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';

import { fmtCost, STEP_DONE, STEP_RUNNING } from './pipelineModel';
import {
    planRenderRows,
    rowMachineLabel,
    batchMachineLabel,
    formatTimeGates,
    stepName,
    stepDescription,
} from './pipelineViewModel';
import {
    stepStateLabel,
    stepStateChipProps,
    runLabel,
    runChipProps,
    ROW_ACCENT,
    BATCH_ACCENT,
    ELIGIBLE_MARKER_COLOR,
    // req #3226 — the SAME red the pause bubble/halo use, so "suppressed"
    // reads as one fact across every surface it appears on rather than three
    // coincidental reds.
    PAUSE_PAUSED_COLOR,
} from './pipelineChipStyles';

const NOWRAP = { whiteSpace: 'nowrap' };

// Column widths sized to the widest realistic value at compact density
// (table-design.md § "Column widths must fit content"): step ids run 4 digits,
// machine labels join two names, epic/feature titles run ~30 chars. Only the
// summary column flexes.
//
// `deps` fits a formatted wall-clock gate ("after Jul 23, 2026, 11:31 PM"), not
// just the three-id list — sizing it to the ids alone pushed the widest column in
// the table off-screen the moment a time gate appeared.
const COL = {
    step: 74,
    // The widest rendered chip is "Complete" + its check icon (not the
    // longer "Scheduled" text, which carries no icon) — down from 116 to 104
    // (req #3148 width audit). Table layout is the browser default (`auto`),
    // so this is a hint only: the column never shrinks below the chip's own
    // min-content width regardless of this number.
    status: 104,
    run: 132,
    machine: 148,
    cost: 96,
    epic: 190,
    feature: 170,
    // The step NAME (req #3119) — its own column, because a name and a
    // description answer different questions and the plan is skimmed by name.
    // Sized to the live plan's longest ("Guiding Principles and Data Refactor",
    // 36 chars) without flexing: a name column that reflows on content would
    // make the whole grid jump between plans.
    name: 210,
    reqs: 168,
    deps: 200,
};

// ── Violations banner (design rule 3) ───────────────────────────────────────
// The renderer refuses to ship a bad order SILENTLY. The POC raised SystemExit;
// a web page cannot, so it renders the failure at the top of the plan instead —
// loud, specific, and never dismissible. Exported: the Plan visualizer
// (req #3115) renders from the same computed order and owes the same loudness.
export function OrderViolationsAlert({ plan }) {
    const { violations = [], duplicateStepIds = [], unresolvedReqIds = [] } = plan;
    if (!violations.length && !duplicateStepIds.length && !unresolvedReqIds.length) return null;

    return (
        <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
               data-testid="pipeline-order-violations">
            <AlertTitle>Plan order failed its own invariant checks</AlertTitle>
            <Typography variant="body2" sx={{ mb: 1 }}>
                The rows below are rendered in the order the engine produced, but that order
                violates a rule the plan depends on. Treat the sequence as untrustworthy
                until this is resolved.
            </Typography>
            <Box component="ul" sx={{ pl: 3, m: 0 }}>
                {violations.map((v, i) => (
                    <li key={`${v.invariant}-${i}`}>
                        <Typography variant="body2">
                            <strong>{v.invariant}</strong>: {v.message}
                        </Typography>
                    </li>
                ))}
                {duplicateStepIds.length > 0 && (
                    <li>
                        <Typography variant="body2">
                            <strong>duplicate-id</strong>: step ids{' '}
                            {duplicateStepIds.join(', ')} appeared more than once in the read
                            and collapsed — the rendered plan is missing steps.
                        </Typography>
                    </li>
                )}
                {unresolvedReqIds.length > 0 && (
                    <li>
                        <Typography variant="body2">
                            <strong>unresolved-requirement</strong>: requirements{' '}
                            {unresolvedReqIds.join(', ')} are linked to a step but absent from
                            the requirements read. Any step linking them may show a state
                            lower than the truth.
                        </Typography>
                    </li>
                )}
            </Box>
        </Alert>
    );
}

// ── Condensation proposals (design rule 2) ──────────────────────────────────
// A SUGGESTION, never a block and never an automatic edit: merging steps is a
// plan mutation and the Primary AI owns plan mutations.
//
// The caller keys this on the proposal set so dismissing today's suggestion
// cannot swallow tomorrow's: React remounts the component when the key changes,
// resetting `dismissed`. Dismiss is "I've seen THIS", not "never show me any".
function CondensationAlert({ proposals }) {
    const [dismissed, setDismissed] = useState(false);
    if (!proposals.length || dismissed) return null;
    return (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}
               onClose={() => setDismissed(true)}
               data-testid="pipeline-condensation-proposals">
            <AlertTitle>
                {proposals.length === 1
                    ? 'One group of steps could be condensed'
                    : `${proposals.length} groups of steps could be condensed`}
            </AlertTitle>
            <Box component="ul" sx={{ pl: 3, m: 0 }}>
                {proposals.map((p) => (
                    <li key={p.stepIds.join('-')}>
                        <Typography variant="body2">{p.reason}</Typography>
                    </li>
                ))}
            </Box>
        </Alert>
    );
}

// ── Launch-batch banner row (design rule 8) ─────────────────────────────────
// Carries the batch letter, its member steps, its gate, and the EXACT one-line
// /swarm-start argument list — the launch unit is explicit, not implied by
// adjacency.
function BatchBannerRow({ batch, colSpan, timezone }) {
    // The REMAINING gate since req #3188 — the deps that are still open, which
    // every member shares. So the empty case is "nothing left", not "never had
    // one": a batch behind a Complete gate is launchable NOW, and printing the
    // dep that closed weeks ago read as something still holding it back.
    const gate = batch.gateStepIds.length
        ? `steps ${batch.gateStepIds.join(', ')}`
        : 'no remaining step gate';
    // Through the SAME formatter the Depends-on cell uses. This banner printed
    // the raw wire value — UTC, microseconds included — while the row eight lines
    // below showed the localized one, for the same instant.
    const timeGates = formatTimeGates(batch.timeDeps, timezone);
    return (
        <TableRow data-testid={`pipeline-batch-banner-${batch.letter}`}>
            <TableCell
                colSpan={colSpan}
                sx={{
                    bgcolor: BATCH_ACCENT.bg,
                    color: BATCH_ACCENT.color,
                    borderTop: BATCH_ACCENT.borderTop,
                    borderBottom: BATCH_ACCENT.borderBottom,
                    py: 0.75,
                    fontSize: '0.78rem',
                    letterSpacing: '0.03em',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <strong>LAUNCH BATCH {batch.letter}</strong>
                    <span>steps {batch.stepIds.join(' ')}</span>
                    <span>·</span>
                    <span>gate: {gate}</span>
                    {timeGates.map((t) => <span key={t}>· after {t}</span>)}
                    <span>·</span>
                    <span>{runLabel(batch.run)}</span>
                    <span>·</span>
                    <span>{batchMachineLabel(batch)}</span>
                    {batch.swarmStartCommand ? (
                        <Box
                            component="code"
                            sx={{ color: BATCH_ACCENT.codeColor, bgcolor: BATCH_ACCENT.codeBg,
                                   px: 0.75, py: 0.25, borderRadius: '3px',
                                   fontFamily: 'monospace' }}
                            data-testid={`pipeline-batch-command-${batch.letter}`}
                        >
                            {batch.swarmStartCommand}
                        </Box>
                    ) : (
                        <em>{batch.noLaunchReason
                            || 'no linked requirements — nothing to launch'}</em>
                    )}
                </Box>
            </TableCell>
        </TableRow>
    );
}

// ── Requirement(s) cell ─────────────────────────────────────────────────────
// Ids link to their own detail page and carry NO '#' (production directive).
//
// A TRACKING link renders dimmed and italic with a tooltip (req #3123). It is
// the answer to a question the table otherwise cannot answer: "this step links a
// requirement that is still in development — why is the step not Running?"
// Without the distinction the derivation looks broken to a reader who is right
// to check it. Kept to a style + tooltip on the existing link deliberately: no
// second chip, no new column, no new view.
function RequirementLinks({ row, pipelineId }) {
    if (!row.reqIds.length) return <span>—</span>;
    const tracking = new Set(row.trackingReqIds || []);
    return (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {row.reqIds.map((id) => {
                const isTracking = tracking.has(id);
                const link = (
                    <Link
                        key={id}
                        component={RouterLink}
                        to={`/swarm/requirement/${id}`}
                        // Provenance, so the detail page's Back returns to THIS plan
                        // rather than the Roadmap (req #3119).
                        state={pipelineId ? { from: 'pipeline', pipelineId } : undefined}
                        underline="hover"
                        sx={{
                            fontFamily: 'monospace',
                            ...(isTracking
                                ? { fontStyle: 'italic', opacity: 0.6 }
                                : null),
                        }}
                        data-testid={`pipeline-req-link-${id}`}
                        data-tracking={isTracking ? 'true' : undefined}
                    >
                        {id}
                    </Link>
                );
                return isTracking
                    ? (
                        <Tooltip
                            key={id}
                            title={`#${id} is a tracking container, not work — it holds `
                                + 'the plan, so this step is not gated on it and it is '
                                + 'not launched with the step (req #3123)'}
                        >
                            {link}
                        </Tooltip>
                    )
                    : link;
            })}
        </Box>
    );
}

// A label rendered once per contiguous group: the repeat rows keep the cell (so
// the grid stays aligned) but render nothing in it.
//
// `width` only, no maxWidth/ellipsis: `max-width` is not honoured on a table cell
// under the default `table-layout: auto`, so an ellipsis rule there expresses an
// intent the browser will not deliver. The TableContainer scrolls instead.
function GroupCell({ show, value, labels, width, color, testid }) {
    const text = show ? (value || '—') : '';
    const extra = show && labels && labels.length > 1
        ? labels.map((l) => l.title).join(' · ')
        : null;
    const cell = (
        <TableCell sx={{ ...NOWRAP, width, color, fontWeight: 600 }}
                   data-testid={testid}>
            {text}
        </TableCell>
    );
    // A step whose requirements span more than one epic/feature is legitimate
    // (design rule 10) — the dominant label renders, the full set is the tooltip.
    return extra ? <Tooltip title={`All: ${extra}`}>{cell}</Tooltip> : cell;
}

export default function PipelinePlanTable({ plan, pipeline, timezone, focusStepId,
    costError = false, showCost = false }) {
    // `showCost` is OWNED BY THE PAGE since req #3119 — the Time / Tokens control
    // renders in the header row beside the pipeline name, with the visualizer's
    // toggles, so both modes put their controls in one place.
    //
    // It still defaults OFF, as the POC did (`<body class="hidecost">`): cost is a
    // secondary question about a plan whose primary job is showing what runs next,
    // and the column is the widest thing that can be added to a row already
    // carrying ten. The values are REAL as of req #3117 — `row.cost` comes from
    // the server-side rollup via two bounded list reads, not from the
    // per-requirement fan-out that got the POC's version disabled.

    const renderRows = useMemo(() => planRenderRows(plan), [plan]);
    const hasBatches = (plan.batches || []).length > 0;

    // Req #3115 handshake: a bead click in the Plan visualizer switches to this
    // mode with focusStepId set — scroll that row to center and highlight it.
    const rootRef = useRef(null);
    useEffect(() => {
        if (focusStepId == null || !rootRef.current) return;
        const el = rootRef.current.querySelector(
            `[data-testid="pipeline-step-row-${focusStepId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [focusStepId, renderRows]);

    // Column count for the banner colSpan — must track the Cost column's
    // visibility or the banner under-spans and leaves a ragged edge.
    // 10 fixed columns since the Name column landed (req #3119).
    const colSpan = 10 + (showCost ? 1 : 0);

    if (!renderRows.length) {
        return (
            <Box>
                <OrderViolationsAlert plan={plan} />
                <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}
                       data-testid="pipeline-plan-empty">
                    <Typography variant="body2" color="text.secondary">
                        This pipeline has no steps yet.
                    </Typography>
                </Paper>
            </Box>
        );
    }

    return (
        <Box ref={rootRef}>
            <OrderViolationsAlert plan={plan} />
            <CondensationAlert
                key={(plan.proposals || []).map((p) => p.stepIds.join('-')).join('|')}
                proposals={plan.proposals || []} />

            {/* The Time / Tokens control moved to the page header row (req
                #3119). What stays here is the pair of things that describe THIS
                table: the cost-read failure notice and the batch legend. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap',
                        minHeight: (showCost && costError) || hasBatches ? undefined : 0 }}>
                {showCost && costError && (
                    <Typography variant="caption" color="error"
                                data-testid="pipeline-cost-error">
                        The cost reads failed — every cell below reads an em-dash because the
                        numbers could not be fetched, not because this plan has no recorded
                        cost. Reload before drawing conclusions from this column.
                    </Typography>
                )}
                <Box sx={{ flexGrow: 1 }} />
                {/* Legend key renders ONLY when a batch exists — POC polish
                    directive, kept in the product. */}
                {hasBatches && (
                    <Stack direction="row" spacing={1} alignItems="center"
                           data-testid="pipeline-batch-legend">
                        <Box sx={{ width: 18, borderTop: BATCH_ACCENT.borderTop }} />
                        <Typography variant="caption" sx={{ color: BATCH_ACCENT.color }}>
                            launch batch — these steps go out in one /swarm-start
                        </Typography>
                    </Stack>
                )}
            </Box>

            <TableContainer component={Paper} variant="outlined">
                <Table size="small" data-testid="pipeline-plan-table">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ ...NOWRAP, width: COL.step }}>Step</TableCell>
                            <TableCell sx={{ ...NOWRAP, width: COL.name }}>Name</TableCell>
                            <TableCell sx={{ ...NOWRAP, width: COL.status }}>Status</TableCell>
                            <TableCell sx={{ ...NOWRAP, width: COL.run }}>Run</TableCell>
                            <TableCell sx={{ ...NOWRAP, width: COL.machine }}>Machine</TableCell>
                            {showCost && (
                                <TableCell sx={{ ...NOWRAP, width: COL.cost }}>Cost</TableCell>
                            )}
                            <TableCell sx={{ ...NOWRAP, width: COL.epic }}>Epic</TableCell>
                            <TableCell sx={{ ...NOWRAP, width: COL.feature }}>Feature</TableCell>
                            <TableCell sx={{ ...NOWRAP, width: COL.reqs }}>
                                Requirement(s)
                            </TableCell>
                            <TableCell>What this step does</TableCell>
                            <TableCell sx={{ ...NOWRAP, width: COL.deps }}>Depends on</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {renderRows.map((entry) => {
                            if (entry.kind === 'batch') {
                                return (
                                    <BatchBannerRow
                                        key={`batch-${entry.batch.letter}`}
                                        batch={entry.batch}
                                        colSpan={colSpan}
                                        timezone={timezone}
                                    />
                                );
                            }
                            const { row, showEpic, showFeature, eligible, batchLetter } = entry;
                            const running = row.state === STEP_RUNNING;
                            // The visualizer-focused row outranks the state tints:
                            // the user just clicked THIS bead and must find it.
                            const focused = row.id === focusStepId;
                            const tint = focused
                                ? 'rgba(74, 217, 200, 0.16)'
                                : running
                                ? ROW_ACCENT.running.tint
                                : eligible ? ROW_ACCENT.eligible.tint : undefined;
                            // Batch membership is the loudest edge (it says "this
                            // launches with others"); otherwise running, then eligible.
                            const edge = batchLetter
                                ? ROW_ACCENT.batchMember.edge
                                : running ? ROW_ACCENT.running.edge
                                : eligible ? ROW_ACCENT.eligible.edge : undefined;
                            // Step gates and wall-clock gates render on SEPARATE
                            // lines. A formatted datetime contains both spaces and
                            // commas, so joining it into the id list with either
                            // one produces "9001 Jul 23, 2026, 11:31 PM" — a
                            // run-on with no token boundary, and unreadable once a
                            // step carries two time gates (which migration 076
                            // deliberately permits).
                            const depIds = row.depIds.map(String);
                            const timeGates = formatTimeGates(row.timeDeps, timezone);
                            const name = stepName(row);
                            const description = stepDescription(row);
                            return (
                                <TableRow
                                    key={row.id}
                                    hover
                                    sx={{ ...(tint ? { bgcolor: tint } : {}) }}
                                    data-testid={`pipeline-step-row-${row.id}`}
                                    data-state={row.state}
                                    data-eligible={eligible ? 'true' : 'false'}
                                    data-focused={focused ? 'true' : 'false'}
                                >
                                    <TableCell sx={{ ...NOWRAP, width: COL.step,
                                                      color: 'text.secondary',
                                                      fontFamily: 'monospace',
                                                      ...(edge ? { borderLeft: edge } : {}) }}>
                                        {row.id}
                                    </TableCell>
                                    {/* Name — the step's own short label. Wraps
                                        rather than clipping (two lines at most
                                        for this plan's longest), and a name that
                                        a legacy row made prose-length is cut with
                                        the full string on hover. */}
                                    <TableCell sx={{ width: COL.name, fontWeight: 600 }}
                                               data-testid={`pipeline-name-${row.id}`}>
                                        {name.truncated ? (
                                            <Tooltip title={name.full}>
                                                <span>{name.text}</span>
                                            </Tooltip>
                                        ) : name.text}
                                    </TableCell>
                                    <TableCell sx={{ ...NOWRAP, width: COL.status }}>
                                        <Chip
                                            size="small"
                                            label={stepStateLabel(row.state)}
                                            icon={row.state === STEP_DONE
                                                ? <CheckIcon sx={{ fontSize: 15 }} /> : undefined}
                                            {...stepStateChipProps(row.state)}
                                            sx={{
                                                ...stepStateChipProps(row.state).sx,
                                                '& .MuiChip-icon': {
                                                    color: 'inherit', marginLeft: '5px',
                                                },
                                            }}
                                            data-testid={`pipeline-state-chip-${row.id}`}
                                        />
                                    </TableCell>
                                    <TableCell sx={{ ...NOWRAP, width: COL.run }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center',
                                                    gap: 0.75 }}>
                                            <Chip size="small" label={runLabel(row.run)}
                                                  {...runChipProps(row.run)}
                                                  data-testid={`pipeline-run-chip-${row.id}`} />
                                            {eligible && (
                                                <Typography
                                                    variant="caption"
                                                    sx={{ color: ELIGIBLE_MARKER_COLOR,
                                                           ...NOWRAP }}
                                                    data-testid={`pipeline-eligible-${row.id}`}
                                                >
                                                    ● eligible
                                                </Typography>
                                            )}
                                            {/* req #3226 — rendered ALONGSIDE
                                                "eligible", never replacing it:
                                                a step in a paused scope is
                                                still genuinely eligible (the
                                                engine's own eligibility() does
                                                not change), it just will not
                                                launch on its own right now. */}
                                            {eligible && row.launchSuppressed && (
                                                <Typography
                                                    variant="caption"
                                                    sx={{ color: PAUSE_PAUSED_COLOR,
                                                           ...NOWRAP }}
                                                    data-testid={`pipeline-suppressed-${row.id}`}
                                                    title="This scope is paused — held, not about to launch"
                                                >
                                                    ⏸ held
                                                </Typography>
                                            )}
                                        </Box>
                                    </TableCell>
                                    <TableCell sx={{ ...NOWRAP, width: COL.machine,
                                                      color: 'text.secondary' }}
                                               data-testid={`pipeline-machine-${row.id}`}>
                                        {rowMachineLabel(row)}
                                    </TableCell>
                                    {showCost && (
                                        // `pre-line`, not `nowrap`: fmtCost joins the
                                        // wall clock and the token count with '\n'
                                        // (the POC used <br>), and nowrap would print
                                        // "2h 14m 132k tok" as one run-on line while
                                        // the column is sized for two.
                                        <TableCell sx={{ whiteSpace: 'pre-line',
                                                          width: COL.cost,
                                                          color: 'text.secondary' }}
                                                   data-testid={`pipeline-cost-${row.id}`}>
                                            {/* Server-side rollup (req #3117), summed
                                                over the row's requirements by the engine
                                                — never fetched per requirement. */}
                                            {fmtCost(row.cost?.wallSecs, row.cost?.tokens)}
                                        </TableCell>
                                    )}
                                    <GroupCell show={showEpic} value={row.epic}
                                               labels={row.epicLabels} width={COL.epic}
                                               color="#b07fd8"
                                               testid={`pipeline-epic-${row.id}`} />
                                    <GroupCell show={showFeature} value={row.feature}
                                               labels={row.featureLabels} width={COL.feature}
                                               color="#0f9b8e"
                                               testid={`pipeline-feature-${row.id}`} />
                                    <TableCell sx={{ width: COL.reqs }}>
                                        <RequirementLinks row={row} pipelineId={pipeline?.id} />
                                    </TableCell>
                                    <TableCell sx={{ minWidth: 340 }}>
                                        <Typography variant="body2"
                                                    data-testid={`pipeline-notes-${row.id}`}>
                                            {description}
                                        </Typography>
                                    </TableCell>
                                    <TableCell sx={{ ...NOWRAP, width: COL.deps,
                                                      color: 'text.secondary' }}
                                               data-testid={`pipeline-deps-${row.id}`}>
                                        {!depIds.length && !timeGates.length && '—'}
                                        {depIds.length > 0 && (
                                            <Box sx={{ fontFamily: 'monospace' }}>
                                                {depIds.join(' ')}
                                            </Box>
                                        )}
                                        {timeGates.map((t) => (
                                            <Typography key={t} variant="caption"
                                                        sx={{ display: 'block' }}>
                                                after {t}
                                            </Typography>
                                        ))}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>

            <Typography variant="caption" color="text.secondary"
                        sx={{ display: 'block', mt: 1.5 }}>
                Hierarchy: Epic &gt; Feature &gt; Story (requirement). Step state is derived
                from the linked requirements and is never stored; row order is computed
                — topological, then Complete before Running before Scheduled — and
                verified on every render.
            </Typography>
        </Box>
    );
}
