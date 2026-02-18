import '../index.css';
import varDump from '../classifier/classifier';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useWorkingDomainStore } from '../stores/useWorkingDomainStore';
import { useApiTrigger } from '../hooks/useApiTrigger';
import DomainCloseDialog from '../Components/DomainClose/DomainCloseDialog';
import DomainAddDialog from '../Components/DomainAdd/DomainAddDialog';

import React, { useState, useEffect, useContext } from 'react';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { Tabs } from '@mui/material';
import Tab from '@mui/material/Tab';
import { Typography } from '@mui/material';
import AreaEditTabPanel from './AreaEditTabPanel';

const AreaEdit = () => {

    console.count('AreaEdit rendered');

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    // Corresponds to crud_app.rest_api table for user, and UI/js index
    const [domainsArray, setDomainsArray] = useState()

    // changing this value triggers useState, re-reads all rest API data
    // misleading, but true or flase doesn't matter, just flip the value
    // and set it, the useState is executed
    const [domainApiTrigger, triggerDomainRefresh] = useApiTrigger();

    // Domain Tabs state
    const [activeTab, setActiveTab] = useState();

    const showError = useSnackBarStore(s => s.showError);
    const getWorkingDomain = useWorkingDomainStore(s => s.getWorkingDomain);
    const setWorkingDomain = useWorkingDomainStore(s => s.setWorkingDomain);

    const domainClose = useConfirmDialog({
        onConfirm: ({ domainId, domainIndex }) => {
            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'PUT', [{'id': domainId, 'closed': 1}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray = newDomainsArray.filter(domain => domain.id !== domainId );
                        setDomainsArray(newDomainsArray);
                        if (parseInt(activeTab) === domainIndex ) {
                            setActiveTab(0);
                        }
                    } else {
                        showError(result, 'Unable to close domain')
                    }
                }).catch(error => {
                    showError(error, 'Unable to close domain')
                });
        }
    });

    const domainAdd = useConfirmDialog({
        onConfirm: (newDomainName) => {
            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'POST', {'creator_fk': profile.userName, 'domain_name': newDomainName, 'closed': 0}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray.push(result.data[0]);
                        setDomainsArray(newDomainsArray);
                    } else if (result.httpStatus.httpStatus === 204) {
                        triggerDomainRefresh();
                    } else {
                        showError(result, `Unable to save new domain ${newDomainName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to save new domain ${newDomainName}`)
                });
        },
        defaultInfo: ''
    });

    // READ domains API data for page
    useEffect( () => {

        console.count('useEffect: Read domains REST API data');

        // FETCH DOMAINS
        // QSPs limit fields to minimum: id,domain_name
        let domainUri = `${darwinUri}/domains?creator_fk=${profile.userName}&closed=0&fields=id,domain_name`

        call_rest_api(domainUri, 'GET', '', idToken)
            .then(result => {
                // Restore working domain from localStorage, fall back to first tab
                const storedId = getWorkingDomain();
                let initialTab = 0;
                if (storedId) {
                    const idx = result.data.findIndex(d => String(d.id) === storedId);
                    if (idx >= 0) initialTab = idx;
                }
                setActiveTab(initialTab);
                setDomainsArray(result.data);
            }).catch(error => {
                varDump(error, `UseEffect: error retrieving Domains: ${error}`);
            });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [domainApiTrigger]);

    // Persist working domain whenever active tab changes
    useEffect(() => {
        if (domainsArray && domainsArray.length > 0) {
            const tabIndex = parseInt(activeTab);
            if (tabIndex >= 0 && tabIndex < domainsArray.length) {
                setWorkingDomain(domainsArray[tabIndex].id);
            }
        }
    }, [activeTab, domainsArray]);

    const changeActiveTab = (event, newValue) => {
        // The tab with value 9999 is the add new tab button, hence no change
        if (newValue === 9999)
            return;
        setActiveTab(newValue);
    }

    const domainCloseClick = (event, domainName, domainId, domainIndex) => {
        domainClose.openDialog({ domainName, domainId, domainIndex });
    }

    const addDomain = (event) => {
        domainAdd.openDialog();
     }

    return (
        <>
            <Box className="app-title">
                <Typography variant="h4" sx={{ml:2}}>
                    Areas Editor
                </Typography>
            </Box>
            { domainsArray &&
                <>
                    <Box className="app-edit" sx={{ml:2}}>
                        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                            <Tabs value={activeTab.toString()}
                                  onChange={changeActiveTab}
                                  variant="scrollable"
                                  scrollButtons="auto" >
                                { domainsArray.map( (domain, domainIndex) =>
                                    <Tab key={domain.id}
                                         icon={<CloseIcon onClick={(event) => domainCloseClick(event, domain.domain_name, domain.id, domainIndex)}/>}
                                         label={domain.domain_name}
                                         value={domainIndex.toString()}
                                         iconPosition="end" />
                                )}
                                <Tab key={9999}
                                     icon={<AddIcon onClick={addDomain}/>}
                                     iconPosition="start"
                                     value={9999} /* used in changeActiveTab */ />
                            </Tabs>
                        </Box>
                            { domainsArray.map( (domain, domainIndex) =>
                                <AreaEditTabPanel key={domain.id}
                                                  domain = {domain}
                                                  domainIndex = {domainIndex}
                                                  activeTab = {activeTab} />
                            )}
                    </Box>
                    <DomainCloseDialog domainCloseDialogOpen={domainClose.dialogOpen}
                                       setDomainCloseDialogOpen={domainClose.setDialogOpen}
                                       domainCloseId={domainClose.infoObject}
                                       setDomainCloseId={domainClose.setInfoObject}
                                       setDomainCloseConfirmed={domainClose.setConfirmed} />
                    <DomainAddDialog domainAddDialogOpen={domainAdd.dialogOpen}
                                     setDomainAddDialogOpen={domainAdd.setDialogOpen}
                                     newDomainInfo={domainAdd.infoObject}
                                     setNewDomainInfo={domainAdd.setInfoObject}
                                     setDomainAddConfirmed={domainAdd.setConfirmed} />
                </>
            }
        </>
    );
}

export default AreaEdit;
