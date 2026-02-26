import '../index.css';
// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useDragTabStore } from '../stores/useDragTabStore';
import { useWorkingDomainStore } from '../stores/useWorkingDomainStore';
import { useApiTrigger } from '../hooks/useApiTrigger';

import DomainCloseDialog from '../Components/DomainClose/DomainCloseDialog';
import DomainAddDialog from '../Components/DomainAdd/DomainAddDialog';
import AreaTabPanel from './AreaTabPanel';
import TaskDragLayer from '../Components/TaskEdit/TaskDragLayer';

import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import Tab from '@mui/material/Tab';
import { CircularProgress, Tabs } from '@mui/material';
import DroppableTab from './DroppableTab';

const TaskPlanView = () => {

    console.count('TaskCardContent rendered');

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    // Corresponds to crud_app.rest_api table for user, and UI/js index
    const [domainsArray, setDomainsArray] = useState()

    // changing this value triggers useState, re-reads all rest API data
    // misleading, but true or flase doesn't matter, just flip the value
    // and set it, the useState is executed
    const [domainApiTrigger, triggerDomainRefresh] = useApiTrigger();

    // Domain Tabs state — from Zustand store
    const activeTab = useDragTabStore(s => s.activeTab);
    const setActiveTab = useDragTabStore(s => s.setActiveTab);

    const showError = useSnackBarStore(s => s.showError);
    const getWorkingDomain = useWorkingDomainStore(s => s.getWorkingDomain);
    const setWorkingDomain = useWorkingDomainStore(s => s.setWorkingDomain);

    // Ref to track blue-line insertion index during domain tab drag
    const domainInsertIndexRef = useRef(null);
    const setDomainInsertIndex = useCallback((index) => {
        domainInsertIndexRef.current = index;
    }, []);

    const renameDomain = useCallback((domainId, newName) => {
        const uri = `${darwinUri}/domains`;
        call_rest_api(uri, 'PUT', [{ id: domainId, domain_name: newName }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setDomainsArray(prev => prev.map(d =>
                        d.id === domainId ? { ...d, domain_name: newName } : d
                    ));
                } else {
                    showError(result, 'Unable to rename domain');
                }
            })
            .catch(error => showError(error, 'Unable to rename domain'));
    }, [darwinUri, idToken, showError]);

    const domainClose = useConfirmDialog({
        onConfirm: ({ domainName, domainId, domainIndex }) => {
            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'PUT', [{'id': domainId, 'closed': 1, 'sort_order': 'NULL'}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray = newDomainsArray.filter(domain => domain.id !== domainId );
                        setDomainsArray(newDomainsArray);
                        if (parseInt(activeTab) === domainIndex ) {
                            setActiveTab(0);
                        }
                    } else {
                        showError(result, `Unable to close ${domainName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to close ${domainName}`)
                });
        }
    });

    const domainAdd = useConfirmDialog({
        onConfirm: (newDomainName) => {
            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'POST', {'creator_fk': profile.userName, 'domain_name': newDomainName, 'closed': 0, 'sort_order': domainsArray.length}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray.push(result.data[0]);
                        setDomainsArray(newDomainsArray);
                    } else if (result.httpStatus.httpStatus === 201) {
                        triggerDomainRefresh();
                    } else {
                        showError(result, `Unable to create ${newDomainName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to create ${newDomainName}`)
                });
        },
        defaultInfo: ''
    });

    // READ domains API data for page
    useEffect( () => {

        console.count('useEffect: Read domains REST API data');

        let domainUri = `${darwinUri}/domains?creator_fk=${profile.userName}&closed=0&fields=id,domain_name,sort_order`

        call_rest_api(domainUri, 'GET', '', idToken)
            .then(result => {
                // Sort by sort_order (null values last)
                result.data.sort((a, b) => {
                    if (a.sort_order === null && b.sort_order === null) return 0;
                    if (a.sort_order === null) return 1;
                    if (b.sort_order === null) return -1;
                    return a.sort_order - b.sort_order;
                });

                // Restore working domain from localStorage, fall back to first tab
                const storedId = getWorkingDomain();
                let initialTab = 0;
                if (storedId) {
                    const idx = result.data.findIndex(d => String(d.id) === storedId);
                    if (idx >= 0) initialTab = idx;
                }
                setActiveTab(initialTab);
                setDomainsArray(result.data);
            }).catch(error => {
                showError(error, 'Unable to read Domain info from database')
            });

    }, [domainApiTrigger, profile, idToken, darwinUri]);

    // Persist working domain whenever active tab changes
    useEffect(() => {
        if (domainsArray && domainsArray.length > 0) {
            const tabIndex = parseInt(activeTab);
            if (tabIndex >= 0 && tabIndex < domainsArray.length) {
                setWorkingDomain(domainsArray[tabIndex].id);
            }
        }
    }, [activeTab, domainsArray]);

    const changeActiveTab = (event, newValue) => {
        // The tab with value 9999 is the add new tab button, hence no change
        if (newValue === 9999)
            return;
        setActiveTab(newValue);
    }

    const domainCloseClick = (event, domainName, domainId, domainIndex) => {
        domainClose.openDialog({ domainName, domainId, domainIndex });
    }

    const addDomain = (event) => {
        domainAdd.openDialog();
     }

    const persistDomainOrder = useCallback((didDrop, dragDomainId) => {
        const insertIndex = domainInsertIndexRef.current;
        domainInsertIndexRef.current = null;

        if (!didDrop || insertIndex === null) return;

        setDomainsArray(prev => {
            if (!prev) return prev;

            const dragIndex = prev.findIndex(d => d.id === dragDomainId);
            if (dragIndex < 0) return prev;

            // Adjust insert index: if dragging rightward, removing the item shifts indices left
            const adjustedIndex = insertIndex > dragIndex ? insertIndex - 1 : insertIndex;
            if (adjustedIndex === dragIndex) return prev;

            const updated = [...prev];
            const [moved] = updated.splice(dragIndex, 1);
            updated.splice(adjustedIndex, 0, moved);

            // Track active tab by domain ID
            const currentTabIndex = parseInt(activeTab);
            if (currentTabIndex >= 0 && currentTabIndex < prev.length) {
                const activeDomainId = prev[currentTabIndex].id;
                const newIndex = updated.findIndex(d => d.id === activeDomainId);
                if (newIndex >= 0 && newIndex !== currentTabIndex) {
                    setActiveTab(newIndex);
                }
            }

            // Renumber sort_order and persist
            const renumbered = updated.map((dom, idx) => ({ ...dom, sort_order: idx }));
            const restDataArray = renumbered.map(dom => ({ 'id': dom.id, 'sort_order': dom.sort_order }));

            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'PUT', restDataArray, idToken)
                .then(result => {
                    if ((result.httpStatus.httpStatus === 200) ||
                        (result.httpStatus.httpStatus === 204)) {
                        console.log('domain tab sort order saved');
                    } else {
                        showError(result, 'Unable to save domain sort order')
                    }
                }).catch(error => {
                    showError(error, 'Unable to save domain sort order')
                });

            return renumbered;
        });
    }, [activeTab, darwinUri, idToken, showError, setActiveTab]);

    return (
        <>
        <TaskDragLayer />
        {domainsArray ?
            <>
            <Box className="app-content-planpage">
                    <Box sx={{ borderBottom: 1, borderColor: 'divider' }}
                         className="app-content-tabs"
                    >
                        <Tabs value={activeTab.toString()}
                              onChange={changeActiveTab}
                              variant="scrollable"
                              scrollButtons="auto" >
                            {domainsArray.map( (domain, domainIndex) =>
                                <DroppableTab key={domain.id}
                                     domainIndex={domainIndex}
                                     domainId={domain.id}
                                     domainName={domain.domain_name}
                                     setDomainInsertIndex={setDomainInsertIndex}
                                     persistDomainOrder={persistDomainOrder}
                                     renameDomain={renameDomain}
                                     icon={<CloseIcon onClick={(event) => domainCloseClick(event, domain.domain_name, domain.id, domainIndex)}/>}
                                     label={domain.domain_name}
                                     value={domainIndex.toString()}
                                     iconPosition="end" />
                            )}
                            <Tab key={'add-domain'}
                                 icon={<AddIcon onClick={addDomain}/>}
                                 iconPosition="start"
                                 value={9999} // this value is used in changeActiveTab()
                            />
                        </Tabs>
                    </Box>
                        {   domainsArray.map( (domain, domainIndex) =>
                                <AreaTabPanel key={domain.id}
                                              domain = {domain}
                                              domainIndex = {domainIndex}
                                              activeTab = {activeTab}>
                                </AreaTabPanel>
                            )
                        }
            </Box>
            <DomainCloseDialog domainCloseDialogOpen={domainClose.dialogOpen}
                               setDomainCloseDialogOpen={domainClose.setDialogOpen}
                               domainCloseId={domainClose.infoObject}
                               setDomainCloseId={domainClose.setInfoObject}
                               setDomainCloseConfirmed={domainClose.setConfirmed} />
            <DomainAddDialog domainAddDialogOpen={domainAdd.dialogOpen}
                             setDomainAddDialogOpen={domainAdd.setDialogOpen}
                             newDomainInfo={domainAdd.infoObject}
                             setNewDomainInfo={domainAdd.setInfoObject}
                             setDomainAddConfirmed={domainAdd.setConfirmed} />
            </>
            :
            <CircularProgress/>
        }
        </>
    );

}

export default TaskPlanView;
