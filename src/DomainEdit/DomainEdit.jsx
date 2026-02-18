// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, {useState, useContext, useEffect} from 'react';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useWorkingDomainStore } from '../stores/useWorkingDomainStore';
import { useApiTrigger } from '../hooks/useApiTrigger';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';

import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import Box from '@mui/material/Box';
import { Typography } from '@mui/material';

import DomainDeleteDialog from './DomainDeleteDialog';
import DomainTableRow from './DomainTableRow';

const DomainEdit = ( { domain, domainIndex } ) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [domainsArray, setDomainsArray] = useState()
    const [domainApiTrigger, triggerDomainRefresh] = useApiTrigger();

    const [areaCounts, setAreaCounts] = useState({});
    const [taskCounts, setTaskCounts] = useState({});

    const showError = useSnackBarStore(s => s.showError);
    const setWorkingDomain = useWorkingDomainStore(s => s.setWorkingDomain);
    const workingDomainId = useWorkingDomainStore(s => s.domainId);

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
                    } else {
                        showError(result, 'Unable to delete domain')
                    }
                }).catch(error => {
                    showError(error, 'Unable to delete domain')
                });
        }
    });

    // READ domains API data for page
    useEffect( () => {

        console.count('useEffect: Read domains REST API data');

        // FETCH DOMAINS
        let domainUri = `${darwinUri}/domains?creator_fk=${profile.userName}&fields=id,domain_name,closed,sort_order`

        call_rest_api(domainUri, 'GET', '', idToken)
            .then(result => {
                let newDomainArray = result.data;
                newDomainArray.sort((domainA, domainB) => domainSortByClosedThenSortOrder(domainA, domainB));
                newDomainArray.push({'id':'', 'domain_name':'', 'closed': 0, 'sort_order': null, 'creator_fk': profile.userName });
                setDomainsArray(result.data);

                // Fetch areas and task counts in parallel
                const areasUri = `${darwinUri}/areas?creator_fk=${profile.userName}&fields=id,domain_fk`;
                const tasksUri = `${darwinUri}/tasks?creator_fk=${profile.userName}&fields=count(*),area_fk`;

                Promise.all([
                    call_rest_api(areasUri, 'GET', '', idToken).catch(() => ({ data: [] })),
                    call_rest_api(tasksUri, 'GET', '', idToken).catch(() => ({ data: [] })),
                ]).then(([areasResult, tasksResult]) => {
                    // Area counts: count areas per domain_fk
                    const newAreaCounts = {};
                    const areaToDomain = {};
                    areasResult.data.forEach((area) => {
                        // String keys ensure consistent lookup regardless of API number/string types
                        areaToDomain[String(area.id)] = area.domain_fk;
                        newAreaCounts[area.domain_fk] = (newAreaCounts[area.domain_fk] || 0) + 1;
                    });
                    setAreaCounts(newAreaCounts);

                    // Task counts: map area_fk → domain_fk, sum per domain
                    const newTaskCounts = {};
                    tasksResult.data.forEach((taskCount) => {
                        const domainFk = areaToDomain[String(taskCount.area_fk)];
                        if (domainFk !== undefined) {
                            newTaskCounts[domainFk] = (newTaskCounts[domainFk] || 0) + taskCount['count(*)'];
                        }
                    });
                    setTaskCounts(newTaskCounts);
                });
            }).catch(error => {
                varDump(error, `UseEffect: error retrieving Domains: ${error}`);
            });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [domainApiTrigger]);

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
                    freshDomainsArray.push({'id':'', 'domain_name':'', 'closed': 0, 'sort_order': null, 'creator_fk': profile.userName });
                    setDomainsArray(freshDomainsArray);

                    // update the areaCounts and taskCounts data
                    let newAreaCounts = {...areaCounts};
                    newAreaCounts[result.data[0].id] = 0;
                    setAreaCounts(newAreaCounts);

                    let newTaskCounts = {...taskCounts};
                    newTaskCounts[result.data[0].id] = 0;
                    setTaskCounts(newTaskCounts);

                } else if (result.httpStatus.httpStatus < 205) {
                    // 201 => record added to database but new data not returned in body
                    // show snackbar and flip read_rest_api state to initiate full data retrieval
                    triggerDomainRefresh();
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
                    console.log('domain sort order saved');
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
                <Typography variant="h4" sx={{ml:2}}>
                    Domains Editor
                </Typography>
            </Box>
            { domainsArray &&
                <Box className="app-edit" sx={{ml:2}}>
                    <Table size='small'>
                        <TableHead>
                            <TableRow key = 'TableHead'>
                                <TableCell> Name </TableCell>
                                <TableCell> Closed </TableCell>
                                <TableCell sx={{textAlign: 'center'}}> Areas </TableCell>
                                <TableCell sx={{textAlign: 'center'}}> Tasks </TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                        </TableHead>
                        <DragDropContext onDragEnd={dragEnd}>
                            <Droppable droppableId="domains">
                                {(provided) => (
                                    <TableBody {...provided.droppableProps} ref={provided.innerRef}>
                                    { domainsArray.map((domain, domainIndex) => (
                                        <DomainTableRow
                                            key={domain.id}
                                            domain={domain}
                                            domainIndex={domainIndex}
                                            changeDomainName={changeDomainName}
                                            keyDownDomainName={keyDownDomainName}
                                            blurDomainName={blurDomainName}
                                            clickDomainClosed={clickDomainClosed}
                                            clickDomainDelete={clickDomainDelete}
                                            areaCounts={areaCounts}
                                            taskCounts={taskCounts}
                                            onRowClick={setWorkingDomain}
                                            isSelected={domain.id && String(domain.id) === workingDomainId}
                                        />
                                    ))}
                                    {provided.placeholder}
                                    </TableBody>
                                )}
                            </Droppable>
                        </DragDropContext>
                    </Table>
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
