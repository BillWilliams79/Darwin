// /swarm/pipelines — the plan-layer pipelines editor (req #3393).
//
// Renders at the route `planListRoutePath()`
// registers in index.jsx — it supersedes that requirement's deliberately-thin
// `PipelinesPage.jsx` placeholder, exactly as that file's own header
// anticipated ("either where they land or it is deleted in favour of the page
// that has them"). Never touches `/swarm/pipelines` (1.0) or its component.
//
// Cards + Table, like 1.0's PipelinesPage.jsx — the Cards/Table toggle, the
// status filter, and browsing the plan set were the pieces missing after the
// first pass (found in manual review): this page IS the 2.0 producer
// `/swarm/pipeline/:id` (the visualizer, req #3463/#3372) needs to be
// reachable from, so it has to be a real browsing surface, not just an
// editor grid. Table view is that editor grid (lock toggle,
// description dialog) — Cards view is `PipelinesCardsView.jsx`, a new file
// adapted from `PipelineCardsView.jsx`.
//
// Two ways to create a pipeline here (req #3773), both writing through
// `useCreatePipeline`: the header's "New pipeline" button and dialog
// (`NewPipelineDialog.jsx` — title, goal, machine; both views; opens the plan)
// and the Cards view's "+ New pipeline" tile (`NewPipelineCard.jsx`), which
// since req #3804 puts an unsaved card at the FRONT of the grid and makes the
// plan there, in place. Both write the new plan below every existing
// `sort_order`, so a new plan is always first.
//
// ── REQ #3804: EDIT IN PLACE, HAND-SORTED, LIVE ─────────────────────────────
// * The Cards view is the editor: title, goal, machine, status and lock are
//   changed on the card (`PipelinesCardsView.jsx`), and cards are dragged into
//   the reader's own order, held in `pipelines.sort_order`.
// * The `closed` flag #3804 added is GONE (req #3965): a finished plan is one
//   whose STATUS is terminal (met, won't fix, deferred), and the status pills
//   — the four non-terminal values lit by default — are what put it away.
// * The page's reads POLL (`LIVE_REFRESH_MS`) — status, counts, holders and
//   thumbnails are written by swarm workers and engines in other processes,
//   which no invalidation in this browser ever hears, so before this the
//   cards stayed as they were when the page loaded until the window lost and
//   regained focus.
//
// `pipeline_status` is EDITED here (req #3965), in both views, through the one
// status control (`PipelineStatusChip.jsx`): any of the seven values, freely,
// as a requirement's status is set. The started_at/completed_at side effects
// are the GATEWAY's (Lambda-Rest pipeline_lifecycle.py derives them for every
// writer), so this page sends the status alone.
//
// Query layer, chip styles, orchestration-holder and the plan-place memory
// are the SHARED files (`useDataQueries.js`, `pipelineChipStyles.js`,
// `orchestrationHolder.js`, `pipelinePlace.js`) rather than parallel copies —
// req #3463 established that additive-extension convention first, and this
// page follows it. `pipelinesViewModel.js` is the one genuinely NEW model
// here: the epic count and the requirement met/total counts, neither
// of which needs (or fabricates) the unverified 1.0 derivation engine — see
// that file's header.
//
// NOT ported: the "resume to the plan I was last reading" auto-redirect
// PipelinesPage.jsx performs on mount. That is real complexity (four
// conditions, a settle effect, a monotonic ref) built for a list a reader
// returns to daily; the 2.0 list has a handful of rows today.
//
// It used to READ that mark to highlight the last-opened card; req #3365
// removed the highlight on the user's directive ("Remove 'last viewed'
// entirely"), so this page now neither reads the mark nor redirects on it.
// `PipelineDetail.jsx` still WRITES it on arrival and this page still prunes
// per-plan storage against the live id set — the record is alive, it simply
// has no decoration on this surface any more.
//
// ── REQ #3978: ALL ACTIVE ───────────────────────────────────────────────────
// The plan visualizer's Active box (`PlanActiveBox.jsx`, req #3721) — the SAME
// component, named "All Active" — fed every plan's requirements whose latest
// session is under way (`allActiveRequirements`). No sort and no source
// column, by directive. It costs THREE more list reads on this page's poll
// (the requirement↔session junction, a light session projection and
// `dev_servers` — what the plan page reads for the same box) and a wider
// requirement projection: the title and the columns the reader's colour key
// paints the ids with.

