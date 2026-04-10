import React, {useState, useContext, useEffect, useRef} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useWorkingProjectStore } from '../stores/useWorkingProjectStore';
import { useProjects, useAllCategories, useRequirementCounts } from '../hooks/useDataQueries';
import { projectKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';

import Box from '@mui/material/Box';
import { Typography } from '@mui/material';

import ProjectDeleteDialog from './ProjectDeleteDialog';
import ProjectTableRow from './ProjectTableRow';
import { PROJECT_GRID_COLUMNS } from './ProjectTableRow';

const ProjectEdit = () => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [projectsArray, setProjectsArray] = useState();

    const [categoryCounts, setCategoryCounts] = useState({});
    const [requirementCounts, setRequirementCounts] = useState({});
    const [selectedId, setSelectedId] = useState(null);
    const templateInputRef = useRef(null);

    const showError = useSnackBarStore(s => s.showError);
    const setWorkingProject = useWorkingProjectStore(s => s.setWorkingProject);

    // TanStack Query — fetch all projects (open + closed), categories, and requirement counts
    const { data: serverProjects } = useProjects(profile?.userName, {
        fields: 'id,project_name,closed,sort_order',
    });
    const { data: serverCategories } = useAllCategories(profile?.userName);
    const { data: serverRequirementCounts } = useRequirementCounts(profile?.userName);

    // Seed local state from query data
    useEffect(() => {
        if (serverProjects) {
            const sorted = [...serverProjects];
            sorted.sort((a, b) => projectSortByClosedThenSortOrder(a, b));
            sorted.push({'id':'', 'project_name':'', 'closed': 0, 'sort_order': null });
            setProjectsArray(sorted);
        }
    }, [serverProjects]);

    // Compute category and requirement counts from query data
    useEffect(() => {
        if (serverCategories) {
            const newCategoryCounts = {};
            const categoryToProject = {};
            serverCategories.forEach((cat) => {
                categoryToProject[String(cat.id)] = cat.project_fk;
                newCategoryCounts[cat.project_fk] = (newCategoryCounts[cat.project_fk] || 0) + 1;
            });
            setCategoryCounts(newCategoryCounts);

            if (serverRequirementCounts) {
                const newRequirementCounts = {};
                serverRequirementCounts.forEach((pc) => {
                    const projectFk = categoryToProject[String(pc.category_fk)];
                    if (projectFk !== undefined) {
                        newRequirementCounts[projectFk] = (newRequirementCounts[projectFk] || 0) + pc['count(*)'];
                    }
                });
                setRequirementCounts(newRequirementCounts);
            }
        }
    }, [serverCategories, serverRequirementCounts]);

    const projectDelete = useConfirmDialog({
        onConfirm: ({ projectId }) => {
            let uri = `${darwinUri}/projects`;
            call_rest_api(uri, 'DELETE', {'id': projectId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newProjectsArray = [...projectsArray];
                        newProjectsArray = newProjectsArray.filter(p => p.id !== projectId);
                        setProjectsArray(newProjectsArray);
                        queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete project');
                    }
                }).catch(error => {
                    showError(error, 'Unable to delete project');
                });
        }
    });

    const restUpdateProjectName = (projectIndex, projectId) => {

        const noop = ()=>{};

        if ((projectId === '') &&
            (projectsArray[projectIndex].project_name === '')) {
            noop();
        } else {
            if (projectId === '') {
                restSaveProjectName(projectIndex);
            } else {
                let uri = `${darwinUri}/projects`;
                call_rest_api(uri, 'PUT', [{'id': projectId, 'project_name': projectsArray[projectIndex].project_name}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            showError(result, 'Unable to update project name');
                        } else {
                            queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                        }
                    }).catch(error => {
                        showError(error, 'Unable to update project name');
                    });
            }
        }
    }

    const { fieldChange: changeProjectName, fieldKeyDown: keyDownProjectName, fieldOnBlur: blurProjectName } = useCrudCallbacks({
        items: projectsArray, setItems: setProjectsArray, fieldName: 'project_name',
        saveFn: (_event, index, id) => restUpdateProjectName(index, id)
    });

    const restSaveProjectName = (projectIndex) => {

        let uri = `${darwinUri}/projects`;

        let newProjectsArray = [...projectsArray];
        newProjectsArray[projectIndex].sort_order = calculateSortOrder(newProjectsArray, projectIndex, newProjectsArray[projectIndex].closed);

        call_rest_api(uri, 'POST', {...newProjectsArray[projectIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    let freshProjectsArray = [...projectsArray];
                    freshProjectsArray[projectIndex] = {...result.data[0]};
                    freshProjectsArray.sort((a, b) => projectSortByClosedThenSortOrder(a, b));
                    freshProjectsArray.push({'id':'', 'project_name':'', 'closed': 0, 'sort_order': null });
                    setProjectsArray(freshProjectsArray);

                    let newCategoryCounts = {...categoryCounts};
                    newCategoryCounts[result.data[0].id] = 0;
                    setCategoryCounts(newCategoryCounts);

                    let newRequirementCounts = {...requirementCounts};
                    newRequirementCounts[result.data[0].id] = 0;
                    setRequirementCounts(newRequirementCounts);

                    queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                    setTimeout(() => templateInputRef.current?.focus(), 0);

                } else if (result.httpStatus.httpStatus < 205) {
                    queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                } else {
                    showError(result, 'Unable to create project');
                }
            }).catch(error => {
                showError(error, 'Unable to create project');
            });
    }

    const clickProjectClosed = (event, projectIndex, projectId) => {

        let newProjectsArray = [...projectsArray];
        let newClosed = newProjectsArray[projectIndex].closed ? 0 : 1;
        newProjectsArray[projectIndex].closed = newClosed;

        if (projectId !== '') {
            let newSortOrder = calculateSortOrder(newProjectsArray, projectIndex, newClosed);

            let uri = `${darwinUri}/projects`;
            call_rest_api(uri, 'PUT', [{'id': projectId, 'closed': newClosed, 'sort_order': newSortOrder}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to close project');
                    }
                }).catch(error => {
                    showError(error, 'Unable to close project');
                });
        }

        newProjectsArray.sort((a, b) => projectSortByClosedThenSortOrder(a, b));
        setProjectsArray(newProjectsArray);
    }

    const handleRowClick = (id) => {
        setSelectedId(String(id));
        if (id !== '') setWorkingProject(id);
    };

    const clickProjectDelete = (event, projectId, projectName) => {
        projectDelete.openDialog({ projectName, projectId, requirementsCount: requirementCounts[projectId] });
    }

    const projectSortByClosedThenSortOrder = (a, b) => {
        if (a.id === '') return 0;
        if (b.id === '') return -1;

        if ((a.closed === 0) && (b.closed === 0)) {
            if (a.sort_order === b.sort_order) return 0;
            if (a.sort_order === null) return 1;
            if (b.sort_order === null) return -1;
            return a.sort_order < b.sort_order ? -1 : 1;
        }

        if (a.closed === b.closed) return 0;
        return a.closed > b.closed ? 1 : -1;
    }

    const calculateSortOrder = (arr, index, newClosed) => {
        var calcSortOrder = "NULL";

        if (newClosed === 0) {
            calcSortOrder = arr.reduce((previous, current) => {
                if (current.sort_order === null) return previous;
                return (previous > current.sort_order) ? previous : current.sort_order;
            }, -1);
            calcSortOrder = calcSortOrder + 1;
        }
        arr[index].sort_order = (calcSortOrder === "NULL") ? null : calcSortOrder;
        return calcSortOrder;
    }

    const dragEnd = async (result) => {

        if ((result.destination === null) || (result.reason !== 'DROP')) {
            return;
        }

        var newProjectsArray = [...projectsArray];
        const [draggedItem] = newProjectsArray.splice(result.source.index, 1);
        newProjectsArray.splice(result.destination.index, 0, draggedItem);

        newProjectsArray = newProjectsArray.map((proj, index) => {
            if ((proj.id !== '') && (proj.closed !== 1)) {
                proj.sort_order = index;
                return proj;
            } else {
                return proj;
            }
        });

        setProjectsArray(newProjectsArray);

        var restDataArray = newProjectsArray
                .filter(proj => ((proj.id !== '') && (proj.sort_order !== null)) ? true : false)
                .map(proj => ({'id': proj.id, 'sort_order': proj.sort_order}));

        let uri = `${darwinUri}/projects`;
        call_rest_api(uri, 'PUT', restDataArray, idToken)
            .then(result => {
                if ((result.httpStatus.httpStatus === 200) ||
                    (result.httpStatus.httpStatus === 204)) {
                    queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                } else {
                    showError(result, 'Unable to save project sort order');
                }
            }).catch(error => {
                showError(error, 'Unable to save project sort order');
            });
    }

    return (
        <>
            <Box className="app-title">
                <Typography variant="h4" sx={{ ml: { xs: 1, md: 2 } }}>
                    Projects Editor
                </Typography>
            </Box>
            { projectsArray &&
                <Box className="app-edit" sx={{ ml: { xs: 0, md: 2 } }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: PROJECT_GRID_COLUMNS, alignItems: 'center', borderBottom: 1, borderColor: 'divider', pb: 0.5, mb: 0.5 }}>
                        <Box sx={{ px: 1 }}><Typography variant="subtitle2">Name</Typography></Box>
                        <Box sx={{ textAlign: 'center' }}><Typography variant="subtitle2">Closed</Typography></Box>
                        <Box sx={{ textAlign: 'center' }}><Typography variant="subtitle2">Categories</Typography></Box>
                        <Box sx={{ textAlign: 'center' }}><Typography variant="subtitle2">Requirements</Typography></Box>
                        <Box />
                    </Box>
                    <DragDropContext onDragEnd={dragEnd}>
                        <Droppable droppableId="projects">
                            {(provided) => (
                                <Box {...provided.droppableProps} ref={provided.innerRef}>
                                { projectsArray
                                    .filter(p => p.closed === 0 && p.id !== '')
                                    .map((project, idx) => (
                                    <ProjectTableRow
                                        key={project.id}
                                        project={project}
                                        projectIndex={idx}
                                        changeProjectName={changeProjectName}
                                        keyDownProjectName={keyDownProjectName}
                                        blurProjectName={blurProjectName}
                                        clickProjectClosed={clickProjectClosed}
                                        clickProjectDelete={clickProjectDelete}
                                        categoryCounts={categoryCounts}
                                        requirementCounts={requirementCounts}
                                        onRowClick={handleRowClick}
                                        isSelected={String(project.id) === selectedId}
                                        isDraggable
                                    />
                                ))}
                                {provided.placeholder}
                                </Box>
                            )}
                        </Droppable>
                    </DragDropContext>
                    { projectsArray
                        .filter(p => p.closed === 1 || p.id === '')
                        .map((project) => (
                        <ProjectTableRow
                            key={project.id || 'template'}
                            project={project}
                            projectIndex={projectsArray.indexOf(project)}
                            changeProjectName={changeProjectName}
                            keyDownProjectName={keyDownProjectName}
                            blurProjectName={blurProjectName}
                            clickProjectClosed={clickProjectClosed}
                            clickProjectDelete={clickProjectDelete}
                            categoryCounts={categoryCounts}
                            requirementCounts={requirementCounts}
                            onRowClick={handleRowClick}
                            isSelected={String(project.id) === selectedId}
                            isDraggable={false}
                            inputRef={project.id === '' ? templateInputRef : undefined}
                        />
                    ))}
                </Box>
            }
            <ProjectDeleteDialog
                projectDeleteDialogOpen = { projectDelete.dialogOpen }
                setProjectDeleteDialogOpen = { projectDelete.setDialogOpen }
                projectInfo = { projectDelete.infoObject }
                setProjectInfo = { projectDelete.setInfoObject }
                setProjectDeleteConfirmed = { projectDelete.setConfirmed }
            />
        </>
    )
}

export default ProjectEdit
