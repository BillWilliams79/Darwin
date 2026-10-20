import '../index.css';
// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useDragTabStore } from '../stores/useDragTabStore';
import { useWorkingDomainStore } from '../stores/useWorkingDomainStore';
import { useDomains } from '../hooks/useDataQueries';
import { domainKeys, areaKeys, taskKeys } from '../hooks/useQueryKeys';

import DomainCloseDialog from '../Components/DomainClose/DomainCloseDialog';
import DomainAddDialog from '../Components/DomainAdd/DomainAddDialog';
import AreaTabPanel from './AreaTabPanel';
import { DarwinDndContext, DarwinSortableList, RemeasureOnChange, useDarwinDropZone } from '../dnd';
import { DOMAIN_TABS, PlanListRegistry, planIds } from './planDnd';
import { usePlanDnd } from './usePlanDnd';

import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import Tab from '@mui/material/Tab';
import { CircularProgress, Tabs } from '@mui/material';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import FlagIcon from '@mui/icons-material/Flag';
import DroppableTab from './DroppableTab';
import ClosedTasksControl from './ClosedTasksControl';
import { useOptionalCardStore } from '../stores/useOptionalCardStore';
import SettingsMenu from '../Components/SettingsMenu/SettingsMenu';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CategoryIcon from '@mui/icons-material/Category';

// Small component to subscribe to per-domain priority card show state
const PriorityFlagButton = ({ domainId, toggleCard }) => {
    const show = useOptionalCardStore(s => s.cards[String(domainId)]?.priority?.show ?? false);
    return (
        <Tooltip title={show ? 'Hide Priority Card' : 'Show Priority Card'}>
            <IconButton
                size="small"
                onClick={() => toggleCard(domainId, 'priority')}
                color={show ? 'primary' : 'default'}
                data-testid={`priority-card-toggle-${domainId}`}
                sx={{ flexShrink: 0, mx: 1 }}
            >
                <FlagIcon />
            </IconButton>
        </Tooltip>
    );
};

// The tab strip as a drop zone: tabs reorder within it (req #3662).
const TabStripZone = ({ children }) => {
    const { setNodeRef } = useDarwinDropZone({ id: planIds.domains, policy: DOMAIN_TABS });
    return (
        <Box ref={setNodeRef} sx={{ flex: 1, overflow: 'hidden' }}>
            {children}
        </Box>
    );
};

// A lifted tab grows a little more than a row or a card — it is small.
const liftScale = (active) => (active.data.current?.type === 'domain' ? 1.06 : 1.02);

