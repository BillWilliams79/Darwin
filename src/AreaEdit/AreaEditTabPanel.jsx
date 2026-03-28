// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, {useState, useContext, useEffect, useRef} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useAreas, useTaskCounts } from '../hooks/useDataQueries';
import { areaKeys, taskKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import { DragDropContext, Droppable, /* Draggable */ } from '@hello-pangea/dnd';

import Box from '@mui/material/Box';
import { Typography } from '@mui/material';

import AreaDeleteDialog from './AreaDeleteDialog';
import AreaTableRow from './AreaTableRow';
import { AREA_GRID_COLUMNS } from './AreaTableRow';

const AreaEditTabPanel = ( { domain, domainIndex, activeTab } ) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [areasArray, setAreasArray] = useState();
    const [taskCounts, setTaskCounts] = useState({});
    const templateInputRef = useRef(null);

    const showError = useSnackBarStore(s => s.showError);

    // TanStack Query — fetch areas for this domain (open + closed) and task counts
    const { data: serverAreas } = useAreas(profile?.userName, domain.id, {
        fields: 'id,area_name,closed,sort_order',
    });
    const { data: serverTaskCounts } = useTaskCounts(profile?.userName);

    // Seed local state from query data
    useEffect(() => {
        if (serverAreas) {
            const sorted = [...serverAreas];
            sorted.sort((areaA, areaB) => areaSortByClosedThenSortOrder(areaA, areaB));
            sorted.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': parseInt(domain.id), 'sort_order': null });
            setAreasArray(sorted);
        } else if (serverAreas && serverAreas.length === 0) {
            setAreasArray([{'id':'', 'area_name':'', 'closed': 0, 'domain_fk': parseInt(domain.id) }]);
        }
    }, [serverAreas]);

    // Compute task counts from query data
    useEffect(() => {
        if (serverTaskCounts) {
            const newTaskCounts = {};
            serverTaskCounts.forEach((countData) => {
                newTaskCounts[countData.area_fk] = countData['count(*)'];
            });
            setTaskCounts(newTaskCounts);
        }
    }, [serverTaskCounts]);

    // cardSettings state
    const areaDelete = useConfirmDialog({
        onConfirm: ({ areaId }) => {
            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'DELETE', {'id': areaId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newAreasArray = [...areasArray]
                        newAreasArray = newAreasArray.filter(area => area.id !== areaId );
                        setAreasArray(newAreasArray);
                        queryClient.invalidateQueries({ queryKey: areaKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete area')
                    }
                }).catch(error => {
                    showError(error, 'Unable to delete area')
                });
        }
    });

    const restUpdateAreaName = (areaIndex, areaId) => {

        const noop = ()=>{};

        // new area with no description, noop
        if ((areaId === '') &&
            (areasArray[areaIndex].area_name === '')) {
            noop();

        } else {
            // blank areaId indicates we are creating a new area
            if (areaId === '') {
                restSaveNewArea(areaIndex)
            } else {
                // otherwise we are updating a existing area
                let uri = `${darwinUri}/areas`;
                call_rest_api(uri, 'PUT', [{'id': areaId, 'area_name': areasArray[areaIndex].area_name}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            // database value is changed only with a 200 response
                            // so only then show snackbar
                            showError(result, `Unable to update area`)

                        }
                    }).catch(error => {
                        showError(error, `Unable to update area`)
                    });
            }
        }
    }

    const { fieldChange: changeAreaName, fieldKeyDown: keyDownAreaName, fieldOnBlur: blurAreaName } = useCrudCallbacks({
        items: areasArray, setItems: setAreasArray, fieldName: 'area_name',
        saveFn: (_event, index, id) => restUpdateAreaName(index, id)
    });

    const restSaveNewArea = (areaIndex) => {

        let newAreasArray = [...areasArray];
        newAreasArray[areaIndex].sort_order = calculateSortOrder(newAreasArray, areaIndex, newAreasArray[areaIndex].closed);

        let uri = `${darwinUri}/areas`;
        call_rest_api(uri, 'POST', {...newAreasArray[areaIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    // 200 => record added to database and returned in body
                    // show snackbar, place new data in table and created another blank element
                    newAreasArray[areaIndex] = {...result.data[0]};
                    newAreasArray.sort((areaA, areaB) => areaSortByClosedThenSortOrder(areaA, areaB));
                    newAreasArray.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': domain.id, 'sort_order': null });
                    setAreasArray(newAreasArray);

                    // update the taskCounts data
                    let newTaskCounts = {...taskCounts};
                    newTaskCounts[result.data[0].id] = 0;
                    setTaskCounts(newTaskCounts);

                    queryClient.invalidateQueries({ queryKey: areaKeys.all(profile.userName) });
                    setTimeout(() => templateInputRef.current?.focus(), 0);

                } else if (result.httpStatus.httpStatus === 201) {
                    // 201 => record added to database but new data not returned in body
                    queryClient.invalidateQueries({ queryKey: areaKeys.all(profile.userName) });
                } else {
                    showError(result, `Unable to save new area`)
                }
            }).catch(error => {
                showError(error, `Unable to save new area`)
            });
    }

    const clickAreaClosed = (event, areaIndex, areaId) => {

        // flip the closed bit...
        let newAreasArray = [...areasArray]
        let newClosed = newAreasArray[areaIndex].closed ? 0 : 1;
        newAreasArray[areaIndex].closed = newClosed;

        if (newAreasArray[areaIndex].id === '') {
            // if the affected area is the new template, no other work is required
            // save state and exit. Sort not required
            setAreasArray(newAreasArray);
            return;
        }

        // calculate correct sort order and returns the value.
        // if the value is null, it will be API/mySQL NULL string
        var newSortOrder = calculateSortOrder(newAreasArray, areaIndex, newClosed);

        // Update database
        let uri = `${darwinUri}/areas`;
        call_rest_api(uri, 'PUT', [{'id': areaId, 'closed': newClosed, 'sort_order': newSortOrder}], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus > 200) {
                    showError(result, `Unable to close area`)
                } else {
                    // Pause or resume recurring task definitions for this area
                    call_rest_api(`${darwinUri}/recurring_tasks?area_fk=${areaId}&fields=id`, 'GET', '', idToken)
                        .then(rtResult => {
                            if (rtResult?.data?.length > 0) {
                                const updates = rtResult.data.map(rt => ({ id: rt.id, active: newClosed ? 0 : 1 }));
                                call_rest_api(`${darwinUri}/recurring_tasks`, 'PUT', updates, idToken);
                            }
                        });
                }
            }).catch(error => {
                showError(error, `Unable to close area`)
            }
        );

        // Only after database is updated, sort areas and update state
        newAreasArray.sort((areaA, areaB) => areaSortByClosedThenSortOrder(areaA, areaB));
        setAreasArray(newAreasArray);
    }

    const clickAreaDelete = (event, areaId, areaName) => {
        areaDelete.openDialog({ areaName, areaId, tasksCount: taskCounts[areaId] });
    }

    const areaSortByClosedThenSortOrder = (areaA, areaB) => {

        // leave blank area in place at bottom of list
        if (areaA.id === '') return 0;
        if (areaB.id === '') return -1;

        // if both areas are open, sort by sort_order
        if ((areaA.closed === 0) &&
            (areaB.closed === 0)) {

            if (areaA.sort_order === areaB.sort_order) {
                return 0;
            } else if (areaA.sort_order < areaB.sort_order) {
                return -1;
            } else {
                return 1;
            }
        }

        if (areaA.closed === areaB.closed) {
            return 0;
        } else if (areaA.closed > areaB.closed) {
            return 1;
        } else {
            return -1;
        }

    }

    const calculateSortOrder = (newAreasArray, areaIndex, newClosed) => {

        // if close = 1, area has a sort_order of NULL, otherwise it moves to the bottom of the list
        var calcSortOrder = "NULL";

        if (newClosed === 0) {
            // find the current max sort order in the area array using -1 as initialValue
            // a newly opened area is sorted to bottom of list by default
            calcSortOrder = newAreasArray.reduce((previous, current) => {
                if (current.sort_order === null) {
                    return previous;
                } else {
                    return ((previous > current.sort_order) ? previous : current.sort_order);
                }
            }, -1);
            calcSortOrder = calcSortOrder + 1;
        }
        // null written to mysql is "NULL", read from mysql is actualy a JS null.
        newAreasArray[areaIndex].sort_order = (calcSortOrder === "NULL") ? null : calcSortOrder;
        return calcSortOrder;
    }

    const dragEnd = async (result) => {

        if ((result.destination === null) ||
            (result.reason !== 'DROP')) {
            // dropped out of area or was cancelled
            return;
        }

        // mutate the array - relocate the dragged item to the new location
        var newAreasArray = [...areasArray]
        const [draggedArray] = newAreasArray.splice(result.source.index, 1);
        newAreasArray.splice(result.destination.index, 0, draggedArray);

        //brute force renumbering of the sort values post drag
        newAreasArray = newAreasArray.map((area, index) => {

            // closed and template areas have no sort_order
            if ((area.id !== '') &&
                (area.closed !== 1)) {
                    area.sort_order = index;
                    return area;
            } else {
                return area;
            }
        })

        // update state
        setAreasArray(newAreasArray);

        // filter/map array down to minimum required to update all areas for the new sort order
        var restDataArray = newAreasArray
                .filter(area => ((area.id !== '') && (area.sort_order !== null)) ? true : false)
                .map(area => ({'id': area.id, 'sort_order': area.sort_order}));

        let uri = `${darwinUri}/areas`;
        call_rest_api(uri, 'PUT', restDataArray, idToken)
            .then(result => {
                if ((result.httpStatus.httpStatus === 200) ||
                    (result.httpStatus.httpStatus === 204)) {
                    // database value is changed only with a 200 response
                    // or no change was required with a 204 respone
                    // so only then show snackbar
                } else {

                    showError(result, `Unable to save area sort order`)
                }
            }).catch(error => {
                showError(error, `Unable to save area sort order`)
            });

        return;
    }

    return (
        <>
            <Box key={domainIndex} role="tabpanel" hidden={String(activeTab) !== String(domainIndex)} sx={{ p: { xs: 1, md: 3 } }} >
                { areasArray &&
                    <Box>
                        <Box sx={{ display: 'grid', gridTemplateColumns: AREA_GRID_COLUMNS, alignItems: 'center', borderBottom: 1, borderColor: 'divider', pb: 0.5, mb: 0.5 }}>
                            <Box sx={{ px: 1 }}><Typography variant="subtitle2">Name</Typography></Box>
                            <Box sx={{ textAlign: 'center' }}><Typography variant="subtitle2">Closed</Typography></Box>
                            <Box sx={{ textAlign: 'center' }}><Typography variant="subtitle2">Tasks</Typography></Box>
                            <Box />
                        </Box>
                        <DragDropContext onDragEnd={dragEnd}>
                            <Droppable droppableId="areas">
                                {(provided) => (
                                    <Box {...provided.droppableProps} ref={provided.innerRef}>
                                        { areasArray
                                            .filter(a => a.closed === 0 && a.id !== '')
                                            .map((area, idx) => (
                                            <AreaTableRow
                                                key = {area.id}
                                                area = {area}
                                                areaIndex = {idx}
                                                changeAreaName = {changeAreaName}
                                                keyDownAreaName = {keyDownAreaName}
                                                blurAreaName = {blurAreaName}
                                                clickAreaClosed = {clickAreaClosed}
                                                clickAreaDelete = {clickAreaDelete}
                                                taskCounts = {taskCounts}
                                                isDraggable />
                                        ))}
                                        {provided.placeholder}
                                    </Box>
                                )}
                            </Droppable>
                        </DragDropContext>
                        { areasArray
                            .filter(a => a.closed === 1 || a.id === '')
                            .map((area) => (
                            <AreaTableRow
                                key = {area.id || 'template'}
                                area = {area}
                                areaIndex = {areasArray.indexOf(area)}
                                changeAreaName = {changeAreaName}
                                keyDownAreaName = {keyDownAreaName}
                                blurAreaName = {blurAreaName}
                                clickAreaClosed = {clickAreaClosed}
                                clickAreaDelete = {clickAreaDelete}
                                taskCounts = {taskCounts}
                                isDraggable={false}
                                inputRef={area.id === '' ? templateInputRef : undefined} />
                        ))}
                    </Box>
                }
            </Box>
            <AreaDeleteDialog
                areaDeleteDialogOpen = { areaDelete.dialogOpen }
                setAreaDeleteDialogOpen = { areaDelete.setDialogOpen }
                areaInfo = { areaDelete.infoObject }
                setAreaInfo = { areaDelete.setInfoObject }
                setAreaDeleteConfirmed = { areaDelete.setConfirmed } />
        </>
    )
}

export default AreaEditTabPanel
