import '../index.css';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useSwarmTabStore } from '../stores/useSwarmTabStore';
import { useWorkingProjectStore } from '../stores/useWorkingProjectStore';
import { useApiTrigger } from '../hooks/useApiTrigger';

import ProjectCloseDialog from './ProjectCloseDialog';
import ProjectAddDialog from './ProjectAddDialog';
import CategoryTabPanel from './CategoryTabPanel';

import React, { useState, useEffect, useContext } from 'react';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import Tab from '@mui/material/Tab';
import { CircularProgress, Tabs } from '@mui/material';

const SwarmView = () => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [projectsArray, setProjectsArray] = useState()
    const [projectApiTrigger, triggerProjectRefresh] = useApiTrigger();

    const activeTab = useSwarmTabStore(s => s.activeTab);
    const setActiveTab = useSwarmTabStore(s => s.setActiveTab);

    const showError = useSnackBarStore(s => s.showError);
    const getWorkingProject = useWorkingProjectStore(s => s.getWorkingProject);
    const setWorkingProject = useWorkingProjectStore(s => s.setWorkingProject);

    const projectClose = useConfirmDialog({
        onConfirm: ({ projectName, projectId, projectIndex }) => {
            let uri = `${darwinUri}/projects`;
            call_rest_api(uri, 'PUT', [{'id': projectId, 'closed': 1, 'sort_order': 'NULL'}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newProjectsArray = [...projectsArray];
                        newProjectsArray = newProjectsArray.filter(project => project.id !== projectId );
                        setProjectsArray(newProjectsArray);
                        if (parseInt(activeTab) === projectIndex ) {
                            setActiveTab(0);
                        }
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
            call_rest_api(uri, 'POST', {'creator_fk': profile.userName, 'project_name': newProjectName, 'closed': 0, 'sort_order': projectsArray.length}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newProjectsArray = [...projectsArray];
                        newProjectsArray.push(result.data[0]);
                        setProjectsArray(newProjectsArray);
                    } else if (result.httpStatus.httpStatus === 201) {
                        triggerProjectRefresh();
                    } else {
                        showError(result, `Unable to create ${newProjectName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to create ${newProjectName}`)
                });
        },
        defaultInfo: ''
    });

    // READ projects
    useEffect( () => {

        let projectUri = `${darwinUri}/projects?creator_fk=${profile.userName}&closed=0&fields=id,project_name,sort_order`

        call_rest_api(projectUri, 'GET', '', idToken)
            .then(result => {
                result.data.sort((a, b) => {
                    if (a.sort_order === null && b.sort_order === null) return 0;
                    if (a.sort_order === null) return 1;
                    if (b.sort_order === null) return -1;
                    return a.sort_order - b.sort_order;
                });

                const storedId = getWorkingProject();
                let initialTab = 0;
                if (storedId) {
                    const idx = result.data.findIndex(d => String(d.id) === storedId);
                    if (idx >= 0) initialTab = idx;
                }
                setActiveTab(initialTab);
                setProjectsArray(result.data);
            }).catch(error => {
                if (error.httpStatus && error.httpStatus.httpStatus === 404) {
                    setProjectsArray([]);
                } else {
                    showError(error, 'Unable to read Project info from database');
                }
            });

    }, [projectApiTrigger, profile, idToken, darwinUri]);

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
                    <Box sx={{ borderBottom: 1, borderColor: 'divider' }}
                         className="app-content-tabs"
                    >
                        <Tabs value={activeTab.toString()}
                              onChange={changeActiveTab}
                              variant="scrollable"
                              scrollButtons="auto" >
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
                    </Box>
                        {   projectsArray.map( (project, projectIndex) =>
                                <CategoryTabPanel key={project.id}
                                              project = {project}
                                              projectIndex = {projectIndex}
                                              activeTab = {activeTab}>
                                </CategoryTabPanel>
                            )
                        }
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
            :
            <CircularProgress/>
        }
        </>
    );

}

export default SwarmView;
