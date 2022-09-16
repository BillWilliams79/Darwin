import '../index.css';
import varDump from '../classifier/classifier';
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import {SnackBar, snackBarError} from '../Components/SnackBar/SnackBar';

import DomainCloseDialog from '../Components/DomainClose/DomainCloseDialog';
import DomainAddDialog from '../Components/DomainAdd/DomainAddDialog';
import AreaTabPanel from './AreaTabPanel';

import React, { useState, useEffect, useContext } from 'react';
import { Navigate } from "react-router-dom"

import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import Tab from '@mui/material/Tab';
import TabContext from '@material-ui/lab/TabContext';
import TabList from '@material-ui/lab/TabList';
import { CircularProgress, Tabs } from '@mui/material';

const TaskPlanView = () => {

    console.count('TaskCardContent rendered');

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    // Corresponds to crud_app.rest_api table for user, and UI/js index
    const [domainsArray, setDomainsArray] = useState()

    // changing this value triggers useState, re-reads all rest API data
    // misleading, but true or flase doesn't matter, just flip the value
    // and set it, the useState is executed
    const [domainApiTrigger, setDomainApiTrigger] = useState(false); 

    // Domain Tabs state
    const [activeTab, setActiveTab] = useState();

    // add domain dialog state
    const [domainAddDialogOpen, setDomainAddDialogOpen] = useState(false);
    const [domainAddConfirmed, setDomainAddConfirmed] = useState(false);
    const [newDomainInfo, setNewDomainInfo] = useState('');

    // domainSettings state
    const [domainCloseDialogOpen, setDomainCloseDialogOpen] = useState(false);
    const [domainCloseConfirmed, setDomainCloseConfirmed] = useState(false);
    const [domainCloseId, setDomainCloseId] = useState({});

    // snackBar state
    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');

    // READ domains API data for page
    useEffect( () => {

        console.count('useEffect: Read domains REST API data');

        let domainUri = `${darwinUri}/domains?creator_fk=${profile.userName}&closed=0&fields=id,domain_name`

        call_rest_api(domainUri, 'GET', '', idToken)
            .then(result => {
                // Tab bookeeping
                // TODO: store and retrieve in browswer persistent storage
                setActiveTab(0);
                setDomainsArray(result.data);
            }).catch(error => {
                snackBarError(error, 'Unable to read Domain info from database', setSnackBarMessage, setSnackBarOpen)
            });

    }, [domainApiTrigger, profile, idToken]);

    // CLOSE DOMAIN in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: close Domain');

        //TODO confirm areaCloseId is a valid object
        if (domainCloseConfirmed === true) {
            const { domainName, domainId, domainIndex  } = domainCloseId;

            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'PUT', [{'id': domainId, 'closed': 1}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // Domain set to close, remove area from Domain state
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray = newDomainsArray.filter(domain => domain.id !== domainId );
                        setDomainsArray(newDomainsArray);
                        if (parseInt(activeTab) === domainIndex ) {
                            // the current tab was displayed, reset activeTab to 0
                            setActiveTab(0);
                        }

                    } else {
                    snackBarError(result, `Unable to close ${domainName}`, setSnackBarMessage, setSnackBarOpen)

                    }
                }).catch(error => {
                    snackBarError(error, `Unable to close ${domainName}`, setSnackBarMessage, setSnackBarOpen)
            });
        }
        // prior to exit and regardless of outcome, clean up state
        setDomainCloseConfirmed(false);
        setDomainCloseId({});

    }, [domainCloseConfirmed])

    // ADD NEW DOMAIN in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: Add New Domain');

        //TODO confirm areaCloseId is a valid object
        if (domainAddConfirmed === true) {

            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'POST', {'creator_fk': profile.userName, 'domain_name': newDomainInfo, 'closed': 0}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // Domain set to close, remove area from Domain state
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray.push(result.data[0]);
                        setDomainsArray(newDomainsArray);

                    } else if (result.httpStatus.httpStatus === 201) {

                        // new domain created but db could not return new value, trigger API re-read, pop snackbar
                        setDomainApiTrigger(domainApiTrigger ? false : true);
                    } else {
                        snackBarError(result, `Unable to create ${newDomainInfo}`, setSnackBarMessage, setSnackBarOpen)
                    }
                }).catch(error => {
                    snackBarError(error, `Unable to create ${newDomainInfo}`, setSnackBarMessage, setSnackBarOpen)
            });
        }
        // prior to exit and regardless of outcome, clean up state
        setDomainAddConfirmed(false);
        setNewDomainInfo('');

    }, [domainAddConfirmed])

    const changeActiveTab = (event, newValue) => {
        // The tab with value 9999 is the add new tab button, hence no change
        if (newValue === 9999)
            return;
        setActiveTab(newValue);
    }

    const domainCloseClick = (event, domainName, domainId, domainIndex) => {
        // originates from the per tab close button.
        // Sets state and pops the dialog
        setDomainCloseId({ domainName, domainId, domainIndex });
        setDomainCloseDialogOpen(true);
    }

    const addDomain = (event) => {
        // open addDomain dialog
        setDomainAddDialogOpen(true);
     }

    return (
        <> 
        {domainsArray ?
            <>
            <Box className="app-content-planpage">
                <TabContext value={activeTab.toString()}>
                    <Box sx={{ borderBottom: 1, borderColor: 'divider' }}
                         className="app-content-tabs"
                    >
                        <Tabs value={activeTab.toString()}
                              onChange={changeActiveTab}
                              variant="scrollable"
                              scrollButtons="auto" >
                            {domainsArray.map( (domain, domainIndex) => 
                                <Tab key={domain.id}
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
                                              domainIndex = {domainIndex}>
                                </AreaTabPanel>
                            )
                        }
                </TabContext>
            </Box>
            <SnackBar {...{snackBarOpen,
                           setSnackBarOpen,
                           snackBarMessage,}} />
            <DomainCloseDialog {...{domainCloseDialogOpen,
                                    setDomainCloseDialogOpen,
                                    domainCloseId,
                                    setDomainCloseId,
                                    setDomainCloseConfirmed,}} />
            <DomainAddDialog {...{domainAddDialogOpen,
                                  setDomainAddDialogOpen,
                                  newDomainInfo,
                                  setNewDomainInfo,
                                  setDomainAddConfirmed,}} />
            </>
            :
            <CircularProgress/>
        }
        </>
    );

} 

export default TaskPlanView;
