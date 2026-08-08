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
import { useProjects } from '../hooks/useDataQueries';
import { projectKeys } from '../hooks/useQueryKeys';

import ProjectCloseDialog from './ProjectCloseDialog';
import ProjectAddDialog from './ProjectAddDialog';
import CategoryTabPanel from './CategoryTabPanel';
import RequirementDragLayer from './RequirementDragLayer';
import RequirementsTableView, { SWARM_TABLE_WIDTH } from './RequirementsTableView';
import SwarmVisualizerView from './SwarmVisualizerView';
import RequirementsTrendsView from './RequirementsTrendsView';
import VisualizerToolbar from './VisualizerToolbar';

import React, { useState, useEffect, useContext } from 'react';
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
import ChipFilter from '../Components/ChipFilter';
import { SWARM_VIEWS } from './swarmViewLink';
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

    // Persist working project whenever active tab changes
    useEffect(() => {
        if (projectsArray && projectsArray.length > 0) {
            const tabIndex = parseInt(activeTab);
            if (tabIndex >= 0 && tabIndex < projectsArray.length) {
                setWorkingProject(projectsArray[tabIndex].id);
            }
        }
    }, [activeTab, projectsArray]);

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
                        {(view === 'cards' || (view === 'table' && !drill)) && (
                            <ChipFilter
                                options={requirementStatusOptions}
                                selected={requirementStatusFilter}
                                onToggle={toggleRequirementStatus}
                                testId="requirement-status-filter"
                            />
                        )}
                        {/* req #3180 — the label names the question it answers:
                            PIPELINE STEP association ("is this scheduled"), not
                            epic association ("does this belong to a body of
                            work"). A requirement can carry a feature, and so an
                            epic, while sitting in no plan at all; a label that
                            didn't distinguish them would be read as answering
                            whichever one the user had in mind. */}
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
                        {(view === 'cards' || (view === 'table' && !drill)) && (
                            <Tooltip title={hidePipelined
                                ? 'Hiding orchestrated requirements'
                                : 'Showing orchestrated requirements'}>
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
                        {view === 'cards' && (
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
                    {view === 'cards' && projectsArray.map( (project, projectIndex) =>
                        <CategoryTabPanel key={project.id}
                                          project = {project}
                                          projectIndex = {projectIndex}
                                          activeTab = {activeTab}
                                          showClosed = {showClosed}
                                          showSwarmStartCard = {showSwarmStartCard}>
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
