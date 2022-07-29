import React, {useState, useContext, useEffect} from 'react';
import TaskCard from './TaskCard';
import SnackBar from './SnackBar';
import CardSettingsDialog from './CardSettingsDialog';

import varDump from '../classifier/classifier';
import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';

import { Box } from '@mui/system';
import { TabPanel } from '@material-ui/lab';

const AreaTabPanel = ( { domain, domainIndex } ) => {

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

        let areaUri = `${darwinUri}/areas?creator_fk=${profile.userName}&closed=0&domain_fk=${domain.id}&fields=id,area_name,domain_fk`;

        call_rest_api(areaUri, 'GET', '', idToken)
            .then(result => {
                
                setAreasArray(result.data);

            }).catch(error => {
                varDump(error, `UseEffect: error retrieving Areas: ${error}`);
            });

    }, [areaApiTrigger]);

    // CLOSE AREA in cooperation with confirmation dialog
    useEffect( () => {
        console.count('useEffect: close Area');

        //TODO confirm areaCloseId is a valid object
        if (areaCloseConfirmed === true) {
            const { areaName, areaId } = areaCloseId;

            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'POST', {'id': areaId, 'closed': 1}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {

                        // Area set to close, remove area from Area object state
                        let newAreasArray = [...areasArray];
                        newAreasArray = newAreasArray.filter(area => area.id !== areaId );
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

    const areaChange = (event, areaIndex) => {
        varDump(areaIndex, 'area index for areaChange')
        // event.target.value contains the new area text
        // updated changes are written to rest API elsewhere (keyup for example)
        let newAreasArray = [...areasArray]
        newAreasArray[areaIndex].area_name = event.target.value;
        setAreasArray(newAreasArray);
    }

    const areaKeyDown = (event, areaIndex, areaId) => {
        if ((event.key === 'Enter') ||
            (event.key === 'Tab')) {

            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'POST', {'id': areaId, 'area_name': areasArray[areaIndex].area_name}, idToken)
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

    const cardSettingsClick = (event, areaName, areaId) => {
        // stores data re: card to close, opens dialog
        setAreaCloseId({ areaName, areaId });
        setCardSettingsDialogOpen(true);
    }

    return (
            <TabPanel key={domainIndex} value={domainIndex.toString()} >
                { areasArray && 
                    <Box className="card">
                        { areasArray.map((area, areaIndex) => (
                            <TaskCard area = {area}
                                      key = {area.id}
                                      areaIndex = {areaIndex}
                                      domainId = {domain.id}
                                      areaChange = {areaChange}
                                      areaKeyDown = {areaKeyDown}
                                      cardSettingsClick = {cardSettingsClick} >
                            </TaskCard>
                        ))}
                    </Box>  
                }
                <SnackBar snackBarOpen = {snackBarOpen} setSnackBarOpen = {setSnackBarOpen} snackBarMessage={snackBarMessage} />
                <CardSettingsDialog cardSettingsDialogOpen = {cardSettingsDialogOpen}
                                    setCardSettingsDialogOpen = {setCardSettingsDialogOpen}
                                    areaCloseId = {areaCloseId}
                                    setAreaCloseId = {setAreaCloseId}
                                    setAreaCloseConfirmed = {setAreaCloseConfirmed} />
            </TabPanel>
    )
}

export default AreaTabPanel