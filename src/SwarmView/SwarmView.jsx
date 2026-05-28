import '../index.css';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { useWorkingProjectStore } from '../stores/useWorkingProjectStore';
import { useShowClosedStore, ALL_REQUIREMENT_STATUSES } from '../stores/useShowClosedStore';
import { useSwarmStartCardStore } from '../stores/useSwarmStartCardStore';
import { useProjects } from '../hooks/useDataQueries';
import { projectKeys } from '../hooks/useQueryKeys';
import { useViewPreference } from '../hooks/useViewPreference';

import ProjectCloseDialog from './ProjectCloseDialog';
import ProjectAddDialog from './ProjectAddDialog';
import CategoryTabPanel from './CategoryTabPanel';
import RequirementDragLayer from './RequirementDragLayer';
import RequirementsTableView, { SWARM_TABLE_WIDTH } from './RequirementsTableView';
import SwarmVisualizerView from './SwarmVisualizerView';
import VisualizerToolbar from './VisualizerToolbar';

import React, { useState, useEffect, useContext } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import Tab from '@mui/material/Tab';
import { CircularProgress, Tabs } from '@mui/material';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import SettingsMenu from '../Components/SettingsMenu/SettingsMenu';
import RequirementJumpInput from '../NavBar/RequirementJumpInput';
import FolderIcon from '@mui/icons-material/Folder';
import CategoryIcon from '@mui/icons-material/Category';
import { requirementStatusChipProps, requirementStatusLabel } from './statusChipStyles';

const SWARM_VIEW_STORAGE_KEY = 'darwin-swarm-view';

const SwarmView = () => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [projectsArray, setProjectsArray] = useState()
    const [view, setView] = useViewPreference(SWARM_VIEW_STORAGE_KEY, 'cards');

    const activeTab = useSwarmTabStore(s => s.activeTab);
    const setActiveTab = useSwarmTabStore(s => s.setActiveTab);

    const showError = useSnackBarStore(s => s.showError);
    const getWorkingProject = useWorkingProjectStore(s => s.getWorkingProject);
    const setWorkingProject = useWorkingProjectStore(s => s.setWorkingProject);
    const requirementStatusFilter = useShowClosedStore(s => s.requirementStatusFilter);
    const toggleRequirementStatus = useShowClosedStore(s => s.toggleRequirementStatus);
    const showSwarmStartCard = useSwarmStartCardStore(s => s.show);
    const toggleSwarmStartCard = useSwarmStartCardStore(s => s.toggle);
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
                               ...(view === 'table' && { maxWidth: SWARM_TABLE_WIDTH }) }}
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
                            <Tooltip title="Cards View">
                                <ToggleButton value="cards" data-testid="view-toggle-cards" sx={{ px: 2 }}>
                                    <ViewModuleIcon fontSize="small" />
                                </ToggleButton>
                            </Tooltip>
                            <Tooltip title="Table View">
                                <ToggleButton value="table" data-testid="view-toggle-table" sx={{ px: 2 }}>
                                    <TableChartIcon fontSize="small" />
                                </ToggleButton>
                            </Tooltip>
                            <Tooltip title="Visualizer View">
                                <ToggleButton value="visualizer" data-testid="view-toggle-visualizer" sx={{ px: 2 }}>
                                    <BubbleChartIcon fontSize="small" />
                                </ToggleButton>
                            </Tooltip>
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
                        {view !== 'visualizer' && (
                            <Stack direction="row" spacing={0.5} data-testid="requirement-status-filter">
                                {ALL_REQUIREMENT_STATUSES.map(status => {
                                    const selected = requirementStatusFilter.includes(status);
                                    const chipProps = requirementStatusChipProps(status);
                                    return (
                                        <Chip
                                            key={status}
                                            label={requirementStatusLabel(status)}
                                            size="small"
                                            onClick={() => toggleRequirementStatus(status)}
                                            {...(selected ? chipProps : { variant: 'outlined' })}
                                            sx={{
                                                ...(selected ? chipProps.sx : {}),
                                                ...(!selected && { opacity: 0.5 }),
                                                cursor: 'pointer',
                                                textTransform: 'capitalize',
                                            }}
                                            data-testid={`filter-chip-${status}`}
                                        />
                                    );
                                })}
                            </Stack>
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
