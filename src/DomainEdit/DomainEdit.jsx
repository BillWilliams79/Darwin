// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, {useState, useContext, useEffect, useRef} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useWorkingDomainStore } from '../stores/useWorkingDomainStore';
import { useDomains, useAllAreas, useTaskCounts } from '../hooks/useDataQueries';
import { domainKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';

import Box from '@mui/material/Box';
import { Typography } from '@mui/material';

import DomainDeleteDialog from './DomainDeleteDialog';
import DomainTableRow from './DomainTableRow';
import { DOMAIN_GRID_COLUMNS } from './DomainTableRow';

const DomainEdit = ( { domain, domainIndex } ) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [domainsArray, setDomainsArray] = useState()

    const [areaCounts, setAreaCounts] = useState({});
    const [taskCounts, setTaskCounts] = useState({});
    const [selectedId, setSelectedId] = useState(null);
    const templateInputRef = useRef(null);

    const showError = useSnackBarStore(s => s.showError);
    const setWorkingDomain = useWorkingDomainStore(s => s.setWorkingDomain);

    // TanStack Query — fetch all domains (open + closed), areas, and task counts
    const { data: serverDomains } = useDomains(profile?.userName, {
        fields: 'id,domain_name,closed,sort_order',
    });
    const { data: serverAreas } = useAllAreas(profile?.userName);
    const { data: serverTaskCounts } = useTaskCounts(profile?.userName);

    // Seed local state from query data
    useEffect(() => {
        if (serverDomains) {
            const sorted = [...serverDomains];
            sorted.sort((domainA, domainB) => domainSortByClosedThenSortOrder(domainA, domainB));
            sorted.push({'id':'', 'domain_name':'', 'closed': 0, 'sort_order': null });
            setDomainsArray(sorted);
        }
    }, [serverDomains]);

    // Compute area and task counts from query data
    useEffect(() => {
        if (serverAreas) {
            const newAreaCounts = {};
            const areaToDomain = {};
            serverAreas.forEach((area) => {
                areaToDomain[String(area.id)] = area.domain_fk;
                newAreaCounts[area.domain_fk] = (newAreaCounts[area.domain_fk] || 0) + 1;
            });
            setAreaCounts(newAreaCounts);

            if (serverTaskCounts) {
                const newTaskCounts = {};
                serverTaskCounts.forEach((taskCount) => {
                    const domainFk = areaToDomain[String(taskCount.area_fk)];
                    if (domainFk !== undefined) {
                        newTaskCounts[domainFk] = (newTaskCounts[domainFk] || 0) + taskCount['count(*)'];
                    }
                });
                setTaskCounts(newTaskCounts);
            }
        }
    }, [serverAreas, serverTaskCounts]);

    // cardSettings state
    const domainDelete = useConfirmDialog({
        onConfirm: ({ domainId }) => {
            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'DELETE', {'id': domainId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newDomainsArray = [...domainsArray]
                        newDomainsArray = newDomainsArray.filter(domain => domain.id !== domainId );
                        setDomainsArray(newDomainsArray);
                        queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete domain')
                    }
                }).catch(error => {
                    showError(error, 'Unable to delete domain')
                });
        }
    });

    const restUpdateDomainName = (domainIndex, domainId) => {

        const noop = ()=>{};

        // new domain with no description, noop
        if ((domainId === '') &&
            (domainsArray[domainIndex].domain_name === '')) {
            noop();

        } else {
            // blank domainId indicates we are creating a new domain rather than updating existing
            if (domainId === '') {
                restSaveDomainName(domainIndex)
            } else {
                let uri = `${darwinUri}/domains`;
                call_rest_api(uri, 'PUT', [{'id': domainId, 'domain_name': domainsArray[domainIndex].domain_name}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            // database value is changed only with a 200 response
                            // so only then show snackbar
                            showError(result, 'Unable to update domain name')
                        } else {
                            queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
                        }
                    }).catch(error => {
                        showError(error, 'Unable to update domain name')
                    });
            }
        }
    }

    const { fieldChange: changeDomainName, fieldKeyDown: keyDownDomainName, fieldOnBlur: blurDomainName } = useCrudCallbacks({
        items: domainsArray, setItems: setDomainsArray, fieldName: 'domain_name',
        saveFn: (_event, index, id) => restUpdateDomainName(index, id)
    });

    const restSaveDomainName = (domainIndex) => {

        let uri = `${darwinUri}/domains`;

        let newDomainsArray = [...domainsArray];
        newDomainsArray[domainIndex].sort_order = calculateSortOrder(newDomainsArray, domainIndex, newDomainsArray[domainIndex].closed);

        call_rest_api(uri, 'POST', {...newDomainsArray[domainIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    // 200 => record added to database and returned in body
                    // show snackbar, place new data in table and created another blank element

                    let freshDomainsArray = [...domainsArray];
                    freshDomainsArray[domainIndex] = {...result.data[0]};
                    freshDomainsArray.sort((domainA, domainB) => domainSortByClosedThenSortOrder(domainA, domainB));
                    freshDomainsArray.push({'id':'', 'domain_name':'', 'closed': 0, 'sort_order': null });
                    setDomainsArray(freshDomainsArray);

                    // update the areaCounts and taskCounts data
                    let newAreaCounts = {...areaCounts};
                    newAreaCounts[result.data[0].id] = 0;
                    setAreaCounts(newAreaCounts);

                    let newTaskCounts = {...taskCounts};
                    newTaskCounts[result.data[0].id] = 0;
                    setTaskCounts(newTaskCounts);

                    queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
                    setTimeout(() => templateInputRef.current?.focus(), 0);

                } else if (result.httpStatus.httpStatus < 205) {
                    // 201 => record added to database but new data not returned in body
                    queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
                } else {
                    showError(result, 'Unable to update domain')
                }
            }).catch(error => {
                showError(error, 'Unable to update domain')
            });
    }

    const clickDomainClosed = (event, domainIndex, domainId) => {

        // invert closed, re-sort domain array for the card, update state.
        let newDomainsArray = [...domainsArray]
        let newClosed = newDomainsArray[domainIndex].closed ? 0 : 1;
        newDomainsArray[domainIndex].closed = newClosed;

        // for domains already in the db, update db
        if (domainId !== '') {
            let newSortOrder = calculateSortOrder(newDomainsArray, domainIndex, newClosed);

            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'PUT', [{'id': domainId, 'closed': newClosed, 'sort_order': newSortOrder}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        showError(result, 'Unable to close domain')
                    } else {
                        // Pause or resume recurring task definitions for all areas in this domain
                        const areaIds = (serverAreas || [])
                            .filter(a => String(a.domain_fk) === String(domainId))
                            .map(a => a.id);
                        if (areaIds.length > 0) {
                            call_rest_api(
                                `${darwinUri}/recurring_tasks?area_fk=(${areaIds.join(',')})&fields=id`,
                                'GET', '', idToken
                            ).then(rtResult => {
                                if (rtResult?.data?.length > 0) {
                                    const updates = rtResult.data.map(rt => ({ id: rt.id, active: newClosed ? 0 : 1 }));
                                    call_rest_api(`${darwinUri}/recurring_tasks`, 'PUT', updates, idToken);
                                }
                            });
                        }
                    }
                }).catch(error => {
                    showError(error, 'Unable to close domain')
                }
            );
        }

        // Only after database is updated, sort domains and update state
        newDomainsArray.sort((domainA, domainB) => domainSortByClosedThenSortOrder(domainA, domainB));
        setDomainsArray(newDomainsArray);
    }

    const handleRowClick = (id) => {
        setSelectedId(String(id));
        if (id !== '') setWorkingDomain(id);
    };

    const clickDomainDelete = (event, domainId, domainName) => {
        domainDelete.openDialog({ domainName, domainId, tasksCount: taskCounts[domainId] });
    }

    const domainSortByClosedThenSortOrder = (domainA, domainB) => {
        // leave blank domain in place at bottom of list
        if (domainA.id === '') return 0;
        if (domainB.id === '') return -1;

        // if both domains are open, sort by sort_order
        if ((domainA.closed === 0) && (domainB.closed === 0)) {
            if (domainA.sort_order === domainB.sort_order) return 0;
            if (domainA.sort_order === null) return 1;
            if (domainB.sort_order === null) return -1;
            return domainA.sort_order < domainB.sort_order ? -1 : 1;
        }

        if (domainA.closed === domainB.closed) return 0;
        return domainA.closed > domainB.closed ? 1 : -1;
    }

    const calculateSortOrder = (domainsArr, index, newClosed) => {
        // closed domains get NULL sort_order
        var calcSortOrder = "NULL";

        if (newClosed === 0) {
            // find the current max sort order, open domains get appended at end
            calcSortOrder = domainsArr.reduce((previous, current) => {
                if (current.sort_order === null) return previous;
                return (previous > current.sort_order) ? previous : current.sort_order;
            }, -1);
            calcSortOrder = calcSortOrder + 1;
        }
        // null written to mysql is "NULL", read from mysql is actually a JS null
        domainsArr[index].sort_order = (calcSortOrder === "NULL") ? null : calcSortOrder;
        return calcSortOrder;
    }

    const dragEnd = async (result) => {

        if ((result.destination === null) || (result.reason !== 'DROP')) {
            return;
        }

        // mutate the array - relocate the dragged item to the new location
        var newDomainsArray = [...domainsArray]
        const [draggedItem] = newDomainsArray.splice(result.source.index, 1);
        newDomainsArray.splice(result.destination.index, 0, draggedItem);

        // brute force renumbering of the sort values post drag
        newDomainsArray = newDomainsArray.map((dom, index) => {
            if ((dom.id !== '') && (dom.closed !== 1)) {
                dom.sort_order = index;
                return dom;
            } else {
                return dom;
            }
        })

        // update state
        setDomainsArray(newDomainsArray);

        // filter/map array down to minimum required to update all domains for new sort order
        var restDataArray = newDomainsArray
                .filter(dom => ((dom.id !== '') && (dom.sort_order !== null)) ? true : false)
                .map(dom => ({'id': dom.id, 'sort_order': dom.sort_order}));

        let uri = `${darwinUri}/domains`;
        call_rest_api(uri, 'PUT', restDataArray, idToken)
            .then(result => {
                if ((result.httpStatus.httpStatus === 200) ||
                    (result.httpStatus.httpStatus === 204)) {
                    queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
                } else {
                    showError(result, 'Unable to save domain sort order')
                }
            }).catch(error => {
                showError(error, 'Unable to save domain sort order')
            });
    }


    return (
        <>
            <Box className="app-title">
                <Typography variant="h4" sx={{ ml: { xs: 1, md: 2 } }}>
                    Domains Editor
                </Typography>
            </Box>
            { domainsArray &&
                <Box className="app-edit" sx={{ ml: { xs: 0, md: 2 } }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: DOMAIN_GRID_COLUMNS, alignItems: 'center', borderBottom: 1, borderColor: 'divider', pb: 0.5, mb: 0.5 }}>
                        <Box sx={{ px: 1 }}><Typography variant="subtitle2">Name</Typography></Box>
                        <Box sx={{ textAlign: 'center' }}><Typography variant="subtitle2">Closed</Typography></Box>
                        <Box sx={{ textAlign: 'center' }}><Typography variant="subtitle2">Areas</Typography></Box>
                        <Box sx={{ textAlign: 'center' }}><Typography variant="subtitle2">Tasks</Typography></Box>
                        <Box />
                    </Box>
                    <DragDropContext onDragEnd={dragEnd}>
                        <Droppable droppableId="domains">
                            {(provided) => (
                                <Box {...provided.droppableProps} ref={provided.innerRef}>
                                { domainsArray
                                    .filter(d => d.closed === 0 && d.id !== '')
                                    .map((domain, idx) => (
                                    <DomainTableRow
                                        key={domain.id}
                                        domain={domain}
                                        domainIndex={idx}
                                        changeDomainName={changeDomainName}
                                        keyDownDomainName={keyDownDomainName}
                                        blurDomainName={blurDomainName}
                                        clickDomainClosed={clickDomainClosed}
                                        clickDomainDelete={clickDomainDelete}
                                        areaCounts={areaCounts}
                                        taskCounts={taskCounts}
                                        onRowClick={handleRowClick}
                                        isSelected={String(domain.id) === selectedId}
                                        isDraggable
                                    />
                                ))}
                                {provided.placeholder}
                                </Box>
                            )}
                        </Droppable>
                    </DragDropContext>
                    { domainsArray
                        .filter(d => d.closed === 1 || d.id === '')
                        .map((domain) => (
                        <DomainTableRow
                            key={domain.id || 'template'}
                            domain={domain}
                            domainIndex={domainsArray.indexOf(domain)}
                            changeDomainName={changeDomainName}
                            keyDownDomainName={keyDownDomainName}
                            blurDomainName={blurDomainName}
                            clickDomainClosed={clickDomainClosed}
                            clickDomainDelete={clickDomainDelete}
                            areaCounts={areaCounts}
                            taskCounts={taskCounts}
                            onRowClick={handleRowClick}
                            isSelected={String(domain.id) === selectedId}
                            isDraggable={false}
                            inputRef={domain.id === '' ? templateInputRef : undefined}
                        />
                    ))}
                </Box>
            }
            <DomainDeleteDialog
                domainDeleteDialogOpen = { domainDelete.dialogOpen }
                setDomainDeleteDialogOpen = { domainDelete.setDialogOpen }
                domainInfo = { domainDelete.infoObject }
                setDomainInfo = { domainDelete.setInfoObject }
                setDomainDeleteConfirmed = { domainDelete.setConfirmed }
            />
        </>
    )
}

export default DomainEdit
