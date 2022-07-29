import '../index.css';
import varDump from '../classifier/classifier';
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';

import call_rest_api from '../RestApi/RestApi';
import SnackBar from './SnackBar';
import CardSettingsDialog from './CardSettingsDialog';
import DomainSettingsDialog from './DomainSettingsDialog';
import AddDomainDialog from './AddDomainDialog';
import AreaTabPanel from './AreaTabPanel';

import React, { useState, useEffect, useContext } from 'react';

import Box from '@mui/material/Box';

import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';

import Tab from '@mui/material/Tab';
import TabContext from '@material-ui/lab/TabContext';
import TabList from '@material-ui/lab/TabList';

const TaskCardContent = () => {

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

    // snackBar state
    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');

    // add domain dialog state
    const [addDomainDialogOpen, setAddDomainDialogOpen] = useState(false);
    const [addDomainConfirmed, setAddDomainConfirmed] = useState(false);
    const [newDomainInfo, setNewDomainInfo] = useState({});

    // domainSettings state
    const [tabSettingsDialogOpen, setTabSettingsDialogOpen] = useState(false);
    const [domainCloseConfirmed, setDomainCloseConfirmed] = useState(false);
    const [domainCloseId, setDomainCloseId] = useState({});

    // READ domains API data for page
    useEffect( () => {

        console.count('useEffect: Read domains REST API data');

        // FETCH DOMAINS
        // QSPs limit fields to minimum: id,domain_name
        let domainUri = `${darwinUri}/domains?creator_fk=${profile.userName}&closed=0&fields=id,domain_name`

        call_rest_api(domainUri, 'GET', '', idToken)
            .then(result => {
                // Tab bookeeping
                // TODO: store and retrieve in browswer persistent storage
                setActiveTab(0);
                setDomainsArray(result.data);
            }).catch(error => {
                varDump(error, `UseEffect: error retrieving Domains: ${error}`);
            });

    }, [domainApiTrigger]);

    // CLOSE DOMAIN in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: close Domain');

        //TODO confirm areaCloseId is a valid object
        if (domainCloseConfirmed === true) {
            const { domainName, domainId, domainIndex  } = domainCloseId;

            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'POST', {'id': domainId, 'closed': 1}, idToken)
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

    // ADD NEW DOMAIN in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: Add New Domain');

        //TODO confirm areaCloseId is a valid object
        if (addDomainConfirmed === true) {

            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'PUT', {'creator_fk': profile.userName, 'domain_name': newDomainInfo, 'closed': 0}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // Domain set to close, remove area from Domain state
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray.push(result.data[0]);
                        setDomainsArray(newDomainsArray);

                        setSnackBarMessage(`${newDomainInfo} Created Successfully`);
                        setSnackBarOpen(true);

                    } else if (result.httpStatus.httpStatus === 201) {

                        // new domain created but db could not return new value, trigger API re-read, pop snackbar
                        setDomainApiTrigger(domainApiTrigger ? false : true);
                        setSnackBarMessage(`${newDomainInfo} Created Successfully`);
                        setSnackBarOpen(true);
                    } else {
                        console.log(`Error: unable to create ${newDomainInfo} : ${result.httpStatus.httpStatus}`);
                        setSnackBarMessage(`Unable to create ${newDomainInfo} : ${result.httpStatus.httpStatus}`);
                        setSnackBarOpen(true);
                    }
                }).catch(error => {
                    console.log(`Error: unable to create ${newDomainInfo} : ${error}`);
                    setSnackBarMessage(`Unable to create ${newDomainInfo} : ${error}`);
                    setSnackBarOpen(true);
            });
        }
        // prior to exit and regardless of outcome, clean up state
        setAddDomainConfirmed(false);
        setNewDomainInfo();

    }, [addDomainConfirmed])

    const changeActiveTab = (event, newValue) => {
        // The tab with value 9999 is the add new tab button, hence no change
        if (newValue === 9999)
            return;
        setActiveTab(newValue);
    }

    const domainCloseClick = (event, domainName, domainId, domainIndex) => {
        // stores data re: card to close, opens dialog
        varDump(domainName, 'should be domain name')
        setDomainCloseId({ domainName, domainId, domainIndex });
        setTabSettingsDialogOpen(true);
    }

    const addDomain = (event) => {
        // open addDomain dialog
        setAddDomainDialogOpen(true);
     }

    return (
        <>
            { domainsArray &&
                <>
                <Box sx={{ typography: 'body1'  }}>
                    <TabContext value={activeTab.toString()}>
                        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                            <TabList  onChange={changeActiveTab} >
                                {domainsArray.map( (domain, domainIndex) => 
                                    <Tab key={domain.id}
                                         icon={<CloseIcon onClick={(event) => domainCloseClick(event, domain.domain_name, domain.id, domainIndex)}/>}
                                         label={domain.domain_name} 
                                         value={domainIndex.toString()}
                                         iconPosition="end"
                                         />
                                )}
                                <Tab key={'close-buton'}
                                     icon={<AddIcon onClick={addDomain}/>}
                                     iconPosition="start"
                                     value={9999} // this value is used in changeActiveTab()
                                />
                            </TabList>
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
                <SnackBar snackBarOpen = {snackBarOpen} setSnackBarOpen = {setSnackBarOpen} snackBarMessage={snackBarMessage} />
                <DomainSettingsDialog tabSettingsDialogOpen = {tabSettingsDialogOpen}
                                    setTabSettingsDialogOpen = {setTabSettingsDialogOpen}
                                    domainCloseId = {domainCloseId}
                                    setDomainCloseId = {setDomainCloseId}
                                    setDomainCloseConfirmed = {setDomainCloseConfirmed} />
                <AddDomainDialog addDomainDialogOpen = {addDomainDialogOpen}
                                 setAddDomainDialogOpen = {setAddDomainDialogOpen}
                                 newDomainInfo = {newDomainInfo}
                                 setNewDomainInfo = {setNewDomainInfo}
                                 setAddDomainConfirmed = {setAddDomainConfirmed}
                                 setDomainCloseConfirmed = {setDomainCloseConfirmed} />

                </>
        }
        </>
    );

} 

export default TaskCardContent;
