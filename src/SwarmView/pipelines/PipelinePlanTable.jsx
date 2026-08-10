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
//   2. A step row carries a MULTI-LINE payload — the requirement links and, on
//      scheduled work, the exact `/swarm-start` argument list (design rule 8).
//      A grid row is one line of records; this is not.
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

// `useState` is used by the horizontal-scroll container ref below (req #3311's
// `useScrollMemory` wiring) and was NEVER IMPORTED — measured on origin/master
// 2026-08-04, commit 53442e4: Table mode threw `useState is not defined` on
// mount, which is the DEFAULT panel of this page, so /swarm/pipeline/:id was
// dead in both modes. Nothing caught it: this file has no component test, there
// is no eslint in this package (see PipelineDetail.jsx's own note on that), and
// Vite happily bundles an unresolved identifier because it is only a
// ReferenceError at RUNTIME. Repaired here, from req #3324's session, because
// it stood between that requirement and anyone being able to look at it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';

import { useScrollMemory } from '../../hooks/useScrollMemory';
import { scrollStorageKey } from '../../utils/viewportMemory';
import { fmtCost, STEP_DONE, STEP_RUNNING, STEP_PENDING } from './pipelineModel';
import {
    planRenderRows,
    rowMachineLabel,
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
    LAUNCH_ACCENT,
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
    // NOTE: `reqs` (below) was widened from 168 by req #3371 — the step row now
    // carries the `/swarm-start` command under its requirement links, and the
    // command's arguments ARE those ids.
    // The step NAME (req #3119) — its own column, because a name and a
    // description answer different questions and the plan is skimmed by name.
    // Sized to the live plan's longest ("Guiding Principles and Data Refactor",
    // 36 chars) without flexing: a name column that reflows on content would
    // make the whole grid jump between plans.
    name: 210,
    reqs: 240,
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

// The condensation advisory that used to render here was DELETED, not hidden
// (req #3303): it proposed a merge that launch grouping already performed, and
// it could not see the file contention rule 2's concurrency condition turns on.

// ── The step's own launch line (design rule 8, req #3371 / polish item P8) ──
//
// THE COMMAND DID NOT DISAPPEAR WITH THE BANNER — IT MOVED ONTO THE ROW.
// Until Pipeline 2.0 the exact `/swarm-start` argument list rode a full-width
// banner above the first member of each launch group, because a launch was N
// steps and no single row could speak for it. In 2.0 the STEP is the launch
// unit, so the whole payload is a property of ONE row: the member requirement
// ids are the links this sits under, its declared dep steps are the
// pre-existing Depends-on cell (that cell has never distinguished a met dep
// from an open one, on 1.0 or 2.0 rows alike — this requirement did not add
// or narrow that), the run mode is the Run chip and the machines are the
// Machine cell. What none of those columns carried is the COMMAND, and
// design rule 8's own artifact is the one thing a reader cannot reconstruct
// from the others — so it renders here, inline, directly beneath the ids
// that ARE its arguments.
//
// SCHEDULED WORK ONLY. The banner appeared over pending rows and nothing else
// (a launch group was formed from pending steps), and that population is the
// honest one: a Complete step's "nothing left to launch" is noise on every
// finished row of a 150-step plan, and a Running step is already out.
function StepLaunchLine({ row }) {
    if (row.state !== STEP_PENDING) return null;
    const command = row.swarmStartCommand || null;
    const reason = row.noLaunchReason || null;
    if (!command && !reason) return null;
    const excluded = row.launchExcluded || [];
    return (
        <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {command ? (
                <Box
                    component="code"
                    sx={{ color: LAUNCH_ACCENT.codeColor, bgcolor: LAUNCH_ACCENT.codeBg,
                           px: 0.75, py: 0.25, borderRadius: '3px',
                           fontFamily: 'monospace', fontSize: '0.75rem',
                           overflowWrap: 'anywhere' }}
                    data-testid={`pipeline-launch-command-${row.id}`}
                >
                    {command}
                </Box>
            ) : (
                <Typography variant="caption" color="text.secondary"
                            sx={{ fontStyle: 'italic' }}
                            data-testid={`pipeline-launch-blocked-${row.id}`}>
                    {reason}
                </Typography>
            )}
            {/* req #3360. A PARTIAL exclusion is the common case and it is
                invisible without this: the command reads `/swarm-start 3329
                3331 3333` on a step that links six requirements, which is
                indistinguishable from a dropped one. Rendered only ALONGSIDE a
                command — when there is none, the reason above already names
                every id. */}
            {command && excluded.length > 0 && (
                <Typography variant="caption" color="text.secondary"
                            sx={{ fontStyle: 'italic' }}
                            data-testid={`pipeline-launch-skipped-${row.id}`}>
                    skipped: {excluded.join(', ')}
                </Typography>
            )}
        </Box>
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
                        // rather than the Roadmap (req #3119) — and to THIS PANEL of
                        // it (req #3252). The route names the plan; which panel it
                        // opens is a stored preference, and a reader who reached the
                        // table through a bead click or a `?step=` link never
                        // persisted `table` (both are transient overrides by design),
                        // so Back sent them to whichever panel their preference held.
                        state={pipelineId
                            ? { from: 'pipeline', pipelineId, mode: 'table' } : undefined}
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

    // Req #3115 handshake: a bead click in the Plan visualizer switches to this
    // mode with focusStepId set — scroll that row to center and highlight it.
    const rootRef = useRef(null);
    useEffect(() => {
        if (focusStepId == null || !rootRef.current) return;
        const el = rootRef.current.querySelector(
            `[data-testid="pipeline-step-row-${focusStepId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [focusStepId, renderRows]);

    // ── THIS TABLE'S OWN VIEWPORT SURVIVES LEAVING IT (req #3311) ───────────
    // The Plan mode's camera has been remembered since req #3252; the Table
    // mode's scroll position was not, and on the live 64-step plan that is the
    // same defect wearing a scrollbar — open a step's requirement, come back,
    // and you are at row 1. Every return path is covered without being listed,
    // because a return is just this component mounting: a link out and Back, the
    // header's Table|Plan toggle (which unmounts this with no navigation at all),
    // a bead click, a reload.
    //
    // KEYED ON THE PLAN, exactly as the camera is: two plans open in one tab keep
    // their own positions, and an unidentified plan persists nothing rather than
    // inheriting another's.
    const planScrollKey = pipeline?.id != null
        ? scrollStorageKey('pipeline-plan-table', pipeline.id) : null;
    // A DEEP LINK OWNS THE SCROLL POSITION FOR ITS ONE LANDING. `?step=` scrolls
    // its row to centre in the effect above, and a restore racing that would put
    // the reader somewhere neither of them asked for. So the RESTORE is suppressed
    // and the RECORD is not — where the link left them IS where they are, and a
    // null key here (the tempting one-liner) would drop their position instead of
    // deferring to the link. Same doctrine PipelinePlanVisualizer applies to
    // `?epic=`: a link asks to see one thing once and must never overwrite what
    // the reader chose.
    const linkOwnsScroll = focusStepId != null;
    useScrollMemory(planScrollKey, window, { restore: !linkOwnsScroll });
    // ── AND SO DOES THE HORIZONTAL ONE ─────────────────────────────────────
    // A separate key because it is a separate scroller: eleven NOWRAP columns run
    // ~1640px, so the TableContainer scrolls sideways under a page that scrolls
    // down, and a reader who moved right to read `Depends on` has moved their
    // viewport just as much as one who scrolled down. Its element arrives through
    // STATE rather than a ref — see useScrollMemory's own note: a ref's `.current`
    // cannot appear in a dependency list, so the effect would never re-run when
    // the node lands.
    //
    // DEEP-LINK SUPPRESSED ON THE SAME TERMS as the vertical one, and it is not
    // symmetry for its own sake: `scrollIntoView` above defaults to
    // `inline: 'nearest'`, and a table ROW is wider than this scrollport, so the
    // focus scroll moves this axis too. Restoring against it would fight it
    // exactly as on the other axis.
    const [tableEl, setTableEl] = useState(null);
    useScrollMemory(pipeline?.id != null
        ? scrollStorageKey('pipeline-plan-table-x', pipeline.id) : null,
    tableEl, { restore: !linkOwnsScroll });

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

            {/* The Time / Tokens control moved to the page header row (req
                #3119). What stays here is the one thing that describes THIS
                table: the cost-read failure notice. The launch-group legend
                beside it ("these steps go out in one /swarm-start") went with
                the group itself — req #3371 — and needs no replacement: one
                step IS one launch, so there is no grouping left to explain. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap',
                        minHeight: showCost && costError ? undefined : 0 }}>
                {showCost && costError && (
                    <Typography variant="caption" color="error"
                                data-testid="pipeline-cost-error">
                        The cost reads failed — every cell below reads an em-dash because the
                        numbers could not be fetched, not because this plan has no recorded
                        cost. Reload before drawing conclusions from this column.
                    </Typography>
                )}
                <Box sx={{ flexGrow: 1 }} />
            </Box>

            <TableContainer component={Paper} variant="outlined" ref={setTableEl}>
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
                            const { row, showEpic, showFeature, eligible } = entry;
                            const running = row.state === STEP_RUNNING;
                            // The visualizer-focused row outranks the state tints:
                            // the user just clicked THIS bead and must find it.
                            const focused = row.id === focusStepId;
                            const tint = focused
                                ? 'rgba(74, 217, 200, 0.16)'
                                : running
                                ? ROW_ACCENT.running.tint
                                : eligible ? ROW_ACCENT.eligible.tint : undefined;
                            // THE EDGE IS THE ROW'S OWN STATE, on every row (req
                            // #3371). A dashed teal edge used to outrank both of
                            // these, marking membership of a multi-step launch
                            // group; one step is one launch now, so there is no
                            // membership and nothing to outrank them with.
                            const edge = running ? ROW_ACCENT.running.edge
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
                                        {/* Design rule 8's own artifact, on the
                                            row that owns it — see StepLaunchLine.
                                            Directly under the ids because they
                                            ARE the command's arguments. */}
                                        <StepLaunchLine row={row} />
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
