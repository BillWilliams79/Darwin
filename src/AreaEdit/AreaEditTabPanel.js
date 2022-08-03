import React, {useState, useContext, useEffect} from 'react';
import SnackBar from './SnackBar';

import varDump from '../classifier/classifier';
import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';

import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

import { Box } from '@mui/system';
import { TabPanel } from '@material-ui/lab';
import { Checkbox, Typography } from '@mui/material';
import { TextField } from '@mui/material';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import AreaDeleteDialog from './AreaDeleteDialog';

const AreaEditTabPanel = ( { domain, domainIndex } ) => {

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

        let areaUri = `${darwinUri}/areas?creator_fk=${profile.userName}&domain_fk=${domain.id}&fields=id,area_name,closed`;

        call_rest_api(areaUri, 'GET', '', idToken)
            .then(result => {
                // retrieve counts from rest API using &fields=count(*), group_by_field syntax
                let uri = `${darwinUri}/tasks?creator_fk=${profile.userName}&fields=count(*),area_fk`;
                call_rest_api(uri, 'GET', '', idToken)
                    .then(result => {
                        // count(*) returns an array of dict with format {group_by_field, count(*)}
                        // reformat to dictionary: taskcounts.area_fk = count(*)
                        let newTaskCounts = {};
                        result.data.map( (countData) => {
                            newTaskCounts[countData.area_fk] = countData['count(*)']; 
                        })

                        setTaskCounts(newTaskCounts);
        
                    }).catch(error => {
                        varDump(error, `UseEffect: error retrieving task counts: ${error}`);
                    });

                let newAreasArray = result.data;
                newAreasArray.sort((areaA, areaB) => areaClosedSort(areaA, areaB));
                newAreasArray.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': parseInt(domain.id), 'creator_fk': profile.userName });
                setAreasArray(newAreasArray);

            }).catch(error => {
                if (error.httpStatus.httpStatus === 404) {
                    let newAreasArray = [];
                    newAreasArray.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': parseInt(domain.id), 'creator_fk': profile.userName });
                    setAreasArray(newAreasArray);
                } else {
                    varDump(error, `UseEffect: error reading Areas in a domain ${domain.id}: ${error}`);
                }
            });
    }, [areaApiTrigger]);

    // DELETE AREA in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: delete area');

        if (areaDeleteConfirmed === true) {
            const {areaName, areaId } = areaInfo;

            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'DELETE', {'id': areaId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // database area was deleted, update areaArray, pop snackbar, cleanup delete dialog
                        let newAreasArray = [...areasArray]
                        newAreasArray = newAreasArray.filter(area => area.id !== areaId );
                        setAreasArray(newAreasArray);
                        setSnackBarMessage('Area Deleted Successfully');
                        setSnackBarOpen(true);
                    } else {
                        console.log(`Error: unable to delete area : ${result.httpStatus.httpStatus}`);
                        setSnackBarMessage(`Unable to delete area : ${result.httpStatus.httpStatus}`);
                        setSnackBarOpen(true);
                    }
                }).catch(error => {
                    console.log(`Error: unable to delete area : ${error}`);
                    setSnackBarMessage(`Unable to delete area : ${error}`);
                    setSnackBarOpen(true);
                });
        }
        // prior to exit and regardless of outcome, clean up state
        setAreaDeleteConfirmed(false);
        setAreaInfo({});

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
 
        // Enter key triggers save, but Enter itself cannot be part of task.description hence preventDefault
        if (event.key === 'Enter') {
            restUpdateAreaName(areaIndex, areaId);
            event.preventDefault();
        }
    }

    const blurAreaName= (event, areaIndex, areaId) => {
        console.log('blurAreaName')

        restUpdateAreaName(areaIndex, areaId);
    }

    const restUpdateAreaName = (areaIndex, areaId) => {

        const noop = ()=>{};

        // new area with no description, noop
        if ((areaId === '') &&
            (areasArray[areaIndex].area_name === '')) {
            noop();

        } else {
            // blank areaId indicates we are creating a new area rather than updating existing
            if (areaId === '') {
                restSaveAreaName(areaIndex)
            } else {
                let uri = `${darwinUri}/areas`;
                call_rest_api(uri, 'POST', {'id': areaId, 'area_name': areasArray[areaIndex].area_name}, idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus === 200) {
                            // database value is changed only with a 200 response
                            // so only then show snackbar
                            setSnackBarMessage('Area Updated Successfully');
                            setSnackBarOpen(true);
                        }
                    }).catch(error => {
                        varDump(error, `Error - could not update area name ${error}`);
                        setSnackBarMessage('Area name updated failed');
                        setSnackBarOpen(true);
                    });
            }
        }
    }

    const restSaveAreaName = (areaIndex) => {
        
        let uri = `${darwinUri}/areas`;
        call_rest_api(uri, 'PUT', {...areasArray[areaIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    // 200 => record added to database and returned in body
                    // show snackbar, place new data in table and created another blank element
                    setSnackBarMessage('Task Created Successfully');
                    setSnackBarOpen(true);
                    let newAreasArray = [...areasArray];
                    newAreasArray[areaIndex] = {...result.data[0]};
                    newAreasArray.sort((areaA, areaB) => areaClosedSort(areaA, areaB));
                    newAreasArray.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': domain.id, 'creator_fk': profile.userName });
                    setAreasArray(newAreasArray);

                    // update the taskCounts data
                    let newTaskCounts = {...taskCounts};
                    newTaskCounts[result.data[0].id] = 0;
                    setTaskCounts(newTaskCounts);


                } else if (result.httpStatus.httpStatus === 201) {
                    // 201 => record added to database but new data not returned in body
                    // show snackbar and flip read_rest_api state to initiate full data retrieval
                    setSnackBarMessage('Area Created Successfully');
                    setSnackBarOpen(true);
                    setAreaApiTrigger(areaApiTrigger ? false : true);  
                } else {
                    setSnackBarMessage('Area not saved, HTTP Error {result.httpStatus.httpStatus}');
                    setSnackBarOpen(true);
                }
            }).catch(error => {
                varDump(error, 'Area not saved, ');
                setSnackBarMessage('Area not saved, HTTP Error {error}');
                setSnackBarOpen(true);
            });
    }

    const clickAreaClosed = (event, areaIndex, areaId) => {

        // invert closed, re-sort area array for the card, update state.
        let newAreasArray = [...areasArray]
        newAreasArray[areaIndex].closed = newAreasArray[areaIndex].closed ? 0 : 1;

        // for areas already in the db, update db
        if (areaId !== '') {
            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'POST', {'id': areaId, 'closed': newAreasArray[areaIndex].closed}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        console.log(`Error closed not updated: ${result.httpStatus.httpStatus} ${result.httpStatus.httpMessage}`);
                        setSnackBarMessage(`closed not updated: ${result.httpStatus.httpStatus}`);
                        setSnackBarOpen(true);
                    }
                }).catch(error => {
                    console.log(`Error caught during closed update ${error.httpStatus.httpStatus} ${error.httpStatus.httpMessage}`);
                    setSnackBarMessage(`closed not updated: ${error.httpStatus.httpStatus}`);
                    setSnackBarOpen(true);
                }
            );
        }
        
        // Only after database is updated, sort areas and update state
        newAreasArray.sort((areaA, areaB) => areaClosedSort(areaA, areaB));
        setAreasArray(newAreasArray);        
    }

    const clickAreaDelete = (event, areaId, areaName) => {

        // store area details in state for use in deleting if confirmed
        setAreaInfo({ areaName, areaId, tasksCount: taskCounts[areaId] });
        setAreaDeleteDialogOpen(true);
    }

    const areaClosedSort = (areaA, areaB) => {
        // leave blank area in place at bottom of list
        if (areaA.id === '') return 0;
        if (areaB.id === '') return -1;

        if (areaA.closed === areaB.closed) {
            return 0;
        } else if (areaA.closed > areaB.closed) {
            return 1;
        } else {
            return -1;
        }
    }

   
    return (
        <>
            <TabPanel key={domainIndex} value={domainIndex.toString()} >
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
                            <TableBody>
                            { areasArray.map((area, areaIndex) => (
                                <TableRow key={area.id}>
                                    <TableCell> 
                                        <TextField variant="outlined"
                                                   value={area.area_name || ''}
                                                   name='area-name'
                                                   onChange= { (event) => changeAreaName(event, areaIndex) }
                                                   onKeyDown = {(event) => keyDownAreaName(event, areaIndex, area.id)}
                                                   onBlur = {(event) => blurAreaName(event, areaIndex, area.id)}
                                                   autoComplete='off'
                                                   size = 'small'
                                                   key={`name-${area.id}`}
                                         />                                    
                                    </TableCell>
                                    <TableCell> 
                                        <Checkbox checked = {(area.closed === 1) ? true : false }
                                                  onClick = {(event) => clickAreaClosed(event, areaIndex, area.id) }
                                                  key={`checked-${area.id}`}
                                        />
                                    </TableCell>
                                    <TableCell> {/* triple ternary checks all cases and display correct value */}
                                        <Typography variant='body1' sx={{textAlign: 'center'}}>
                                        {  area.id === '' ? '' :
                                            taskCounts[`${area.id}`] === undefined ? 0 :
                                              taskCounts[`${area.id}`] === '' ? '' : taskCounts[`${area.id}`] }
                                         </Typography>
                                    </TableCell>
                                    <TableCell>
                                        { area.id === '' ?
                                            <IconButton >
                                                <SavingsIcon />
                                            </IconButton>
                                            :
                                            <IconButton  onClick={(event) => clickAreaDelete(event, area.id, area.area_name)} >
                                                <DeleteIcon />
                                            </IconButton>
                                        }
                                </TableCell>
                                </TableRow>
                            ))}
                            </TableBody>
                        </Table>
                    </Box>  
                }

            </TabPanel>
            <SnackBar snackBarOpen = {snackBarOpen} setSnackBarOpen = {setSnackBarOpen} snackBarMessage={snackBarMessage} />
            <AreaDeleteDialog 
                areaDeleteDialogOpen = { areaDeleteDialogOpen }
                setAreaDeleteDialogOpen = { setAreaDeleteDialogOpen }
                areaInfo = { areaInfo }
                setAreaInfo = { setAreaInfo }
                setAreaDeleteConfirmed = { setAreaDeleteConfirmed }
            >
            </AreaDeleteDialog>
        </>
    )
}

export default AreaEditTabPanel