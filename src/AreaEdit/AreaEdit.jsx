import '../index.css';
import varDump from '../classifier/classifier';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useWorkingDomainStore } from '../stores/useWorkingDomainStore';
import { useDomains } from '../hooks/useDataQueries';
import { domainKeys } from '../hooks/useQueryKeys';
import DomainCloseDialog from '../Components/DomainClose/DomainCloseDialog';
import DomainAddDialog from '../Components/DomainAdd/DomainAddDialog';

import React, { useState, useEffect, useContext } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import Box from '@mui/material/Box';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { Tabs } from '@mui/material';
import Tab from '@mui/material/Tab';
import { Typography } from '@mui/material';
import AreaEditTabPanel from './AreaEditTabPanel';

const AreaEdit = () => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [domainsArray, setDomainsArray] = useState()

    // Domain Tabs state
    const [activeTab, setActiveTab] = useState();

    const showError = useSnackBarStore(s => s.showError);
    const getWorkingDomain = useWorkingDomainStore(s => s.getWorkingDomain);
    const setWorkingDomain = useWorkingDomainStore(s => s.setWorkingDomain);

    // TanStack Query — fetch open domains
    const { data: serverDomains } = useDomains(profile?.userName, { closed: 0 });

    // Seed local state from query data
    useEffect(() => {
        if (serverDomains) {
            const sorted = [...serverDomains];
            sorted.sort((a, b) => {
                if (a.sort_order === null && b.sort_order === null) return 0;
                if (a.sort_order === null) return 1;
                if (b.sort_order === null) return -1;
                return a.sort_order - b.sort_order;
            });

            // Restore working domain from localStorage, fall back to first tab
            const storedId = getWorkingDomain();
            let initialTab = 0;
            if (storedId) {
                const idx = sorted.findIndex(d => String(d.id) === storedId);
                if (idx >= 0) initialTab = idx;
            }
            setActiveTab(initialTab);
            setDomainsArray(sorted);
        }
    }, [serverDomains]);

    const domainClose = useConfirmDialog({
        onConfirm: ({ domainId, domainIndex }) => {
            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'PUT', [{'id': domainId, 'closed': 1, 'sort_order': 'NULL'}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray = newDomainsArray.filter(domain => domain.id !== domainId );
                        setDomainsArray(newDomainsArray);
                        if (parseInt(activeTab) === domainIndex ) {
                            setActiveTab(0);
                        }
                        queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
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
            call_rest_api(uri, 'POST', {'domain_name': newDomainName, 'closed': 0, 'sort_order': domainsArray.length}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newDomainsArray = [...domainsArray];
                        newDomainsArray.push(result.data[0]);
                        setDomainsArray(newDomainsArray);
                        queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
                    } else if (result.httpStatus.httpStatus === 204) {
                        queryClient.invalidateQueries({ queryKey: domainKeys.all(profile.userName) });
                    } else {
                        showError(result, `Unable to save new domain ${newDomainName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to save new domain ${newDomainName}`)
                });
        },
        defaultInfo: ''
    });

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
