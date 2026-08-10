import React, { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import call_rest_api from '../../RestApi/RestApi';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { useShowClosedStore, ALL_REQUIREMENT_STATUSES } from '../../stores/useShowClosedStore';
import { useAllCategories, useMachines,
    pipelineStepRequirementKeys } from '../../hooks/useDataQueries';
// Master replaced this page's `usePipelinedRequirementIds` + `hidePipelined` pair
// with one `useRequirementVisibility().isVisible` predicate; that change merged
// into the body cleanly, so only the import line collided with req #3435's.
import { useRequirementVisibility } from '../../hooks/useRequirementVisibility';
import { useOrchestrationIndex } from './useOrchestrationIndex';
import {
    epicForFeature, epicRowForFeature, stepOptions,
} from './orchestrationIndex';
import { epicLinkTo, planLinkTo } from '../pipelines/pipelineEpicLink';
import { stepPlanLinkTo } from '../pipelines/pipelineStepLink';
import { siblingElevator, readElevatorIds } from './requirementSort';
import { coerceSortMode, DEFAULT_SORT_MODE } from '../processSort';
import { formatDateTime, formatDate } from '../../utils/dateFormat';
import { requirementStatusTimestampFields, requirementStatusTimestampState } from '../../utils/requirementStatusTimestamps';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { DataGrid } from '@mui/x-data-grid';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { requirementKeys } from '../../hooks/useQueryKeys';
import RequirementDeleteDialog from '../RequirementDeleteDialog';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

import { swarmStatusChipProps, swarmStatusLabel } from '../swarmStatusChipProps';
import { COORDINATION_COLOR } from '../coordinationChipStyles';
import { AI_MODEL_COLOR, AI_MODELS, aiModelLabel } from '../modelChipStyles';
import { EFFORT_COLOR, EFFORTS, effortLabel } from '../effortChipStyles';
import { terminalFocusState } from '../terminalFocus';
import TerminalChip from '../TerminalChip';
import { formatDuration } from '../../utils/formatDuration';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import { alpha, CircularProgress, Stack, Typography } from '@mui/material';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import NorthIcon from '@mui/icons-material/North';
import SouthIcon from '@mui/icons-material/South';
import LayersIcon from '@mui/icons-material/Layers';
import LanIcon from '@mui/icons-material/Lan';
import AccountTreeIcon from '@mui/icons-material/AccountTree';

// Soft limit for requirement titles — the swarm terminal, status line, and iTerm tab title
// all cap at 35 chars (see ~/.claude/statusline.sh and scripts/swarm/iterm-launch.sh). Req #2410.
const TITLE_SOFT_LIMIT = 35;

// Req #3327 — fixed-width alignment column. The "{id} -" prefix on the Title
// row (see ID_PREFIX_WIDTH below) and the five settings-row labels (Status,
// Autonomy, Model, Effort, Machine) are each given a FIXED `width` — not
// measured off the DOM at runtime — so the Title's text and every row's
// first Chip's text start at the same x, deterministically, by construction.
// A prior version of this measured the id prefix's rendered width live (a
// ResizeObserver + callback ref) to handle the id's varying digit count
// exactly; that added a live-measurement dependency for a value that only
// ever needs to be "wide enough", produced a real regression (a short id
// measured narrower than the label "Autonomy" needs, truncating it to
// "Autono…"), and was hard to verify end-to-end. Fixing the id prefix's width
// instead — wide enough for any id length in realistic reach, with the text
// simply left-aligned and trailing space absorbed — removes the runtime
// dependency entirely: the Title's text always starts at
// ID_PREFIX_WIDTH + one flex `gap` (8px), full stop.
//
// ID_PREFIX_WIDTH is chosen generously for "12345 -" at 24px/weight 500 (this
// page's id is in the low thousands today and grows slowly). CHIP_TEXT_INSET
// is MUI's Chip label padding for size="small": filled = 0 border + 8px
// label padding; outlined = 1px border + 7px label padding — both total 8px
// (verified in @mui/material/Chip/Chip.js) — subtracting it lands each row's
// first chip's TEXT, not just its box, under the Title's text.
// FIELDSET_LEFT_INSET is this page's own AI Settings fieldset border (1px) +
// `px: 1.5` padding (12px), which sits in front of the Model/Effort rows
// only. SETTINGS_LABEL_WIDTH (80) and FIELDSET_LABEL_WIDTH (67) both exceed
// the widths this page used for these rows before this req (72 and 48
// respectively) — already-proven floors for "Autonomy" and "Model"/"Effort"
// not to truncate — so legibility is guaranteed by construction as well.
// Verified against the live-rendered production page (real account, real
// requirement #3327): the Title's text and every chip's text land at
// x=300px exactly (six-way match), and the Category row's moved icon group
// lands at the same right edge (x=1004px) as the Title editor.
const ID_PREFIX_WIDTH = 88;
const CHIP_TEXT_INSET = 8;
const FIELDSET_LEFT_INSET = 13;
const SETTINGS_LABEL_WIDTH = ID_PREFIX_WIDTH - CHIP_TEXT_INSET;
const FIELDSET_LABEL_WIDTH = SETTINGS_LABEL_WIDTH - FIELDSET_LEFT_INSET;

// Req #3435 — the Orchestration box's two selects, styled as the Category select
// is: standard variant with the underline suppressed until hover and no dropdown
// arrow, so the value reads as text rather than as a form field. `minWidth` keeps
// the box from resizing as the reader moves between a short plan name and a long
// epic name; `maxWidth` keeps a long epic title from widening the whole row past
// the AI Settings fieldset beside it, letting the label ellipsize instead.
const ORCH_SELECT_SX = {
    minWidth: 200,
    maxWidth: 320,
    fontSize: '0.95rem',
    fontWeight: 500,
    color: 'text.secondary',
    '& .MuiSelect-select': {
        py: 0,
        pr: '0 !important',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    '&:before': { borderBottomColor: 'transparent' },
    // Derived from the palette, not a hardcoded colour: the literal this box
    // shipped with was white, which is invisible under a light palette.
    '&:hover:not(.Mui-disabled):before': (theme) => ({
        borderBottomColor: alpha(theme.palette.text.primary, 0.3),
    }),
};

// Req #3435 — the two READ-ONLY rows. Same metrics as the select beside them so
// all three values start at the same x and a long step title ellipsizes rather
// than widening the fieldset past the AI Settings box next to it.
// Fixed `width`, not content-sized — the same construction, and the same
// constant, the Model/Effort rows use inside the AI Settings fieldset beside
// this one (req #3327's alignment discipline). So a row name occupies a column of
// exactly the width Autonomy gives its own label, and the icon after it starts at
// one x on all three rows regardless of whether the word is "Pipeline" or "Epic" —
// which is the whole reason it is not content-sized.
//
// It is NOT trying to align with Autonomy's label on screen: the two fieldsets sit
// side by side in one flex row, not stacked, so there is no shared x to hit. What
// is shared is the METRIC — same label width, same 8px gap after it — which is
// what makes the two boxes read as one rhythm.
const ORCH_ROW_LABEL_SX = {
    width: FIELDSET_LABEL_WIDTH,
    flexShrink: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
};

const ORCH_VALUE_SX = {
    minWidth: 200,
    maxWidth: 320,
    fontSize: '0.95rem',
    fontWeight: 500,
    color: 'text.secondary',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
};

const getSessionColumns = (navigate, timezone) => [
    { field: 'id',           headerName: 'ID',        width: 70 },
    { field: 'swarm_status', headerName: 'Status',    width: 110,
      renderCell: (params) => (
          <Chip label={swarmStatusLabel(params.value)} size="small"
                {...swarmStatusChipProps(params.value)} />
      )
    },
    {
        // req #3455 — Terminal replaces Source here. Source was `requirement:NNNN`
        // on EVERY row of this grid: it is the linked-sessions grid of that very
        // requirement, so the column restated the page you were already on.
        // Terminal answers something this page could not: which window each of
        // those sessions is running in, and a click that brings it to the front.
        field: 'terminal',
        headerName: 'Terminal',
        width: 130,
        valueGetter: (value) => value?.label ?? '',
        renderCell: (params) => (
            <TerminalChip terminal={params.row.terminal}
                          testId={`req-session-terminal-${params.row.id}`} />
        ),
    },
    { field: 'branch',       headerName: 'Branch',    width: 200, flex: 1 },
    {
        field: 'duration',
        headerName: 'Duration',
        width: 110,
        valueGetter: (value, row) => {
            if (row.instrumented) {
                return (Number(row.starting_secs) || 0) + (Number(row.waiting_secs) || 0)
                    + (Number(row.planning_secs) || 0) + (Number(row.implementing_secs) || 0)
                    + (Number(row.review_secs) || 0) + (Number(row.completion_secs) || 0)
                    + (Number(row.paused_secs) || 0) + (Number(row.legacy_secs) || 0);
            }
            return row.legacy_secs != null ? Number(row.legacy_secs) : null;
        },
        valueFormatter: (value) => formatDuration(value),
    },
    { field: 'started_at',   headerName: 'Started',   width: 170,
      valueFormatter: (value) => value ? formatDate(value, timezone) : '—' },
    { field: 'completed_at', headerName: 'Completed', width: 120,
      valueFormatter: (value) => value ? formatDate(value, timezone) : '—' },
];

const RequirementDetail = () => {

    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const fromCalendar = location.state?.from === 'calendar';
    // Req #3119: arriving from a plan (the plan table's requirement link or the
    // visualizer's requirement label) must go BACK to that plan, not to the
    // Roadmap. Without this the only exit from a requirement opened out of the
    // visualizer was the Requirements cards view — a different page than the one
    // the user left, so the plan (and the mode/layout toggles they had set) had
    // to be found again by hand.
    const fromPipelineId = location.state?.from === 'pipeline'
        ? Number(location.state?.pipelineId) : null;
    const hasPipelineOrigin = Number.isFinite(fromPipelineId) && fromPipelineId > 0;
    // Req #3252: WHICH PANEL of that plan. The route names the plan; the panel
    // comes from a stored preference, and a reader who reached the visualizer
    // through a `?mode=plan` link never persisted `plan` — that override is
    // transient by design. So "Back to Plan" landed such a reader in the TABLE,
    // where the pan and zoom this requirement restores are not even on screen.
    //
    // NOT VALIDATED AGAINST THE MODE LIST HERE, on purpose. `pipelineDetailModes`
    // imports both panels, so importing it would pull react-konva and the whole
    // plan visualizer into this page's bundle to check one string. The receiving
    // page already validates `?mode=` against that list and falls back to the
    // stored preference on anything it does not recognise — one validation, at
    // the end that owns the vocabulary. All this needs is that the value cannot
    // corrupt the URL it is interpolated into, and it comes from in-app router
    // state rather than the address bar.
    const rawBackMode = location.state?.mode;
    const fromPipelineMode = typeof rawBackMode === 'string'
        && /^[a-z]{1,16}$/.test(rawBackMode) ? rawBackMode : null;
    // "new" mode (req #2414): the user came from the aggregator template row.
    // No DB record exists yet — the requirement is POSTed only when the user
    // picks a category. Until then this page edits a purely local draft.
    const isNew = id === 'new';
    const handleBack = () => {
        if (hasPipelineOrigin) {
            // `?mode=` is a TRANSIENT override on the receiving page, never a
            // write to the reader's stored preference — so returning them to the
            // panel they left cannot change what any other plan opens in.
            return navigate(`/swarm/pipeline/${fromPipelineId}`
                + (fromPipelineMode ? `?mode=${fromPipelineMode}` : ''));
        }
        return navigate(fromCalendar ? '/calview' : '/swarm');
    };
    const backLabel = hasPipelineOrigin ? 'Back to Plan'
        : (fromCalendar ? 'Back to Calendar' : 'Back to Roadmap');
    const { idToken, profile } = useContext(AuthContext);
    const timezone = profile?.timezone;
    const { darwinUri } = useContext(AppContext);

    const [requirement, setRequirement] = useState(isNew ? {
        id: null,
        title: location.state?.title || '',
        description: '',
        category_fk: null,
        requirement_status: 'authoring',
        coordination_type: 'implemented',
        ai_model: 'opus',
        effort: 'high',
        machine_fk: null,   // req #2978 — every requirement is born "Any machine"
        started_at: null,
        completed_at: null,
        deferred_at: null,
        create_ts: null,
        update_ts: null,
    } : null);
    const [sessions, setSessions] = useState([]);
    const [siblings, setSiblings] = useState([]);
    const [sibSortMode, setSibSortMode] = useState(DEFAULT_SORT_MODE);
    const [loading, setLoading] = useState(!isNew);

    // Req #2818: in the aggregator-template / category-unset flow the Category select is
    // autofocused (req #2815). Once the user picks a category the description field can no
    // longer rely on its mount-time `autoFocus` (the component stays mounted), so we move
    // focus imperatively. `descriptionInputRef` points at the description <textarea>;
    // `focusDescriptionPending` is set ONLY when the category was previously unset.
    const descriptionInputRef = useRef(null);
    const [focusDescriptionPending, setFocusDescriptionPending] = useState(false);

    // Req #2884: the Category <Select> is gated behind the categories query
    // (`allCategories ? <Select autoFocus={categoryUnset}/> : —`). On a cold load
    // it mounts only once `useAllCategories` resolves, and `autoFocus` fires at
    // that (late) mount — yanking focus away from the Title/Description field the
    // user already clicked into. Track whether the user has focused an editable
    // field first; if so, the late-mounting select must NOT auto-focus. The flag
    // is a ref because `autoFocus` is consulted only at the select's mount render
    // (driven by the query resolving), so the ref value at that moment is exactly
    // the signal we need — and we don't want to trigger an extra re-render.
    const userInteractedRef = useRef(false);
    const markUserInteracted = () => { userInteractedRef.current = true; };

    const showError = useSnackBarStore(s => s.showError);
    const requirementStatusFilter = useShowClosedStore(s => s.requirementStatusFilter);

    const { data: allCategoriesData } = useAllCategories(profile?.userName, {
        fields: 'id,category_name,sort_order,closed',
        closed: 0,
    });
    // Req #3015 — match the card view's ordering (CategoryTabPanel) rather than
    // whatever order the DB happens to return (no ORDER BY on the /categories GET).
    // The `closed: 0` query param already asks the server for open categories only;
    // the `.filter` below re-asserts that client-side (defense in depth against a
    // stale/shared query-cache entry serving closed rows) — reopening #3015 reported
    // closed categories leaking into this list.
    const allCategories = useMemo(
        () => allCategoriesData && [...allCategoriesData].filter(c => !c.closed).sort((a, b) => {
            const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
            const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
            if (ao !== bo) return ao - bo;
            return (a.category_name || '').localeCompare(b.category_name || '');
        }),
        [allCategoriesData]
    );

    // Req #2978 — machine pin options. Machines are an OPEN set (rows in the
    // `machines` table), so the chip list is data-driven rather than a static
    // constant like AI_MODELS/EFFORTS. Only OPEN machines are offerable: a
    // retired machine must not be a new pin target. A requirement already
    // pinned to a since-retired machine still renders that pin (see
    // `pinnedMachineMissing` below) so the state is never silently lost.
    const { data: machinesData = [] } = useMachines(profile?.userName);

    // req #3455 — the Terminal column needs the machines list to answer "is this
    // terminal on the machine this browser is on?", which a DataGrid renderCell
    // cannot reach. Computed once per row here, exactly as SessionsView does.
    const sessionRows = React.useMemo(
        () => (sessions || []).map(s => ({ ...s, terminal: terminalFocusState(s, machinesData) })),
        [sessions, machinesData]);
    const openMachines = useMemo(
        () => (machinesData || [])
            .filter(m => !m.closed)
            .sort((a, b) => {
                // Hand sort_order first (NULL sinks to the end), then title.
                const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
                const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
                if (ao !== bo) return ao - bo;
                return (a.title || '').localeCompare(b.title || '');
            }),
        [machinesData]
    );
    // ── Req #3435 — the Orchestration box: WHICH PLAN, WHICH EPIC ───────────
    // One index over six bounded list reads replaces the two targeted resolvers
    // this box used to run (`useEpicPipelineLocation`, five serial hops for one
    // epic; `useRequirementStepLocation`, three for one requirement). Those were
    // right for a box that only REPORTED; this one OFFERS, and an epic dropdown
    // asks "which plan is this epic in?" of every epic at once — the exact
    // fan-out a per-row chain cannot serve. Five of the six reads are the same
    // cache entries the plan pages hold. Detail in `useOrchestrationIndex.js`.
    const orchestration = useOrchestrationIndex(profile?.userName, { enabled: !isNew });
    const orchIndex = orchestration.index;
    const orchSettled = orchestration.isSettled;
    // SPLIT, not one flag (code review). The epic assignment needs `epics` and
    // `features` and nothing else; a transient failure on any of the four
    // plan-side reads has nothing to do with the write, and folding them
    // together let one of them disable assignment entirely. The predecessor
    // degraded gracefully by design — req #3235's own comment said a failed
    // plan-location lookup "just renders no second link" — and that property
    // has to survive the consolidation.
    const epicSideErrored = orchestration.errors.epics || orchestration.errors.features;
    const planSideErrored = orchestration.errors.plan;
    // `errors.epicPlanMap` is deliberately NOT consumed here any more. It gated
    // the epic list's narrowing; with the epic read-only, the only derived
    // scoping left is the STEP list's, and a failed chained read empties
    // `epicByStep` — which reads as "this step has no epic yet" and therefore
    // WIDENS the list rather than narrowing it. Widening is the safe direction
    // (the reader sees more steps, never fewer), so there is nothing to guard.

    // ── THREE LEVELS, AND ONLY ONE OF THEM IS SETTABLE ──────────────────────
    // Pipeline, Epic, Step — top to bottom, each with a button that opens the
    // visualizer AT THAT LEVEL and a value beside it. The Epic is the only
    // selector; Pipeline and Step are read-only text.
    //
    // That is not a shortcut, it is what the data allows. There is no
    // `requirements.pipeline_fk` and no `requirements.step_fk`: a requirement
    // reaches a plan only by being seated on a `pipeline_steps` row, which is a
    // PLAN mutation the Primary AI owns (memory/swarm-orchestration-doctrine.md),
    // not a field on a requirement. An earlier cut of this box shipped a pipeline
    // SELECT anyway, as a display-plus-local-filter, and it was withdrawn: it was
    // indistinguishable from the control beside it (identical styling, sitting
    // under a Category select that DOES save on change) while silently
    // discarding the reader's choice on navigation, and it carried two meanings
    // that disagree the moment a different plan is picked — "the plan this
    // requirement is on" and "the plan I am filtering by".
    //
    // Making the other two settable at all is req #3453 (authoring/discuss) —
    // deliberately a design conversation, not a backlog item, because drag and
    // drop onto the visualizer is as plausible an answer as two more selects.
    //
    // THE EPIC IS READ-ONLY TOO NOW. It is reached only through
    // `requirements.feature_fk`, and which of an epic's features carries a
    // requirement is an editorial choice — this page tried deriving it, was
    // measured wrong on nine of eleven live epics, then offered it explicitly,
    // and the user's call is that it does not belong here at all. Setting the
    // epic (and the plan) from this page is req #3453.

    // The requirement's own seat: which step of which plan carries it. The Step
    // row's value, and the narrowest of the three links — `?step=` lands the
    // camera on one bead, where `?epic=` fits the whole band and on a large epic
    // IS a zoomed-out view (req #3253).
    const requirementSeat = orchIndex.requirementSeat.get(Number(id)) || null;
    const seatStep = requirementSeat && requirementSeat.stepId != null
        ? (orchIndex.stepsById.get(requirementSeat.stepId) || { id: requirementSeat.stepId })
        : null;

    // READ OFF THE LIVE ROW, not the index's requirements projection: this page
    // holds the row it fetched and has just written to, while the projection is
    // a cache that lags a PUT by one invalidation. The box therefore updates the
    // instant an assignment lands rather than a refetch later.
    //
    // COERCED, unlike everything else read off the live row: it is a Map key
    // (`epicByFeature`) and a `'46'` from the wire indexes as a different feature
    // than 46. The index normalises every id it holds (`toId`); this is the one
    // read that happens outside it.
    const currentFeatureFk = (() => {
        const raw = requirement?.feature_fk;
        if (raw == null || raw === '') return null;
        const n = Number(raw);
        return Number.isInteger(n) ? n : null;
    })();
    const currentEpicId = epicForFeature(orchIndex, currentFeatureFk);
    const currentEpicRow = epicRowForFeature(orchIndex, currentFeatureFk);

    // WHICH PLAN. The seat's, when a step carries this requirement; otherwise the
    // one its epic reaches (req #3235's fallback, kept). The two are DIFFERENT
    // FACTS — seated-vs-unseated is what the sync report splits into
    // UNSEATED-REQS and ORPHANS, and it decides whether a launch is the
    // coordinator's to make — but they no longer need a parenthetical to tell
    // apart: the Step row below says so structurally by reading "—".
    const epicPipelineId = currentEpicId != null
        ? (orchIndex.epicPrimaryPipeline.get(currentEpicId) ?? null) : null;
    const seatPipelineId = requirementSeat ? requirementSeat.pipelineId : null;
    const shownPipelineId = seatPipelineId ?? epicPipelineId;
    const shownPipelineRow = shownPipelineId != null
        ? orchIndex.pipelinesById.get(shownPipelineId) : null;

    // ── The ONE settable level: which open step of this epic carries the work ─
    // Scoped to the plan and epic already on screen, so picking here can never
    // move the requirement to another epic — which is what keeps the three rows
    // consistent without a second write. See `stepOptions`.
    const stepChoices = stepOptions(orchIndex, {
        pipelineId: shownPipelineId,
        epicId: currentEpicId,
        currentStepId: seatStep ? seatStep.id : null,
    });

    // ── The three links, one per level ──────────────────────────────────────
    // Every builder returns null for an unusable id, and `to={null}` handed to
    // react-router's Link throws at render — so each is null-guarded and its
    // button renders disabled rather than dead (the box's existing "omit rather
    // than render a dead link" rule, req #3235).
    const pipelineLink = planLinkTo(shownPipelineId);
    const epicPlanLink = epicLinkTo(epicPipelineId, currentEpicId);
    const stepPlanLink = seatStep ? stepPlanLinkTo(seatPipelineId, seatStep.id) : null;

    // Filter chips now match DB status values directly
    const siblingStatuses = [...requirementStatusFilter];

    // req #3302 / #3419 — the card's OTHER filter, as the card's OWN predicate.
    // See the elevator memo below.
    const { isVisible } = useRequirementVisibility(profile?.userName);

    const queryClient = useQueryClient();


    const requirementDelete = useConfirmDialog({
        onConfirm: ({ requirementId }) => {
            const uri = `${darwinUri}/requirements`;
            call_rest_api(uri, 'DELETE', { id: requirementId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                        navigate('/swarm');
                    } else {
                        showError(result, 'Unable to delete requirement');
                    }
                })
                .catch(error => showError(error, 'Unable to delete requirement'));
        }
    });

    // Requirement Duplicator (req #2808): clone the opened requirement into a NEW
    // requirement that shares ONLY the title, description and category. Status and
    // coordination fall back to defaults (status 'authoring'; coordination_type
    // omitted so the server applies its NOT NULL default). The title gets a
    // "COPY of {origin id}" suffix. Nothing else is copied — dates, sessions,
    // sort_order and project_fk are deliberately left off the POST body.
    const handleDuplicate = async () => {
        if (isNew || !requirement) return;
        // requirements.title is VARCHAR(256). Always keep the "COPY of {id}" suffix
        // and truncate the base title so the combined string fits the column.
        const suffix = ` COPY of ${id}`;
        const baseTitle = (requirement.title || '').slice(0, 256 - suffix.length);
        const draft = {
            title: `${baseTitle}${suffix}`,
            description: requirement.description || '',
            category_fk: requirement.category_fk,
            requirement_status: 'authoring',
            // req #3007: ai_model + effort have NO database default — copy the
            // source requirement's values (fall back to opus / high) so the
            // POST never omits them and the DB never stores an invalid ''.
            ai_model: requirement.ai_model || 'opus',
            effort: requirement.effort || 'high',
        };
        const postResult = await call_rest_api(`${darwinUri}/requirements`, 'POST', draft, idToken)
            .catch(() => null);
        if (!postResult || !postResult.httpStatus || postResult.httpStatus.httpStatus !== 200 ||
            !postResult.data || !postResult.data[0]) {
            const err = postResult && postResult.httpStatus
                ? postResult
                : { httpStatus: { httpStatus: 'network error' } };
            showError(err, 'Unable to duplicate requirement');
            return;
        }
        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
        navigate(`/swarm/requirement/${postResult.data[0].id}`);
    };

    useEffect(() => {
        if (isNew) return;  // no fetch — local draft only
        // Re-arm the loading gate on every id change (code review, req #3234): without
        // this, navigating from one requirement straight to another (duplicate, the
        // sessions grid's Source link, browser Back/Forward) left the OLD requirement's
        // data — including its resolved Epic link — rendered and clickable throughout
        // the new GET, since `loading` was already false from the previous mount.
        setLoading(true);
        const fetchData = async () => {
            try {
                const requirementUri = `${darwinUri}/requirements?id=${id}`;
                const result = await call_rest_api(requirementUri, 'GET', '', idToken);

                if (result.httpStatus.httpStatus !== 200 || result.data.length === 0) {
                    showError(result, 'Unable to load requirement');
                    setLoading(false);
                    return;
                }

                const p = result.data[0];
                setRequirement(p);

                // Fetch sessions, siblings, and category sort_mode in parallel
                const siblingFilter = siblingStatuses.length === ALL_REQUIREMENT_STATUSES.length
                    ? ''
                    : `&requirement_status=(${siblingStatuses.join(',')})`;
                const [sessionsResult, siblingsResult, categoryResult] = await Promise.all([
                    // Req #2834 — read swarm_sessions through `darwinUri` (the dev/prod split),
                    // matching req #2827's migration of the factory ops hooks. The req #2697
                    // pin to production `darwin` is gone: in production `darwinUri === darwinOpsUri`
                    // (= `…/darwin`) so this is a no-op there, while in dev mode the linked-sessions
                    // read now hits `darwin_dev` — the same schema SessionsView/useSessions reads —
                    // so a dev-seeded session is visible here too (without this, dev showed the
                    // list from darwin_dev but linked sessions from production darwin).
                    call_rest_api(`${darwinUri}/swarm_sessions?source_ref=requirement:${p.id}`, 'GET', '', idToken).catch(() => null),
                    call_rest_api(`${darwinUri}/requirements?category_fk=${p.category_fk}&fields=id,requirement_status,completed_at,deferred_at,started_at,sort_order${siblingFilter}`, 'GET', '', idToken).catch(() => null),
                    call_rest_api(`${darwinUri}/categories?id=${p.category_fk}&fields=id,sort_mode`, 'GET', '', idToken).catch(() => null),
                ]);

                if (sessionsResult?.httpStatus?.httpStatus === 200 && sessionsResult.data.length > 0) {
                    setSessions(sessionsResult.data);
                }
                if (siblingsResult?.httpStatus?.httpStatus === 200 && siblingsResult.data.length > 0) {
                    setSiblings(siblingsResult.data);
                }
                if (categoryResult?.httpStatus?.httpStatus === 200 && categoryResult.data.length > 0) {
                    setSibSortMode(coerceSortMode(categoryResult.data[0].sort_mode));
                }
            } catch (error) {
                showError(error, 'Unable to load requirement');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [id, idToken, darwinUri, siblingStatuses.join()]);

    const saveField = (field, value) => {
        if (isNew) return;  // draft — nothing is saved until category is picked
        let uri = `${darwinUri}/requirements`;
        call_rest_api(uri, 'PUT', [{ id: parseInt(id), [field]: value }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, `Unable to update ${field}`);
                } else {
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                }
            }).catch(error => {
                showError(error, `Unable to update ${field}`);
            });
    };

    const handleTitleBlur = () => {
        if (requirement) saveField('title', requirement.title);
    };

    const handleTitleKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveField('title', requirement.title);
        }
    };

    const handleDescriptionBlur = () => {
        if (requirement) saveField('description', requirement.description || '');
    };

    const currentStatus = requirement?.requirement_status || 'authoring';

    // Confirmation dialog for transitions FROM met state
    const requirementReopen = useConfirmDialog({
        onConfirm: ({ targetStatus }) => {
            executeStatusChange(targetStatus);
        }
    });

    const executeStatusChange = (newStatus) => {
        const now = new Date().toISOString();

        // req #3244 — shared with CategoryCard/SwarmStartCard so all three frontend
        // writers of requirement_status derive the same timestamps darwin-mcp does.
        const updates = {
            requirement_status: newStatus,
            ...requirementStatusTimestampFields(newStatus, now),
        };

        setRequirement(prev => ({
            ...prev,
            requirement_status: newStatus,
            ...requirementStatusTimestampState(newStatus, now),
        }));

        let uri = `${darwinUri}/requirements`;
        call_rest_api(uri, 'PUT', [{ id: parseInt(id), ...updates }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, 'Unable to update requirement status');
                } else {
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                }
            }).catch(error => {
                showError(error, 'Unable to update requirement status');
            });
    };

    const handleStatusChange = (event, newStatus) => {
        if (newStatus === null || newStatus === currentStatus) return;

        // Require confirmation when leaving a terminal state (met or wontfix — req #2783)
        if (currentStatus === 'met' || currentStatus === 'wontfix') {
            requirementReopen.openDialog({ targetStatus: newStatus });
            return;
        }

        executeStatusChange(newStatus);
    };

    const handleCoordinationChange = (event, newVal) => {
        // Autonomy is mandatory (req #2745) — newVal is always one of the four
        // values; the chip can no longer deselect to null.
        setRequirement(prev => ({ ...prev, coordination_type: newVal }));
        saveField('coordination_type', newVal);
    };

    const handleModelChange = (event, newVal) => {
        // Model is mandatory (req #2909) — newVal is always one of the four
        // values; no deselect-to-null path, mirroring autonomy.
        setRequirement(prev => ({ ...prev, ai_model: newVal }));
        saveField('ai_model', newVal);
    };

    const handleEffortChange = (event, newVal) => {
        // Effort is mandatory (req #2916) — newVal is always one of the five
        // values; no deselect-to-null path, mirroring autonomy and model.
        setRequirement(prev => ({ ...prev, effort: newVal }));
        saveField('effort', newVal);
    };

    const handleMachineChange = (newVal) => {
        // Req #2978 — unlike autonomy/model/effort, NULL is a REAL value here:
        // it means "Any machine". newVal is either a machines.id or null (Any).
        setRequirement(prev => ({ ...prev, machine_fk: newVal }));
        // REST PUT NULL convention: the literal string 'NULL' clears the column.
        saveField('machine_fk', newVal === null ? 'NULL' : newVal);
    };

    // ── Req #3435 — seat this requirement on a step ─────────────────────────
    // WRITES `pipeline_step_requirements`, the junction that actually places a
    // requirement on a plan. There is no column on `requirements` that can do it.
    //
    // ## THIS CROSSES A LINE StepsPage DELIBERATELY DOES NOT, ON PURPOSE
    //
    // `src/Steps/StepsPage.jsx`'s header says it edits a step's own columns and
    // NOT this junction, because "a browser form that unlinks a requirement while
    // the 2.0 orchestration engine is polling that plan would race the launch
    // decision with no error anywhere" (req #3083's operating rule — plan edit and
    // launch are ONE act). That reasoning is unchanged and still correct.
    //
    // The user was shown the conflict and the mitigations available (a guard on
    // `orchestration_claims`, which the UI already reads, or refusing on an
    // `active` plan) and chose the unguarded write, 2026-08-10. So the race is a
    // KNOWN, ACCEPTED cost of editing a seat from here, not an oversight — do not
    // "fix" this by adding a silent refusal, and do not delete this note.
    //
    // ## Order of operations
    //
    // INSERT the new link, THEN delete the old. The reverse leaves the
    // requirement silently seated nowhere if the insert fails; this way a failed
    // delete leaves it on two steps, which the plan view shows and a person can
    // undo. Neither is good — this one is at least visible.
    const handleStepChange = async (event) => {
        if (isNew) return;   // draft — `id` is the literal 'new'.
        const raw = event.target.value;
        const clearing = raw === '';
        const nextStepId = clearing ? null : Number(raw);
        if (!clearing && !Number.isInteger(nextStepId)) return;
        const prevStepId = seatStep ? seatStep.id : null;
        if (nextStepId === prevStepId) return;

        const uri = `${darwinUri}/pipeline_step_requirements`;
        const reqId = parseInt(id);
        try {
            if (nextStepId != null) {
                await call_rest_api(uri, 'POST',
                    { step_fk: nextStepId, requirement_fk: reqId }, idToken);
            }
            if (prevStepId != null) {
                // Composite PK (step_fk, requirement_fk) — no surrogate id, so
                // the DELETE body names both columns. Same shape as
                // `unlinkFeatureTestCase` in Features/actions/validationApi.js.
                await call_rest_api(uri, 'DELETE',
                    { step_fk: prevStepId, requirement_fk: reqId }, idToken);
            }
        } catch (error) {
            showError(error, 'Unable to update step');
            // Re-read rather than patch local state: the seat lives in the
            // junction cache, not on the requirement row, and a half-applied
            // move is exactly the case a guessed rollback would get wrong.
            queryClient.invalidateQueries({
                queryKey: pipelineStepRequirementKeys.all(profile.userName) });
            return;
        }
        queryClient.invalidateQueries({
            queryKey: pipelineStepRequirementKeys.all(profile.userName) });
        queryClient.invalidateQueries({ queryKey: ['orchestration_index'] });
    };

    const handleCategoryChange = async (event) => {
        const newCategoryFk = parseInt(event.target.value, 10);
        if (!Number.isFinite(newCategoryFk)) return;  // ignore the placeholder value
        // Req #2818: only the forced-pick (category-was-unset) case jumps focus to
        // description afterward. Changing the category on an already-categorized
        // requirement leaves focus where it is.
        const wasCategoryUnset = !requirement?.category_fk;
        setRequirement(prev => ({ ...prev, category_fk: newCategoryFk }));

        // New-mode (req #2414): picking a category is the first save. POST creates
        // the requirement, then we navigate to the canonical detail URL.
        if (isNew) {
            // req #3007: ai_model + effort have NO database default — the caller
            // MUST send them, or the DB stores an invalid ''. Send the draft's
            // values (defaults: opus / high) explicitly.
            const draft = {
                title: requirement?.title || '',
                description: requirement?.description || '',
                requirement_status: requirement?.requirement_status || 'authoring',
                category_fk: newCategoryFk,
                project_fk: null,
                ai_model: requirement?.ai_model || 'opus',
                effort: requirement?.effort || 'high',
            };
            const postResult = await call_rest_api(`${darwinUri}/requirements`, 'POST', draft, idToken)
                .catch(() => null);
            if (!postResult || !postResult.httpStatus || postResult.httpStatus.httpStatus !== 200 ||
                !postResult.data || !postResult.data[0]) {
                setRequirement(prev => ({ ...prev, category_fk: null }));
                const err = postResult && postResult.httpStatus
                    ? postResult
                    : { httpStatus: { httpStatus: 'network error' } };
                showError(err, 'Unable to create requirement');
                return;
            }
            queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
            if (wasCategoryUnset) setFocusDescriptionPending(true);  // req #2818
            navigate(`/swarm/requirement/${postResult.data[0].id}`, { replace: true });
            return;
        }

        // Await the PUT so siblings refetch sees the committed category_fk
        const putResult = await call_rest_api(`${darwinUri}/requirements`, 'PUT', [{ id: parseInt(id), category_fk: newCategoryFk }], idToken)
            .catch(() => null);
        if (!putResult || (putResult.httpStatus.httpStatus !== 200 && putResult.httpStatus.httpStatus !== 204)) {
            showError(putResult, 'Unable to update category');
            return;
        }
        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
        if (wasCategoryUnset) setFocusDescriptionPending(true);  // req #2818

        // Refresh siblings and sort mode for the new category so prev/next navigation stays accurate
        const siblingFilter = siblingStatuses.length === ALL_REQUIREMENT_STATUSES.length
            ? ''
            : `&requirement_status=(${siblingStatuses.join(',')})`;
        try {
            const [siblingsResult, categoryResult] = await Promise.all([
                call_rest_api(`${darwinUri}/requirements?category_fk=${newCategoryFk}&fields=id,requirement_status,completed_at,deferred_at,started_at,sort_order${siblingFilter}`, 'GET', '', idToken).catch(() => null),
                call_rest_api(`${darwinUri}/categories?id=${newCategoryFk}&fields=id,sort_mode`, 'GET', '', idToken).catch(() => null),
            ]);
            if (siblingsResult?.httpStatus?.httpStatus === 200) setSiblings(siblingsResult.data || []);
            if (categoryResult?.httpStatus?.httpStatus === 200) setSibSortMode(coerceSortMode(categoryResult.data[0]?.sort_mode));
        } catch (e) {
            // siblings refresh is best-effort
        }
    };

    // Req #2818: when a category was just picked from the forced-pick state, move focus to
    // the description field. Runs once the flag is set and the input is mounted; in new-mode
    // the same effect re-fires after the post-navigate refetch replaces `requirement`.
    useEffect(() => {
        if (focusDescriptionPending && descriptionInputRef.current) {
            descriptionInputRef.current.focus();
            setFocusDescriptionPending(false);
        }
    }, [focusDescriptionPending, requirement]);

    // req #3302 — THE ELEVATOR'S POPULATION MUST BE THE CARD'S, not just its
    // ORDER. `requirementSort.js`'s header states the invariant ("prev/next
    // navigation matches the row order shown on the category card") and the two
    // comparators have always agreed; what diverged is WHICH ROWS they sort.
    // `CategoryCard` gained the pipelined filter in req #3258 and this list did
    // not, so with `hidePipelinedRequirements` on — its DEFAULT since req #3242 —
    // the siblings were a strict SUPERSET of the visible rows.
    //
    // Measured on `darwin_dev` category 1052 (Agents), default chips: the card's
    // first row (#3100) sat at sibling index 1 behind pipelined #3074, so Up was
    // enabled on the first row, and Down from it landed on pipelined #3136 —
    // a requirement the card does not show at all.
    //
    // req #3419 — no longer "the same predicate": it IS the predicate. The card,
    // the table, the aggregator and this elevator all read
    // `useRequirementVisibility().isVisible`, so there is no second derivation
    // left to drift. That also fixed the narrower half of the same defect —
    // requirements filed under an EPIC were never hidden anywhere.
    // req #3302 — the surface that opened this page hands over the ordered ids it
    // rendered (`elevatorStateFrom`), and that wins. It is the ONLY thing that
    // can be right for the SwarmStartCard aggregator, whose list is every
    // category under ONE status with its own filter and sort — nothing derivable
    // from this requirement's `category_fk`. A refresh or a pasted link carries
    // no state, and the category query below is the fallback.
    const linkOrderedIds = readElevatorIds(location.state);

    const { prevId, nextId } = useMemo(
        () => siblingElevator(siblings, {
            sortMode: sibSortMode,
            isVisible,
            currentId: id,
            orderedIds: linkOrderedIds,
        }),
        [siblings, sibSortMode, isVisible, id, linkOrderedIds],
    );

    const titleOverflow = Math.max(0, (requirement?.title || '').length - TITLE_SOFT_LIMIT);

    if (loading) return <CircularProgress />;
    if (!requirement) return <Typography>Requirement not found.</Typography>;

    const categoryUnset = !requirement.category_fk;

    // Req #2836 — page is wider than the prose column so the Linked Sessions
    // DataGrid (~770px of columns) fits without a horizontal scrollbar. The
    // editor controls above the table keep their readable width via NARROW.
    // Mirrors the page-width-vs-prose-width split in SwarmStartDetail.
    const NARROW = { maxWidth: 800 };
    return (
        <Box sx={{ p: 3, maxWidth: 1000 }} data-testid="requirement-detail">
            <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', ...NARROW }}>
                <Button variant="outlined"
                        onClick={handleBack}
                        data-testid="btn-back-to-swarm">
                    {backLabel}
                </Button>
            </Box>

            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, ...NARROW }}>
                {/* Req #3313 — ID moves onto the title line: "ID - Title" instead of
                    "Title" alone. New-mode (req #2424): kept in layout but
                    invisible, matching the other rows below, so the title's left
                    edge doesn't jump once the draft is saved and isNew flips.
                    Req #3313 reopen — "{id} -" instead of "ID - {id}", and no
                    explicit color so it inherits the same default text color as
                    the Title field next to it (which also sets none). */}
                {/* Req #3327 — fixed `width: ID_PREFIX_WIDTH` (module scope above), not a
                    content-sized box: the Title's text always starts at the same x (that
                    width plus this row's flex `gap`), regardless of the id's digit count.
                    Left-aligned by default, so a shorter id just leaves trailing space
                    before the Title field rather than shifting it. */}
                <Box component="span" data-testid="requirement-id"
                     sx={{
                         fontSize: 24, fontWeight: 500, flexShrink: 0, width: ID_PREFIX_WIDTH,
                         ...(isNew && { visibility: 'hidden' }),
                     }}>
                    {requirement.id} -
                </Box>
                <TextField
                    variant="standard"
                    value={requirement.title || ''}
                    onChange={(e) => setRequirement(prev => ({ ...prev, title: e.target.value }))}
                    onBlur={handleTitleBlur}
                    onKeyDown={handleTitleKeyDown}
                    onFocus={markUserInteracted}  // req #2884 — block late select autofocus steal
                    fullWidth
                    autoComplete="off"
                    slotProps={{
                        input: { style: { fontSize: 24, fontWeight: 500 } },
                        htmlInput: { maxLength: 256 }
                    }}
                    data-testid="requirement-title"
                />
                {titleOverflow > 0 && (
                    <Tooltip title={`${titleOverflow} over the ${TITLE_SOFT_LIMIT}-char soft limit (status line / tab title truncate past ${TITLE_SOFT_LIMIT})`} enterDelay={400}>
                        <Chip
                            label={`+${titleOverflow}`}
                            size="small"
                            variant="outlined"
                            sx={{ borderColor: '#fbc02d', color: '#b38600', fontWeight: 500, flexShrink: 0 }}
                            data-testid="title-overflow-chip"
                        />
                    </Tooltip>
                )}
            </Box>

            {/* Req #3313 — Category moves here, between the ID/Title line and Status,
                out of its former position directly above Description (which now
                gets the freed-up whitespace to itself, right below Machine).
                Category's own html/behavior is untouched — only its position and
                the now-relocated ID span (see the title line above) changed. */}
            <Box sx={{
                mb: 2, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', ...NARROW,
                color: categoryUnset ? 'error.main' : 'text.secondary',
                fontWeight: 'bold', fontSize: '1.25rem',
            }}>
                <Box component="span">Category -&nbsp;</Box>
                {allCategories ? (
                    <Select
                        // Req #2815: when the category is unset (the aggregator-template /
                        // "new" case) focus the category select, not description. The user
                        // presses ArrowDown to open the list, picks a category, and then
                        // lands in description (which autofocuses once a category is set).
                        // Req #2884: suppress this if the user already focused a field — the
                        // select mounts late (after the categories query resolves) and would
                        // otherwise steal focus from the field being typed in.
                        autoFocus={categoryUnset && !userInteractedRef.current}
                        value={requirement.category_fk || ''}
                        onChange={handleCategoryChange}
                        displayEmpty
                        renderValue={(selected) => {
                            if (!selected) return 'Must Select';
                            const cat = allCategories.find(c => c.id === selected);
                            return cat ? cat.category_name : '';
                        }}
                        variant="standard"
                        IconComponent={() => null}
                        data-testid="requirement-category-select"
                        sx={{
                            fontSize: '1.25rem',
                            fontWeight: 'bold',
                            color: categoryUnset ? 'error.main' : 'text.secondary',
                            '& .MuiSelect-select': { py: 0, pr: '0 !important' },
                            '&:before': { borderBottomColor: 'transparent' },
                            '&:hover:not(.Mui-disabled):before': { borderBottomColor: 'rgba(0,0,0,0.3)' },
                        }}
                    >
                        {allCategories.map(cat => (
                            <MenuItem key={cat.id} value={cat.id} sx={{ fontSize: '1.25rem' }}>
                                {cat.category_name}
                            </MenuItem>
                        ))}
                    </Select>
                ) : (
                    <Box component="span">—</Box>
                )}
                {/* Req #3327 — Prev/Next/Duplicate/Delete move here from the Status row,
                    right-aligned with this row's right edge: it shares the Title row's
                    NARROW max-width, so `ml: 'auto'` pushes the group there — which
                    coincides with the title editor's own right edge except while the
                    title-overflow chip is showing (that chip, not the editor, then sits
                    flush with the edge). `alignSelf: 'center'` keeps the icon buttons
                    vertically centered regardless of this row's `alignItems: 'baseline'`
                    (set for the Category text/select). `spacing={1}` matches the 8px gap
                    the old Status row gave these same four buttons. Same new-mode
                    invisibility as before the move. */}
                <Stack direction="row" alignItems="center" spacing={1} data-testid="requirement-nav-actions"
                       sx={{
                           ml: 'auto', alignSelf: 'center',
                           ...(isNew && { visibility: 'hidden', pointerEvents: 'none' }),
                       }}>
                    <Tooltip title="Previous requirement" enterDelay={400}>
                        <span>
                            <IconButton
                                onClick={() => navigate(`/swarm/requirement/${prevId}`, { state: location.state })}
                                disabled={!prevId}
                                aria-label="Previous requirement"
                                data-testid="btn-prev-requirement"
                                sx={{ maxWidth: 25, maxHeight: 25 }}
                            >
                                <NorthIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title="Next requirement" enterDelay={400}>
                        <span>
                            <IconButton
                                onClick={() => navigate(`/swarm/requirement/${nextId}`, { state: location.state })}
                                disabled={!nextId}
                                aria-label="Next requirement"
                                data-testid="btn-next-requirement"
                                sx={{ maxWidth: 25, maxHeight: 25 }}
                            >
                                <SouthIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                    {!isNew && (
                        <Tooltip title="Duplicate requirement" enterDelay={400} enterNextDelay={200}>
                            <IconButton
                                onClick={handleDuplicate}
                                data-testid="btn-duplicate-requirement"
                                sx={{ maxWidth: '25px', maxHeight: '25px' }}
                            >
                                <ContentCopyIcon />
                            </IconButton>
                        </Tooltip>
                    )}
                    <Tooltip title="Delete requirement" enterDelay={400} enterNextDelay={200}>
                        <IconButton
                            onClick={() => requirementDelete.openDialog({ requirementId: parseInt(id) })}
                            data-testid="btn-delete-requirement"
                            sx={{ maxWidth: '25px', maxHeight: '25px' }}
                        >
                            <DeleteIcon />
                        </IconButton>
                    </Tooltip>
                </Stack>
            </Box>

            {/* New-mode (req #2424): keep this row in the layout but invisible so
                Description below doesn't shift when the requirement is saved
                and the row becomes visible. */}
            <Box sx={{
                display: 'flex', gap: 1, mb: 2, alignItems: 'center', flexWrap: 'wrap', ...NARROW,
                ...(isNew && { visibility: 'hidden', pointerEvents: 'none' }),
            }}>
                {/* Req #3327 — fixed `width` (SETTINGS_LABEL_WIDTH, module scope above), not
                    `minWidth`, so the "Authoring" chip's text lands under the Title's text.
                    A `minWidth` floor a wider label's own text could exceed would let the
                    next flex item (the chip Stack) start at a variable x — a fixed `width`
                    guarantees it stays put; `flexShrink: 0`/`whiteSpace: 'nowrap'` keep that
                    width from being negotiated away or wrapped onto two lines.
                    `overflow`/`textOverflow: 'ellipsis'` are a defensive fallback only — the
                    constant is already sized for this row's longest label ("Autonomy"). */}
                <Typography variant="subtitle2" color="text.secondary"
                            sx={{ width: SETTINGS_LABEL_WIDTH, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Status
                </Typography>
                <Stack direction="row" spacing={0.5} data-testid="requirement-state-selector">
                    {[
                        { value: 'authoring',   label: 'Authoring', chipSx: { bgcolor: '#fbc02d', color: '#000' } },
                        { value: 'approved',    label: 'Approved',  chipSx: { bgcolor: '#90caf9', color: '#000' } },
                        { value: 'swarm_ready', label: 'Swarm-Start', chipSx: { bgcolor: '#1976d2', color: '#fff' } },
                        { value: 'development', label: 'Dev',       chipSx: { bgcolor: '#81c784', color: '#000' } },
                        { value: 'met',         label: 'Met',       chipSx: { bgcolor: '#2e7d32', color: '#fff' } },
                        { value: 'deferred',    label: 'Deferred',  chipSx: { bgcolor: '#ff9800', color: '#fff' } },
                        { value: 'wontfix',     label: "Won't Fix", chipSx: { bgcolor: '#9e9e9e', color: '#fff' } },
                    ].map(({ value, label, color, chipSx }) => {
                        const selected = currentStatus === value;
                        return (
                            <Chip
                                key={value}
                                label={label}
                                size="small"
                                onClick={() => handleStatusChange(null, value)}
                                data-testid={`state-${value}`}
                                {...(selected
                                    ? (chipSx ? { sx: { ...chipSx, cursor: 'pointer' } } : { color, sx: { cursor: 'pointer' } })
                                    : { variant: 'outlined', sx: { cursor: 'pointer', opacity: 0.6 } }
                                )}
                            />
                        );
                    })}
                </Stack>
            </Box>

            {/* Autonomy — editable during authoring/approved/swarm_ready, full opacity whenever editable, faded+disabled otherwise (req #3054).
                Fade tracks EDITABILITY, not swarm_ready alone: fading it during authoring/approved
                misrepresented a fully-editable control as disabled (same fix as AI Settings/Machine pin, req #3008).
                New-mode (req #2424): kept in layout but invisible so Description below doesn't shift when the requirement is saved. */}
            {(() => {
                const isEditable = ['authoring', 'approved', 'swarm_ready'].includes(currentStatus);
                const isFaded = !isEditable;

                return (
                    <Box sx={{
                        display: 'flex', gap: 1, mb: 2, alignItems: 'center', ...NARROW,
                        opacity: isFaded ? 0.4 : 1,
                        ...(isNew && { visibility: 'hidden', pointerEvents: 'none' }),
                    }}>
                        {/* Req #3327 — same computed SETTINGS_LABEL_WIDTH as Status above (as a
                            fixed `width`, not a `minWidth` floor — see that row's comment). */}
                        <Typography variant="subtitle2" color={isFaded ? 'text.disabled' : 'text.secondary'}
                                    sx={{ width: SETTINGS_LABEL_WIDTH, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            Autonomy
                        </Typography>
                        <Stack direction="row" spacing={0.5} data-testid="coordination-type-selector">
                            {[
                                { value: 'discuss',     label: 'Discuss Req', chipSx: { bgcolor: COORDINATION_COLOR.discuss,     color: '#000' } },
                                { value: 'planned',     label: 'Planned',     chipSx: { bgcolor: COORDINATION_COLOR.planned,     color: '#000' } },
                                { value: 'implemented', label: 'Implemented', chipSx: { bgcolor: COORDINATION_COLOR.implemented, color: '#000' } },
                                { value: 'deployed',    label: 'Deployed',    chipSx: { bgcolor: COORDINATION_COLOR.deployed,    color: '#000' } },
                            ].map(({ value, label, color, chipSx }) => {
                                const selected = requirement.coordination_type === value;
                                return (
                                    <Chip
                                        key={value}
                                        label={label}
                                        size="small"
                                        disabled={!isEditable}
                                        onClick={() => { if (!selected) handleCoordinationChange(null, value); }}
                                        {...(selected
                                            ? (chipSx ? { sx: { ...chipSx, cursor: isEditable ? 'pointer' : 'default' } } : { color, sx: { cursor: isEditable ? 'pointer' : 'default' } })
                                            : { variant: 'outlined', sx: { cursor: isEditable ? 'pointer' : 'default', opacity: !isEditable ? 0.3 : 0.6 } }
                                        )}
                                    />
                                );
                            })}
                        </Stack>
                    </Box>
                );
            })()}

            {/* Model + Effort (req #2909 / #2916) — the Claude launch settings, grouped in one
                rounded-rectangle area directly below Autonomy with identical editability and
                new-mode rules. Fade, however, tracks EDITABILITY (like the Machine pin), not
                swarm_ready alone (req #3008) — so it stays full opacity in authoring/approved.
                Pre-migration rows fall back to 'opus' / 'high' (the documented backfill defaults). */}
            {(() => {
                // Req #3008 — AI Settings (Model + Effort) fade only when NOT editable.
                // They are a planning-time decision the user makes while authoring/approved,
                // so fading them there misrepresented fully-editable controls as disabled.
                const isEditable = ['authoring', 'approved', 'swarm_ready'].includes(currentStatus);
                const isFaded = !isEditable;
                const currentModel = requirement.ai_model || 'opus';
                const currentEffort = requirement.effort || 'high';
                const rowSx = { display: 'flex', gap: 1, alignItems: 'center' };
                const labelColor = isFaded ? 'text.disabled' : 'text.secondary';

                return (
                    // Row pairing AI Settings with the Epic linkage box (req #3234) — the
                    // same flex-row idiom the Requirement/Session timings pair below uses.
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap', mb: 2 }}>
                    {/* A real <fieldset>/<legend> pair so the "AI Settings" caption sits ON the
                        border line at top-left with the line notched behind the text. */}
                    <Box
                        component="fieldset"
                        data-testid="launch-settings-group"
                        sx={{
                            width: 'fit-content', maxWidth: '100%',
                            m: 0, px: 1.5, pt: 0.25, pb: 1.25,
                            display: 'flex', flexDirection: 'column', gap: 1.5,
                            border: 1, borderColor: 'common.white', borderRadius: 2,
                            opacity: isFaded ? 0.4 : 1,
                            ...(isNew && { visibility: 'hidden', pointerEvents: 'none' }),
                        }}
                    >
                        <Box component="legend" sx={{ ml: 1, px: 0.5 }}>
                            <Typography variant="subtitle2" color={labelColor}>
                                AI Settings
                            </Typography>
                        </Box>
                        <Box sx={rowSx}>
                            {/* Req #3327 — FIELDSET_LABEL_WIDTH already nets out this fieldset's
                                own left border+padding, so this row's first chip text lands
                                under the Title's text exactly like the top-level rows. Fixed
                                `width` (not `minWidth`) for the same reason as Status/Autonomy. */}
                            <Typography variant="subtitle2" color={labelColor}
                                        sx={{ width: FIELDSET_LABEL_WIDTH, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                Model
                            </Typography>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap data-testid="ai-model-selector">
                                {AI_MODELS.map((value) => {
                                    const selected = currentModel === value;
                                    return (
                                        <Chip
                                            key={value}
                                            label={aiModelLabel(value)}
                                            size="small"
                                            disabled={!isEditable}
                                            onClick={() => { if (!selected) handleModelChange(null, value); }}
                                            data-testid={`model-${value}`}
                                            {...(selected
                                                ? { sx: { bgcolor: AI_MODEL_COLOR[value], color: '#000', cursor: isEditable ? 'pointer' : 'default' } }
                                                : { variant: 'outlined', sx: { cursor: isEditable ? 'pointer' : 'default', opacity: !isEditable ? 0.3 : 0.6 } }
                                            )}
                                        />
                                    );
                                })}
                            </Stack>
                        </Box>
                        <Box sx={rowSx}>
                            {/* Req #3327 — same FIELDSET_LABEL_WIDTH as Model above (fixed `width`). */}
                            <Typography variant="subtitle2" color={labelColor}
                                        sx={{ width: FIELDSET_LABEL_WIDTH, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                Effort
                            </Typography>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap data-testid="effort-selector">
                                {EFFORTS.map((value) => {
                                    const selected = currentEffort === value;
                                    return (
                                        <Chip
                                            key={value}
                                            label={effortLabel(value)}
                                            size="small"
                                            disabled={!isEditable}
                                            onClick={() => { if (!selected) handleEffortChange(null, value); }}
                                            data-testid={`effort-${value}`}
                                            {...(selected
                                                ? { sx: { bgcolor: EFFORT_COLOR[value], color: '#000', cursor: isEditable ? 'pointer' : 'default' } }
                                                : { variant: 'outlined', sx: { cursor: isEditable ? 'pointer' : 'default', opacity: !isEditable ? 0.3 : 0.6 } }
                                            )}
                                        />
                                    );
                                })}
                            </Stack>
                        </Box>
                    </Box>

                    {/* ── Orchestration (req #3435) ──────────────────────────────
                        WHICH PLAN and WHICH EPIC, in two rows and nothing else.
                        Same fieldset/legend/border/radius as AI Settings so the
                        two read as a pair.

                        Each row is one ICON BUTTON that navigates and one SELECT
                        that names the thing — the Category select's idiom
                        (standard variant, no dropdown arrow, the value rendered
                        as text), so the box reads as prose until it is clicked.

                        The pipeline row WRITES NOTHING: there is no
                        `requirements.pipeline_fk`, and a seat on a plan is a
                        `pipeline_steps` mutation the Primary AI owns. It displays
                        the plan this requirement is on and filters the epic list.
                        The epic row is the one that assigns.

                        No third line. The `via feature "…"` caption this box used
                        to carry is deliberately gone: the feature tier is the
                        SEAT that carries an epic label, not a fact the reader of
                        a requirement needs. */}
                    <Box
                        component="fieldset"
                        data-testid="requirement-orchestration-group"
                        sx={{
                            width: 'fit-content', maxWidth: '100%',
                            m: 0, px: 1.5, pt: 0.25, pb: 1.25,
                            display: 'flex', flexDirection: 'column', gap: 0.5,
                            border: 1, borderColor: 'common.white', borderRadius: 2,
                            ...(isNew && { visibility: 'hidden', pointerEvents: 'none' }),
                        }}
                    >
                        <Box component="legend" sx={{ ml: 1, px: 0.5 }}>
                            <Typography variant="subtitle2" color="text.secondary">
                                Orchestration
                            </Typography>
                        </Box>
                        {!orchSettled ? (
                            <Typography variant="body2" color="text.secondary" data-testid="orchestration-loading">
                                Loading…
                            </Typography>
                        ) : (epicSideErrored && planSideErrored) ? (
                            // Distinct from an empty selection — a failed read is
                            // not the same fact as a confirmed-absent link, and
                            // offering an assignment list built from rows that
                            // never arrived would silently omit real options.
                            <Typography variant="body2" color="text.secondary" data-testid="orchestration-error">
                                Orchestration unavailable
                            </Typography>
                        ) : (
                            <>
                                {/* ── PIPELINE ── read-only. LanIcon matches the
                                    Pipelines nav entry's own icon — the app's
                                    existing iconography, not one invented here. */}
                                {planSideErrored ? (
                                    <Typography variant="body2" color="text.secondary"
                                                data-testid="orchestration-pipeline-error">
                                        Pipeline unavailable
                                    </Typography>
                                ) : (
                                <Stack direction="row" spacing={1} alignItems="center"
                                       data-testid="orchestration-pipeline-row">
                                    <Typography variant="subtitle2" color="text.secondary"
                                                sx={ORCH_ROW_LABEL_SX}
                                                data-testid="orchestration-pipeline-label">
                                        Pipeline
                                    </Typography>
                                    <Tooltip title="View this plan on the visualizer">
                                        {/* SPAN WRAPPER: a disabled MUI button
                                            fires no events, so a Tooltip anchored
                                            straight to it never opens — and the
                                            disabled state is the common one for a
                                            requirement on no plan. */}
                                        <span>
                                            <IconButton
                                                size="small"
                                                disabled={!pipelineLink}
                                                aria-label="View this plan on the visualizer"
                                                data-testid="orchestration-pipeline-link"
                                                {...(pipelineLink ? { component: RouterLink, to: pipelineLink } : {})}
                                            >
                                                <LanIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Typography sx={ORCH_VALUE_SX} data-testid="orchestration-pipeline-value">
                                        {shownPipelineRow ? shownPipelineRow.title
                                            : shownPipelineId != null ? `Pipeline ${shownPipelineId}`
                                                : 'No pipeline'}
                                    </Typography>
                                </Stack>
                                )}

                                {/* ── EPIC ── read-only. An epic is reached only
                                    through `requirements.feature_fk`, and which
                                    feature carries it is an editorial choice this
                                    page stopped guessing (req #3453 holds the
                                    question of setting it from here at all).
                                    LayersIcon matches the Epics nav entry. */}
                                {epicSideErrored ? (
                                    <Typography variant="body2" color="text.secondary"
                                                data-testid="orchestration-epic-error">
                                        Epic unavailable
                                    </Typography>
                                ) : (
                                <Stack direction="row" spacing={1} alignItems="center"
                                       data-testid="orchestration-epic-row">
                                    <Typography variant="subtitle2" color="text.secondary"
                                                sx={ORCH_ROW_LABEL_SX}
                                                data-testid="orchestration-epic-label">
                                        Epic
                                    </Typography>
                                    <Tooltip title="View this epic's location on the plan visualizer">
                                        <span>
                                            <IconButton
                                                size="small"
                                                disabled={!epicPlanLink}
                                                // NAMES THE EPIC: a reader tabbing
                                                // the box otherwise cannot tell
                                                // which epic this opens.
                                                aria-label={currentEpicRow
                                                    ? `View epic ${currentEpicRow.title} on the plan visualizer`
                                                    : "View this epic's location on the plan visualizer"}
                                                data-testid="orchestration-epic-link"
                                                {...(epicPlanLink
                                                    ? { component: RouterLink, to: epicPlanLink } : {})}
                                            >
                                                <LayersIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Typography sx={ORCH_VALUE_SX} data-testid="orchestration-epic-value">
                                        {currentEpicRow ? currentEpicRow.title
                                            : currentFeatureFk != null ? `Feature ${currentFeatureFk}`
                                                : 'No epic'}
                                    </Typography>
                                </Stack>
                                )}

                                {/* ── STEP ── THE ONE SETTABLE LEVEL. Picking here
                                    writes `pipeline_step_requirements` — see
                                    `handleStepChange` for why that crosses a line
                                    StepsPage draws, and on whose authority.

                                    The list is scoped to this plan and this epic
                                    (`stepOptions`), so a pick can never move the
                                    requirement to another epic — which is what
                                    keeps the three rows consistent without a
                                    second write. An em-dash value IS "no step
                                    sequences this requirement", the distinction
                                    the sync report splits into UNSEATED-REQS and
                                    ORPHANS. */}
                                {planSideErrored ? null : (
                                <Stack direction="row" spacing={1} alignItems="center"
                                       data-testid="orchestration-step-row">
                                    <Typography variant="subtitle2" color="text.secondary"
                                                sx={ORCH_ROW_LABEL_SX}
                                                data-testid="orchestration-step-label">
                                        Step
                                    </Typography>
                                    <Tooltip title="View this requirement's step on the plan visualizer">
                                        <span>
                                            <IconButton
                                                size="small"
                                                disabled={!stepPlanLink}
                                                aria-label="View this requirement's step on the plan visualizer"
                                                data-testid="orchestration-step-link"
                                                {...(stepPlanLink ? { component: RouterLink, to: stepPlanLink } : {})}
                                            >
                                                <AccountTreeIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Select
                                        value={seatStep ? seatStep.id : ''}
                                        onChange={handleStepChange}
                                        displayEmpty
                                        renderValue={(selected) => {
                                            if (selected === '' || selected == null) return 'No step';
                                            const st = orchIndex.stepsById.get(Number(selected));
                                            return (st && st.title) ? st.title : `Step ${selected}`;
                                        }}
                                        variant="standard"
                                        IconComponent={() => null}
                                        data-testid="orchestration-step-select"
                                        // Lands on the role="combobox" element
                                        // (`.MuiSelect-select`), not on the hidden
                                        // native input — without it a screen reader
                                        // announces the display VALUE as the
                                        // control's own name.
                                        inputProps={{ 'aria-label': 'Step' }}
                                        sx={ORCH_SELECT_SX}
                                    >
                                        <MenuItem value="">No step</MenuItem>
                                        {stepChoices.map(entry => (
                                            <MenuItem key={entry.step.id} value={entry.step.id}>
                                                {entry.label}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </Stack>
                                )}
                            </>
                        )}
                    </Box>
                    </Box>
                );
            })()}

            {/* Machine pin (req #2978) — WHERE this requirement is allowed to run.
                "Any" (NULL) is the default and the common case; a pin restricts
                /swarm-start, /swarm-restart and /swarm-resume to that machine.
                Same editability/fade/new-mode rules as Autonomy/Model/Effort.
                Chips are deliberately NEUTRAL (outlined → filled when selected):
                machines are an open set, so there is no per-machine color file
                to mirror modelChipStyles/effortChipStyles. */}
            {(() => {
                // The Machine pin is editable in authoring, approved AND swarm_ready.
                // Fade tracks EDITABILITY, not swarm_ready alone: the pin is a
                // planning-time decision the user makes while authoring, so fading it
                // in authoring/approved would misrepresent a fully-editable control as
                // disabled. (The AI Settings group above now uses this same
                // editability-based fade rule — req #3008.)
                const isEditable = ['authoring', 'approved', 'swarm_ready'].includes(currentStatus);
                const isFaded = !isEditable;
                const labelColor = isFaded ? 'text.disabled' : 'text.secondary';
                const currentMachine = requirement.machine_fk ?? null;
                // A pin pointing at a machine that is closed (or already gone
                // from the list) still has to render — otherwise the chip row
                // would silently show "Any" for a requirement that is in fact
                // pinned, and the user could never see or clear it.
                const pinnedMachineMissing =
                    currentMachine !== null &&
                    !openMachines.some(m => m.id === currentMachine);
                const pinnedMachine = pinnedMachineMissing
                    ? (machinesData || []).find(m => m.id === currentMachine)
                    : null;

                return (
                    <Box sx={{ mb: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', ...NARROW,
                               opacity: isFaded ? 0.4 : 1,
                               ...(isNew && { visibility: 'hidden', pointerEvents: 'none' }) }}>
                        {/* Req #3327 — same computed SETTINGS_LABEL_WIDTH as Status/Autonomy
                            (fixed `width`, not `minWidth` — see the Status row's comment). */}
                        <Typography variant="subtitle2" color={labelColor}
                                    sx={{ width: SETTINGS_LABEL_WIDTH, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            Machine
                        </Typography>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap data-testid="machine-selector">
                            {[
                                { id: null, label: 'Any' },
                                ...openMachines.map(m => ({ id: m.id, label: m.title })),
                                // Retired-but-pinned tail entry (see above).
                                ...(pinnedMachineMissing
                                    ? [{ id: currentMachine,
                                         label: pinnedMachine ? `${pinnedMachine.title} (retired)` : `#${currentMachine}` }]
                                    : []),
                            ].map(({ id: machineId, label }) => {
                                const selected = currentMachine === machineId;
                                return (
                                    <Chip
                                        key={machineId === null ? 'any' : machineId}
                                        label={label}
                                        size="small"
                                        disabled={!isEditable}
                                        // `disabled` only stops pointer events via CSS on a
                                        // MUI Chip — guard the handler too so a non-editable
                                        // status can never write a pin.
                                        onClick={() => { if (isEditable && !selected) handleMachineChange(machineId); }}
                                        data-testid={`machine-${machineId === null ? 'any' : machineId}`}
                                        {...(selected
                                            ? { sx: { cursor: isEditable ? 'pointer' : 'default' } }
                                            : { variant: 'outlined', sx: { cursor: isEditable ? 'pointer' : 'default', opacity: !isEditable ? 0.3 : 0.6 } }
                                        )}
                                    />
                                );
                            })}
                        </Stack>
                    </Box>
                );
            })()}

            <Box sx={{ mb: 2, ...NARROW }}>
                <Typography
                    variant="subtitle2"
                    color={categoryUnset ? 'error.main' : 'text.secondary'}
                    sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}
                >
                    Description
                </Typography>
                <TextField
                    variant="outlined"
                    value={requirement.description || ''}
                    onChange={(e) => setRequirement(prev => ({ ...prev, description: e.target.value }))}
                    onBlur={handleDescriptionBlur}
                    onFocus={markUserInteracted}  // req #2884 — block late select autofocus steal
                    fullWidth
                    multiline
                    minRows={3}
                    autoComplete="off"
                    autoFocus={!categoryUnset && !userInteractedRef.current}
                    inputRef={descriptionInputRef}
                    size="small"
                    data-testid="requirement-description"
                    sx={categoryUnset ? { '& .MuiInputBase-input': { color: 'error.main' } } : undefined}
                />
            </Box>

            {!isNew && (
            <Box sx={{ display: 'flex', gap: 4, mb: 3, ...NARROW }}>
                {/* Requirement timings — left column */}
                <Box sx={{ flex: 1 }}>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Requirement Created</Typography>
                        <Typography variant="body2" data-testid="requirement-create-ts">
                            {requirement.create_ts ? formatDateTime(requirement.create_ts, timezone) : '—'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Requirement Updated</Typography>
                        <Typography variant="body2" data-testid="requirement-update-ts">
                            {requirement.update_ts ? formatDateTime(requirement.update_ts, timezone) : '—'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Requirement Deferred</Typography>
                        <Typography variant="body2" data-testid="requirement-deferred-at">
                            {requirement.deferred_at ? formatDateTime(requirement.deferred_at, timezone) : '—'}
                        </Typography>
                    </Box>
                </Box>
                {/* Session timings — right column */}
                <Box sx={{ flex: 1 }}>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>Swarm Started</Typography>
                        <Typography variant="body2" data-testid="requirement-started-at">
                            {requirement.started_at ? formatDateTime(requirement.started_at, timezone) : '—'}
                        </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>{requirement.requirement_status === 'wontfix' ? "Won't Fix" : 'Requirement Met'}</Typography>
                        <Typography variant="body2" data-testid="requirement-completed-at">
                            {requirement.completed_at ? formatDateTime(requirement.completed_at, timezone) : '—'}
                        </Typography>
                    </Box>
                </Box>
            </Box>
            )}

            {!isNew && (
                <>
                    <Typography variant="h6" gutterBottom>Linked Sessions</Typography>
                    {sessions.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" data-testid="no-linked-sessions">
                            No sessions linked to this requirement.
                        </Typography>
                    ) : (
                        <Box data-testid="linked-sessions-grid">
                            <DataGrid
                                autoHeight
                                rows={sessionRows}
                                columns={getSessionColumns(navigate, timezone)}
                                density="compact"
                                disableRowSelectionOnClick
                                onRowClick={(params) => navigate(`/swarm/session/${params.id}`)}
                                sx={{ cursor: 'pointer' }}
                            />
                        </Box>
                    )}
                </>
            )}

            <RequirementDeleteDialog
                deleteDialogOpen={requirementDelete.dialogOpen}
                setDeleteDialogOpen={requirementDelete.setDialogOpen}
                setDeleteId={requirementDelete.setInfoObject}
                setDeleteConfirmed={requirementDelete.setConfirmed}
                requirement={requirement}
            />

            <Dialog
                open={requirementReopen.dialogOpen}
                onClose={() => { requirementReopen.setDialogOpen(false); requirementReopen.setInfoObject({}); }}
                data-testid="requirement-reopen-dialog"
            >
                <DialogTitle>
                    {requirementReopen.infoObject.targetStatus === 'deferred' ? 'Defer Requirement' : 'Re-open Requirement'}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {requirementReopen.infoObject.targetStatus === 'deferred'
                            ? 'This will clear the completion date and mark the requirement as deferred. Continue?'
                            : 'Re-opening will clear the completion date. Continue?'}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { requirementReopen.setConfirmed(true); requirementReopen.setDialogOpen(false); }} variant="outlined">
                        {requirementReopen.infoObject.targetStatus === 'deferred' ? 'Defer' : 'Re-open'}
                    </Button>
                    <Button onClick={() => { requirementReopen.setDialogOpen(false); requirementReopen.setInfoObject({}); }} variant="outlined" autoFocus>
                        Cancel
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default RequirementDetail;
