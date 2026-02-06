// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, {useState, useContext, useEffect} from 'react';
import {SnackBar, snackBarError} from '../Components/SnackBar/SnackBar';

import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';
import { DragDropContext, Droppable, /* Draggable */ } from '@hello-pangea/dnd';

import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import Box from '@mui/material/Box';

import AreaDeleteDialog from './AreaDeleteDialog';
import AreaTableRow from './AreaTableRow';

const AreaEditTabPanel = ( { domain, domainIndex, activeTab } ) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [areasArray, setAreasArray] = useState();
    const [taskCounts, setTaskCounts] = useState({});
    const [areaApiTrigger, setAreaApiTrigger] = useState(false);
 
    // snackBar state
    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');

    // cardSettings state
    const [areaDeleteDialogOpen, setAreaDeleteDialogOpen] = useState(false);
    const [areaDeleteConfirmed, setAreaDeleteConfirmed] = useState(false);
    const [areaInfo, setAreaInfo] = useState({});

    // READ AREA API data for TabPanel
    useEffect( () => {

        console.count('useEffect: read all Rest API data');

        let areaUri = `${darwinUri}/areas?creator_fk=${profile.userName}&domain_fk=${domain.id}&fields=id,area_name,closed,sort_order`;

        call_rest_api(areaUri, 'GET', '', idToken)
            .then(result => {
                // retrieve counts from rest API using &fields=count(*), group_by_field syntax
                let uri = `${darwinUri}/tasks?creator_fk=${profile.userName}&fields=count(*),area_fk`;
                call_rest_api(uri, 'GET', '', idToken)
                    .then(result => {
                        // count(*) returns an array of dict with format {group_by_field, count(*)}
                        // reformat to dictionary: taskcounts.area_fk = count(*)
                        let newTaskCounts = {};
                        // eslint-disable-next-line array-callback-return
                        result.data.map( (countData) => {
                            newTaskCounts[countData.area_fk] = countData['count(*)']; 
                        })

                        setTaskCounts(newTaskCounts);
        
                    }).catch(error => {
                        snackBarError(error, 'Unable to retrieve task counts', setSnackBarMessage, setSnackBarOpen)
                    });

                let newAreasArray = result.data;
                newAreasArray.sort((areaA, areaB) => areaSortByClosedThenSortOrder(areaA, areaB));
                newAreasArray.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': parseInt(domain.id), 'creator_fk': profile.userName, 'sort_order': null });
                setAreasArray(newAreasArray);

            }).catch(error => {
                if (error.httpStatus.httpStatus === 404) {
                    let newAreasArray = [];
                    newAreasArray.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': parseInt(domain.id), 'creator_fk': profile.userName });
                    setAreasArray(newAreasArray);
                } else {
                    snackBarError(error, `Unable to read area data for domain ${domain.id}`, setSnackBarMessage, setSnackBarOpen)
                }
            });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [areaApiTrigger]);

    // DELETE AREA in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: delete area');

        if (areaDeleteConfirmed === true) {
            const { areaId } = areaInfo;

            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'DELETE', {'id': areaId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // database area was deleted, update areaArray, pop snackbar, cleanup delete dialog
                        let newAreasArray = [...areasArray]
                        newAreasArray = newAreasArray.filter(area => area.id !== areaId );
                        setAreasArray(newAreasArray);
                    } else {
                        snackBarError(result, `Unable to delete area`, setSnackBarMessage, setSnackBarOpen)
                    }
                }).catch(error => {
                    snackBarError(error, `Unable to delete area`, setSnackBarMessage, setSnackBarOpen)
                });
        }
        // prior to exit and regardless of outcome, clean up state
        setAreaDeleteConfirmed(false);
        setAreaInfo({});

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [areaDeleteConfirmed])    

    const changeAreaName = (event, areaIndex) => {

        // event.target.value contains the new area text
        // updated changes are written to rest API elsewhere (keyup for example)
        let newAreasArray = [...areasArray]
        newAreasArray[areaIndex].area_name = event.target.value;
        setAreasArray(newAreasArray);
    }

    const keyDownAreaName = (event, areaIndex, areaId) => {
        console.log('keyDownAreaName')
        // Enter key triggers update, but Enter itself cannot be part of area.area_name hence preventDefault
        if (event.key === 'Enter') {
            restUpdateAreaName(areaIndex, areaId);
            event.preventDefault();
        }
    }

    const blurAreaName= (event, areaIndex, areaId) => {
        // handler shared with keyDownAreaName
        restUpdateAreaName(areaIndex, areaId);
    }

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
                            snackBarError(result, `Unable to update area`, setSnackBarMessage, setSnackBarOpen)

                        }
                    }).catch(error => {
                        snackBarError(error, `Unable to update area`, setSnackBarMessage, setSnackBarOpen)
                    });
            }
        }
    }

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
                    newAreasArray.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': domain.id, 'creator_fk': profile.userName, 'sort_order': null });
                    setAreasArray(newAreasArray);

                    // update the taskCounts data
                    let newTaskCounts = {...taskCounts};
                    newTaskCounts[result.data[0].id] = 0;
                    setTaskCounts(newTaskCounts);

                } else if (result.httpStatus.httpStatus === 201) {
                    // 201 => record added to database but new data not returned in body
                    // show snackbar and flip read_rest_api state to initiate full data retrieval
                    setAreaApiTrigger(areaApiTrigger ? false : true);  
                } else {
                    snackBarError(result, `Unable to save new area`, setSnackBarMessage, setSnackBarOpen)
                }
            }).catch(error => {
                snackBarError(error, `Unable to save new area`, setSnackBarMessage, setSnackBarOpen)
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
                    snackBarError(result, `Unable to close area`, setSnackBarMessage, setSnackBarOpen)
                }
            }).catch(error => {
                snackBarError(error, `Unable to close area`, setSnackBarMessage, setSnackBarOpen)
            }
        );

        // Only after database is updated, sort areas and update state
        newAreasArray.sort((areaA, areaB) => areaSortByClosedThenSortOrder(areaA, areaB));
        setAreasArray(newAreasArray);        
    }

    const clickAreaDelete = (event, areaId, areaName) => {

        // store area details in state for use in deleting if confirmed
        setAreaInfo({ areaName, areaId, tasksCount: taskCounts[areaId] });
        setAreaDeleteDialogOpen(true);
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
                    console.log('sort order saved');
                } else {

                    snackBarError(result, `Unable to save area sort order`, setSnackBarMessage, setSnackBarOpen)
                }
            }).catch(error => {
                snackBarError(error, `Unable to save area sort order`, setSnackBarMessage, setSnackBarOpen)
            });
 
        return;
    }

    return (
        <>
            <Box key={domainIndex} role="tabpanel" hidden={String(activeTab) !== String(domainIndex)} sx={{ p: 3 }} >
                { areasArray && 
                    <Box>
                        <Table size='small'>
                            <TableHead>
                                <TableRow key = 'TableHead'>
                                    <TableCell> Name </TableCell>
                                    <TableCell> Closed </TableCell>
                                    <TableCell> Task Count </TableCell>
                                    <TableCell></TableCell>
                                </TableRow>
                            </TableHead>
                            <DragDropContext onDragEnd={dragEnd}>
                                <Droppable droppableId="areas">
                                    {(provided) => (
                                        <TableBody {...provided.droppableProps} ref={provided.innerRef}>
                                            { areasArray.map((area, areaIndex) => (
                                                <AreaTableRow
                                                    key = {area.id}
                                                    area = {area}
                                                    areaIndex = {areaIndex}
                                                    changeAreaName = {changeAreaName}
                                                    keyDownAreaName = {keyDownAreaName}
                                                    blurAreaName = {blurAreaName}
                                                    clickAreaClosed = {clickAreaClosed}
                                                    clickAreaDelete = {clickAreaDelete}
                                                    taskCounts = {taskCounts} />
                                            ))}
                                            {provided.placeholder}
                                        </TableBody>
                                    )}
                                </Droppable>
                            </DragDropContext>
                        </Table>
                    </Box>  
                }
            </Box>
            <SnackBar {...{snackBarOpen,
                           setSnackBarOpen,
                           snackBarMessage,}} />
            <AreaDeleteDialog 
                areaDeleteDialogOpen = { areaDeleteDialogOpen }
                setAreaDeleteDialogOpen = { setAreaDeleteDialogOpen }
                areaInfo = { areaInfo }
                setAreaInfo = { setAreaInfo }
                setAreaDeleteConfirmed = { setAreaDeleteConfirmed } />
        </>
    )
}

export default AreaEditTabPanel
