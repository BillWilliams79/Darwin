import '../index.css';
import varDump from '../classifier/classifier';
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import {SnackBar, snackBarError} from '../Components/SnackBar/SnackBar';

import React, { useState, useEffect, useContext } from 'react';
import { Navigate } from "react-router-dom"

import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import Tab from '@mui/material/Tab';
import TabContext from '@material-ui/lab/TabContext';
import TabList from '@material-ui/lab/TabList';
import { CircularProgress, Tabs } from '@mui/material';
import DroidTabPanel from './DroidTabPanel';

const DroidView = () => {

    console.count('DroidView rendered');

    const { droidProfile } = useContext(AuthContext);
    const { droidsUri } = useContext(AppContext);

    // Corresponds to crud_app.rest_api table for user, and UI/js index
    const [droidsArray, setDroidsArray] = useState()

    // changing this value triggers useState, re-reads all rest API data
    // misleading, but true or flase doesn't matter, just flip the value
    // and set it, the useState is executed
    const [droidApiTrigger, setDroidApiTrigger] = useState(false); 

    // Domain Tabs state
    const [activeTab, setActiveTab] = useState();

    // snackBar state
    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');

    // READ droids data
    useEffect( () => {

        console.count('useEffect: Read droids REST API data');

        let Uri = `${droidsUri}/droids?creator_fk=${droidProfile}`

        call_rest_api(Uri, 'GET', '', null)
            .then(result => {
                // Tab bookeeping
                // TODO: store and retrieve in browswer persistent storage
                setActiveTab(0);
                setDroidsArray(result.data);
            }).catch(error => {
                snackBarError(error, 'Unable to read Domain info from database', setSnackBarMessage, setSnackBarOpen)
            });

    }, [droidApiTrigger, droidProfile]);


    const changeActiveTab = (event, newValue) => {
        // The tab with value 9999 is the add new tab button, hence no change
        setActiveTab(newValue);
    }

    return (
        <> 
        {droidsArray ?
            <>
            <Box className="app-content-planpage">
                <TabContext value={activeTab.toString()}>
                    <Box sx={{ borderBottom: 1, borderColor: 'divider' }}
                         className="app-content-tabs"
                    >
                        <Tabs value={activeTab.toString()}
                              onChange={changeActiveTab}
                              variant="scrollable"
                              scrollButtons="auto" 
                        >
                            {droidsArray.map( (droid, droidIndex) => 
                                <Tab key={droid.id}
                                     label={droid.name} 
                                     value={droidIndex.toString()}
                                />
                            )}
                        </Tabs>
                    </Box>
                        { droidsArray.map( (droid, droidIndex) =>
                             <DroidTabPanel key={droid.id}
                                            droid = {droid}
                                            droidIndex = {droidIndex}
                             />
                          )
                        }
                </TabContext>
            </Box>
            <SnackBar {...{snackBarOpen,
                           setSnackBarOpen,
                           snackBarMessage,}} />
            </>
            :
            <CircularProgress/>
        }
        </>
    );

} 

export default DroidView;
