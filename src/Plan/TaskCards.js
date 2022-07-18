import '../index.css';
import varDump from '../classifier/classifier';
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import SnackBar from './SnackBar';
import DeleteDialog from './DeleteDialog';
 
import React, { useState, useEffect, useContext } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import Checkbox from '@mui/material/Checkbox';
import TextareaAutosize from '@mui/material/TextareaAutosize';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import ReportIcon from '@mui/icons-material/Report';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

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

    // useEffect retrieves and sets initial
    useEffect( () => {
        // TODO: creator_fk must by dynamically set based on logged in user.
        console.count('data access useEffect called');

        // Fetch domains
        let domainUri = `${darwinUri}/domains?creator_fk=1`

        call_rest_api(domainUri, 'GET', '', idToken)
            .then(result => {
                setDomainsArray(result.data);
                // Tabs bookeeping
                setActiveTab(0);
            }).catch(error => {
                 varDump(error, 'error state for retrieve table data');
            });

        // Fetch Areas
        let areaUri = `${darwinUri}/areas?creator_fk=1`

        call_rest_api(areaUri, 'GET', '', idToken)
            .then(result => {
                setAreasArray(result.data);
                // create object with an array per area based on its area.id
                var sortedTasksObject = {};
                result.data.map( area => sortedTasksObject[area.id] = []);

                // Fetch Tasks
                let taskUri = `${darwinUri}/tasks?creator_fk=1`
                call_rest_api(taskUri, 'GET', '', idToken)
                    .then(result => {
                        // sort tasks into area arrays (this enable bookeeping/indexing for the cards)
                        result.data.map( (task) => sortedTasksObject[task.area_fk].push(task))
                        // TODO: INSERT BLANK OBJECT for creating new tasks...
                        setTasksArray(sortedTasksObject);
                    }).catch(error => {
                         varDump(error, 'error state for retrieve table data');
                    });
            }).catch(error => {
                 varDump(error, 'error state for retrieve table data');
            });
    }, [readRestApi]);

    useEffect( () => {
        console.count('task delete useEffect called');

        //TODO confirm deleteId is a valid object
        if (deleteConfirmed === true) {
            const {areaId, taskIndex, taskId} = deleteId;

            let uri = `${darwinUri}/tasks?id=${taskId}`;
            call_rest_api(uri, 'DELETE', {'id': taskId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // database task was deleted, update taskArray, pop snackbar, cleanup delete dialog
                        let newTasksArray = {...tasksArray}
                        newTasksArray[areaId] = newTasksArray[areaId].filter(task => task.id !== taskId );
                        setTasksArray(newTasksArray);
                        setSnackBarMessage('Task Deleted Successfully');
                        setSnackBarOpen(true);
                        setDeleteConfirmed(false);
                        setDeleteId({});
                    }
                    varDump(result.httpStatus.httpStatus, 'update based on description change result data');
                }).catch(error => {
                    varDump(error, 'error state for retrieve table data');
                });
        }

    }, [deleteConfirmed])


    const changeActiveTab = (event, newValue) => {
        setActiveTab(newValue);
    };

    const priorityClick = (areaId, taskIndex, taskId) => {

        // invert the current priority value, write changes to database and update state
        let newTasksArray = {...tasksArray}
        newTasksArray[areaId][taskIndex].priority = newTasksArray[areaId][taskIndex].priority ? 0 : 1;
        let uri = `${darwinUri}/tasks?id=${taskId}`;
        call_rest_api(uri, 'POST', {'id': taskId, 'priority': newTasksArray[areaId][taskIndex].priority}, idToken);
        setTasksArray(newTasksArray);
    }

    const doneClick = (areaId, taskIndex, taskId) => {

        // invert the current done value, write changes to database and update state
        let newTasksArray = {...tasksArray}
        newTasksArray[areaId][taskIndex].done = newTasksArray[areaId][taskIndex].done ? 0 : 1;
        let uri = `${darwinUri}/tasks?id=${taskId}`;

        // toISOString converts to the SQL expected format and UTC from local time. They think of everything
        call_rest_api(uri, 'POST', {'id': taskId, 'done': newTasksArray[areaId][taskIndex].done,
            ...(newTasksArray[areaId][taskIndex].done === 1 ? {'done_ts': new Date().toISOString()} : {'done_ts': 'NULL'})}, idToken);
        setTasksArray(newTasksArray);
    }
    
    const descriptionChange = (event, areaId, taskIndex, taskId) => {

        // event.target.value contains the new text from description which is retained in state
        // updated changes are written to rest API elsewhere (keyup for example)
        let newTasksArray = {...tasksArray}
        newTasksArray[areaId][taskIndex].description = event.target.value;
        setTasksArray(newTasksArray);
    }

    const descriptionKeyDown = (event, areaId, taskIndex, taskId) => {
        if ((event.key === 'Enter') ||
            (event.key === 'Tab')) {
            let uri = `${darwinUri}/tasks?id=${taskId}`;
            call_rest_api(uri, 'POST', {'id': taskId, 'description': tasksArray[areaId][taskIndex].description}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        // database value is changed only with a 200 response
                        // so only then show snackbar
                        setSnackBarMessage('Task Updated Successfully');
                        setSnackBarOpen(true);
                    }
                    varDump(result.httpStatus.httpStatus, 'update based on description change result data');
                }).catch(error => {
                    varDump(error, 'error state for retrieve table data');
                });
        }

        // we don't want the Enter key to be part of the text
        if (event.key === 'Enter') {
            event.preventDefault();
        }

    }

    const deleteClick = (event, areaId, taskIndex, taskId) => {
        setDeleteId({areaId, taskIndex, taskId});
        setDeleteDialogOpen(true);
    }

    return (
        <>
            { domainsArray &&
                <>
                <Box sx={{ width: '100vw', typography: 'body1'  }}>
                    <TabContext value={activeTab.toString()}>
                        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                            <TabList onChange={changeActiveTab}>
                                {domainsArray.map( (domain, domainIndex) => 
                                    <Tab key={domainIndex} 
                                         label={domain.domain_name} 
                                         value={domainIndex.toString()} />
                                )}
                            </TabList>
                        </Box>
                         { domainsArray.map( (domain, domainIndex) => 
                            <TabPanel key={domainIndex} value={domainIndex.toString()} >
                                {areasArray && 
                                    <Box className="card">
                                        { areasArray.filter(area => area.domain_fk === domain.id)
                                            .map((area, areaIndex) => (
                                            <Card key={areaIndex} raised={true}>
                                                <CardContent>
                                                    <Typography gutterBottom variant="h5" component="div" key={area.id}>
                                                        {area.area_name}
                                                    </Typography>
                                                    { tasksArray &&
                                                        tasksArray[area.id].filter(task => task.area_fk === area.id)
                                                            .map((task, taskIndex) => (
                                                            <Box className="task">
                                                                <Checkbox
                                                                    checked = {task.priority ? true : false}
                                                                    onClick = {() => priorityClick(area.id, taskIndex, task.id)}
                                                                    icon={<ReportGmailerrorredOutlinedIcon />}
                                                                    checkedIcon={<ReportIcon />}
                                                                /> 
                                                                <Checkbox
                                                                    checked = {task.done ? true : false}
                                                                    onClick = {() => doneClick(area.id, taskIndex, task.id)}
                                                                    icon={<CheckCircleOutlineIcon />}
                                                                    checkedIcon={<CheckCircleIcon />}
                                                                /> 
                                                                <TextField variant="outlined"
                                                                            multiline
                                                                            key={`description-${task.id}`}
                                                                            name='description'
                                                                            value={task.description || ''}
                                                                            autoComplete='off'
                                                                            sx = {{...(task.done === 1 && {textDecoration: 'line-through'}),}}
                                                                            /*disabled= { (columnName === 'id') ? true : false }*/
                                                                            onChange= { (event) => descriptionChange(event, area.id, taskIndex, task.id) }
                                                                            onKeyDown = {(event) => descriptionKeyDown(event, area.id, taskIndex, task.id)}
                                                                            size = 'small' />
                                                                <IconButton onClick={(event) => deleteClick(event, area.id, taskIndex, task.id)} >
                                                                    <DeleteIcon/>
                                                                </IconButton>
             
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
                <DeleteDialog deleteDialogOpen = {deleteDialogOpen}
                              setDeleteDialogOpen = {setDeleteDialogOpen}
                              setDeleteId = {setDeleteId}
                              setDeleteConfirmed = {setDeleteConfirmed} />
                </>
            }
        </>
    );

} 

export default TaskCards;
