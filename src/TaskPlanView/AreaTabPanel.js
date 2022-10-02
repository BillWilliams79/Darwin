// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, {useState, useContext, useEffect} from 'react';
import call_rest_api from '../RestApi/RestApi';
import TaskCard from './TaskCard';
import {SnackBar, snackBarError} from '../Components/SnackBar/SnackBar';

import CardCloseDialog from '../Components/CardClose/CardCloseDialog';

import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';

import { Box } from '@mui/system';
import { TabPanel } from '@material-ui/lab';

const AreaTabPanel = ( { domain, domainIndex } ) => {

    // Tab Panel contains all the taskcards for a given domain
    // Parent is TaskCardContent. Children are TaskCards

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [areasArray, setAreasArray] = useState()
    const [areaApiTrigger, setAreaApiTrigger] = useState(false); 

    // snackBar state
    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');

    // cardSettings state
    const [cardSettingsDialogOpen, setCardSettingsDialogOpen] = useState(false);
    const [areaCloseConfirmed, setAreaCloseConfirmed] = useState(false);
    const [areaCloseId, setAreaCloseId] = useState({});

    // READ AREA API data for TabPanel
    useEffect( () => {

        console.count('useEffect: read all Rest API data');

        let areaUri = `${darwinUri}/areas?creator_fk=${profile.userName}&closed=0&domain_fk=${domain.id}&fields=id,area_name,domain_fk,sort_order,creator_fk`;

        call_rest_api(areaUri, 'GET', '', idToken)
            .then(result => {
                
                if (result.httpStatus.httpStatus === 200) {

                    // Sort the data, find largest sort order, add template area/card and save the state
                    result.data.sort((areaA,areaB) => areaSortBySortOrder(areaA, areaB));
                    let maxSortOrder = result.data.at(-1).sort_order + 1
                    result.data.push({'id':'', 'area_name':'', 'domain_fk': domain.id, 'closed': 0, 'sort_order': maxSortOrder, 'creator_fk': profile.userName, });
                    setAreasArray(result.data);

                } else {
                    snackBarError(result, 'Unable to read Area data', setSnackBarMessage, setSnackBarOpen)
                }

            }).catch(error => {
                if (error.httpStatus.httpStatus === 404) {

                    // a domain with no areas, still requires a template area
                    setAreasArray([{'id':'', 'area_name':'', 'domain_fk': domain.id, 'sort_order': 1, 'creator_fk': profile.userName, }]);
                } else {
                    snackBarError(error, 'Unable to read Area data', setSnackBarMessage, setSnackBarOpen)
                }
            });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [areaApiTrigger]);

    // CLOSE AREA in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: close Area');

        //TODO confirm areaCloseId is a valid object
        if (areaCloseConfirmed === true) {
            const { areaName, areaId } = areaCloseId;

            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'PUT', [{'id': areaId, 'closed': 1, 'sort_order': 'NULL'}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // Area set to close, remove area from Area object state
                        let newAreasArray = [...areasArray];
                        newAreasArray = newAreasArray.filter(area => area.id !== areaId );
                        setAreasArray(newAreasArray);

                    } else {
                        snackBarError(result, `Unable to close ${areaName}`, setSnackBarMessage, setSnackBarOpen)
                    }
                }).catch(error => {
                    snackBarError(error, `Unable to close ${areaName}`, setSnackBarMessage, setSnackBarOpen)
            });
        }
        // prior to exit and regardless of outcome, clean up state
        setAreaCloseConfirmed(false);
        setAreaCloseId({});

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [areaCloseConfirmed])

    const areaChange = (event, areaIndex) => {
        // event.target.value contains the new area text
        // updated changes are written to rest API elsewhere (keydown for example)
        let newAreasArray = [...areasArray]
        newAreasArray[areaIndex].area_name = event.target.value;
        setAreasArray(newAreasArray);
    }

    const areaKeyDown = (event, areaIndex, areaId) => {
        if (event.key === 'Enter') {
            updateArea(event, areaIndex, areaId);
            event.preventDefault();
        }

        // hack around: not escaping single parens so disallow for now
        if (event.key === "'") {
            event.preventDefault();
        }
    }

    const areaOnBlur = (event, areaIndex, areaId) => {
        updateArea(event, areaIndex, areaId);
    }

    const updateArea = (event, areaIndex, areaId) => {

        const noop = ()=>{};

        if ((areaId === '') &&
            (areasArray[areaIndex].area_name === '')) {
            // new area with no description, noop
            noop();

        } else {
            // blank taskId indicates we are creating a new task rather than updating existing
            if (areaId === '') {
                saveArea(event, areaIndex)
            } else {

                // Otherwise we are updating the name of an existing area
                let uri = `${darwinUri}/areas`;
                call_rest_api(uri, 'PUT', [{'id': areaId, 'area_name': areasArray[areaIndex].area_name}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            // database change confirmed only with a 200/201 response
                            snackBarError(result, `Unable to update area name`, setSnackBarMessage, setSnackBarOpen)
                        }
                    }).catch(error => {
                        snackBarError(error, `Unable to update area name`, setSnackBarMessage, setSnackBarOpen)
                    });
            }
        }
    }

    const saveArea = (area, areaIndex, areaId) => {

        // Call rest API and create a new array
        let newAreasArray = [...areasArray];
        let uri = `${darwinUri}/areas`;
        call_rest_api(uri, 'POST', {...newAreasArray[areaIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    // 200 => record added to database and returned in body
                    // place new data in table and created another template area
                    newAreasArray[areaIndex] = {...result.data[0]};
                    let newSortOrder = result.data[0].sort_order + 1;
                    newAreasArray.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': domain.id, 'creator_fk': profile.userName, 'sort_order': newSortOrder });
                    setAreasArray(newAreasArray);

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

    const clickCardClosed = (event, areaName, areaId) => {
        // stores data re: card to close, opens dialog
        if (areaId !== '') {
            setAreaCloseId({ areaName, areaId });
            setCardSettingsDialogOpen(true);
        }
    }

    const areaSortBySortOrder = (areaA, areaB) => {

        if (areaA.sort_order === areaB.sort_order) {
            return 0;
        } else if (areaA.sort_order < areaB.sort_order) {
            return -1;
        } else {
            return 1;
        }
    }

    return (
            <TabPanel key={domainIndex} value={domainIndex.toString()} 
                      className="app-content-tabpanel"
            >
                { areasArray && 
                    <Box className="card">
                        { areasArray.map((area, areaIndex) => (
                            <TaskCard {...{key: area.id,
                                           area,
                                           areaIndex,
                                           domainId: domain.id,
                                           areaChange,
                                           areaKeyDown,
                                           areaOnBlur,
                                           clickCardClosed,}}/>
                        ))}
                    </Box>  
                }
                <SnackBar {...{snackBarOpen,
                               setSnackBarOpen,
                               snackBarMessage,}} />
                <CardCloseDialog {...{cardSettingsDialogOpen,
                                      setCardSettingsDialogOpen,
                                      areaCloseId,
                                      setAreaCloseId,
                                      setAreaCloseConfirmed}}
                />
            </TabPanel>
    )
}

export default AreaTabPanel