import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewInArIcon from '@mui/icons-material/ViewInAr';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {
    useMachines,
    useAllPipelines,
    pipelineKeys,
    useAllInitiatives,
    useAllPipelineEpics,
    useAllPipelineEpicRequirements,
    useAllInitiativeDeps,
    useAllRequirements,
    useOrchestrationClaims,
    useAllRequirementSessions,
    useAllSessionTerminals,
    useDevServers,
    initiativeKeys,
    pipelineEpicKeys,
    pipelineEpicRequirementKeys,
    pipelineEpicDepKeys,
    initiativeDepKeys,
} from '../hooks/useDataQueries';
import { pipelineComposeKeys, requirementKeys } from '../hooks/useQueryKeys';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useViewPreference } from '../hooks/useViewPreference';
import normalizeView from '../Components/ViewerHeader/normalizeView';
import ViewerHeader from '../Components/ViewerHeader/ViewerHeader';
import ChipFilter from '../Components/ChipFilter';
import { formatDateTime } from '../utils/dateFormat';
import {
    pipelineStatusChipProps,
    pipelineStatusLabel,
    lockedChipProps,
    lockedLabel,
    PIPELINE_STATUS_VALUES,
    DEFAULT_PIPELINE_STATUSES,
    NEW_PIPELINE_STATUS,
} from '../SwarmView/pipelines/pipelineChipStyles';
import {
    hiddenPipelineStatusCounts,
    buildSessionStatusIndex,
} from '../SwarmView/pipelines/pipelineViewModel';
// req #3978 — the All Active box: the plan's Active box and what feeds it.
import PlanActiveBox from '../SwarmView/pipelines/PlanActiveBox';
import { buildReqPills } from '../SwarmView/pipelines/planReqPills';
import { buildReqColorViews, reqIdStyle } from '../SwarmView/pipelines/pipelinePlanLayout';
import { usePlanViewSetting } from '../SwarmView/pipelines/planViewSettings';
import { useAllActiveBoxStore } from '../stores/usePlanActiveBoxStore';
// req #3463/#3372 built the reachable 2.0 visualizer at
// planDetailPath(id). This list is that visualizer's PRODUCER
// (the whole reason it was safe to ship) — a row here has to open it, or the
// producer/consumer pair is only reachable by hand-typing a URL.
import { planDetailPath } from '../SwarmView/pipelines/planEra';
// `readPipelinePlace` went with the last-viewed decoration (req #3365) — this
// page has no remaining reader of the mark. `prunePipelineStorage` stays: it is
// the orphan sweep for per-plan camera/scroll keys and has nothing to do with
// the mark.
import { prunePipelineStorage } from '../SwarmView/pipelines/pipelinePlace';
import {
    pipelineSummaries, pipelineRequirementCounts, orderPipelines, frontSortOrder,
    reorderPipelines, withPositions, allActiveRequirements,
} from './pipelinesViewModel';
import PipelinesCardsView from './PipelinesCardsView';
import PipelineStatusChip from './PipelineStatusChip';
import NewPipelineDialog from './NewPipelineDialog';
import useCreatePipeline from './useCreatePipeline';
import { updatePipeline, updatePipelines, deletePipeline, REST_NULL } from './pipelinesApi';
// req #3972 — three.js rides in this chunk alone; Cards and Table never load it.
const PipelineGroupView = lazy(() => import('./PipelineGroupView'));

// req #3356 — the `2` is out of both keys now that there is one plan list.
// Dropping it ORPHANS the two stored preferences rather than migrating them, so
// on first load after this ships a reader's view choice (Cards vs Table) and
// status filter fall back to their defaults, once. That is the same call
// `PIPELINE_PLACE_SCHEMA_VERSION` and the plan storage namespace make, and for
// the same reason: a migration branch for a view preference lives forever, and
// re-establishing it costs one click.
const VIEW_STORAGE_KEY = 'darwin-swarm-pipelines-view';
const STATUS_FILTER_STORAGE_KEY = 'darwin-swarm-pipelines-status-filter';

const VIEWS = [
    { value: 'cards', label: 'Cards view', icon: ViewModuleIcon },
    { value: 'table', label: 'Table view', icon: TableChartIcon },
    // req #3972 — every pipeline in one 3D scene ("pipeline group" until it
    // has a name), the Data Center to a plan's SuperPod. A calendar since
    // req #4042: time left to right, sort order within a column.
    { value: 'group', label: 'Pipeline calendar', icon: ViewInArIcon },
];

