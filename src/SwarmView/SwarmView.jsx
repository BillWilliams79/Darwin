import '../index.css';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { useWorkingProjectStore } from '../stores/useWorkingProjectStore';
import { useShowClosedStore, ALL_REQUIREMENT_STATUSES } from '../stores/useShowClosedStore';
import { useSwarmStartCardStore } from '../stores/useSwarmStartCardStore';
import { useModelEffortDisplayStore } from '../stores/useModelEffortDisplayStore';
import { useRequirementDrillStore } from '../stores/useRequirementDrillStore';
import { useProjects, useAllEpics, useAllCategories, useEpicRequirementIds, useAllPipelineSteps, useStepRequirementIds } from '../hooks/useDataQueries';
import { projectKeys } from '../hooks/useQueryKeys';
import { firstProjectIndexWithEpicWork } from '../utils/epicMembership';

import ProjectCloseDialog from './ProjectCloseDialog';
import ProjectAddDialog from './ProjectAddDialog';
import CategoryTabPanel from './CategoryTabPanel';
import RequirementDragLayer from './RequirementDragLayer';
import RequirementsTableView, { SWARM_TABLE_WIDTH } from './RequirementsTableView';
import SwarmVisualizerView from './SwarmVisualizerView';
import RequirementsTrendsView from './RequirementsTrendsView';
import VisualizerToolbar from './VisualizerToolbar';

