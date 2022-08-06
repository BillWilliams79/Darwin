import React, {useState, useContext, useEffect} from 'react';

import varDump from '../classifier/classifier';
import AuthContext from '../Context/AuthContext.js'
import AppContext from '../Context/AppContext';

import { Box } from '@mui/system';
import { Typography } from '@mui/material';

const CalendarView = ( { domain, domainIndex } ) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [dateArray, setDataArray] = useState()
   
    return (
        <>
            <Box className="app-title">
                <Typography variant="h4" sx={{ml:2}}>
                    Calendar View - Completed Tasks
                </Typography>
            </Box>

        </>
    )
}

export default CalendarView