// PipelinesPage.jsx — /swarm/pipelines (req #3114).
//
// The orchestrator of a view-switchable page per memory/view-switchable-pages.md:
// the `.app-content-planpage` CSS grid, the canonical `<ViewerHeader>`, and exactly
// one view component rendered at a time. View state comes from useViewPreference
// (R1/V8) under `darwin-swarm-pipelines-view`.
//
// Both views are fed the SAME pre-filtered rows and the SAME derived summaries
// (R5) — switching views re-renders, never re-fetches.
//
// req #3282 — the header used to be hand-rolled: a bare Box holding a
// ToggleButtonGroup, the ChipFilter, an inline `variant="caption"` accounting line
// and a separate `flexGrow` spacer, with NO TITLE at all. Req #3067 extracted
// `ViewerHeader` at the moment a third hand-rolled copy existed and had already
// drifted; this was the fourth, and it had drifted on V2 (the spacer Box), V7 (the
// accounting position AND its type scale) and on having no title. Converting also
// fixes the toggle's accessible name for free: the old row wrapped the Tooltip
// INSIDE the ToggleButton around the icon, so MUI put the name on an SvgIcon that
// SvgIcon.js then marks aria-hidden and both buttons computed an EMPTY accessible
// name (the same defect req #3281 files against PipelineDetail.jsx). ViewerHeader
// wraps the Tooltip AROUND the button and sets `aria-label` on the button itself.

import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';

import AuthContext from '../../Context/AuthContext';
import {
    useAllPipelineStepRequirements,
    useAllPipelineSteps,
    useAllPipelines,
    useAllRequirements,
    useMachines,
    useOrchestrationClaims,
} from '../../hooks/useDataQueries';
import { useViewPreference } from '../../hooks/useViewPreference';
import normalizeView from '../../Components/ViewerHeader/normalizeView';
import ViewerHeader from '../../Components/ViewerHeader/ViewerHeader';
import ChipFilter from '../../Components/ChipFilter';
import PipelineCardsView from './PipelineCardsView';
import PipelinesTableView from './PipelinesTableView';
import {
    pipelineStatusChipProps,
    DEFAULT_PIPELINE_STATUSES,
    PIPELINE_STATUS_VALUES,
} from './pipelineChipStyles';
import {
    DEFAULT_REQ_COUNTS,
    PLAN_REQUIREMENT_FIELDS,
    REQ_COUNTS_STORAGE_KEY,
    pipelineSummaries,
    pipelineRequirementCounts,
    hiddenPipelineStatusCounts,
} from './pipelineViewModel';

const VIEW_STORAGE_KEY = 'darwin-swarm-pipelines-view';

// req #3220 — per-tab only (sessionStorage), matching useViewPreference's own
// per-tab-first rationale (memory/view-switchable-pages.md). Needed because the
// default is no longer "show everything": before this feature, losing the
// filter on a click-into-detail-and-back was harmless (it reset to null, i.e.
// every pipeline). Now it resets to a NARROWER set, so silently forgetting a
// chip the user turned back on (e.g. re-enabling `completed` to look at one)
// would re-hide it the moment they navigate back — the exact class of surprise
// this requirement's default-set discussion was worried about.
const STATUS_FILTER_STORAGE_KEY = 'darwin-swarm-pipelines-status-filter';