const TaskPlanView = () => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    // Corresponds to crud_app.rest_api table for user, and UI/js index
    const [domainsArray, setDomainsArray] = useState()

    // Domain Tabs state — from Zustand store
    const activeTab = useDragTabStore(s => s.activeTab);
    const setActiveTab = useDragTabStore(s => s.setActiveTab);

    const showError = useSnackBarStore(s => s.showError);
    const getWorkingDomain = useWorkingDomainStore(s => s.getWorkingDomain);
    const setWorkingDomain = useWorkingDomainStore(s => s.setWorkingDomain);

    // Card toggle (used by PriorityFlagButton and SwarmStartFlagButton via prop)
    const toggleCard = useOptionalCardStore(s => s.toggleCard);

    // TanStack Query — fetch open domains
    const { data: serverDomains } = useDomains(profile?.userName, { closed: 0 });

    // A deep link may name the domain to open (`?domain=<id>`) and ask for its
    // priority card (`&priority=1`) — so a link can land on one exact board
    // (req #3662: the dev server opens on the change). Otherwise the working
    // domain from localStorage, then the first tab.
    const [searchParams] = useSearchParams();
    const linkedDomainId = searchParams.get('domain');
    const linkedPriority = searchParams.get('priority') === '1';
    // Honoured on the FIRST seed only: every later domain refetch (a reorder,
    // an add, a close) must leave the user on the tab they chose.
    const linkAppliedRef = useRef(false);

    // Seed local state from query data (hybrid pattern — local state owns DnD)
    useEffect(() => {
        if (serverDomains) {
            const sorted = [...serverDomains];
            sorted.sort((a, b) => {
                if (a.sort_order === null && b.sort_order === null) return 0;
                if (a.sort_order === null) return 1;
                if (b.sort_order === null) return -1;
                return a.sort_order - b.sort_order;
            });

            // Linked domain, else the working domain from localStorage, else the first tab
            const storedId = getWorkingDomain();
            let initialTab = 0;
            const linkedIdx = linkedDomainId && !linkAppliedRef.current
                ? sorted.findIndex(d => String(d.id) === linkedDomainId) : -1;
            linkAppliedRef.current = true;
            if (linkedIdx >= 0) {
                initialTab = linkedIdx;
                if (linkedPriority && !useOptionalCardStore.getState().cards[linkedDomainId]?.priority?.show) {
                    toggleCard(linkedDomainId, 'priority');
                }
            } else if (storedId) {
                const idx = sorted.findIndex(d => String(d.id) === storedId);
                if (idx >= 0) initialTab = idx;
            }
            setActiveTab(initialTab);
            setDomainsArray(sorted);
        }
    }, [serverDomains]);

    // req #3662 — every card registers its local array here; the page's one
    // onDragEnd resolves a drop against them.
    const planListRegistry = useRef(new Map()).current;

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
                        queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
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
            call_rest_api(uri, 'POST', {'domain_name': newDomainName, 'closed': 0, 'sort_order': domainsArray.length}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray.push(result.data[0]);
                        setDomainsArray(newDomainsArray);
                        queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
                    } else if (result.httpStatus.httpStatus === 201) {
                        queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
                    } else {
                        showError(result, `Unable to create ${newDomainName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to create ${newDomainName}`)
                });
        },
        defaultInfo: ''
    });

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

    const dragHandlers = usePlanDnd({
        registry: planListRegistry,
        writeCtx: { darwinUri, idToken, showError },
        invalidateTasks: () => queryClient.invalidateQueries({ queryKey: taskKeys.all(profile.userName) }),
        invalidateAreas: () => queryClient.invalidateQueries({ queryKey: areaKeys.all(profile.userName) }),
        invalidateDomains: () => queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) }),
        domains: domainsArray,
        setDomains: setDomainsArray,
        activeTab,
        setActiveTab,
    });

    return (
        <PlanListRegistry.Provider value={planListRegistry}>
        <DarwinDndContext {...dragHandlers} liftScale={liftScale}>
        <RemeasureOnChange value={activeTab} />
        {domainsArray ?
            <>
            <Box className="app-content-planpage">
                    <Box sx={{ borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center' }}
                         className="app-content-tabs"
                    >
                        <TabStripZone>
                            <DarwinSortableList id={planIds.domains}
                                                items={domainsArray.map(d => planIds.domain(d.id))}
                                                policy={DOMAIN_TABS}>
                            <Tabs value={activeTab.toString()}
                                  onChange={changeActiveTab}
                                  variant="scrollable"
                                  scrollButtons="auto" >
                                {domainsArray.map( (domain, domainIndex) =>
                                    <DroppableTab key={domain.id}
                                         domainIndex={domainIndex}
                                         domainId={domain.id}
                                         domain={domain}
                                         domainName={domain.domain_name}
                                         isActiveTab={String(activeTab) === String(domainIndex)}
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
                            </DarwinSortableList>
                        </TabStripZone>
                        {/* req #3506 — "Closed" window, global to the page rather
                            than per-domain, so it sits outside the active-domain
                            block below. */}
                        <ClosedTasksControl />
                        {domainsArray[parseInt(activeTab)] && (() => {
                            const activeDomainId = domainsArray[parseInt(activeTab)].id;
                            return (
                                <PriorityFlagButton domainId={activeDomainId} toggleCard={toggleCard} />
                            );
                        })()}
                        <SettingsMenu
                            tooltipTitle="Manage Domains & Areas"
                            links={[
                                { path: '/domainedit', label: 'Domains', icon: AccountTreeIcon },
                                { path: '/areaedit', label: 'Areas', icon: CategoryIcon },
                            ]}
                        />
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
        </DarwinDndContext>
        </PlanListRegistry.Provider>
    );

}

export default TaskPlanView;
