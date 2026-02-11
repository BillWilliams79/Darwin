// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, {useState, useEffect} from 'react';
import Box from '@mui/material/Box';
import { CircularProgress, Typography } from '@mui/material';
import DayView from './DayView';

const CalendarView = () => {

    const [dateArray, setDateArray] = useState([])

    useEffect( () => {   
        
        console.count('CalendarView useEffect');

        // number of days displayed in the calendar, not including current week
        var displayDays = 28;

        // SundayAnchor is the Sunday from four weeks prior, at start of day
        var today = new Date();
        var sundayAnchor = new Date();
        sundayAnchor.setDate(today.getDate() - (today.getDay() + displayDays));
        sundayAnchor.setHours(0,0,0,0);

        // Create an array of ISO string dates to pass to DayView
        // ISO string dates are readily convertible back to date object
        var newDateArray = [];
        for (let day = 0; day < (displayDays + 7); day++) {
            newDateArray.push(sundayAnchor.toISOString());
            sundayAnchor.setDate(sundayAnchor.getDate() + 1);
        }
        setDateArray(newDateArray);

    }, []);

    return (
        <>
            <Box className="app-title">
                <Typography variant="h4" sx={{ml:2}}>
                    Calendar View - Completed Tasks
                </Typography>
            </Box>
            <Box className="card-calendar">
                {dateArray ?
                    dateArray.map( (date) => (
                        <DayView date = {date}
                        />
                    ))
                 :
                   <CircularProgress/>
                }
            </Box>
        </>
    )
}

export default CalendarView