// req #3804 — how often the page re-reads what other processes write. Each
// cycle is 7 list reads (one gateway call each); every call is an API Gateway
// + Lambda request, so the interval is a COST, stated to the user: about 840
// list calls an hour plus one per card per minute for the thumbnails, only
// while the tab is visible.
export const LIVE_REFRESH_MS = 30_000;
// The thumbnails are one composed read PER CARD, so they refresh at half the
// rate of the list reads. Neither polls a hidden tab (TanStack's
// `refetchIntervalInBackground` default), so a page left in a background tab
// costs nothing.
export const THUMBNAIL_REFRESH_MS = 60_000;

// On a LOCKED plan the gateway still writes these (plan_lock.py) — everything
// else is authoring, refused 423, so it is refused here first in the lock's words.
const LOCK_FREE_FIELDS = new Set(['locked', 'sort_order', 'pipeline_status']);

// `description` is NOT in `pipelines`' own defaultFields (devopsQueries.js
// deliberately keeps req #3463's id-producer index light) — this page both
// RENDERS and EDITS the description, so it must ask for it explicitly. Code
// review (req #3393): without this, every row arrived with
// `description === undefined`, the Goal dialog opened EMPTY over a real goal,
// and the first save silently overwrote it — a real data-loss path, confirmed
// against production plan 7's 454-character description. Own cache entry
// (`pipelines` has `fieldsInKey: true`), so this does not collide with req
// #3463's own narrower read of the same table.
// req #3649 — `locked` added so the Lock column reads the stored flag.
// req #3804 — the hand-sorted `sort_order`.
const PIPELINES_FIELDS = 'id,title,description,pipeline_status,locked,sort_order,'
    + 'machine_fk,started_at,completed_at,creator_fk,create_ts,update_ts';

// req #3978 — `id,requirement_status` for the counts, the rest for All Active.
const REQUIREMENT_FIELDS = 'id,title,requirement_status,coordination_type,ai_model,machine_fk';

const pipelineStatusOptions = PIPELINE_STATUS_VALUES.map((status) => ({
    value: status,
    label: pipelineStatusLabel(status),
    chipProps: pipelineStatusChipProps(status),
}));

