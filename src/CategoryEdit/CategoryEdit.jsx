import '../index.css';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useWorkingProjectStore } from '../stores/useWorkingProjectStore';
import { useProjects } from '../hooks/useDataQueries';
import { projectKeys } from '../hooks/useQueryKeys';
import ProjectCloseDialog from '../SwarmView/ProjectCloseDialog';
import ProjectAddDialog from '../SwarmView/ProjectAddDialog';

import React, { useState, useEffect, useContext } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { Tabs } from '@mui/material';
import Tab from '@mui/material/Tab';
import { Typography } from '@mui/material';
import CategoryEditTabPanel from './CategoryEditTabPanel';

const CategoryEdit = () => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [projectsArray, setProjectsArray] = useState();

    const [activeTab, setActiveTab] = useState();

    const showError = useSnackBarStore(s => s.showError);
    const getWorkingProject = useWorkingProjectStore(s => s.getWorkingProject);
    const setWorkingProject = useWorkingProjectStore(s => s.setWorkingProject);

    // TanStack Query — fetch open projects
    const { data: serverProjects } = useProjects(profile?.userName, { closed: 0 });

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
                const idx = sorted.findIndex(p => String(p.id) === storedId);
                if (idx >= 0) initialTab = idx;
            }
            setActiveTab(initialTab);
            setProjectsArray(sorted);
        }
    }, [serverProjects]);

    const projectClose = useConfirmDialog({
        onConfirm: ({ projectId, projectIndex }) => {
            let uri = `${darwinUri}/projects`;
            call_rest_api(uri, 'PUT', [{'id': projectId, 'closed': 1, 'sort_order': 'NULL'}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newProjectsArray = [...projectsArray];
                        newProjectsArray = newProjectsArray.filter(p => p.id !== projectId);
                        setProjectsArray(newProjectsArray);
                        if (parseInt(activeTab) === projectIndex) {
                            setActiveTab(0);
                        }
                        queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to close project');
                    }
                }).catch(error => {
                    showError(error, 'Unable to close project');
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
                    } else if (result.httpStatus.httpStatus === 204) {
                        queryClient.invalidateQueries({ queryKey: projectKeys.all(profile.userName) });
                    } else {
                        showError(result, `Unable to save new project ${newProjectName}`);
                    }
                }).catch(error => {
                    showError(error, `Unable to save new project ${newProjectName}`);
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

    return (
        <>
            <Box className="app-title">
                <Typography variant="h4" sx={{ ml: { xs: 1, md: 2 } }}>
                    Categories Editor
                </Typography>
            </Box>
            { projectsArray &&
                <>
                    <Box className="app-edit" sx={{ ml: { xs: 0, md: 2 } }}>
                        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                            <Tabs value={activeTab.toString()}
                                  onChange={changeActiveTab}
                                  variant="scrollable"
                                  scrollButtons="auto" >
                                { projectsArray.map( (project, projectIndex) =>
                                    <Tab key={project.id}
                                         icon={<CloseIcon onClick={(event) => projectCloseClick(event, project.project_name, project.id, projectIndex)}/>}
                                         label={project.project_name}
                                         value={projectIndex.toString()}
                                         iconPosition="end" />
                                )}
                                <Tab key={9999}
                                     icon={<AddIcon onClick={addProject}/>}
                                     iconPosition="start"
                                     value={9999} />
                            </Tabs>
                        </Box>
                            { projectsArray.map( (project, projectIndex) =>
                                <CategoryEditTabPanel key={project.id}
                                                      project = {project}
                                                      projectIndex = {projectIndex}
                                                      activeTab = {activeTab} />
                            )}
                    </Box>
                    <ProjectCloseDialog dialogOpen={projectClose.dialogOpen}
                                        setDialogOpen={projectClose.setDialogOpen}
                                        closeInfo={projectClose.infoObject}
                                        setCloseInfo={projectClose.setInfoObject}
                                        setCloseConfirmed={projectClose.setConfirmed} />
                    <ProjectAddDialog dialogOpen={projectAdd.dialogOpen}
                                      setDialogOpen={projectAdd.setDialogOpen}
                                      newProjectInfo={projectAdd.infoObject}
                                      setNewProjectInfo={projectAdd.setInfoObject}
                                      setAddConfirmed={projectAdd.setConfirmed} />
                </>
            }
        </>
    );
}

export default CategoryEdit;