import React, { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import Tab from '@mui/material/Tab';
import { CircularProgress, Tabs } from '@mui/material';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import TimelineIcon from '@mui/icons-material/Timeline';
import SettingsMenu from '../Components/SettingsMenu/SettingsMenu';
import RequirementJumpInput from '../NavBar/RequirementJumpInput';
import FolderIcon from '@mui/icons-material/Folder';
import CategoryIcon from '@mui/icons-material/Category';
import { requirementStatusChipProps, requirementStatusLabel } from './statusChipStyles';
import Chip from '@mui/material/Chip';
import ChipFilter from '../Components/ChipFilter';
import { SWARM_VIEWS, readEpicParam, withoutEpicParam, readStepParam, withoutStepParam } from './swarmViewLink';
import { useSwarmViewSelection } from './useSwarmViewSelection';

// req #2992 — fixed vocabulary, so options are module-level. Colors come from
// requirementStatusChipProps, not the ChipFilter palette.
const requirementStatusOptions = ALL_REQUIREMENT_STATUSES.map(status => ({
    value: status,
    label: requirementStatusLabel(status),
    chipProps: requirementStatusChipProps(status),
}));

// The CHROME for each view — its tooltip and its icon (§ C R3's canonical mapping).
// Kept here rather than in `swarmViewLink.js` so that module stays free of MUI and
// testable without a DOM; the VOCABULARY is still `SWARM_VIEWS`, and the toggle row
// maps over that, so this object can only ever add presentation to a value the
// validator already knows.
const SWARM_VIEW_CHROME = {
    cards:      { label: 'Cards View',      Icon: ViewModuleIcon },
    table:      { label: 'Table View',      Icon: TableChartIcon },
    visualizer: { label: 'Visualizer View', Icon: BubbleChartIcon },
    trends:     { label: 'Trends View',     Icon: TimelineIcon },
};

const SwarmView = () => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [projectsArray, setProjectsArray] = useState()

    // ── `?view=` makes the SURFACE addressable, not just the page (req #3168 R9) ──
    // Which panel this page shows is a persisted PREFERENCE (§ H), so `/swarm`
    // alone names the page and not a view of it: it opens whatever this reader
    // last chose, or `cards` for a first-time visitor. That made Table,
    // Visualizer and Trends unlinkable — no URL reliably landed on one — which is
    // a real gap for a dev-server deep link, a bug report, and a link pasted into
    // a review.
    //
    // The rules and their rationale live in `useSwarmViewSelection.js`, because
    // they are stateful and a stateful rule inside this component is a rule no
    // test can reach. `setView` is the MANUAL PICK (clears the link override and
    // persists); `showViewTransiently` is a CROSS-VIEW HANDSHAKE (override only,
    // never persisted).
    const { view, setView, showTransiently: showViewTransiently } = useSwarmViewSelection();

    const activeTab = useSwarmTabStore(s => s.activeTab);
    const setActiveTab = useSwarmTabStore(s => s.setActiveTab);

    const showError = useSnackBarStore(s => s.showError);
    const getWorkingProject = useWorkingProjectStore(s => s.getWorkingProject);
    const setWorkingProject = useWorkingProjectStore(s => s.setWorkingProject);
    const requirementStatusFilter = useShowClosedStore(s => s.requirementStatusFilter);
    const toggleRequirementStatus = useShowClosedStore(s => s.toggleRequirementStatus);
    // req #3180 — Table view only. The requirements BROWSE page is the one place
    // where both populations (scheduled / unscheduled) are legitimate to look at,
    // so pipeline membership is a user CONTROL here rather than the automatic
    // exclusion the launch-offering surfaces apply.
    const hidePipelined = useShowClosedStore(s => s.hidePipelinedRequirements);
    const toggleHidePipelined = useShowClosedStore(s => s.toggleHidePipelinedRequirements);
    const showSwarmStartCard = useSwarmStartCardStore(s => s.show);
    const toggleSwarmStartCard = useSwarmStartCardStore(s => s.toggle);
    // Model/Effort column display preference (req #3029) — surfaced in the gear
    // Settings menu (req #3064 retired the standalone Tune icon+menu; the
    // aggregator card is now always the usual width, same as every other card).
    const meShowOnAllCards = useModelEffortDisplayStore(s => s.showOnAllCards);
    const meToggleShowOnAllCards = useModelEffortDisplayStore(s => s.toggleShowOnAllCards);
    // req #2850 — a Trends drill-down is active; in Table view the status-filter
    // chips are replaced by the drill pill (the chips don't apply while drilled).
    const drill = useRequirementDrillStore(s => s.drill);
    const showClosed = false;

    // ── `?epic=` — the plan visualizer's epic chip lands here (req #3428) ────
    // A URL param, not a store: the LINK IS THE FILTER, so it is deep-linkable,
    // survives a reload, and dismissing the pill clears it without touching a
    // single saved preference. That is the same doctrine `StepsPage.jsx` states
    // for the sibling target of the same chip (req #3373), and the reason this
    // is not shaped like `useRequirementDrillStore` — a drill is computed
    // INSIDE its page and never crosses a route; this arrives from a different
    // one.
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const epicId = readEpicParam(searchParams);
    const epicFilterActive = epicId !== null;
    // THE FILTER IS THE CARDS VIEW'S — one expression, so the pill, the two
    // suppressed controls and the row predicate can only ever turn on together.
    // In the other panels the parameter sleeps: it is still in the address bar,
    // nothing is filtered, and nothing claims to be.
    const epicFilterApplies = epicFilterActive && view === 'cards';
    // ── `?step=` — the plan visualizer's requirement-count badge lands here
    // (req #3503) ───────────────────────────────────────────────────────────
    // A PARALLEL, INDEPENDENT filter, not a mode of the epic one: same doctrine
    // (the LINK IS THE FILTER), same cards-view gate, its own parameter, its own
    // pill, its own scope prop. Both may be in the address bar at once and each
    // narrows the rows the other left, which is why nothing below is written as
    // an either/or.
    //
    // READ UP HERE, beside the epic's, because the shared `allCategories` read a
    // few lines down is enabled by EITHER filter and needs both answers before
    // it. Its own hooks and derivations sit in one block after the epic's.
    const stepId = readStepParam(searchParams);
    const stepFilterActive = stepId !== null;
    const stepFilterApplies = stepFilterActive && view === 'cards';
    // ONE derivation of "which requirements does this epic contain", shared with
    // every card and the aggregator — see the hook for why it is an id Set and
    // not a wider projection.
    //
    // KEYED ON `epicFilterApplies`, NOT `epicFilterActive`: with `?epic=` in the
    // address bar and the reader on Table/Visualizer/Trends the filter is asleep,
    // and three reads whose results nothing consumes are pure cost.
    const scopedEpicId = epicFilterApplies ? epicId : null;
    const { epicReqIds, isError: epicScopeError, requirements: epicScopeRequirements } =
        useEpicRequirementIds(profile?.userName, scopedEpicId);
    const { data: epicRows = [] } = useAllEpics(profile?.userName, { enabled: epicFilterApplies });
    // req #3503 — ONE read for BOTH filters' tab seeds. `firstProjectIndexWithEpicWork`
    // is era- and scope-independent (it takes an id Set and never asks how it was
    // derived), so both seeds consume the same category rows; a second hook with
    // a step-shaped name would fetch identical rows into a second cache entry.
    const { data: allCategories = [] } = useAllCategories(profile?.userName, {
        fields: 'id,project_fk', closed: 0, enabled: epicFilterApplies || stepFilterApplies,
    });
    const epicTitle = epicFilterActive
        ? (epicRows.find(e => Number(e.id) === epicId)?.title ?? String(epicId))
        : null;
    // A FAILED MEMBERSHIP READ SHOWS EVERYTHING AND SAYS SO. `epicReqIds` is null
    // on error, so nothing is filtered; the pill goes red and names the state
    // instead of the epic. The alternative — an empty Set — renders every card
    // gone and every badge zero, which reads as "this epic has no work" and never
    // corrects itself. Filtering is a claim, and a claim that cannot be checked
    // must not be made silently.
    const epicFilterFailed = epicFilterApplies && epicScopeError;
    // IS A SCOPE ACTUALLY IN FORCE? Everything the filter OVERRIDES hangs off
    // this rather than off `epicFilterApplies`, so a failed read restores the two
    // suppressed controls and the aggregator's own preference along with the
    // rows — the same rule from the other side: a control is off screen only
    // while something else is deciding for it.
    const epicFilterEngaged = epicFilterApplies && epicReqIds != null;
    // DISMISSING A FILTER RETURNS TO THE READER'S OWN WORKING PROJECT, not
    // wherever the filter's own tab-seed effect left `activeTab` standing
    // (user report: closing the step pill "goes somewhere random"). The seed
    // effect MOVES `activeTab`, but the "persist to localStorage" effect
    // (below) stands down for as long as a filter is engaged, so the STORED
    // value is still the reader's own the whole time — this re-reads it
    // rather than leaving the seeded tab in place once the filter that
    // justified it is gone. Same lookup the initial-mount effect uses,
    // reused rather than re-derived.
    const restoreWorkingProjectTab = () => {
        if (!projectsArray || projectsArray.length === 0) return;
        const storedId = getWorkingProject();
        const idx = storedId ? projectsArray.findIndex((p) => String(p.id) === storedId) : -1;
        setActiveTab(idx >= 0 ? idx : 0);
    };
    const clearEpicFilter = () => {
        setSearchParams(withoutEpicParam(searchParams), { replace: true });
        restoreWorkingProjectTab();
    };

    // ── The `?step=` filter's own derivations (req #3503) ───────────────────
    // Line for line the epic block above, over a ONE-HOP membership answer.
    //
    // DECLARED BEFORE THE EPIC TAB-SEED EFFECT BELOW (req #3503 review), even
    // though it reads as the epic block's sibling rather than its prerequisite:
    // that effect's dependency array reads `stepFilterEngaged` (see its own
    // comment on why), and a dependency array is evaluated the moment
    // `useEffect(...)` is CALLED — synchronously, during render — not deferred
    // the way the effect BODY is. A `const` declared later in this same
    // function is still in the temporal dead zone at that point, so the
    // ordering here is load-bearing, not stylistic.
    //
    // KEYED ON `stepFilterApplies`, NOT `stepFilterActive`, for the epic block's
    // reason: with `?step=` in the address bar and the reader on
    // Table/Visualizer/Trends the filter is asleep, and reads nothing consumes
    // are pure cost.
    const scopedStepId = stepFilterApplies ? stepId : null;
    const { stepReqIds, isError: stepScopeError, requirements: stepScopeRequirements } =
        useStepRequirementIds(profile?.userName, scopedStepId);
    // THE PILL'S NAME. `id,title` is the narrowest projection that answers "what
    // is this step called" — the same shape and the same conditional enablement
    // as `useEpicRequirementIds`' own `id,epic_fk` steps read, so this is the
    // established cost for a plan-table lookup on this page rather than a new
    // one. It is a SEPARATE cache entry from that one (`fieldsInKey`, req #2213),
    // which is correct: the two projections share no column beyond `id`, and only
    // ever one of the two filters is paying for a `pipeline_steps` read at a time.
    const { data: stepRows = [] } = useAllPipelineSteps(profile?.userName, {
        fields: 'id,title', enabled: stepFilterApplies,
    });
    const stepTitle = stepFilterActive
        ? (stepRows.find(s => Number(s.id) === stepId)?.title || String(stepId))
        : null;
    // `||` rather than `??` on the title, unlike `epicTitle`'s: `pipeline_steps.title`
    // is a NOT NULL column that is routinely the empty string (a step named by its
    // requirements alone), and `Step: ` with nothing after it names nothing. An
    // absent row and a blank title both fall back to the raw id.
    //
    // A FAILED MEMBERSHIP READ SHOWS EVERYTHING AND SAYS SO — the epic block's
    // rule, and it must never render as "this step has no work".
    const stepFilterFailed = stepFilterApplies && stepScopeError;
    const stepFilterEngaged = stepFilterApplies && stepReqIds != null;
    const clearStepFilter = () => {
        setSearchParams(withoutStepParam(searchParams), { replace: true });
        restoreWorkingProjectTab();
    };

    // WHERE THE EPIC'S WORK ACTUALLY LIVES, so the link does not land on an
    // empty tab. An epic's requirements sit in categories and categories sit in
    // projects, so a bare landing opens whichever project this reader last
    // worked in — routinely one with none of that epic in it, i.e. the feature
    // invisible on arrival.
    //
    // SEEDED ONCE PER `epicId`, the same re-seed discipline `useSwarmViewSelection`
    // uses for `linkView`: a manual tab click wins from that moment on, and
    // clearing the filter re-arms it for the next link.
    //
    // IT DOES NOT REDEFINE THE READER'S WORKING PROJECT — see the effect below,
    // which stands down while the filter is engaged. Letting it through would
    // have made following this link write `darwin_working_project` to
    // localStorage for 90 days, so a reader who glanced at one epic would find
    // bare `/swarm` opening on a different project ever after. That is the one
    // thing this whole feature promises not to do.
    const epicTabSeededFor = useRef(null);
    useEffect(() => {
        if (!epicFilterEngaged) { epicTabSeededFor.current = null; return; }
        // req #3503 review — WITH BOTH FILTERS ENGAGED, THE STEP SEED EFFECT
        // BELOW OWNS THIS. Each effect only guards against re-seeding ITS OWN
        // scope's tab, so two engaged at once raced on whichever membership
        // read resolved second, sometimes landing on the epic's tab under a
        // pill claiming the (narrower) step — an empty intersection nobody
        // asked to see. Standing down here rather than in the step effect
        // is the deliberate half: a step scope is a subset of at most one
        // epic's work, so it is always the narrower, more specific claim, and
        // the more specific link is the one the reader actually followed.
        if (stepFilterEngaged) { epicTabSeededFor.current = null; return; }
        if (epicTabSeededFor.current === epicId) return;
        const index = firstProjectIndexWithEpicWork(
            projectsArray, allCategories, epicScopeRequirements, epicReqIds);
        // null means either "not resolved yet" (try again next render) or
        // "nowhere" — and leaving the reader on the tab they chose is the right
        // answer to the second, so neither case seeds.
        if (index === null) return;
        epicTabSeededFor.current = epicId;
        setActiveTab(index);
    }, [epicFilterEngaged, stepFilterEngaged, epicId, projectsArray, allCategories,
        epicScopeRequirements, epicReqIds]);

    // WHERE THE STEP'S WORK ACTUALLY LIVES — the epic seed's twin, calling the
    // SAME `firstProjectIndexWithEpicWork`. That function is generic over any id
    // Set (see its own JSDoc: "era-independent, it takes the id Set as an argument
    // and never asks how it was derived"), so a step-shaped copy would be a second
    // implementation of one rule with nothing making them agree.
    //
    // SEEDED ONCE PER `stepId`, and it does NOT redefine the reader's working
    // project — the effect below stands down for this filter as well as the epic's.
    const stepTabSeededFor = useRef(null);
    useEffect(() => {
        if (!stepFilterEngaged) { stepTabSeededFor.current = null; return; }
        if (stepTabSeededFor.current === stepId) return;
        const index = firstProjectIndexWithEpicWork(
            projectsArray, allCategories, stepScopeRequirements, stepReqIds);
        if (index === null) return;
        stepTabSeededFor.current = stepId;
        setActiveTab(index);
    }, [stepFilterEngaged, stepId, projectsArray, allCategories, stepScopeRequirements, stepReqIds]);

    // TanStack Query — fetch projects (open only or with closed based on chip filter)
    const { data: serverProjects } = useProjects(profile?.userName, {
        closed: showClosed ? undefined : 0,
    });

    // Seed local state from query data
    useEffect(() => {
        if (serverProjects) {
            const sorted = [...serverProjects];
            sorted.sort((a, b) => {
                if (a.sort_order === null && b.sort_order === null) return 0;
                if (a.sort_order === null) return 1;
                if (b.sort_order === null) return -1;
                return a.sort_order - b.sort_order;
            });

            const storedId = getWorkingProject();
            let initialTab = 0;
            if (storedId) {
                const idx = sorted.findIndex(d => String(d.id) === storedId);
                if (idx >= 0) initialTab = idx;
            }
            setActiveTab(initialTab);
            setProjectsArray(sorted);
        }
    }, [serverProjects]);

    const projectClose = useConfirmDialog({
        onConfirm: ({ projectName, projectId, projectIndex }) => {
            let uri = `${darwinUri}/projects`;
            call_rest_api(uri, 'PUT', [{'id': projectId, 'closed': 1, 'sort_order': 'NULL'}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        if (showClosed) {
                            let newProjectsArray = projectsArray.map(project =>
                                project.id === projectId ? { ...project, closed: 1, sort_order: null } : project
                            );
                            setProjectsArray(newProjectsArray);
                        } else {
                            let newProjectsArray = [...projectsArray];
                            newProjectsArray = newProjectsArray.filter(project => project.id !== projectId );
                            setProjectsArray(newProjectsArray);
                            if (parseInt(activeTab) === projectIndex ) {
                                setActiveTab(0);
                            }
                        }
                        queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                    } else {
                        showError(result, `Unable to close ${projectName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to close ${projectName}`)
                });
        }
    });

    const projectAdd = useConfirmDialog({
        onConfirm: (newProjectName) => {
            let uri = `${darwinUri}/projects`;
            call_rest_api(uri, 'POST', {'project_name': newProjectName, 'closed': 0, 'sort_order': projectsArray.length}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newProjectsArray = [...projectsArray];
                        newProjectsArray.push(result.data[0]);
                        setProjectsArray(newProjectsArray);
                        queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                    } else if (result.httpStatus.httpStatus === 201) {
                        queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                    } else {
                        showError(result, `Unable to create ${newProjectName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to create ${newProjectName}`)
                });
        },
        defaultInfo: ''
    });

    // Persist working project whenever active tab changes.
    //
    // req #3428 — NOT WHILE AN EPIC FILTER IS ENGAGED. `darwin_working_project`
    // is persisted to localStorage with a 90-day life, and the tab under a filter
    // is not a choice the reader made about where they work — it is either this
    // page's own seed or a click inside a transient, dismissable view. Writing it
    // would mean glancing at one epic silently re-homed bare `/swarm`, which is
    // the same class of defect as the filter writing the view preference or the
    // aggregator toggle, and this is where it would have leaked in.
    //
    // req #3503 — and NOT WHILE A STEP FILTER IS ENGAGED EITHER, identically. A
    // step scope is narrower than an epic one, so its seeded tab is even less a
    // statement about where this reader works.
    useEffect(() => {
        if (epicFilterEngaged || stepFilterEngaged) return;
        if (projectsArray && projectsArray.length > 0) {
            const tabIndex = parseInt(activeTab);
            if (tabIndex >= 0 && tabIndex < projectsArray.length) {
                setWorkingProject(projectsArray[tabIndex].id);
            }
        }
    }, [activeTab, projectsArray, epicFilterEngaged, stepFilterEngaged]);

    const changeActiveTab = (event, newValue) => {
        if (newValue === 9999)
            return;
        setActiveTab(newValue);
    }

    const projectCloseClick = (event, projectName, projectId, projectIndex) => {
        projectClose.openDialog({ projectName, projectId, projectIndex });
    }

    const addProject = (event) => {
        projectAdd.openDialog();
     }

    const handleViewChange = (event, newView) => setView(newView);

    const settingsLinks = [
        { path: '/projectedit', label: 'Projects', icon: FolderIcon },
        { path: '/categoryedit', label: 'Categories', icon: CategoryIcon },
    ];

    // Model/Effort display preference (req #3029) — only meaningful in Cards view.
    //
    // req #3419 deliberately adds NOTHING here. The gold orchestrated mark had
    // two toggles and a border-size ladder for one round and they were removed:
    // the mark is one fixed appearance, so there is nothing to configure and
    // nothing to keep in sync.
    const settingsToggleItems = view === 'cards' ? [
        {
            label: 'Show Model & Effort on all cards',
            checked: meShowOnAllCards,
            onToggle: meToggleShowOnAllCards,
            testId: 'model-effort-show-all-cards',
        },
    ] : [];

    return (
        <>
        {projectsArray ?
            projectsArray.length === 0 ?
            <Box className="app-content-planpage" sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <Box>No projects yet. Click + to create one.</Box>
                <Tab key={'add-project'}
                     icon={<AddIcon onClick={addProject}/>}
                     iconPosition="start"
                     value={9999}
                />
            </Box>
            :
            <>
            <Box className="app-content-planpage">
                    {/* Canonical header row (req #2722) — same LTR order in every view:
                        [view toggle] [req# jump input] [project tabs (cards)]
                        [visualizer toolbar (visualizer)] [flex spacer]
                        [status chips (cards/table)] [rocket (cards)] [settings].
                        The view toggle is the stable far-left anchor; the right-side
                        cluster (chips → rocket → settings) keeps the same relative order
                        in every view, with conditional items either present or omitted
                        but never reordered. `minHeight: 72px` pins all three views to the
                        Cards-view height: MUI v7 `<Tab>` with BOTH icon AND label uses
                        `minHeight: 72` (Tab.js — regardless of iconPosition), so the
                        Tabs in Cards naturally render at 72px; Table and Visualizer
                        expand to that same 72px via this minHeight. The bottom divider
                        is drawn in ALL three views so the visual separator from the
                        content below is consistent.
                        Padding `px: 3` matches `p: 3` on `.app-content-tabpanel` below, so
                        the row's right edge aligns with the tabpanel's right content edge.
                        In Table view, maxWidth is capped at SWARM_TABLE_WIDTH so settings
                        aligns with the table's right edge. */}
                    <Box className="app-content-view-toggle"
                         sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 3, mb: 1, px: 3,
                               minHeight: '72px',
                               borderBottom: 1, borderColor: 'divider',
                               ...(view === 'table' && { maxWidth: SWARM_TABLE_WIDTH }),
                               // Req #2802 — the visualizer's wide toolbar overflowed the
                               // viewport on mobile, scrolling the whole page left/right.
                               // Constrain the row to its grid track and let the toolbar
                               // scroll within its own band instead (children keep their
                               // natural width; the flex-grow spacer still right-aligns
                               // settings when everything fits → no scrollbar on desktop).
                               ...(view === 'visualizer' && {
                                   minWidth: 0,
                                   overflowX: 'auto',
                                   '& > *': { flexShrink: 0 },
                               }) }}
                         data-testid="swarm-view-toggle-row"
                    >
                        <ToggleButtonGroup
                            value={view}
                            exclusive
                            onChange={handleViewChange}
                            size="small"
                            sx={{ flexShrink: 0 }}
                            data-testid="swarm-view-toggle"
                        >
                            {/* Mapped OUT of the same vocabulary `?view=` is validated
                                against (`PipelineDetail.jsx`'s shape), so a fifth view
                                cannot render, toggle and persist while being unlinkable
                                — which is what hand-written `value=` literals allowed,
                                silently, with nothing failing. Adding a view now means
                                adding it to `SWARM_VIEWS`, and `SWARM_VIEW_CHROME`
                                fails the render if it has no entry. */}
                            {SWARM_VIEWS.map((value) => {
                                const { label, Icon } = SWARM_VIEW_CHROME[value];
                                return (
                                    <Tooltip key={value} title={label}>
                                        <ToggleButton value={value} data-testid={`view-toggle-${value}`} sx={{ px: 2 }}>
                                            <Icon fontSize="small" />
                                        </ToggleButton>
                                    </Tooltip>
                                );
                            })}
                        </ToggleButtonGroup>
                        <RequirementJumpInput />
                        {view === 'cards' && (
                            <Tabs value={activeTab.toString()}
                                  onChange={changeActiveTab}
                                  variant="scrollable"
                                  scrollButtons="auto"
                                  sx={{ flexShrink: 1, minWidth: 0 }} >
                                {projectsArray.map( (project, projectIndex) =>
                                    <Tab key={project.id}
                                         icon={<CloseIcon onClick={(event) => projectCloseClick(event, project.project_name, project.id, projectIndex)}/>}
                                         label={project.project_name}
                                         value={projectIndex.toString()}
                                         iconPosition="end" />
                                )}
                                <Tab key={'add-project'}
                                     icon={<AddIcon onClick={addProject}/>}
                                     iconPosition="start"
                                     value={9999}
                                />
                            </Tabs>
                        )}
                        {view === 'visualizer' && <VisualizerToolbar />}
                        <Box sx={{ flexGrow: 1 }} />
                        {/* req #3428 — the epic filter's dismissable pill, first
                            item of the right-hand cluster because that is where
                            this page's filters live. Deliberately NOT on the
                            left: the project `<Tabs>` there carry
                            `flexShrink: 1, minWidth: 0`, so a variable-width
                            chip beside them steals width from the tabs.

                            RENDERED EXACTLY WHEN IT IS APPLYING — `view ===
                            'cards'` is the same condition the row filter turns
                            on, because this filter is the CARDS view's. In the
                            other three panels the parameter sleeps and re-applies
                            on return; only the ✕ clears it. A control on screen
                            that is not applying is the defect the `!drill`
                            guards below already exist to avoid.

                            The body opens the Epics editor and the ✕ clears the
                            filter — the other end of the same epic chip's two
                            links. MUI routes the delete icon's click to
                            `onDelete` alone, so the two never fire together.

                            req #3356 — the 1.0 editor was DELETED and the
                            surviving one took its route back, so this target is
                            `/swarm/epics` again. It briefly pointed at
                            `/swarm/epics2` while both eras stood; a chip whose
                            whole affordance is "open the editor" landing on
                            Error404 is worse than no chip, so this string moves
                            in the same commit as the route. */}
                        {epicFilterApplies && (
                            <Chip size="small"
                                  color={epicFilterFailed ? 'error' : 'secondary'}
                                  label={epicFilterFailed
                                      ? `Epic filter unavailable — showing everything`
                                      : `Epic: ${epicTitle}`}
                                  onClick={() => navigate('/swarm/epics')}
                                  title={epicFilterFailed
                                      ? 'The epic membership read failed, so nothing is being filtered'
                                      : 'Open the Epics editor'}
                                  onDelete={clearEpicFilter}
                                  sx={{ flexShrink: 0, cursor: 'pointer' }}
                                  data-testid="swarm-epic-filter-chip" />
                        )}
                        {/* req #3503 — the step filter's pill, the epic pill's
                            twin and rendered INDEPENDENTLY of it. Both can be on
                            screen at once: they are two conditions, not two
                            values of one, and a reader who arrived by one link
                            and then followed the other should see both scopes
                            named rather than one silently replacing the other.

                            RENDERED EXACTLY WHEN IT IS APPLYING — `view ===
                            'cards'`, the same gate the row filter turns on.

                            The body opens the Steps editor (`/swarm/steps`), the
                            same relationship the epic pill has to the Epics
                            editor; the ✕ clears `?step=` and touches nothing
                            else, so dismissing one pill leaves the other's
                            parameter exactly where it was. */}
                        {stepFilterApplies && (
                            <Chip size="small"
                                  color={stepFilterFailed ? 'error' : 'secondary'}
                                  label={stepFilterFailed
                                      ? `Step filter unavailable — showing everything`
                                      : `Step: ${stepTitle}`}
                                  onClick={() => navigate('/swarm/steps')}
                                  title={stepFilterFailed
                                      ? 'The step membership read failed, so nothing is being filtered'
                                      : 'Open the Steps editor'}
                                  onDelete={clearStepFilter}
                                  sx={{ flexShrink: 0, cursor: 'pointer' }}
                                  data-testid="swarm-step-filter-chip" />
                        )}
                        {(view === 'cards' || (view === 'table' && !drill)) && (
                            <ChipFilter
                                options={requirementStatusOptions}
                                selected={requirementStatusFilter}
                                onToggle={toggleRequirementStatus}
                                testId="requirement-status-filter"
                            />
                        )}
                        {/* req #3419 — ORCHESTRATED now means BOTH: a pipeline
                            step carries it, OR an epic seats it (requirement ->
                            feature -> epic). req #3180 answered step
                            association alone and called the gap "what the
                            filter exists to expose"; measured on production,
                            what the reader saw was a control asked to hide
                            orchestrated work still showing 4 epic-seated
                            requirements in one card. Filed twice, so the
                            control now answers the question its label makes.
                            The tooltip names both halves for the same reason
                            #3180's named one: a reader must not have to guess
                            which membership the icon means.

                            req #3502 — THIS CONTROL NOW REACHES EVERY SURFACE
                            ON THE PAGE, the aggregator card included. It used
                            to stop short of three of that card's five chips,
                            which held an unconditional exclusion of their own;
                            measured on production, 18 `authoring` requirements
                            that this control could not show. There is no
                            surface left with a second answer. */}
                        {/* `!drill` for the same reason the status chips carry it:
                            a Trends drill-down bypasses both filters, so leaving
                            the control on screen would show an ON toggle that is
                            not applying. Cards view joined Table (req #3258):
                            editing/hand-sorting an orchestrated requirement's
                            position there doesn't mean anything (the plan owns
                            it, not the card), so hiding it fixes the card view's
                            own broken edit affordance, not just its clutter —
                            see CategoryCard.jsx's identical predicate. */}
                        {/* req #3242 user directive — the icon reads as ON
                            (blue) exactly when orchestrated requirements are
                            ON screen, and OFF (default/white) when they are
                            hidden. That is the opposite mapping from before:
                            `hidePipelined` used to light up blue to announce
                            the filter it applies; now the icon announces what
                            is CURRENTLY VISIBLE, not which control is active. */}
                        {/* req #3428 — `!epicFilterApplies` joins `!drill` for
                            the reason stated three comments up: an epic filter
                            forces this toggle OFF (`effectiveHidePipelined`), so
                            leaving it on screen would show a control that is not
                            applying — and, worse, an ON toggle whose stored value
                            says the exact opposite of what the reader sees. */}
                        {/* req #3503 — `!stepFilterEngaged` joins it for the
                            identical reason: a step filter forces this toggle OFF
                            too (`useRequirementVisibility`), so leaving it on
                            screen would show a control that is not applying. */}
                        {(view === 'cards' || (view === 'table' && !drill)) && !epicFilterEngaged && !stepFilterEngaged && (
                            <Tooltip title={hidePipelined
                                ? 'Hiding orchestrated requirements (on a plan step or in an epic)'
                                : 'Showing orchestrated requirements (on a plan step or in an epic)'}>
                                <IconButton
                                    size="small"
                                    onClick={toggleHidePipelined}
                                    color={hidePipelined ? 'default' : 'primary'}
                                    aria-label={hidePipelined
                                        ? 'Hiding orchestrated requirements'
                                        : 'Showing orchestrated requirements'}
                                    aria-pressed={!hidePipelined}
                                    data-testid="hide-pipelined-toggle"
                                    sx={{ flexShrink: 0 }}
                                >
                                    <AccountTreeIcon />
                                </IconButton>
                            </Tooltip>
                        )}
                        {/* Hidden under an epic filter for the same reason: the
                            aggregator is forced visible there (the requirement's
                            "you get the aggregator on"), so this toggle would
                            flip a stored preference and change nothing on
                            screen. */}
                        {view === 'cards' && !epicFilterEngaged && !stepFilterEngaged && (
                            <Tooltip title={showSwarmStartCard ? 'Hide Swarm-Start Card' : 'Show Swarm-Start Card'}>
                                <IconButton
                                    size="small"
                                    onClick={toggleSwarmStartCard}
                                    color={showSwarmStartCard ? 'primary' : 'default'}
                                    data-testid="swarm-start-card-toggle"
                                    sx={{ flexShrink: 0 }}
                                >
                                    <RocketLaunchIcon />
                                </IconButton>
                            </Tooltip>
                        )}
                        <SettingsMenu
                            tooltipTitle="Manage Projects & Categories"
                            links={settingsLinks}
                            toggleItems={settingsToggleItems}
                        />
                    </Box>

                    {/* Content — table view */}
                    {view === 'table' && (
                        <Box className="app-content-tabpanel">
                            <RequirementsTableView />
                        </Box>
                    )}

                    {/* Content — cards view */}
                    {/* req #3428 — TWO derived overrides, neither of which
                        writes a store.

                        The aggregator is FORCED VISIBLE under an epic filter
                        (the requirement's "you get the aggregator on") by OR-ing
                        the host's own boolean, never by calling `toggle()`: an
                        external condition must not overwrite uncommitted user
                        intent, so dismissing the pill restores exactly the
                        aggregator state the reader had.

                        `epicReqIds` is the SCOPE, threaded down as a prop
                        because the HOST owns the filter — an aggregator never
                        invents one. `null` (not an empty Set) is what says "no
                        filter": an empty Set means the filter is on and matches
                        nothing, which is a different page. */}
                    {view === 'cards' && projectsArray.map( (project, projectIndex) =>
                        <CategoryTabPanel key={project.id}
                                          project = {project}
                                          projectIndex = {projectIndex}
                                          activeTab = {activeTab}
                                          showClosed = {showClosed}
                                          epicReqIds = {epicFilterEngaged ? epicReqIds : null}
                                          stepReqIds = {stepFilterEngaged ? stepReqIds : null}
                                          showSwarmStartCard = {showSwarmStartCard || epicFilterEngaged || stepFilterEngaged}>
                        </CategoryTabPanel>
                    )}

                    {/* Content — visualizer view (req #2394 — migrated from /calview).
                        Wrap in `.app-content-tabpanel` so the visualizer claims the full
                        `tab-panels` grid area of `.app-content-planpage` (same pattern
                        as table view); otherwise it collapses into an implicit grid cell. */}
                    {view === 'visualizer' && (
                        <Box className="app-content-tabpanel">
                            <SwarmVisualizerView />
                        </Box>
                    )}

                    {/* Content — trends view (req #2812). Charts requirements
                        closed over time; wrapped in `.app-content-tabpanel` so it
                        claims the full tab-panels grid area like table/visualizer. */}
                    {view === 'trends' && (
                        <Box className="app-content-tabpanel">
                            {/* Transient, not persisted — clicking a chart bar to inspect
                                its requirements is not a request to make Table the
                                default in every tab. See `showViewTransiently`. */}
                            <RequirementsTrendsView onDrillToTable={() => showViewTransiently('table')} />
                        </Box>
                    )}
            </Box>
            <ProjectCloseDialog dialogOpen={projectClose.dialogOpen}
                               setDialogOpen={projectClose.setDialogOpen}
                               closeInfo={projectClose.infoObject}
                               setCloseInfo={projectClose.setInfoObject}
                               setCloseConfirmed={projectClose.setConfirmed} />
            </>
            :
            <CircularProgress/>
        }
        <ProjectAddDialog dialogOpen={projectAdd.dialogOpen}
                         setDialogOpen={projectAdd.setDialogOpen}
                         newProjectInfo={projectAdd.infoObject}
                         setNewProjectInfo={projectAdd.setInfoObject}
                         setAddConfirmed={projectAdd.setConfirmed} />
        <RequirementDragLayer />
        </>
    );

}

export default SwarmView;
