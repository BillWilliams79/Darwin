import React, { useState, useEffect, useContext} from 'react'
import varDump from '../classifier/classifier';
import call_rest_api from '../RestApi/RestApi';
import {SnackBar, snackBarError} from '../Components/SnackBar/SnackBar';

import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import { CircularProgress } from '@material-ui/core';

import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { Typography } from '@mui/material';

const DroidVisualizerCard = ({sensorObject, sensorIndex, droidId }) => {

    // Task card is the list of tasks per area displayed in a card.
    const { droidProfile } = useContext(AuthContext);
    const { droidsUri } = useContext(AppContext);

    // Array of task objects
    const [droidDataArray, setDroidDataArray] = useState()
    const [droidApiTrigger, setDroidApiTrigger] = useState(false); 

    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');

    console.count(`Render visualizer for sensor: ${sensorObject.displayName}`)

    // READ Task API data for card
    useEffect( () => {

        console.count('useEffect: read task API data for a given area');

        // create the start date string for the URI
        var startDate = new Date();
        startDate.setDate(startDate.getDate() - 5);
        startDate.setHours(0,0,0,0);
        var startDateString = startDate.toISOString().slice(0,19);

        // create the end date string for the URI
        var endDate = new Date();
        endDate.setDate(endDate.getDate() - 4);
        endDate.setHours(0,0,0,0);
        var endDateString = endDate.toISOString().slice(0,19);


        // FETCH TASKS: filter for creator, done=0 and area.id
        // QSPs limit fields to minimum: id,priority,done,description,area_fk
        //let droidDataUri = `${droidsUri}/${sensorObject.name}?droid_fk=${droidId}&filter_ts=(time_ts,${startDateString},${endDateString})`
        let droidDataUri = `${droidsUri}/${sensorObject.name}?droid_fk=${droidId}`
        varDump(droidDataUri, "computed URI")
        call_rest_api(droidDataUri, 'GET', '', null)
            .then(result => {

                if (result.httpStatus.httpStatus === 200) {

                    // Store Droid Data, but first trim excess precision
                    result.data = result.data.map((data) => { 
                        data.time_ts = data.time_ts.slice(5,10);
                        if ((sensorObject.dataPoint === 'temperature') ||
                            (sensorObject.dataPoint === 'relative_humidity') ||
                            (sensorObject.dataPoint === 'soil_temperature') ||
                            (sensorObject.dataPoint === 'uv_index')) {
                            data[sensorObject.dataPoint] = data[sensorObject.dataPoint].toPrecision(3);
                        }
                        return data;
                        }
                    )
                    setDroidDataArray(result.data);

                } else {

                    varDump(result.httpStatus, `DroidVisualizerCard UseEffect: error retrieving sensor data ${sensorObject.displayName}`);
                }  

            }).catch(error => {

                if (error.httpStatus.httpStatus === 404) {

                    // 404 = no data for this sensor, leave a blank array
                    setDroidDataArray([]);

                } else {
                    varDump(error, `DroidVisualizerCard UseEffect: error retrieving sensor data ${sensorObject.displayName}`);
                }
            });

    }, [droidApiTrigger]);

    return (
        <Card key={sensorObject.name} raised={true} >
            <CardContent>
                <Box className="card-header" sx={{marginBottom: 2}}>
                    <Typography key={`sensorName-${sensorObject.name}`}
                                variant="h5">
                        {sensorObject.displayName || ''}
                    </Typography>

                </Box>
                { droidDataArray ?
                    (droidDataArray.length) ?
                      <ResponsiveContainer width={'100%'} aspect={1}>
                        <LineChart data={droidDataArray}>
                            <CartesianGrid strokeDasharray="3 3"/>
                            <Line type="monotone" dataKey={sensorObject.dataPoint} />
                            <XAxis dataKey="time_ts"/>
                            <YAxis />
                            <Tooltip />
                        </LineChart>
                      </ResponsiveContainer>
                    :
                      <Typography>
                        No data available for selected time frame
                      </Typography>
                  :
                    <CircularProgress/>
                }
            </CardContent>
            <SnackBar {...{snackBarOpen,
                           setSnackBarOpen,
                           snackBarMessage,}} />
        </Card>
    )
}

export default DroidVisualizerCard