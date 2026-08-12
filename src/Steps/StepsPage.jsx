// /swarm/steps — the Steps editor (req #3140).
//
// The plan's own entities — epics (req #3139) and steps — reached as
// second-level navigation under Pipelines, alongside the plan views that
// render them. It is an
// L2 SIBLING of Pipelines and Epics, never a child: req #3209's nesting is for
// lifecycle records OF a thing (Starts are of a Session), and a step is a member
// of a plan, not a record about one.
//
// Shape follows EpicsPage, which follows MachinesView: one DataGrid, click-to-
// toggle chips, one dialog for create and edit, no cards/trends views. Not a
// `ViewerHeader` page (memory/darwin-viewer-pages.md) for the reason recorded
// there — that contract is for a dataset shown through MORE THAN ONE
// presentation and mandates a ToggleButtonGroup even at length 1.
//
// ## "connects to the existing Step editor"
//
// There is no step-editing component in Darwin today; every step in production
// was written by the Primary AI through the MCP tools. The existing step SURFACE
// is the plan table and plan visualizer at /swarm/pipeline/:id, which already
// scroll to and highlight a `focusStepId` (the req #3115 bead-click handshake).
// So the connection is the Pipeline cell: it deep-links to that plan FOCUSED ON
// THIS STEP, via `pipelineStepLink.js`, which owns both halves of the URL
// contract. Exactly the move req #3139 made with its (since-retired) Features
// count cell.
//
// ## What this page edits, and what it deliberately does not
//
// A step's OWN COLUMNS: `title`, `notes`, `run`, and `completed_at`.
//
// NOT `pipeline_step_requirements` and NOT `pipeline_step_deps`. Those are the
// coordinator's, and mutating one is half of an atomic act — req #3083's
// operating rule, *plan edit and launch are ONE action, never two*, recorded
// after step 13's five sessions ran while the plan still read "Scheduled". A
// browser form that unlinks a requirement while the 2.0 orchestration engine is
// polling that plan would race the launch decision with no error anywhere, and
// `set_step_deps` has REPLACE semantics where a lost update is silent. Links and
// dependencies render read-only, with their ids on hover. This is the same line
// EpicsPage draws: it edits an epic's own columns, never what points at it.
//
// NOT `pipeline_fk` on an existing step, either — the MCP's own rule: *a step's
// plan membership is its identity; drop it and create it in the other plan, which
// forces the dependency question to be answered rather than silently broken.*
// Moving a step would leave its dep rows pointing across plans, which the engine
// cannot order and `set_step_deps` rejects loudly.
//
// ## Reads
//
// Seven bounded list reads, ALL of them ones the plan pages already use, so
// arriving from /swarm/pipelines or /swarm/pipeline/:id paints from cache with
// zero fetches (design rule 5; memory/detail-page-interlinking.md's composition
// rule). `useAllRequirements` is asked for PLAN_REQUIREMENT_FIELDS specifically —
// `fields` is in that hook's cache key, so a different projection here would be a
// second cache entry and a guaranteed refetch of the whole requirements table.
//
// Machines are deliberately NOT read. The engine derives a `machineLabel` for
// every row, but a machine is a LAUNCH parameter belonging to the plan view, and
// this page shows no such column — so the read would cost a request to populate a
// field nothing renders.
//
// `features` KEPT ALIVE (req #3357 code review). This page's Epic column and
// its `?epic=<id>` filter (req #3373) both come from the SAME 1.0 derivation
// engine `SwarmView/pipelines/` uses (`buildPipelineModel`, out of this
// requirement's scope), which still needs `features` to derive a step's
// dominant epic — there is no non-Feature source for that fact in 1.0. A
// first cut of this requirement dropped the read on the theory that "retire
// Feature from the frontend" meant every consumer, but that broke an
// ALREADY-SHIPPED, tested feature: the plan visualizer's epic chip ↗
// (req #3373) already links to this page's `?epic=` filter, and pulling the
// data out from under it left that live link resolving to zero rows —
// forever. `useAllFeatures` was already going to survive regardless (as the
// same read `usePlanSources.js` makes for the excluded plan pages), so
// keeping this page a second caller of it costs nothing and avoids the
// regression. `EpicsPage`'s own feature-derived Features COUNT is still
// gone — the requirement's mandate holds wherever it does not conflict with
// something already shipped.

