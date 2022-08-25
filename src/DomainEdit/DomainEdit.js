import React, {useState, useContext, useEffect} from 'react';
import {SnackBar, snackBarError} from '../Components/SnackBar/SnackBar';

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
import { Checkbox, Typography } from '@mui/material';
import { TextField } from '@mui/material';

import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import DomainDeleteDialog from './DomainDeleteDialog';

const DomainEdit = ( { domain, domainIndex } ) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [domainsArray, setDomainsArray] = useState()
    const [domainApiTrigger, setDomainApiTrigger] = useState(false); 
    
    const [areaCounts, setAreaCounts] = useState({});

    // snackBar state
    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');

    // cardSettings state
    const [domainDeleteDialogOpen, setDomainDeleteDialogOpen] = useState(false);
    const [domainDeleteConfirmed, setDomainDeleteConfirmed] = useState(false);
    const [domainInfo, setDomainInfo] = useState({});

    // READ domains API data for page
    useEffect( () => {

        console.count('useEffect: Read domains REST API data');

        // FETCH DOMAINS
        // QSPs limit fields to minimum: id,domain_name
        let domainUri = `${darwinUri}/domains?creator_fk=${profile.userName}&fields=id,domain_name,closed`

        call_rest_api(domainUri, 'GET', '', idToken)
            .then(result => {

                // retrieve counts from rest API using &fields=count(*), group_by_field syntax
                let uri = `${darwinUri}/areas?creator_fk=${profile.userName}&fields=count(*),domain_fk`;
                call_rest_api(uri, 'GET', '', idToken)
                    .then(result => {
                        // count(*) returns an array of dict with format {group_by_field, count(*)}
                        // reformat to dictionary: taskcounts.area_fk = count(*)
                        let newAreaCounts = {};
                        result.data.map( (countData) => {
                            newAreaCounts[countData.domain_fk] = countData['count(*)']; 
                        })

                        setAreaCounts(newAreaCounts);
        
                    }).catch(error => {
                        varDump(error, `UseEffect: error retrieving task counts: ${error}`);
                    });
                let newDomainArray = result.data;
                newDomainArray.sort((domainA, domainB) => domainClosedSort(domainA, domainB));
                newDomainArray.push({'id':'', 'domain_name':'', 'closed': 0, 'creator_fk': profile.userName });
                setDomainsArray(result.data);
            }).catch(error => {
                varDump(error, `UseEffect: error retrieving Domains: ${error}`);
            });

    }, [domainApiTrigger]);

    // DELETE DOMAIN in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: delete domain');

        if (domainDeleteConfirmed === true) {
            const {domainName, domainId } = domainInfo;

            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'DELETE', {'id': domainId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // database domain was deleted, update domainArray, pop snackbar, cleanup delete dialog
                        let newDomainsArray = [...domainsArray]
                        newDomainsArray = newDomainsArray.filter(domain => domain.id !== domainId );
                        setDomainsArray(newDomainsArray);
                    } else {
                        snackBarError(result, 'Unable to delete domain', setSnackBarMessage, setSnackBarOpen)
                    }
                }).catch(error => {
                    snackBarError(error, 'Unable to delete domain', setSnackBarMessage, setSnackBarOpen)
                });
        }
        // prior to exit and regardless of outcome, clean up state
        setDomainDeleteConfirmed(false);
        setDomainInfo({});

    }, [domainDeleteConfirmed])    

    const changeDomainName = (event, domainIndex) => {

        // event.target.value contains the new domain text
        // updated changes are written to rest API elsewhere (keyup for example)
        let newDomainsArray = [...domainsArray]
        newDomainsArray[domainIndex].domain_name = event.target.value;
        setDomainsArray(newDomainsArray);
    }

    const keyDownDomainName = (event, domainIndex, domainId) => {
        console.log('keyDownDomainName')
 
        // Enter key triggers save, but Enter itself cannot be part of area.description hence preventDefault
        if (event.key === 'Enter') {
            restUpdateDomainName(domainIndex, domainId);
            event.preventDefault();
        }
    }

    const blurDomainName= (event, domainIndex, domainId) => {
        console.log('blurDomainName')

        restUpdateDomainName(domainIndex, domainId);
    }

    const restUpdateDomainName = (domainIndex, domainId) => {

        const noop = ()=>{};

        // new domain with no description, noop
        if ((domainId === '') &&
            (domainsArray[domainIndex].domain_name === '')) {
            noop();

        } else {
            // blank domainId indicates we are creating a new domain rather than updating existing
            if (domainId === '') {
                restSaveDomainName(domainIndex)
            } else {
                let uri = `${darwinUri}/domains`;
                call_rest_api(uri, 'POST', [{'id': domainId, 'domain_name': domainsArray[domainIndex].domain_name}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 201) {
                            // database value is changed only with a 200 response
                            // so only then show snackbar
                            snackBarError(result, 'Unable to update domain name', setSnackBarMessage, setSnackBarOpen)

                        }
                    }).catch(error => {
                        snackBarError(error, 'Unable to update domain name', setSnackBarMessage, setSnackBarOpen)
                    });
            }
        }
    }

    const restSaveDomainName = (domainIndex) => {

        let uri = `${darwinUri}/domains`;

        call_rest_api(uri, 'PUT', {...domainsArray[domainIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    // 200 => record added to database and returned in body
                    // show snackbar, place new data in table and created another blank element

                    let newDomainsArray = [...domainsArray];
                    newDomainsArray[domainIndex] = {...result.data[0]};
                    newDomainsArray.sort((domainA, domainB) => domainClosedSort(domainA, domainB));
                    newDomainsArray.push({'id':'', 'domain_name':'', 'closed': 0, 'creator_fk': profile.userName });
                    setDomainsArray(newDomainsArray);

                    // update the areaCounts data
                    let newAreaCounts = {...areaCounts};
                    newAreaCounts[result.data[0].id] = 0;
                    setAreaCounts(newAreaCounts);

                } else if (result.httpStatus.httpStatus === 201) {
                    // 201 => record added to database but new data not returned in body
                    // show snackbar and flip read_rest_api state to initiate full data retrieval
                    setDomainApiTrigger(domainApiTrigger ? false : true);  
                } else {
                    snackBarError(result, 'Unable to update domain', setSnackBarMessage, setSnackBarOpen)
                }
            }).catch(error => {
                snackBarError(error, 'Unable to update domain', setSnackBarMessage, setSnackBarOpen)
            });
    }

    const clickDomainClosed = (event, domainIndex, domainId) => {

        // invert closed, re-sort domain array for the card, update state.
        let newDomainsArray = [...domainsArray]
        newDomainsArray[domainIndex].closed = newDomainsArray[domainIndex].closed ? 0 : 1;

        // for domains already in the db, update db
        if (domainId !== '') {
            let uri = `${darwinUri}/domains`;
            call_rest_api(uri, 'POST', [{'id': domainId, 'closed': newDomainsArray[domainIndex].closed}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200) {
                        snackBarError(result, 'Unable to close domain', setSnackBarMessage, setSnackBarOpen)
                    }
                }).catch(error => {
                    snackBarError(error, 'Unable to close domain', setSnackBarMessage, setSnackBarOpen)
                }
            );
        }
        
        // Only after database is updated, sort domains and update state
        newDomainsArray.sort((domainA, domainB) => domainClosedSort(domainA, domainB));
        setDomainsArray(newDomainsArray);        
    }

    const clickDomainDelete = (event, domainId, domainName) => {

        // store domain details in state for use in deleting if confirmed
        setDomainInfo({ domainName, domainId, areasCount: areaCounts[domainId] });
        setDomainDeleteDialogOpen(true);
    }

    const domainClosedSort = (domainA, domainB) => {
        // leave blank domain in place at bottom of list
        if (domainA.id === '') return 0;
        if (domainB.id === '') return -1;

        if (domainA.closed === domainB.closed) {
            return 0;
        } else if (domainA.closed > domainB.closed) {
            return 1;
        } else {
            return -1;
        }
    }

   
    return (
        <>
            <Box className="app-title">
                <Typography variant="h4" sx={{ml:2}}>
                    Domains Editor
                </Typography>
            </Box>
            { domainsArray && 
                <Box className="app-edit" sx={{ml:2}}>
                    <Table size='small'>
                        <TableHead>
                            <TableRow key = 'TableHead'>
                                <TableCell> Name </TableCell>
                                <TableCell> Closed </TableCell>
                                <TableCell> Area Count </TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                        { domainsArray.map((domain, domainIndex) => (
                            <TableRow key={domain.id}>
                                <TableCell> 
                                    <TextField variant="outlined"
                                               value={domain.domain_name || ''}
                                               name='domain-name'
                                               onChange= { (event) => changeDomainName(event, domainIndex) }
                                               onKeyDown = {(event) => keyDownDomainName(event, domainIndex, domain.id)}
                                               onBlur = {(event) => blurDomainName(event, domainIndex, domain.id)}
                                               autoComplete='off'
                                               size = 'small'
                                               inputProps={{ maxLength: 32 }}
                                               key={`name-${domain.id}`}
                                     />                                    
                                </TableCell>
                                <TableCell> 
                                    <Checkbox checked = {(domain.closed === 1) ? true : false }
                                              onClick = {(event) => clickDomainClosed(event, domainIndex, domain.id) }
                                              key={`checked-${domain.id}`}
                                    />
                                </TableCell>
                                <TableCell> {/* triple ternary checks all cases and display correct value */}
                                    <Typography variant='body1' sx={{textAlign: 'center'}}>
                                    {  domain.id === '' ? '' :
                                        areaCounts[`${domain.id}`] === undefined ? 0 :
                                          areaCounts[`${domain.id}`] === '' ? '' : areaCounts[`${domain.id}`] }
                                     </Typography>
                                </TableCell>
                                <TableCell>
                                    { domain.id === '' ?
                                        <IconButton >
                                            <SavingsIcon />
                                        </IconButton>
                                        :
                                        <IconButton  onClick={(event) => clickDomainDelete(event, domain.id, domain.domain_name)} >
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
            <SnackBar {...{snackBarOpen,
                           setSnackBarOpen,
                           snackBarMessage,}} />
            <DomainDeleteDialog 
                domainDeleteDialogOpen = { domainDeleteDialogOpen }
                setDomainDeleteDialogOpen = { setDomainDeleteDialogOpen }
                domainInfo = { domainInfo }
                setDomainInfo = { setDomainInfo }
                setDomainDeleteConfirmed = { setDomainDeleteConfirmed }
            />
        </>
    )
}

export default DomainEdit