function readStoredStatusFilter() {
    try {
        const raw = sessionStorage.getItem(STATUS_FILTER_STORAGE_KEY);
        if (raw == null) return null; // nothing stored yet — caller falls back to the default
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        // A stored [] is a legal, intentional "show nothing" (ChipFilter's own
        // contract: empty is never auto-corrected back to a default). `[]` is
        // truthy in JS, so the caller's `|| DEFAULT_PIPELINE_STATUSES` only
        // fires when nothing was stored at all, never on a real empty choice.
        return parsed.filter((v) => PIPELINE_STATUS_VALUES.includes(v));
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

// `label` is REQUIRED by ViewerHeader and is never rendered as text: it becomes
// BOTH the tooltip and the button's aria-label. So it is the full caption here
// ('Cards view', matching DocumentsPage) rather than the bare noun the old
// hand-rolled row expanded with a `${label} View` template at the render site.
const VIEWS = [
    { value: 'cards', label: 'Cards view', icon: ViewModuleIcon },
    { value: 'table', label: 'Table view', icon: TableChartIcon },
];

// req #3220 — fixed vocabulary, so options are module-level, same pattern as
// SwarmView's requirementStatusOptions. Colors come from pipelineStatusChipProps,
// not the ChipFilter palette.
const pipelineStatusOptions = PIPELINE_STATUS_VALUES.map((status) => ({
    value: status,
    label: status,
    chipProps: pipelineStatusChipProps(status),
}));

export default function PipelinesPage() {
    const navigate = useNavigate();
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const [view, setView] = useViewPreference(VIEW_STORAGE_KEY, 'cards');
    const activeView = normalizeView(view, VIEWS);
    // req #3225 — the SAME preference the plan detail header's toggle writes.
    // This page carries no control of its own for it (the toggle lives where
    // the requirement puts it, in the header's row of toggle groups); it only
    // reads whatever the reader last chose there. `useViewPreference`'s
    // per-tab sessionStorage read happens at mount, which is exactly when a
    // route change lands here, so a choice made on the detail page is already
    // in effect the moment this page opens.
    //
    // Key and default from the ONE shared pair (req #3241) rather than a second
    // copy of both literals — a page reading a mistyped key does not fail, it
    // quietly falls back to its own default and shows a plausible answer.
    const [showReqCountsPref] = useViewPreference(
        REQ_COUNTS_STORAGE_KEY, DEFAULT_REQ_COUNTS);
    const showReqCounts = showReqCountsPref === 'on';
    // req #3220 — multi-select via the shared ChipFilter, not the old nullable
    // single value. Nothing outside this page reads the filter, so a Zustand
    // store would still be ceremony without a second consumer — but the value
    // itself is now worth surviving a click-into-detail-and-back (see the
    // STATUS_FILTER_STORAGE_KEY comment above), so it's seeded from and
    // written through to sessionStorage rather than living purely in memory.
    const [statusFilter, setStatusFilter] = useState(
        () => readStoredStatusFilter() || DEFAULT_PIPELINE_STATUSES);
    const toggleStatus = (status) => setStatusFilter((current) => {
        const next = current.includes(status)
            ? current.filter((s) => s !== status)
            : [...current, status];
        writeStoredStatusFilter(next);
        return next;
    });

    const { data: pipelines = [], isLoading: pipelinesLoading } = useAllPipelines(creatorFk);
    const { data: steps = [], isLoading: stepsLoading } = useAllPipelineSteps(creatorFk);
    const { data: stepRequirements = [], isLoading: linksLoading } =
        useAllPipelineStepRequirements(creatorFk);
    // The SAME projection the detail page requests. `useAllRequirements` puts
    // `fields` in its cache key, so a narrower one here would be a second cache
    // entry — and clicking into a plan would refetch the whole requirements table
    // rather than rendering from the read this page already paid for.
    const { data: requirements = [], isLoading: reqsLoading } =
        useAllRequirements(creatorFk, { fields: PLAN_REQUIREMENT_FIELDS });
    const { data: machines = [], isLoading: machinesLoading } = useMachines(creatorFk);
    // req #3224 — the durable orchestration reservation. ONE unfiltered list
    // read (a handful of rows: one per reserved scope), joined client-side, so
    // the request count still grows with the number of TABLES this page draws
    // on and never with the number of plans on it.
    //
    // Deliberately NOT in `isLoading`. Every other read below feeds a NUMBER OR
    // A LABEL that would render wrong before it arrives; this one feeds an
    // OPTIONAL badge whose absence means "not orchestrated", which is also the
    // correct reading while it is in flight. Gating the whole page on live
    // process state would make an unreachable ops table a blank plans page.
    const { data: orchestrationClaims = [] } = useOrchestrationClaims(creatorFk);

    // Every read that feeds a NUMBER OR A LABEL gates the spinner. `pipelines` is
    // one row and resolves first; the requirements read is the whole table and
    // resolves last — so gating on pipelines alone paints "0 steps · 0 complete"
    // and an empty progress bar over a 34-step plan on essentially every cold
    // load, then snaps to the real figures. A wrong number is not a loading
    // state, and neither is a machine rendered as a bare id.
    const isLoading = pipelinesLoading || stepsLoading || linksLoading
        || reqsLoading || machinesLoading;

    const summaries = useMemo(
        () => pipelineSummaries({ pipelines, steps, stepRequirements, requirements }),
        [pipelines, steps, stepRequirements, requirements]);
    // req #3225 — one more pass over the same shared reads (design rule 5:
    // never a per-pipeline fetch), computed unconditionally so toggling the
    // preference never triggers a fresh read — only a fresh render.
    const reqCounts = useMemo(
        () => pipelineRequirementCounts({ pipelines, steps, stepRequirements, requirements }),
        [pipelines, steps, stepRequirements, requirements]);

    const filtered = useMemo(
        () => pipelines.filter((p) => statusFilter.includes(p.pipeline_status)),
        [pipelines, statusFilter]);

    // Named for the empty state (req #3220 acceptance) rather than a boolean —
    // "a filter is active" doesn't say WHICH statuses vanished.
    const hiddenStatusCounts = useMemo(
        () => hiddenPipelineStatusCounts(pipelines, statusFilter),
        [pipelines, statusFilter]);

    const open = (id) => navigate(`/swarm/pipeline/${id}`);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box className="app-content-planpage">
            {/* The grid class goes on a WRAPPER, not on ViewerHeader's own row.
                `.app-content-planpage` assigns areas by class and ViewerHeader
                returns a FRAGMENT — the header row plus the V7 accounting line —
                so classing the row alone would leave the accounting Typography as
                a second, unplaced grid child, auto-flowed into the `tabs` row at
                one column's width. Both lines belong in the `view-toggle` area,
                which is also exactly where the accounting text sat before.

                Only the page-level insets (mt/px) live here; the rhythm INSIDE the
                header — the row/accounting gap and the accounting line's own
                bottom margin — is ViewerHeader's and is not overridden. */}
            <Box className="app-content-view-toggle" sx={{ mt: 3, px: 3 }}>
                <ViewerHeader
                    title="Pipelines"
                    views={VIEWS}
                    view={activeView}
                    onViewChange={setView}
                    testIdPrefix="pipelines"
                    /* Shared control — filters BOTH views (R4/R5). Multi-select
                       via the standardized ChipFilter (req #3220), not a second
                       hand-rolled implementation of it. V3 puts it in the filters
                       slot: it changes WHAT is listed. */
                    filters={
                        <ChipFilter
                            options={pipelineStatusOptions}
                            selected={statusFilter}
                            onToggle={toggleStatus}
                            testId="pipelines-status-filter"
                            chipTestIdPrefix="pipelines-status-chip"
                        />
                    }
                    /* Counts the WHOLE dataset, with the filtered subset named
                       separately (V7). The call-to-action names what the ACTIVE
                       view actually shows — "click a row" is wrong advice in
                       Cards, where the click target is a card. */
                    accounting={<>
                        {filtered.length} of {pipelines.length} pipeline
                        {pipelines.length === 1 ? '' : 's'} — click a{' '}
                        {activeView === 'table' ? 'row' : 'card'} for the plan
                    </>}
                />
            </Box>

            <Box className="app-content-tabpanel" sx={{ px: 3, pt: 0 }}>
                {activeView === 'table' ? (
                    <PipelinesTableView
                        pipelines={filtered}
                        summaries={summaries}
                        reqCounts={reqCounts}
                        showReqCounts={showReqCounts}
                        machines={machines}
                        claims={orchestrationClaims}
                        timezone={timezone}
                        onOpen={open}
                        hiddenStatusCounts={hiddenStatusCounts}
                    />
                ) : (
                    <PipelineCardsView
                        pipelines={filtered}
                        summaries={summaries}
                        reqCounts={reqCounts}
                        showReqCounts={showReqCounts}
                        machines={machines}
                        claims={orchestrationClaims}
                        onOpen={open}
                        hiddenStatusCounts={hiddenStatusCounts}
                    />
                )}
            </Box>
        </Box>
    );
}
