import '../index.css';
import varDump from '../classifier/classifier';
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import SnackBar from './SnackBar';
import DeleteDialog from './DeleteDialog';
import CardSettingsDialog from './CardSettingsDialog';
import DomainSettingsDialog from './DomainSettingsDialog';
 
import React, { useState, useEffect, useContext } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CloseIcon from '@mui/icons-material/Close';

import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';

import Tab from '@mui/material/Tab';
import TabContext from '@material-ui/lab/TabContext';
import TabList from '@material-ui/lab/TabList';
import TabPanel from '@material-ui/lab/TabPanel';

const TaskCards = () => {

    const { idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    // Corresponds to crud_app.rest_api table for user, and UI/js index
    const [domainsArray, setDomainsArray] = useState()
    const [areasArray, setAreasArray] = useState()
    const [tasksArray, setTasksArray] = useState()

    // changing this value triggers useState, re-reads all rest API data
    // misleading, but true or flase doesn't matter, just flip the value
    // and set it, the useState is executed
    const [readRestApi, setReadRestApi] = useState(false); 

    // Domain Tabs state
    const [activeTab, setActiveTab] = useState();

    // snackBar state
    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');

    // deleteDialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteConfirmed, setDeleteConfirmed] = useState(false);
    const [deleteId, setDeleteId] = useState({});

    // cardSettings state
    const [cardSettingsDialogOpen, setCardSettingsDialogOpen] = useState(false);
    const [areaCloseConfirmed, setAreaCloseConfirmed] = useState(false);
    const [areaCloseId, setAreaCloseId] = useState({});

    // domainSettings state
    const [tabSettingsDialogOpen, setTabSettingsDialogOpen] = useState(false);
    const [domainCloseConfirmed, setDomainCloseConfirmed] = useState(false);
    const [domainCloseId, setDomainCloseId] = useState({});

    // READ API data for page
    useEffect( () => {
        // TODO: creator_fk must by dynamically set based on logged in user.
        console.count('useEffect: read all Rest API data');

        // FETCH DOMAINS
        // QSPs limit fields to minimum: id,domain_name
        let domainUri = `${darwinUri}/domains?creator_fk=2&closed=0&fields=id,domain_name`

        call_rest_api(domainUri, 'GET', '', idToken)
            .then(result => {
                // Tab bookeeping
                // TODO: store and retrieve in browswer persistent storage
                setActiveTab(0);
                setDomainsArray(result.data);

                // create object with an array per domain based on domain.id
                var sortedAreasObject = {};
                result.data.map( domain => sortedAreasObject[domain.id] = []);

                // Create string of domain.ids for use in QSP
                const domainFkString = `(${Object.keys(sortedAreasObject).toString()})`

                // FETCH AREAS: filter for: creator, closed=0, open domains
                // QSPs limit area fields to minimum: id,area_name,domain_fk
                let areaUri = `${darwinUri}/areas?creator_fk=2&closed=0&domain_fk=${domainFkString}&fields=id,area_name,domain_fk`;


                call_rest_api(areaUri, 'GET', '', idToken)
                    .then(result => {
                        // distribute areas into domain arrays (enables bookeeping/indexing for the area names)
                        result.data.map( (area) => sortedAreasObject[area.domain_fk].push(area))
                        
                        setAreasArray(sortedAreasObject);

                        // create object with an array per area based on its area.id
                        var sortedTasksObject = {};
                        result.data.map( area => sortedTasksObject[area.id] = []);

                        // create a string of area.id's in the format of (id1, id2, id3...)
                        // the handy toString makes this a comma separate string
                        let areaIdArray=[];
                        result.data.map( area => areaIdArray.push(area.id));
                        let areaFkString = `(${areaIdArray.toString()})`

                        // FETCH TASKS: filter for creator, done=0 and only for the open areas
                        // QSPs limit fields to minimum: id,priority,done,description,area_fk
                        let taskUri = `${darwinUri}/tasks?creator_fk=2&done=0&area_fk=${areaFkString}&fields=id,priority,done,description,area_fk`

                        call_rest_api(taskUri, 'GET', '', idToken)
                            .then(result => {
                                // tasks are stored in taskObject with key=area.id, value is array of task objects
                                // thus, push the tasks into the area arrays
                                result.data.map( (task) => sortedTasksObject[task.area_fk].push(task))

                                // Prior to display, the tasks have to be sorted
                                Object.keys(sortedTasksObject).map( areaId => sortedTasksObject[areaId].sort((taskA, taskB) => taskPrioritySort(taskA, taskB)))

                                // After sorting, add a blank task that is used for new task creation in the UI
                                // TODO: creator_fk is hardcoded and needs to come from profile/context
                                Object.keys(sortedTasksObject).map( areaId => sortedTasksObject[areaId]
                                    .push({'id':'', 'description':'', 'priority': 0, 'done': 0, 'area_fk': parseInt(areaId), 'creator_fk': 2 }));

                                setTasksArray(sortedTasksObject);

                            }).catch(error => {
                                 varDump(error, `UseEffect: error retrieving Tasks: ${error}`);
                            });
                    }).catch(error => {
                        varDump(error, `UseEffect: error retrieving Areas: ${error}`);
                    });
            }).catch(error => {
                varDump(error, `UseEffect: error retrieving Domains: ${error}`);
            });

    }, [readRestApi]);

    // DELETE TASK in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: delete task');

        //TODO confirm deleteId is a valid object
        if (deleteConfirmed === true) {
            const {areaId, taskId} = deleteId;

            let uri = `${darwinUri}/tasks`;
            call_rest_api(uri, 'DELETE', {'id': taskId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // database task was deleted, update taskArray, pop snackbar, cleanup delete dialog
                        let newTasksArray = {...tasksArray}
                        newTasksArray[areaId] = newTasksArray[areaId].filter(task => task.id !== taskId );
                        setTasksArray(newTasksArray);
                        setSnackBarMessage('Task Deleted Successfully');
                        setSnackBarOpen(true);
                    } else {
                        console.log(`Error: unable to delete task : ${result.httpStatus.httpStatus}`);
                        setSnackBarMessage(`Unable to delete task : ${result.httpStatus.httpStatus}`);
                        setSnackBarOpen(true);
                    }
                }).catch(error => {
                    console.log(`Error: unable to delete task : ${error}`);
                    setSnackBarMessage(`Unable to delete task : ${error}`);
                    setSnackBarOpen(true);
                });
        }
        // prior to exit and regardless of outcome, clean up state
        setDeleteConfirmed(false);
        setDeleteId({});

    }, [deleteConfirmed])

    // CLOSE AREA in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: close Area');

        //TODO confirm areaCloseId is a valid object
        if (areaCloseConfirmed === true) {
            const { areaName, areaId, domainId } = areaCloseId;

            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'POST', {'id': areaId, 'closed': 1}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // Area set to close, remove area from Area object state
                        let newAreasArray = {...areasArray};
                        newAreasArray[domainId] = newAreasArray[domainId].filter(area => area.id !== areaId );
                        setAreasArray(newAreasArray);

                        setSnackBarMessage(`${areaName} Closed Successfully`);
                        setSnackBarOpen(true);

                    } else {
                        console.log(`Error: unable to close ${areaName} : ${result.httpStatus.httpStatus}`);
                        setSnackBarMessage(`Unable to close ${areaName} : ${result.httpStatus.httpStatus}`);
                        setSnackBarOpen(true);
                    }
                }).catch(error => {
                    console.log(`Error: unable to close ${areaName} : ${error}`);
                    setSnackBarMessage(`Unable to close ${areaName} : ${error}`);
                    setSnackBarOpen(true);
            });
        }
        // prior to exit and regardless of outcome, clean up state
        setAreaCloseConfirmed(false);
        setAreaCloseId({});

    }, [areaCloseConfirmed])

    // CLOSE DOMAIN in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: close Domain');

        //TODO confirm areaCloseId is a valid object
        if (domainCloseConfirmed === true) {
            const { domainName, domainId, domainIndex } = domainCloseId;

            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'POST', {'id': domainId, 'closed': 1}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // Domain set to close, remove area from Domain state
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray = newDomainsArray.filter(domain => domain.id !== domainId );
                        setDomainsArray(newDomainsArray);

                        setSnackBarMessage(`${domainName} Closed Successfully`);
                        setSnackBarOpen(true);

                    } else {
                        console.log(`Error: unable to close ${domainName} : ${result.httpStatus.httpStatus}`);
                        setSnackBarMessage(`Unable to close ${domainName} : ${result.httpStatus.httpStatus}`);
                        setSnackBarOpen(true);
                    }
                }).catch(error => {
                    console.log(`Error: unable to close ${domainName} : ${error}`);
                    setSnackBarMessage(`Unable to close ${domainName} : ${error}`);
                    setSnackBarOpen(true);
            });
        }
        // prior to exit and regardless of outcome, clean up state
        setDomainCloseConfirmed(false);
        setDomainCloseId({});

    }, [domainCloseConfirmed])


    const changeActiveTab = (event, newValue) => {
        setActiveTab(newValue);
    }

    const domainCloseClick = (event, domainName, domainId, domainIndex) => {
        // stores data re: card to close, opens dialog
        varDump(domainName, 'should be domain name')
        setDomainCloseId({ domainName, domainId, domainIndex });
        setTabSettingsDialogOpen(true);
    }

    const areaChange = (event, domainId, areaIndex, areaId) => {
        // event.target.value contains the new area text
        // updated changes are written to rest API elsewhere (keyup for example)
        let newAreasArray = {...areasArray}
        newAreasArray[domainId][areaIndex].area_name = event.target.value;
        setAreasArray(newAreasArray);
    }

    const areaKeyDown = (event, domainId, areaIndex, areaId) => {
        if ((event.key === 'Enter') ||
            (event.key === 'Tab')) {

            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'POST', {'id': areaId, 'area_name': areasArray[domainId][areaIndex].area_name}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        // database change confirmed only with a 200 response
                        // so only then show snackbar
                        setSnackBarMessage('Area Updated Successfully');
                        setSnackBarOpen(true);
                    }
                }).catch(error => {
                    varDump(error, `Error - could not update area name ${error}`);
                });
            }
        // Enter key cannot be part of area name, so eat the event
        if (event.key === 'Enter') {
            event.preventDefault();
        }
    }

    const cardSettingsClick = (event, areaName, areaId, domainId) => {
        // stores data re: card to close, opens dialog
        setAreaCloseId({ areaName, areaId, domainId });
        setCardSettingsDialogOpen(true);
    }

    const priorityClick = (areaId, taskIndex, taskId) => {

        // invert priority, resort task array for the card, update state.
        let newTasksArray = {...tasksArray}
        newTasksArray[areaId][taskIndex].priority = newTasksArray[areaId][taskIndex].priority ? 0 : 1;
        newTasksArray[areaId].sort((taskA, taskB) => taskPrioritySort(taskA, taskB));
        setTasksArray(newTasksArray);

        // for tasks already in the db, update db
        if (taskId != '') {
            let uri = `${darwinUri}/tasks`;
            call_rest_api(uri, 'POST', {'id': taskId, 'priority': newTasksArray[areaId][taskIndex].priority}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus != 200) {
                        console.log(`Error Priority not updated: ${result.httpStatus.httpStatus} ${result.httpStatus.httpMessage}`);
                        setSnackBarMessage(`Priority not updated: ${result.httpStatus.httpStatus}`);
                        setSnackBarOpen(true);
                    }
                }).catch(error => {
                    console.log(`Error caught during priority update ${error.httpStatus.httpStatus} ${error.httpStatus.httpMessage}`);
                    setSnackBarMessage(`Priority not updated: ${error.httpStatus.httpStatus}`);
                    setSnackBarOpen(true);
                }
            );
        }
    }

    const doneClick = (areaId, taskIndex, taskId) => {

        // invert done, update state
        let newTasksArray = {...tasksArray}
        newTasksArray[areaId][taskIndex].done = newTasksArray[areaId][taskIndex].done ? 0 : 1;
        setTasksArray(newTasksArray);

        // for tasks already in the db, update the db
        if (taskId != '') {
            let uri = `${darwinUri}/tasks`;
            // toISOString converts to the SQL expected format and UTC from local time. They think of everything
            call_rest_api(uri, 'POST', {'id': taskId, 'done': newTasksArray[areaId][taskIndex].done,
                          ...(newTasksArray[areaId][taskIndex].done === 1 ? {'done_ts': new Date().toISOString()} : {'done_ts': 'NULL'})}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus != 200) {
                        console.log(`Error domainName not updated: ${result.httpStatus.httpStatus} ${result.httpStatus.httpMessage}`);
                        setSnackBarMessage(`domainName not updated: ${result.httpStatus.httpStatus}`);
                        setSnackBarOpen(true);
                    }
                }).catch(error => {
                    console.log(`Error caught during done update ${error.httpStatus.httpStatus} ${error.httpStatus.httpMessage}`);
                    setSnackBarMessage(`domainName not updated: ${error.httpStatus.httpStatus}`);
                    setSnackBarOpen(true);
                }
            );
        }
    }

    const saveClick = (event, areaId, taskIndex, taskId) => {
        let uri = `${darwinUri}/tasks`;
        call_rest_api(uri, 'PUT', {...tasksArray[areaId][taskIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    // 200 => record added to database and returned in body
                    // show snackbar, place new data in table and created another blank element
                    setSnackBarMessage('Task Created Successfully');
                    setSnackBarOpen(true);
                    let newTasksArray = {...tasksArray};
                    newTasksArray[areaId][taskIndex] = {...result.data[0]};
                    newTasksArray[areaId].sort((taskA, taskB) => taskPrioritySort(taskA, taskB));
                    newTasksArray[areaId].push({'id':'', 'description':'', 'priority': 0, 'done': 0, 'area_fk': areaId, 'creator_fk': 2 });
                    setTasksArray(newTasksArray);
                } else if (result.httpStatus.httpStatus === 201) {
                    // 201 => record added to database but new data not returned in body
                    // show snackbar and flip read_rest_api state to initiate full data retrieval
                    setSnackBarMessage('Task Created Successfully');
                    setSnackBarOpen(true);
                    setReadRestApi(readRestApi ? false : true);  
                } else {
                    setSnackBarMessage('Task not saved. HTTP Error {result.httpStatus.httpStatus}');
                    setSnackBarOpen(true);
                }
            }).catch(error => {
                varDump(error, 'Error caught during saveClick');
                setSnackBarMessage('Task not saved. Error {error}');
                setSnackBarOpen(true);
            });
    }
    
    const descriptionChange = (event, areaId, taskIndex) => {

        // event.target.value contains the new text from description which is retained in state
        // updated changes are written to rest API elsewhere (keyup for example)
        let newTasksArray = {...tasksArray}
        newTasksArray[areaId][taskIndex].description = event.target.value;
        setTasksArray(newTasksArray);
    }

    const descriptionKeyDown = (event, areaId, taskIndex, taskId) => {
        if ((event.key === 'Enter') ||
            (event.key === 'Tab')) {

            updateTask(event, areaId, taskIndex, taskId);
        }

        // Enter key cannot be part of task description, so eat the event
        if (event.key === 'Enter') {
            event.preventDefault();
        }
    }

    const descriptionOnBlur= (event, areaId, taskIndex, taskId) => {
        updateTask(event, areaId, taskIndex, taskId);
    }

    const updateTask = (event, areaId, taskIndex, taskId) => {

        // new tasks that are blank should not be saved
        if ((taskId === '') &&
            (tasksArray[areaId][taskIndex].description === '')) {

            console.log('no save');

        } else {

            // blank taskId indicates we are creating a new task rather than updating existing
            if (taskId === '') {
                saveClick(event, areaId, taskIndex, taskId)
            } else {
                let uri = `${darwinUri}/tasks`;
                call_rest_api(uri, 'POST', {'id': taskId, 'description': tasksArray[areaId][taskIndex].description}, idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus === 200) {
                            // database value is changed only with a 200 response
                            // so only then show snackbar
                            setSnackBarMessage('Task Updated Successfully');
                            setSnackBarOpen(true);
                        }
                    }).catch(error => {
                        varDump(error, `Error - could not update area name ${error}`);
                    });
            }
        }
    }

    const deleteClick = (event, areaId, taskId) => {
        // stores data re: task to delete, opens dialog
        setDeleteId({areaId, taskId});
        setDeleteDialogOpen(true);
    }

    const taskPrioritySort = (taskA, taskB) => {
            // leave blanks in place
            if (taskA.id === '') return 1;
            if (taskB.id === '') return -1;

            if (taskA.priority === taskB.priority) {
                return 0;
            } else if (taskA.priority > taskB.priority) {
                return -1;
            } else {
                return 1;
            }
    }

    return (
        <>
            { domainsArray &&
                <>
                <Box sx={{ typography: 'body1'  }}>
                    <TabContext value={activeTab.toString()}>
                        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                            <TabList  onChange={changeActiveTab}>
                                {domainsArray.map( (domain, domainIndex) => 
                                    <Tab sx={{'& .MuiTab-root': {minHeight: '48px'} }} key={domainIndex}
                                         icon={<CloseIcon onClick={(event) => domainCloseClick(event, domain.domain_name, domain.id, domainIndex)}/>}
                                         label={domain.domain_name} 
                                         value={domainIndex.toString()}
                                         iconPosition="end"
                                         />
                                )}
                            </TabList>
                        </Box>
                         { domainsArray.map( (domain, domainIndex) => 
                            <TabPanel key={domainIndex} value={domainIndex.toString()} >
                                {areasArray && 
                                    <Box className="card">
                                        { areasArray[domain.id].map((area, areaIndex) => (
                                            <Card key={areaIndex} raised={true}>
                                                <CardContent>
                                                    <Box className="card-header" sx={{marginBottom: 2}}>
                                                        <TextField variant="standard"
                                                                    value={area.area_name || ''}
                                                                    name='area-name'
                                                                    onChange= { (event) => areaChange(event, domain.id, areaIndex, area.id) }
                                                                    onKeyDown = {(event) => areaKeyDown(event, domain.id, areaIndex, area.id)}
                                                                    multiline
                                                                    autoComplete='off'
                                                                    size = 'small'
                                                                    InputProps={{disableUnderline: true, style: {fontSize: 24}}}
                                                                    key={`area-${area.id}`}
                                                         />
                                                        <IconButton onClick={(event) => cardSettingsClick(event, area.area_name, area.id, domain.id)} >
                                                            <CloseIcon />
                                                        </IconButton>
                                                    </Box>
                                                    { tasksArray &&
                                                        tasksArray[area.id].map((task, taskIndex) => (
                                                            <Box className="task">
                                                                <Checkbox
                                                                    checked = {task.priority ? true : false}
                                                                    onClick = {() => priorityClick(area.id, taskIndex, task.id)}
                                                                    icon={<ReportGmailerrorredOutlinedIcon />}
                                                                    checkedIcon={<ReportIcon />}
                                                                    key={`priority-${task.id}`}
                                                                /> 
                                                                <Checkbox
                                                                    checked = {task.done ? true : false}
                                                                    onClick = {() => doneClick(area.id, taskIndex, task.id)}
                                                                    icon={<CheckCircleOutlineIcon />}
                                                                    checkedIcon={<CheckCircleIcon />}
                                                                    key={`done-${task.id}`}
                                                                /> 
                                                                <TextField variant="outlined"
                                                                            value={task.description || ''}
                                                                            name='description'
                                                                            onChange= { (event) => descriptionChange(event, area.id, taskIndex, task.id) }
                                                                            onKeyDown = {(event) => descriptionKeyDown(event, area.id, taskIndex, task.id)}
                                                                            onBlur = {(event) => descriptionOnBlur(event, area.id, taskIndex, task.id)}
                                                                            multiline
                                                                            autoComplete='off'
                                                                            sx = {{...(task.done === 1 && {textDecoration: 'line-through'}),}}
                                                                            size = 'small' 
                                                                            key={`description-${task.id}`}
                                                                 />
                                                                { task.id === '' ?
                                                                    <IconButton onClick={(event) => saveClick(event, area.id, taskIndex, task.id)} >
                                                                        <SavingsIcon/>
                                                                    </IconButton>
                                                                    :
                                                                    <IconButton onClick={(event) => deleteClick(event, area.id, task.id)} >
                                                                        <DeleteIcon/>
                                                                    </IconButton>
                                                                }
                                                            </Box>
                                                        ))
                                                    }
                                               </CardContent>
                                            </Card>
                                        ))}
                                    </Box>  
                                    }
                                </TabPanel>
                           )
                         }
                    </TabContext>
                </Box>
                <SnackBar snackBarOpen = {snackBarOpen} setSnackBarOpen = {setSnackBarOpen} snackBarMessage={snackBarMessage} />
                {/* Confirmation dialogs: at present follow same pattern. If don't become settings, refactor to 1 dialog w/props */}
                <DeleteDialog deleteDialogOpen = {deleteDialogOpen}
                              setDeleteDialogOpen = {setDeleteDialogOpen}
                              setDeleteId = {setDeleteId}
                              setDeleteConfirmed = {setDeleteConfirmed} />
                <CardSettingsDialog cardSettingsDialogOpen = {cardSettingsDialogOpen}
                                    setCardSettingsDialogOpen = {setCardSettingsDialogOpen}
                                    areaCloseId = {areaCloseId}
                                    setAreaCloseId = {setAreaCloseId}
                                    setAreaCloseConfirmed = {setAreaCloseConfirmed} />
                <DomainSettingsDialog tabSettingsDialogOpen = {tabSettingsDialogOpen}
                                    setTabSettingsDialogOpen = {setTabSettingsDialogOpen}
                                    domainCloseId = {domainCloseId}
                                    setDomainCloseId = {setDomainCloseId}
                                    setDomainCloseConfirmed = {setDomainCloseConfirmed} />
                </>
}
        </>
    );

} 

export default TaskCards;