import { useContext, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {
    ALL_ROWS,
    useAllEpics,
    useAllFeatures,
    useAllPipelineStepDeps,
    useAllPipelineStepRequirements,
    useAllPipelineSteps,
    useAllPipelines,
    useAllRequirements,
} from '../hooks/useDataQueries';
import {
    pipelineStepKeys,
    pipelineStepDepKeys,
    pipelineStepRequirementKeys,
} from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import ChipFilter from '../Components/ChipFilter/ChipFilter';
import { formatDateTime } from '../utils/dateFormat';
import { PLAN_REQUIREMENT_FIELDS } from '../SwarmView/pipelines/pipelineViewModel';
import { sortReqIdsByStatus } from '../SwarmView/pipelines/pipelinePlanLayout';
import {
    runChipProps,
    runLabel,
    stepStateChipProps,
    stepStateLabel,
} from '../SwarmView/pipelines/pipelineChipStyles';
import { stepLinkTo } from '../SwarmView/pipelines/pipelineStepLink';
import {
    STEP_DONE,
    STEP_PENDING,
    STEP_RUNNING,
    buildStepEditorRows,
    completionGuard,
    filterStepRows,
    gatingRequirementIds,
    stepsAccounting,
} from './stepsModel';
import {
    REST_NULL,
    VALID_RUN_MODES,
    completeStep,
    createStep,
    deleteStep,
    fetchRequirementTracking,
    fetchStepRequirementIds,
    isRestNullLiteral,
    reopenStep,
    updateStep,
} from './stepsApi';

// Explicit chipProps rather than the ChipFilter palette, for EpicsPage's reason:
// step state is a fixed three-value VOCABULARY with colours the plan table has
// used since req #3114, and letting the palette hash them would put the same word
// in two colours on two pages. `stepStateChipProps` is that vocabulary.
const STATE_FILTER_OPTIONS = [
    { value: STEP_PENDING, label: stepStateLabel(STEP_PENDING),
        chipProps: stepStateChipProps(STEP_PENDING) },
    { value: STEP_RUNNING, label: stepStateLabel(STEP_RUNNING),
        chipProps: stepStateChipProps(STEP_RUNNING) },
    { value: STEP_DONE, label: stepStateLabel(STEP_DONE),
        chipProps: stepStateChipProps(STEP_DONE) },
];

// VARCHAR(256) — the column's real width. Without the cap a longer title reaches
// MySQL, fails 1406, and comes back as an opaque 500 (the RequirementRow rule).
const TITLE_MAX = 256;

// The sentinel the Pipeline filter uses for "every plan". A real pipeline id can
// never be '' , and `filterStepRows` takes null for all — so the Select holds the
// string and the memo below converts.
const ALL_PIPELINES = '';

// Collapse prose to one line for a grid cell. Step notes are multi-sentence (see
// darwin://pipeline/2) and a raw multi-line value renders as a single clipped
// line with the newlines swallowed anyway — this at least keeps the words on
// either side of a break from running together.
const oneLine = (value) => (value ? String(value).replace(/\s+/g, ' ').trim() : '');

// Requirement ids for a hover, marking the containers. A tracking requirement is
// linked but never gates (req #3123), and a reader looking at a step that says
// "3 requirements — Scheduled" needs to see which of them the derivation ignored.
//
// Sorted met-first, deferred/wontfix-last (req #3363) via the SAME ladder the
// plan visualizer stacks its requirement marks with — `statusOf` defaults to a
// no-op lookup so a caller with no status map still gets the row's own order
// rather than a crash.
const reqIdSummary = (row, statusOf = () => null) => {
    const ids = row.reqIds || [];
    if (!ids.length) return 'No requirements linked — this step is completed by hand.';
    const tracking = new Set(row.trackingReqIds || []);
    const unresolved = new Set(row.unresolvedReqIds || []);
    return sortReqIdsByStatus(ids, statusOf).map((id) => {
        if (tracking.has(id)) return `${id} (tracking)`;
        if (unresolved.has(id)) return `${id} (not found)`;
        return String(id);
    }).join(', ');
};

// Why a delete is refused, as a clause. ONE place, because the tooltip and the
// snackbar say the same thing and must not drift.
//
// The verb agrees. "step 10 depend on it" reads as a rendering fault, and since
// `dropBlockers` counts a self-dependency (InnoDB does — see its docstring) the
// worst version of that was reachable: "Step 11 cannot be deleted: step 11 depend
// on it", which looks like a bug rather than the correct answer it is. A step
// blocking itself gets said outright.
const blockerClause = (row) => {
    const ids = row.blockerStepIds || [];
    if (ids.length === 1 && ids[0] === row.id) return 'it depends on itself';
    return ids.length === 1
        ? `step ${ids[0]} depends on it`
        : `steps ${ids.join(', ')} depend on it`;
};

// "requirement 3050" / "requirements 3050, 3090", with a verb that agrees.
//
// A HELPER RATHER THAN A TERNARY AT THE CALL SITE, for the reason `blockerClause`
// is one: a hand-rolled `${n === 1 ? '' : 's'}` switches the noun and leaves the
// verb behind, and the singular is the case most readers actually see. That exact
// slip was written twice in this file before it was factored out both times.
const requirementClause = (ids, verb) => (
    ids.length === 1
        ? `requirement ${ids[0]} ${verb}s`
        : `requirements ${ids.join(', ')} ${verb}`
);

// A step's gate, as text. One dep row = ONE condition, and a step may carry both
// kinds (migration 076 leaves `time_at` rows out of the UNIQUE key precisely so it
// can), so both are counted and both are named.
const gateSummary = (row) => {
    const parts = [];
    if ((row.depIds || []).length) parts.push(`after step${row.depIds.length === 1 ? '' : 's'} ${row.depIds.join(', ')}`);
    if ((row.timeDeps || []).length) parts.push(`${row.timeDeps.length} wall-clock gate${row.timeDeps.length === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' · ') : 'No gate — eligible as soon as the plan is running.';
};

export default function StepsPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);
    const navigate = useNavigate();

    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: pipelines = [], isLoading: pipelinesLoading } = useAllPipelines(creatorFk);
    const { data: steps = [], isLoading: stepsLoading } = useAllPipelineSteps(creatorFk);
    const { data: stepRequirements = [], isLoading: linksLoading, isError: linksError } =
        useAllPipelineStepRequirements(creatorFk);
    const { data: stepDeps = [], isLoading: depsLoading, isError: depsError } =
        useAllPipelineStepDeps(creatorFk);
    const { data: requirements = [], isLoading: reqsLoading, isError: reqsError } =
        useAllRequirements(creatorFk, { fields: PLAN_REQUIREMENT_FIELDS });
    // Labels are a DICTIONARY here, not a catalog: a closed epic or feature must
    // still resolve or the Epic column blanks for data it has. `features` is
    // kept alive for the engine's dominant-epic derivation (design rule 10,
    // requirement -> feature -> epic) — see the file header's "`features` KEPT
    // ALIVE" note for why this page did not follow req #3357's usual retirement.
    const { data: features = [], isLoading: featuresLoading, isError: featuresError } =
        useAllFeatures(creatorFk, { closed: ALL_ROWS });
    const { data: epics = [], isLoading: epicsLoading, isError: epicsError } =
        useAllEpics(creatorFk);

    // EVERY read that feeds a number or a label gates the spinner (the
    // PipelinesPage rule). They resolve independently: gating on steps alone
    // paints every State chip as Scheduled — a claim about the plan, not about the
    // fetch — and a delete confirmed in that window would omit the "its N
    // requirement links will be removed" clause the confirmation exists to deliver.
    const isLoading = pipelinesLoading || stepsLoading || linksLoading || depsLoading
        || reqsLoading || featuresLoading || epicsLoading;

    // ── A FAILED READ IS NOT AN EMPTY ONE, and here that distinction is safety ──
    //
    // `fetchEntity` turns a 404 into `[]` and a 5xx leaves `data` undefined, so on
    // failure the `= []` defaults above make every read look like a table with no
    // rows. `isLoading` says nothing about it: a failed query is settled, not
    // loading. Two consequences, and they are not the same size:
    //
    // PLAN DATA — the two junctions and the requirements. Their absence does not
    // merely blank a column, it silently REVERSES design rule 1: a step whose
    // links did not load reports zero gating requirements, so the guard reads
    // `editable` and one click stamps `completed_at` on a requirement-backed step
    // of a live plan. That stamp is invisible while the requirements exist
    // (`deriveStepState` ignores it) and surfaces later as a step deriving
    // Complete from a stamp nobody intended. So this does not just warn — it
    // BLOCKS the two mutations that depend on knowing the link set.
    const planDataError = linksError || depsError || reqsError;

    // WHICH read failed, for the messages. One boolean is right for deciding
    // whether to block; spending it as though it were always the links read makes
    // the page state a falsehood about the other two — "the requirement links did
    // not load" when the junctions read fine and the requirements list is what
    // failed. On a page whose whole argument is *say which it is*, that is the
    // wrong thing to be sloppy about.
    const failedReads = [
        linksError && 'requirement links',
        depsError && 'dependency rows',
        reqsError && 'requirement list',
    ].filter(Boolean);
    const failedReadsText = failedReads.length > 1
        ? `${failedReads.slice(0, -1).join(', ')} and ${failedReads[failedReads.length - 1]}`
        : (failedReads[0] || '');

    // LABELS — features and epics. Nothing here is ORDERED by them (unlike the
    // plan pages, where display order breaks ties on epic first-appearance), so
    // the consequence really is bounded to a blank Epic column. Say so rather
    // than let it read as "these steps have no epic".
    const dictionaryError = featuresError || epicsError;

    // Plain state, deliberately: unlike PipelinesPage's persisted filter, this
    // page has no detail route to click into and come back from, so there is no
    // navigation that could silently forget a chip the user turned on.
    //
    // `null` is the ChipFilter default and it means "every state, including ones
    // that do not exist yet" — the pattern's rule for a dimension backed by data.
    // Step state is a closed three-value vocabulary so that cannot bite here, but
    // starting at null is also the honest default for an EDITOR: it opens showing
    // the whole plan rather than a view of it.
    const [stateFilter, setStateFilter] = useState(null);
    const toggleStateFilter = (value) => setStateFilter(current => {
        const selected = current === null
            ? STATE_FILTER_OPTIONS.map(o => o.value)
            : current;
        return selected.includes(value)
            ? selected.filter(v => v !== value)
            : [...selected, value];
    });
    const [pipelineFilter, setPipelineFilter] = useState(ALL_PIPELINES);

    // Epic filter via ?epic=<id> (req #3373) — the plan visualizer epic chip's
    // ↗ control lands here: a URL param, not persisted state, so the link IS
    // the filter and dismissing the chip clears it without touching anything
    // else. Integer ids only — `Number(' ')` is 0 and `Number('1.5')` is 1.5,
    // either of which would filter every step out under a chip reading "Epic: 0".
    const [searchParams, setSearchParams] = useSearchParams();
    const epicParamRaw = searchParams.get('epic');
    const epicFilter = epicParamRaw != null && /^\d+$/.test(epicParamRaw.trim())
        ? Number(epicParamRaw.trim()) : null;
    const clearEpicFilter = () => {
        const next = new URLSearchParams(searchParams);
        next.delete('epic');
        setSearchParams(next, { replace: true });
    };

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [formPipelineFk, setFormPipelineFk] = useState('');
    const [formTitle, setFormTitle] = useState('');
    const [formNotes, setFormNotes] = useState('');
    const [formRun, setFormRun] = useState('auto');
    const [submitting, setSubmitting] = useState(false);
    // Step ids with a completion write in flight — the dialog's `submitting` flag
    // for a control that has no dialog to disable. `toggleComplete` is a read then
    // a write, so a double-click starts a second round trip while the first is
    // still deciding: two GETs, two PUTs, and two timestamps for one intent. A ref
    // rather than state because the guard has to be seen by the SECOND call
    // synchronously, before React has re-rendered anything.
    const completingRef = useRef(new Set());

    // The engine runs here, once, over the reads. See stepsModel.js for why this
    // page does not derive step state itself.
    const { rows: allRows, unrenderedStepIds } = useMemo(() => buildStepEditorRows({
        pipelines, steps, stepRequirements, stepDeps, requirements, features, epics,
    }), [pipelines, steps, stepRequirements, stepDeps, requirements, features, epics]);

    // req #3363 — id -> requirement_status, for the "Reqs" tooltip's sort.
    const reqStatusById = useMemo(
        () => new Map(requirements.map((r) => [r.id, r.requirement_status])),
        [requirements]);

    const rows = useMemo(() => filterStepRows(allRows, {
        pipelineIds: pipelineFilter === ALL_PIPELINES ? null : [Number(pipelineFilter)],
        states: stateFilter,
        epicIds: epicFilter !== null ? [epicFilter] : null,
    }), [allRows, pipelineFilter, stateFilter, epicFilter]);

    // The WHOLE plan, never the filtered view (view-switchable-pages § V7). The
    // "N of M" line beside it is where the filter's effect is stated.
    const accounting = useMemo(() => stepsAccounting(allRows), [allRows]);

    // Plans in the order the Pipelines page shows them, so the Select and that
    // page agree: `useAllPipelines` sorts id:desc, which puts the newest first.
    const pipelineOptions = useMemo(() => pipelines.map(
        p => ({ id: p.id, title: p.title })), [pipelines]);

    const invalidateSteps = () =>
        queryClient.invalidateQueries({ queryKey: pipelineStepKeys.all(creatorFk) });

    const openCreate = () => {
        setEditTarget(null);
        // Pre-select the plan the grid is currently filtered to, falling back to
        // the first plan. `pipeline_fk` is required and ON DELETE RESTRICT, so an
        // empty default is a dead Create button on a form that looks complete.
        setFormPipelineFk(pipelineFilter !== ALL_PIPELINES
            ? Number(pipelineFilter)
            : (pipelineOptions[0]?.id ?? ''));
        setFormTitle('');
        setFormNotes('');
        setFormRun('auto');
        setDialogOpen(true);
    };

    const openEdit = (row) => {
        setEditTarget(row);
        setFormPipelineFk(row.pipelineId);
        setFormTitle(row.title || '');
        setFormNotes(row.notes || '');
        setFormRun(VALID_RUN_MODES.includes(row.run) ? row.run : 'auto');
        setDialogOpen(true);
    };

    const handleSubmit = async () => {
        const title = formTitle.trim();
        const notes = formNotes.trim();
        if (!title) {
            showError('Title is required');
            return;
        }
        // `rest_post` and `rest_put` both substitute SQL NULL for the literal
        // string 'NULL', and `title` is NOT NULL — so this exact input becomes a
        // MySQL 1048 and an opaque 500 at the gateway. Refuse it here, where the
        // message can say what actually happened.
        if (isRestNullLiteral(title)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
                + 'be a title. Try "Null" or another wording.');
            return;
        }
        if (!editTarget && (formPipelineFk === '' || formPipelineFk == null)) {
            showError('Pipeline is required');
            return;
        }
        setSubmitting(true);
        try {
            if (editTarget) {
                // Every editable column is sent, with the nullable one cleared via
                // the REST 'NULL' sentinel. One code path beats diffing the form
                // against the row and getting the empty case wrong. `pipeline_fk`
                // is NOT among them — see the header.
                await updateStep(darwinUri, idToken, editTarget.id, {
                    title,
                    notes: notes || REST_NULL,
                    run: formRun,
                });
            } else {
                await createStep(darwinUri, idToken, {
                    pipeline_fk: formPipelineFk,
                    title,
                    // POST takes a real null; the 'NULL' string is a PUT-only
                    // sentinel and would be stored as the literal text.
                    notes: notes || null,
                    run: formRun,
                });
            }
            invalidateSteps();
            setDialogOpen(false);
        } catch (err) {
            // TWO-argument form on purpose. call_rest_api THROWS a bare
            // `{data, httpStatus}` object for every gateway error, so `err.message`
            // is undefined on exactly the failures worth reporting; the store's
            // second argument is what renders the status code beside the text.
            showError(err, editTarget ? 'Could not save step' : 'Could not create step');
        } finally {
            setSubmitting(false);
        }
    };

    const toggleRun = async (row) => {
        try {
            await updateStep(darwinUri, idToken, row.id,
                { run: row.run === 'manual' ? 'auto' : 'manual' });
            invalidateSteps();
        } catch (err) {
            showError(err, 'Could not change the step run mode');
        }
    };

    // Design rule 1, and THIS is the only place it is decided. The chip stays
    // clickable on a derived step deliberately: a control that silently does
    // nothing teaches nothing, and the reason a step cannot be stamped by hand is
    // the single most useful thing this page can say about it. So the click lands,
    // the guard refuses, and the refusal names the requirements — the same shape
    // the MCP's `complete_pipeline_step` raises rather than a disabled tool.
    //
    // Deciding it here rather than in the render is also what makes it correct:
    // the row can be re-derived between paint and click by an invalidation, and a
    // stamp on a requirement-backed step is not recoverable by looking at the page
    // — the plan would go on rendering the derived answer while the column quietly
    // disagreed.
    const toggleComplete = async (row) => {
        // REOPENING is unguarded, matching the MCP's `reopen_pipeline_step`.
        // Clearing the stamp can only ever move the stored column TOWARDS what a
        // derived step already reports, so there is nothing to protect and a step
        // marked done by mistake must always be recoverable — including while
        // `planDataError` is blocking the other direction, which is why the State
        // chip reports this row as `reopen` rather than `derived`.
        if (row.completedAt) {
            try {
                await reopenStep(darwinUri, idToken, row.id);
                invalidateSteps();
            } catch (err) {
                showError(err, 'Could not reopen the step');
            }
            return;
        }
        // One completion per step at a time. Added HERE, released in the single
        // `finally` below, so no early return can leak the entry.
        //
        // The reopen path above gets no such guard, deliberately: it is a bare
        // idempotent write with no read in front of it, so a double-click sends
        // `completed_at = NULL` twice and the second is a no-op. What makes the
        // completion path different is that it DECIDES first — two clicks would
        // run two independent guard evaluations and land two different timestamps
        // for one intent.
        if (completingRef.current.has(row.id)) return;
        completingRef.current.add(row.id);
        try {
            await completeFlow(row);
        } finally {
            completingRef.current.delete(row.id);
        }
    };

    // The guarded completion itself. Split out only so `toggleComplete` can hold
    // the in-flight entry across every exit with one try/finally instead of a
    // release before each of five returns.
    //
    // WHAT IT DOES NOT CLOSE: the window between the live re-read and the PUT. The
    // Primary AI can link a requirement in it, and no client-side check can see
    // that — closing it needs a server-side conditional write, which is a
    // Lambda-Rest contract change. The MCP's `complete_pipeline_step` has the
    // identical window for the identical reason. What the re-read removes is the
    // 30-second one, which is the reachable one.
    const completeFlow = async (row) => {
        if (planDataError) {
            showError(`Step ${row.id} cannot be completed: the ${failedReadsText} did not `
                + 'load, so there is no way to tell whether its state is derived. Reload first.');
            return;
        }
        const cached = completionGuard(row);
        if (!cached.allowed) {
            showError(`Step ${row.id} is derived from its requirements. ${cached.reason}`);
            return;
        }

        // THE CACHED GUARD IS NOT ENOUGH — it is the fast path, not the rule.
        // `staleTime` is 30s and the Primary AI links requirements onto steps of
        // the live plan while this page is open, so the grid can be showing a
        // link set that is half a minute out of date. Re-read this one step's
        // links before writing, exactly as `complete_pipeline_step` does.
        //
        // A FAILED re-read refuses the stamp. "I could not check" and "there is
        // nothing to check" are different answers, and only one of them permits a
        // write.
        let liveGating;
        let liveTracking;
        try {
            const liveReqIds = await fetchStepRequirementIds(darwinUri, idToken, row.id);
            liveGating = gatingRequirementIds(liveReqIds, requirements);
            // The complement, so the refusal's "N containers are exempt" clause
            // describes the links that were just read rather than the stale ones
            // the grid was drawn from — the whole reason for re-reading.
            liveTracking = liveReqIds.filter((rid) => !liveGating.includes(rid));
            // LIVE IDS ARE NOT ENOUGH WHEN THE FLAGS ARE STILL CACHED. The line
            // above takes ids from the server and `tracking` from the same ≤30s
            // cache this re-read exists to distrust. One direction is already
            // safe: an id the cache does not know resolves to
            // `isTrackingRequirement(undefined)` === false, so it gates. The other
            // is not — a requirement cached as a container that has since been
            // corrected to work would drop out of the gating set and let the stamp
            // through, which is precisely the damage this guard prevents.
            //
            // So the EXEMPTIONS are re-read, and only the exemptions: that set is
            // empty on essentially every step, costing nothing on the common path,
            // and never larger than a step's container count. A requirement that
            // has since been deleted comes back absent and gates, same safe
            // direction as an unknown id.
            if (liveTracking.length) {
                const rows = await Promise.all(liveTracking.map(
                    (rid) => fetchRequirementTracking(darwinUri, idToken, rid)));
                const fresh = rows.filter(Boolean);
                liveGating = gatingRequirementIds(liveReqIds, [...requirements, ...fresh]);
                // AN EXEMPTION THE RE-READ COULD NOT CONFIRM GATES, whatever the
                // cache says about it — and it has to be forced, not left to the
                // merge. A `null` row simply contributes nothing, so the merge
                // falls back to the CACHED row, and a cached `tracking: 1` would
                // exempt the id anyway: a failed verification producing a write,
                // the one outcome this whole block exists to prevent. Absent is
                // not the same as absent-and-therefore-work.
                //
                // Unreachable today — `fk_psr_requirement` is ON DELETE RESTRICT,
                // so a requirement a live junction row points at cannot be deleted,
                // and a 5xx throws to the catch below rather than arriving here as
                // a 404. That is a fact about the schema, not about this code, and
                // it is not the reason this is correct.
                for (const rid of liveTracking.filter((_r, i) => rows[i] == null)) {
                    if (!liveGating.includes(rid)) liveGating.push(rid);
                }
                liveTracking = liveReqIds.filter((rid) => !liveGating.includes(rid));
            }
        } catch (err) {
            showError(err, `Could not verify step ${row.id}'s requirements — not completed`);
            return;
        }
        if (liveGating.length) {
            showError(`Step ${row.id} is derived from its requirements. `
                + `${completionGuard({
                    ...row, gatingReqIds: liveGating, trackingReqIds: liveTracking,
                }).reason}`);
            // The grid was stale enough to offer a write it should not have, so
            // repaint it from the server rather than leave the user looking at
            // the data that misled them.
            invalidateSteps();
            queryClient.invalidateQueries({
                queryKey: pipelineStepRequirementKeys.all(creatorFk) });
            return;
        }

        try {
            await completeStep(darwinUri, idToken, row.id);
            invalidateSteps();
        } catch (err) {
            showError(err, 'Could not complete the step');
        }
    };

    const handleDelete = async (row) => {
        // REFUSE POLITELY — design rule 4, from cached dep rows. This is a
        // COURTESY, not the enforcement: `dep_step_fk` is ON DELETE RESTRICT and
        // `deleteStep` is one statement, so a stale or failed dep read costs at
        // worst a 409 with the plan untouched. What this buys is a message that
        // names the blocking steps instead of a gateway error code.
        if (row.blockerStepIds.length) {
            showError(`Step ${row.id} cannot be deleted: ${blockerClause(row)}. `
                + 'Re-point or remove those dependencies in the plan first.');
            return;
        }
        const linkCount = (row.reqIds || []).length;
        const gateCount = (row.depIds || []).length + (row.timeDeps || []).length;
        const consequence = [
            linkCount && `${linkCount} requirement link${linkCount === 1 ? '' : 's'}`,
            gateCount && `${gateCount} dependency row${gateCount === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' and ');
        if (!window.confirm(
            `Delete step ${row.id} "${row.title}"?`
            // The counts come from the same reads the grid drew, so when those
            // failed the confirmation must not state them as fact.
            + (planDataError
                ? ` The ${failedReadsText} could not be read, so the consequence is`
                  + ' unknown — the database will refuse if another step depends on it.'
                : consequence
                    ? ` Its ${consequence} will be removed with it. The requirements themselves are not touched.`
                    : '')
            + ' This cannot be undone.')) return;
        try {
            await deleteStep(darwinUri, idToken, row.id);
            invalidateSteps();
            // Both junction caches held rows for this step and the DATABASE just
            // cascaded them away, so nothing in this client knows they are gone.
            // Without these the plan table would keep drawing a gate that points
            // at a step that no longer exists, which `verifyOrder` reports as
            // `dangling-dependency` — a loud, wrong alarm caused entirely by a
            // stale cache.
            queryClient.invalidateQueries({
                queryKey: pipelineStepRequirementKeys.all(creatorFk) });
            queryClient.invalidateQueries({ queryKey: pipelineStepDepKeys.all(creatorFk) });
        } catch (err) {
            showError(err, 'Could not delete step');
        }
    };

    // Deliberately NOT memoized (the EpicsPage shape). Every action
    // cell closes over `idToken`, which is refreshed in place by AuthContext; a
    // memoized column array would keep firing REST calls with the token it
    // captured on first render long after that token expired.
    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        { field: 'title', headerName: 'Step', flex: 1, minWidth: 180 },
        {
            field: 'pipelineTitle', headerName: 'Pipeline', width: 170,
            // THE CONNECTION TO THE EXISTING STEP SURFACE (req #3140): the plan
            // table, scrolled to and highlighting this step.
            renderCell: (params) => {
                const to = stepLinkTo(params.row.pipelineId, params.row.id);
                // `#<id>` when the pipelines read did not resolve this plan. The
                // LINK still stands in that case, and deliberately: the id is
                // known, it is the read that failed, and the plan page says so far
                // better than a dead chip here could.
                const label = params.value || `#${params.row.pipelineId}`;
                return (
                    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                        <Tooltip title={`Open this step in ${label}'s plan table`}>
                            <Chip
                                label={label}
                                size="small"
                                variant="outlined"
                                clickable={!!to}
                                onClick={(e) => { e.stopPropagation(); if (to) navigate(to); }}
                                data-testid={`step-plan-link-${params.row.id}`}
                            />
                        </Tooltip>
                    </Box>
                );
            },
        },
        {
            field: 'state', headerName: 'State', width: 130, sortable: false,
            renderCell: (params) => {
                // ── THE MARKER REPORTS WHAT THE CLICK DOES ──────────────────
                // Not what the row's own data says, and not what the general rule
                // is: with the link read failed every row LOOKS completable and
                // none is, and a stamped step is REOPENABLE even then. Three
                // outcomes, so three values — `reopen` exists because
                // `data-guard="derived"` has to keep meaning "this click writes
                // nothing", which is exactly what a reader of the test suite
                // assumes it means.
                const contradicted = params.row.completedAt
                    && (params.row.gatingReqIds || []).length > 0;
                const guard = params.row.completedAt
                    ? { kind: 'reopen',
                        // A STAMP ITS REQUIREMENTS CONTRADICT is a real row and
                        // this page is where someone would come to clean it up, so
                        // the tooltip must not open with "Complete —" beside a chip
                        // reading Running. It cannot be produced from here (that is
                        // what the live guard prevents); it arrives from pre-existing
                        // data or an MCP-side stamp.
                        reason: contradicted
                            ? 'This step carries a completed_at stamp, but '
                              + `${requirementClause(params.row.gatingReqIds, 'contradict')} `
                              + 'it — the plan renders the DERIVED state, so the stamp is '
                              + 'dead weight. Click to clear it; that is the fix.'
                            : 'Complete — click to clear the stamp. Reopening is always '
                              + 'allowed: it only ever moves the stored column towards what a '
                              + 'derived step already reports.' }
                    : planDataError
                        ? { kind: 'derived',
                            reason: `The ${failedReadsText} did not load, so there is no way `
                                + 'to tell whether this step\'s state is derived. Completing '
                                + 'it is disabled until the read recovers.' }
                        : (({ allowed, reason }) => ({
                            kind: allowed ? 'editable' : 'derived', reason }))(
                            completionGuard(params.row));
                return (
                    <Tooltip title={guard.reason}>
                        {/* Clickable even when the guard will refuse — see
                            toggleComplete. `data-guard` is how the refusal is
                            visible to a test without hovering the tooltip. */}
                        <Chip
                            label={stepStateLabel(params.value)}
                            size="small"
                            {...stepStateChipProps(params.value)}
                            clickable
                            onClick={() => toggleComplete(params.row)}
                            // The SAME string the tooltip carries. A tooltip is
                            // invisible to a screen reader until focus, and this
                            // one is the only place the page explains why a click
                            // will or will not write — the PipelineDetail
                            // description-button rule.
                            aria-label={guard.reason}
                            data-guard={guard.kind}
                            data-testid={`step-state-chip-${params.row.id}`}
                        />
                    </Tooltip>
                );
            },
        },
        {
            field: 'run', headerName: 'Run', width: 110, sortable: false,
            renderCell: (params) => (
                <Tooltip title={params.value === 'manual'
                    ? 'Manual — the orchestrator reports this step eligible but never launches it. Click for Auto.'
                    : 'Auto — the orchestrator launches this step when its gate clears. Click for Manual.'}>
                    <Chip
                        label={runLabel(params.value)}
                        size="small"
                        {...runChipProps(params.value)}
                        clickable
                        onClick={() => toggleRun(params.row)}
                        data-testid={`step-run-chip-${params.row.id}`}
                    />
                </Tooltip>
            ),
        },
        {
            field: 'reqCount', headerName: 'Reqs', width: 90, type: 'number',
            valueGetter: (_v, row) => (row.reqIds || []).length,
            renderCell: (params) => (
                <Tooltip title={reqIdSummary(params.row, (id) => reqStatusById.get(id))}>
                    <Box component="span" data-testid={`step-req-count-${params.row.id}`}>
                        {params.value}
                    </Box>
                </Tooltip>
            ),
        },
        {
            field: 'gateCount', headerName: 'Gate', width: 90, type: 'number',
            valueGetter: (_v, row) =>
                (row.depIds || []).length + (row.timeDeps || []).length,
            renderCell: (params) => (
                <Tooltip title={gateSummary(params.row)}>
                    <Box component="span" data-testid={`step-gate-count-${params.row.id}`}>
                        {params.value}
                    </Box>
                </Tooltip>
            ),
        },
        {
            field: 'epic', headerName: 'Epic', width: 160,
            valueFormatter: (value) => value || '—',
        },
        {
            field: 'notes', headerName: 'Notes', flex: 2, minWidth: 240,
            valueGetter: (value) => oneLine(value),
            valueFormatter: (value) => value || '—',
        },
        {
            field: 'completedAt', headerName: 'Completed', width: 150,
            valueFormatter: (value) => (value ? formatDateTime(value, timezone) : '—'),
        },
        {
            field: 'actions', headerName: '', width: 100, sortable: false,
            filterable: false, disableColumnMenu: true,
            renderCell: (params) => (
                <Stack direction="row" spacing={0.5}>
                    <Tooltip title="Edit">
                        <IconButton size="small"
                                    data-testid={`step-edit-${params.row.id}`}
                                    onClick={(e) => { e.stopPropagation(); openEdit(params.row); }}>
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    {/* Enabled even when design rule 4 will refuse, for the same
                        reason the State chip is: the refusal names the steps that
                        gate on this one, which is the information the operator
                        needs, and a disabled button delivers it only on hover. */}
                    <Tooltip title={params.row.blockerStepIds.length
                        ? `Blocked — ${blockerClause(params.row)}`
                        : 'Delete'}>
                        <IconButton size="small"
                                    aria-label={params.row.blockerStepIds.length
                                        ? `Blocked — ${blockerClause(params.row)}`
                                        : `Delete step ${params.row.id}`}
                                    data-blocked={params.row.blockerStepIds.length ? 'yes' : 'no'}
                                    data-testid={`step-delete-${params.row.id}`}
                                    onClick={(e) => { e.stopPropagation(); handleDelete(params.row); }}>
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            ),
        },
    ];

    return (
        <Box sx={{ gridArea: 'content', p: 3, width: '100%', minWidth: 0, overflow: 'auto' }}
             data-testid="steps-page">
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}
                   useFlexGap>
                <Typography variant="h5">Steps</Typography>

                <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>Pipeline</InputLabel>
                    <Select label="Pipeline" value={pipelineFilter}
                            onChange={(e) => setPipelineFilter(e.target.value)}
                            data-testid="steps-pipeline-filter">
                        <MenuItem value={ALL_PIPELINES}>All pipelines</MenuItem>
                        {pipelineOptions.map(p => (
                            <MenuItem key={p.id} value={p.id}>{p.title}</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <ChipFilter
                    options={STATE_FILTER_OPTIONS}
                    selected={stateFilter}
                    onToggle={toggleStateFilter}
                    testId="steps-state-filter"
                    chipTestIdPrefix="steps-state-chip"
                />

                {epicFilter !== null && (
                    // The plan visualizer's epic chip ↗ landed here (req #3373).
                    // The ✕ clears the filter; the body carries no navigation of
                    // its own — unlike FeaturesPage's identical (retired) chip,
                    // this page IS the destination, so there is nowhere else
                    // for a click on the body to usefully go.
                    <Chip size="small" color="secondary"
                          label={`Epic: ${epics.find(e => e.id === epicFilter)?.title
                              || epicFilter}`}
                          onDelete={clearEpicFilter}
                          sx={{ flexShrink: 0 }}
                          data-testid="steps-epic-filter-chip" />
                )}

                <Typography variant="caption" sx={{ color: 'text.secondary' }}
                            data-testid="steps-accounting">
                    {rows.length} of {accounting.total} step{accounting.total === 1 ? '' : 's'} —{' '}
                    {accounting.done} complete · {accounting.running} running ·{' '}
                    {accounting.pending} scheduled
                </Typography>

                <Box sx={{ flexGrow: 1 }} />

                <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}
                        disabled={!pipelineOptions.length}
                        data-testid="step-add">
                    New Step
                </Button>
            </Stack>

            {/* A step the grouping could not place is REPORTED, never dropped
                silently — an editor page that quietly loses a row is how a plan
                ends up with a step nobody can see or fix. */}
            {unrenderedStepIds.length > 0 && (
                <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
                       data-testid="steps-unrendered-warning">
                    {unrenderedStepIds.length} step{unrenderedStepIds.length === 1 ? '' : 's'}{' '}
                    ({unrenderedStepIds.join(', ')}) carry no usable pipeline and are not
                    listed below. They exist in the database and belong to no plan.
                </Alert>
            )}

            {planDataError && (
                <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
                       data-testid="steps-plan-data-error">
                    The {failedReadsText} failed to load. <strong>Every State chip, Reqs
                    count and Gate count below is computed as though those rows do not
                    exist</strong> — a step that is Running may read Scheduled. Completing
                    a step is disabled until this read recovers; reopening one, and edits
                    to title, notes and run mode, are unaffected, and the database still
                    refuses a delete that would break a dependency. Reload.
                </Alert>
            )}

            {dictionaryError && (
                <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}
                       data-testid="steps-dictionary-error">
                    The epic or feature list failed to load, so the Epic column is blank for
                    every row — that is the failed read, not the plan. Reload before reading
                    anything into it. Step state, requirement counts and gates are unaffected.
                </Alert>
            )}

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Box sx={{ width: '100%' }} data-testid="steps-datagrid">
                    <DataGrid
                        autoHeight
                        rows={rows}
                        columns={columns}
                        getRowId={(r) => r.id}
                        density="compact"
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{ toolbar: { showQuickFilter: true } }}
                        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                        pageSizeOptions={[10, 25, 50, 100]}
                        disableRowSelectionOnClick
                        data-testid="steps-grid"
                    />
                </Box>
            )}

            <Dialog open={dialogOpen} onClose={() => !submitting && setDialogOpen(false)}
                    maxWidth="md" fullWidth data-testid="step-edit-dialog">
                <DialogTitle>{editTarget ? `Edit step ${editTarget.id}` : 'New step'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <FormControl fullWidth required disabled={!!editTarget}>
                            <InputLabel>Pipeline</InputLabel>
                            <Select label="Pipeline" value={formPipelineFk}
                                    onChange={(e) => setFormPipelineFk(e.target.value)}
                                    data-testid="step-pipeline-select">
                                {pipelineOptions.map(p => (
                                    <MenuItem key={p.id} value={p.id}>{p.title}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {editTarget && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', mt: -1 }}>
                                A step&apos;s plan membership is its identity. To move this step,
                                delete it and create it in the other plan — that forces its
                                dependencies to be answered rather than silently broken.
                            </Typography>
                        )}
                        <TextField
                            label="Title"
                            value={formTitle}
                            onChange={(e) => setFormTitle(e.target.value)}
                            helperText="The step's short NAME — &quot;Session Drain&quot;, not a sentence."
                            autoFocus required fullWidth
                            slotProps={{ htmlInput: {
                                'data-testid': 'step-title-input', maxLength: TITLE_MAX } }}
                        />
                        <TextField
                            label="Notes"
                            value={formNotes}
                            onChange={(e) => setFormNotes(e.target.value)}
                            helperText={'What this step must achieve and why. Never its dependencies, '
                                + 'status, membership or ordinal — those are rows, and prose that '
                                + 'restates them goes stale (design rule 11). Replaces on save; it '
                                + 'does not append.'}
                            fullWidth multiline minRows={5}
                            slotProps={{ htmlInput: { 'data-testid': 'step-notes-input' } }}
                        />
                        <FormControl fullWidth>
                            <InputLabel>Run</InputLabel>
                            <Select label="Run" value={formRun}
                                    onChange={(e) => setFormRun(e.target.value)}
                                    data-testid="step-run-select">
                                <MenuItem value="auto">Auto — the orchestrator launches it</MenuItem>
                                <MenuItem value="manual">Manual — reported eligible, never launched</MenuItem>
                            </Select>
                        </FormControl>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
                    <Button variant="contained" onClick={handleSubmit}
                            disabled={submitting || !formTitle.trim()
                                || (!editTarget && formPipelineFk === '')}
                            data-testid="step-save">
                        {editTarget ? 'Save' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