function readStoredStatusFilter() {
    try {
        const raw = sessionStorage.getItem(STATUS_FILTER_STORAGE_KEY);
        if (raw == null) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        // A stored value this vocabulary no longer has (the pre-#3965
        // draft|active|paused|completed) means the selection was made over
        // another vocabulary: fall back to the default rather than keep a
        // filtered remnant that would hide plans for no reason the reader chose.
        if (parsed.some((v) => !PIPELINE_STATUS_VALUES.includes(v))) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeStoredStatusFilter(statuses) {
    try {
        sessionStorage.setItem(STATUS_FILTER_STORAGE_KEY, JSON.stringify(statuses));
    } catch {
        // Safari private mode / quota exceeded — in-memory state still updates.
    }
}

// ── Editable pipeline description ────────────────────────────────────────
// THE PLAN-DESCRIPTION DIALOG LIVED HERE AND IS GONE (req #3365).
// Its only opener was the Table view's "Goal" button column, which the user
// directed away; a dialog no control can reach is dead code, and leaving it
// would read as a feature somebody had merely forgotten to wire up. The plan's
// goal text is authored on the plan itself — `PipelineDetail.jsx` carries its
// own copy of this dialog behind the header's Description chip, which is
// unaffected.

export default function PipelinesPage() {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore((s) => s.showError);
    const showMessage = useSnackBarStore((s) => s.showMessage);
    const navigate = useNavigate();

    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const [view, setView] = useViewPreference(VIEW_STORAGE_KEY, 'cards');
    // ── `?view=` MAKES THE PANEL ADDRESSABLE (req #3641) ────────────────────
    // A dev-server deep link or a pasted link names the panel it means; the
    // stored preference would otherwise decide. PipelineDetail's `?mode=`
    // contract: validated against VIEWS (a typo leaves the preference in
    // charge), TRANSIENT (it never rewrites the stored choice), and dropped
    // from the address the moment the reader picks a view by hand, so a reload
    // does not resurrect the panel they just left.
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedView = searchParams.get('view');
    const linkView = VIEWS.some((v) => v.value === requestedView) ? requestedView : null;
    const activeView = linkView ?? normalizeView(view, VIEWS);
    const changeView = (next) => {
        if (next == null) return;
        if (searchParams.has('view') || (next !== 'group' && searchParams.has('focus'))) {
            const rest = new URLSearchParams(searchParams);
            rest.delete('view');
            if (next !== 'group') rest.delete('focus');
            setSearchParams(rest, { replace: true });
        }
        setView(next);
    };
    // req #3972 — the group view's focused pipeline is addressable too
    // (`?view=group&focus=<id>`), so a link can land on one plan in the field.
    // Unlike `?view=` it is the LIVE state, written on every focus change.
    const focusParam = Number(searchParams.get('focus'));
    const groupFocus = Number.isInteger(focusParam) && focusParam > 0 ? focusParam : null;
    const setGroupFocus = (id) => {
        if (id === groupFocus) return;
        const rest = new URLSearchParams(searchParams);
        if (id == null) rest.delete('focus');
        else rest.set('focus', String(id));
        setSearchParams(rest, { replace: true });
    };
    // The card's requirement figures are its info block (req #3804) — always
    // shown, so the old show-counts preference no longer gates them.

    const [statusFilter, setStatusFilter] = useState(
        () => readStoredStatusFilter() || [...DEFAULT_PIPELINE_STATUSES]);
    const toggleStatus = (status) => setStatusFilter((current) => {
        const next = current.includes(status)
            ? current.filter((s) => s !== status)
            : [...current, status];
        writeStoredStatusFilter(next);
        return next;
    });

    // THE "last plan opened" MARK IS GONE FROM THIS PAGE (req #3365 user
    // directive — "Remove 'last viewed' entirely"). It was read once here and
    // handed to the cards view, which drew a chip and a primary-coloured
    // border with it.
    //
    // `pipelinePlace.js` ITSELF IS UNTOUCHED. `PipelineDetail.jsx` still writes
    // the record on arrival and `prunePipelineStorage` (imported above) still
    // sweeps per-plan storage against it. Only this page's decoration is gone;
    // the record is a live fact that another surface may still act on.

    const open = (id) => {
        const to = planDetailPath(id);
        if (to) navigate(to);
    };

    const live = { refetchInterval: LIVE_REFRESH_MS };
    const { data: pipelines = [], isLoading: pipelinesLoading } =
        useAllPipelines(creatorFk, { fields: PIPELINES_FIELDS, ...live });

    // The orphan sweep for per-plan camera/scroll storage (viewportMemory.js
    // keys keyed by plan id) had no caller anywhere in `src/` after the 1.0
    // list page — its only caller — was deleted (code review, req #3356):
    // every camera and scroll offset for every plan ever opened, including
    // deleted ones, would otherwise accumulate in localStorage for the life
    // of the browser profile. This page is the natural home — it already
    // fetches the live id set on every mount, which is exactly what the
    // prune needs to tell a live plan from an orphan.
    useEffect(() => {
        if (pipelinesLoading) return;
        prunePipelineStorage(pipelines.map((p) => p.id));
    }, [pipelinesLoading, pipelines]);
    const { data: machines = [], isLoading: machinesLoading } = useMachines(creatorFk);
    const { data: initiatives = [], isLoading: initiativesLoading, isError: initiativesError } =
        useAllInitiatives(creatorFk, live);
    const { data: epics = [], isLoading: epicsLoading, isError: epicsError } =
        useAllPipelineEpics(creatorFk, live);
    const { data: epicRequirements = [], isLoading: linksLoading, isError: linksError } =
        useAllPipelineEpicRequirements(creatorFk, live);
    // req #3823 — initiative-to-initiative edges, counted per plan.
    const { data: initiativeDeps = [] } = useAllInitiativeDeps(creatorFk, live);
    // `id,requirement_status` is enough for the met/total counts — see
    // pipelinesViewModel.js. A narrower projection than 1.0's PLAN_REQUIREMENT_FIELDS
    // on purpose: this page derives no epic state from it, only a stored-status tally.
    // req #3978 — plus the All Active box's title and the columns its id colour
    // reads (autonomy, model, machine — `REQ_COLOR_SCALES`).
    const { data: requirements = [], isLoading: reqsLoading, isError: reqsError } =
        useAllRequirements(creatorFk, { fields: REQUIREMENT_FIELDS, ...live });
    const { data: orchestrationClaims = [] } = useOrchestrationClaims(creatorFk, live);
    // req #3978 — the All Active box's reads. They never gate the page: the box
    // says "…" until the session reads have data, as the plan's does.
    const { data: requirementSessions } = useAllRequirementSessions(creatorFk, live);
    const { data: sessionTerminals } = useAllSessionTerminals(creatorFk, live);
    const { data: devServers } = useDevServers(creatorFk, live);
    const [colorKey] = usePlanViewSetting('colorKey');

    const isLoading = pipelinesLoading || machinesLoading || initiativesLoading
        || epicsLoading || linksLoading || reqsLoading;

    // An epic's PLAN is reachable only through its initiative (containment — no
    // `pipeline_fk` column on epics), so a failed initiatives OR epics
    // read does not just blank one column, it zeroes every card's epic
    // count, progress bar and requirement tally — indistinguishable from a
    // genuinely empty plan (code review, req #3393; EpicsPage.jsx draws the
    // identical distinction for the same underlying reason).
    const planDataError = initiativesError || epicsError;
    const failedReadsText = [initiativesError && 'initiatives', epicsError && 'epics']
        .filter(Boolean).join(' and ');

    const machineById = new Map(machines.map((m) => [m.id, m]));

    // req #3978 — All Active: the latest session per requirement, from the
    // junction and the session projection (it carries `swarm_status`); null
    // until both have data, so the box reads loading, never "None running".
    const sessionStatus = useMemo(() => buildSessionStatusIndex({
        requirementSessions, sessions: sessionTerminals,
        ready: requirementSessions !== undefined && sessionTerminals !== undefined,
    }), [requirementSessions, sessionTerminals]);
    const activeItems = useMemo(() => allActiveRequirements({
        pipelines, initiatives, epics, epicRequirements, requirements, sessionStatus,
    }), [pipelines, initiatives, epics, epicRequirements, requirements, sessionStatus]);
    const activeReqPills = useMemo(() => buildReqPills({
        requirementSessions, sessions: sessionTerminals, devServers,
        machines: machinesLoading ? undefined : machines,
    }), [requirementSessions, sessionTerminals, devServers, machines, machinesLoading]);
    // The ids in the reader's own plan colour key, built over the listed rows.
    const activeColorViews = useMemo(() => {
        const listed = new Set(activeItems.map((r) => r.id));
        return buildReqColorViews({
            requirements: requirements
                .filter((r) => listed.has(Number(r.id)))
                .map((r) => ({ ...r, id: Number(r.id), session_status: sessionStatus?.get(Number(r.id)) })),
            machines, presentReqIds: listed,
        });
    }, [activeItems, requirements, sessionStatus, machines]);
    const activeIdStyleOf = useCallback((reqId) => reqIdStyle({
        colorKey, views: activeColorViews, reqId: Number(reqId),
    }), [colorKey, activeColorViews]);
    // A failed plan or requirement read is "could not tell", never "None running".
    const activeUnknown = sessionStatus == null
        || initiativesError || epicsError || linksError || reqsError;
    const openActiveReq = useCallback((id) => navigate(`/swarm/requirement/${id}`), [navigate]);

    const summaries = pipelineSummaries({ pipelines, epics, initiatives, initiativeDeps });
    const reqCounts = pipelineRequirementCounts({
        pipelines, epics, initiatives, epicRequirements, requirements });

    // req #3804 — the reader's hand-sorted order.
    // req #3966 — over it, the order a drop just made, from the drop's own
    // render until its write settles (`reorder`).
    const [dropped, setDropped] = useState(null);
    const ordered = useMemo(() => orderPipelines(withPositions(pipelines, dropped)),
        [pipelines, dropped]);
    // Stable between renders — the Cards view keys its drag list on it.
    const filtered = useMemo(() => ordered.filter((p) => statusFilter.includes(p.pipeline_status)),
        [ordered, statusFilter]);
    const hiddenStatusCounts = hiddenPipelineStatusCounts(ordered, statusFilter);

    const listKey = [...pipelineKeys.all(creatorFk), { fields: PIPELINES_FIELDS }];
    const invalidatePipelines = () =>
        queryClient.invalidateQueries({ queryKey: pipelineKeys.all(creatorFk) });
    // Optimistic: the card shows the change at once, a poll in flight is
    // cancelled so it cannot land the old row on top, and every write ends in
    // a re-read either way. The cancel (and its revert) happens as it is
    // called, so the patch follows it in the same tick — nothing to await.
    const patchCache = (patchRows) => {
        queryClient.cancelQueries({ queryKey: listKey });
        queryClient.setQueryData(listKey, (old) => (Array.isArray(old) ? patchRows(old) : old));
    };

    // ONE write path for every in-place edit (req #3804). Resolves true when it
    // landed — a card's text field puts the stored text back on false.
    const updateRow = async (row, fields, problem) => {
        if (problem) { showError(problem); return false; }
        if (Number(row.locked) && Object.keys(fields).some((k) => !LOCK_FREE_FIELDS.has(k))) {
            showError('This pipeline is locked — unlock it first');
            return false;
        }
        const shownValues = Object.fromEntries(Object.entries(fields)
            .map(([k, v]) => [k, v === REST_NULL ? null : v]));
        patchCache((rows) => rows.map((p) => (p.id === row.id ? { ...p, ...shownValues } : p)));
        try {
            await updatePipeline(darwinUri, idToken, row.id, fields);
            return true;
        } catch (err) {
            showError(err, 'Could not save the pipeline');
            return false;
        } finally {
            invalidatePipelines();
        }
    };

    // req #3649 — a locked plan freezes its initiatives and epics (gateway 423).
    const toggleLock = (row) => updateRow(row, { locked: Number(row.locked) ? 0 : 1 });

    // req #3965 — the status control on every view. Allowed on a locked plan
    // (LOCK_FREE_FIELDS). A plan moved to a status the pills hide leaves the
    // view at once, so the reader is told where it went.
    const setStatus = async (row, next) => {
        const done = await updateRow(row, { pipeline_status: next });
        if (done && !statusFilter.includes(next)) {
            showMessage(`"${row.title}" is now ${pipelineStatusLabel(next)} — hidden by the status filter`);
        }
        return done;
    };

    // req #3934 — the card menu's confirmed hard delete. Every plan-layer read
    // on this page is re-read after it, since its initiatives, epics, seats and
    // edges went with it.
    const deleteRow = async (row) => {
        try {
            await deletePipeline(darwinUri, idToken, row.id);
            showMessage(`Deleted pipeline "${row.title}"`);
            return true;
        } catch (err) {
            // A named refusal (a lock, a running orchestrator, a cross-plan
            // edge) says WHICH — show it, as InitiativesPage does.
            const status = err?.httpStatus?.httpStatus;
            if (err?.namedRefusal) {
                showError(`Could not delete the pipeline${status ? ` (${status})` : ''} — ${err.message}`);
            } else {
                showError(err, 'Could not delete the pipeline');
            }
            return false;
        } finally {
            invalidatePipelines();
            [initiativeKeys.all(creatorFk), pipelineEpicKeys.all(creatorFk),
                pipelineEpicRequirementKeys.all(creatorFk), pipelineEpicDepKeys.all(creatorFk),
                initiativeDepKeys.all(creatorFk), pipelineComposeKeys.all,
                // Requirement rows carry the derived `pipelined` flag.
                requirementKeys.all(creatorFk)]
                .forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
        }
    };

    // req #3804 — a card dropped on another's place. Renumbers over the FULL
    // ordered list, so plans the filters hide keep their places.
    //
    // req #3966 — "the card flies around … momentarily returning to its
    // origin". The new order must be on screen IN THE RENDER THAT ENDS THE
    // DRAG: this runs inside dnd-kit's drop, and the cache only tells the page
    // a tick later. Drawn one render late, the cards drop their previewing
    // offsets and slide back, the lifted card settles onto its OLD slot, and
    // then everything jumps forward. So the order is set here, before
    // anything is awaited, and held until the write settles — by then the
    // patched cache (and after it the re-read) carries it.
    const reorder = async (fromId, toId) => {
        const move = reorderPipelines(ordered, fromId, toId);
        if (!move || !move.writes.length) return;
        const position = new Map(move.rows.map((p) => [p.id, p.sort_order]));
        setDropped(position);
        patchCache((rows) => withPositions(rows, position));
        try {
            await updatePipelines(darwinUri, idToken, move.writes);
        } catch (err) {
            showError(err, 'Could not save the pipeline order');
        } finally {
            // Let go only once the re-read has landed: a cache a poll or an
            // earlier drop's re-read filled meanwhile may not carry this order.
            // A later drop holds its own order — leave it.
            await invalidatePipelines();
            setDropped((held) => (held === position ? null : held));
        }
    };

    // req #3804 — the front card's Enter: a new plan made in place, first.
    const { create, creating } = useCreatePipeline();
    // A new plan is born `authoring` (req #3965): if that status is filtered
    // out, light it, or the card the reader just made would vanish the moment
    // it is written.
    const createInPlace = async (title) => {
        const done = await create({ title, sort_order: frontSortOrder(pipelines), open: false });
        if (done) {
            setStatusFilter((current) => {
                if (current.includes(NEW_PIPELINE_STATUS)) return current;
                const next = [...current, NEW_PIPELINE_STATUS];
                writeStoredStatusFilter(next);
                return next;
            });
        }
        return done;
    };

    const columns = [
        { field: 'id', headerName: 'ID', width: 70 },
        {
            // 40% NARROWER (req #3365 user directive). It was `flex: 1,
            // minWidth: 220`, which made it absorb every spare pixel — measured
            // 460px at a 1600px viewport, more than a third of the grid, for a
            // value that is one short line. A fixed width is what makes the
            // reduction stick: leaving `flex` on and lowering `minWidth` would
            // have changed nothing, because flex re-expands to fill whatever
            // the columns removed below gave back. 276 = 460 x 0.6, taken from
            // the measurement rather than picked.
            field: 'title', headerName: 'Pipeline', width: 276,
            renderCell: (params) => (
                <Tooltip title="Open this plan's visualizer">
                    <Box
                        component="span"
                        role="link"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); open(params.row.id); }}
                        onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            e.stopPropagation();
                            open(params.row.id);
                        }}
                        sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }}
                        data-testid={`pipelines-open-title-${params.row.id}`}
                    >
                        {params.value}
                    </Box>
                </Tooltip>
            ),
        },
        {
            // req #3965 — the plan's status editor (all seven values).
            field: 'pipeline_status', headerName: 'Status', width: 190, sortable: false,
            renderCell: (params) => (
                <PipelineStatusChip
                    status={params.value}
                    onChange={(next) => setStatus(params.row, next)}
                    testId={`pipelines-status-${params.row.id}`}
                />
            ),
        },
        {
            // req #3649 — the lock cascades to every initiative and epic in the plan.
            field: 'locked', headerName: 'Lock', width: 100, sortable: false,
            renderCell: (params) => (
                <Tooltip title={params.value
                    ? 'Locked — this plan, its initiatives and epics are frozen as a record. Click to unlock.'
                    : 'Open — editable. Click to lock this plan and freeze everything in it.'}>
                    <Chip
                        label={lockedLabel(params.value)}
                        size="small"
                        {...lockedChipProps(params.value)}
                        clickable
                        onClick={(e) => { e.stopPropagation(); toggleLock(params.row); }}
                        data-testid={`pipelines-lock-chip-${params.row.id}`}
                    />
                </Tooltip>
            ),
        },
        {
            // req #3823 — how many initiative-to-initiative dependencies the plan holds.
            field: 'initiative_deps', headerName: 'Initiative deps', width: 120, type: 'number',
            valueGetter: (_v, row) => summaries.get(row.id)?.initiativeDeps ?? 0,
            renderCell: (params) => (
                <Box component="span" data-testid={`pipelines-initiative-deps-${params.row.id}`}>
                    {params.value || '—'}
                </Box>
            ),
        },
        {
            field: 'machine_fk', headerName: 'Machine', width: 140,
            valueGetter: (_v, row) => (row.machine_fk == null
                ? '' : (machineById.get(row.machine_fk)?.title || `#${row.machine_fk}`)),
            valueFormatter: (value) => value || '—',
        },
        {
            field: 'started_at', headerName: 'Started', width: 150,
            valueFormatter: (value) => (value ? formatDateTime(value, timezone) : '—'),
        },
        {
            field: 'completed_at', headerName: 'Completed', width: 150,
            valueFormatter: (value) => (value ? formatDateTime(value, timezone) : '—'),
        },
        // ── TWO COLUMNS REMOVED (req #3365 user directive) ──────────────────
        //
        // THE "Goal" BUTTON COLUMN is gone, and with it this page's whole
        // description-editing surface (the dialog and its `descriptionTarget`
        // state below). Stated plainly because it is a capability removal, not
        // a tidy-up: a plan's goal text is still authored on the plan itself,
        // `/swarm/pipeline/:id`, whose header carries the same dialog behind
        // the Description chip. The list is an index; the plan is where its
        // prose is written.
        //
        // THE TRAILING "open" ICON is gone as REDUNDANT, which is its own
        // argument rather than a preference: this grid already navigates from
        // THREE places — the title renders as a link, `onRowClick` opens the
        // plan from anywhere in the row, and the row's own cursor says so. A
        // fourth control doing exactly what clicking anywhere already does is
        // chrome that teaches nothing, and it was costing the last 60px of a
        // grid whose Pipeline column has just been cut to fit.
    ];

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box className="app-content-planpage" data-testid="pipelines-page">
            {/* req #3978 — every plan's Active box in one: viewport-fixed, so
                it floats over whichever view is showing. */}
            <PlanActiveBox items={activeItems} reqPills={activeReqPills}
                           idStyleOf={activeIdStyleOf}
                           isLoading={activeUnknown}
                           onOpen={openActiveReq}
                           name="All Active" testid="pipelines-all-active"
                           rackId="all-active" store={useAllActiveBoxStore} />
            <Box className="app-content-view-toggle" sx={{ mt: 3, px: 3 }}>
                <ViewerHeader
                    title="Pipelines"
                    views={VIEWS}
                    view={activeView}
                    onViewChange={changeView}
                    testIdPrefix="pipelines"
                    filters={
                        <Stack direction="row" spacing={1} alignItems="center"
                               sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                            <ChipFilter
                                options={pipelineStatusOptions}
                                selected={statusFilter}
                                onToggle={toggleStatus}
                                testId="pipelines-status-filter"
                                chipTestIdPrefix="pipelines-status-chip"
                            />
                        </Stack>
                    }
                    actions={<NewPipelineDialog machines={machines}
                                                sortOrder={frontSortOrder(pipelines)} />}
                />
            </Box>

            {planDataError && (
                <Box sx={{ px: 3 }}>
                    <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
                           data-testid="pipelines-plan-data-error">
                        The {failedReadsText} read{failedReadsText.includes(' and ') ? 's' : ''} failed
                        to load. Every epic count, progress bar and requirement tally below is
                        computed as though those rows do not exist — a plan with real work may show
                        "0 epics". Reload.
                    </Alert>
                </Box>
            )}

            <Box className="app-content-tabpanel" sx={{ px: 3, pt: 0 }}>
                {activeView === 'group' ? (
                    <Suspense fallback={(
                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                            <CircularProgress />
                        </Box>
                    )}>
                        <PipelineGroupView
                            pipelines={filtered}
                            machines={machines}
                            refetchInterval={THUMBNAIL_REFRESH_MS}
                            focusId={groupFocus}
                            onFocusChange={setGroupFocus}
                            onOpen={open}
                            onSetStatus={setStatus}
                        />
                    </Suspense>
                ) : activeView === 'table' ? (
                    <Box sx={{ width: '100%' }} data-testid="pipelines-datagrid">
                        <DataGrid
                            autoHeight
                            rows={filtered}
                            columns={columns}
                            getRowId={(r) => r.id}
                            density="compact"
                            slots={{ toolbar: GridToolbar }}
                            slotProps={{ toolbar: { showQuickFilter: true } }}
                            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                            pageSizeOptions={[10, 25, 50]}
                            disableRowSelectionOnClick
                            onRowClick={(params) => open(params.id)}
                            sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
                            data-testid="pipelines-grid"
                        />
                    </Box>
                ) : (
                    <PipelinesCardsView
                        pipelines={filtered}
                        summaries={summaries}
                        reqCounts={reqCounts}
                        machines={machines}
                        claims={orchestrationClaims}
                        onOpen={open}
                        onUpdate={updateRow}
                        onDelete={deleteRow}
                        onReorder={reorder}
                        onCreate={createInPlace}
                        onSetStatus={setStatus}
                        creating={creating}
                        hiddenStatusCounts={hiddenStatusCounts}
                        refetchInterval={LIVE_REFRESH_MS}
                        thumbnailRefetchInterval={THUMBNAIL_REFRESH_MS}
                    />
                )}
            </Box>

        </Box>
    );
}
