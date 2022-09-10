import varDump from '../classifier/classifier';
import React, {useState, useContext, useEffect} from 'react';
import call_rest_api from '../RestApi/RestApi';
import {SnackBar, snackBarError} from '../Components/SnackBar/SnackBar';

import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';

import { Box } from '@mui/system';
import { TabPanel } from '@material-ui/lab';
import { CircularProgress } from '@mui/material';
import DroidVisualizerCard from './DroidVisualizerCard';

const DroidTabPanel = ( { droid, droidIndex } ) => {

    // Tab Panel contains all the taskcards for a given domain
    // Parent is TaskCardContent. Children are TaskCards

    const { droidProfile } = useContext(AuthContext);
    const { droidUri } = useContext(AppContext);

    const [sensorsArray, setSensorsArray] = useState()
    const [droidApiTrigger, setDroidApiTrigger] = useState(false); 

    // snackBar state
    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');


    // READ AREA API data for TabPanel
    useEffect( () => {

        console.count('useEffect: read all Rest API data');

        // TODO - droids needs a list of attached sensors that we can correlate to table data and read into the
        // cards
        setSensorsArray([{name: 'temperature', dataPoint: 'temperature', displayName: 'Air Temperature'},
                         {name: 'relative_humidity', dataPoint: 'relative_humidity', displayName: 'Relative Humidity'},
                         {name: 'soil_temperature', dataPoint: 'soil_temperature', displayName: 'Soil Temperature'},
                         {name: 'soil_moisture', dataPoint: 'soil_moisture', displayName: 'Soil Moisture'},
                         {name: 'uv', dataPoint: 'uv_index', displayName: 'UV Index'},
                         {name: 'rssi', dataPoint: 'rssi', displayName: 'RSSI'},
                       ]);

/*         let areaUri = `${darwinUri}/areas?creator_fk=${profile.userName}&closed=0&domain_fk=${domain.id}&fields=id,area_name,domain_fk,sort_order`;

        call_rest_api(areaUri, 'GET', '', idToken)
            .then(result => {
                
                result.data.sort((areaA,areaB) => areaSortBySortOrder(areaA, areaB));
                setAreasArray(result.data);

            }).catch(error => {
                varDump(error, `UseEffect: error retrieving Areas: ${error}`);
            });
 */
    }, [droidApiTrigger]);

    return (
            <TabPanel key={droidIndex} value={droidIndex.toString()} 
                      className="app-content-tabpanel"
            >
                { sensorsArray ? 
                    <Box className="card">
                        { sensorsArray.map((sensor, sensorIndex) => (
                             <DroidVisualizerCard key = {sensor}
                                                  sensorObject = {{...sensor}}
                                                  droidId = {droid.id}
                            />
                        ))}
                    </Box>
                  :
                    <CircularProgress/>
                }
                <SnackBar {...{snackBarOpen,
                               setSnackBarOpen,
                               snackBarMessage,}} />
            </TabPanel>
    )
}

export default DroidTabPanel