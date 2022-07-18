
import React from 'react';

import Typography from '@mui/material/Typography';
import { Button } from '@mui/material';

const TestComponent = ({stateA, changeStateA}) => {

    return (
        <>
    <Typography variant="h3">
    {`Props state is ${stateA}`}
    {console.count('Props state Render')}
    </Typography>
    <Button onClick= { (event) => (stateA === 'A' ? changeStateA('a') : changeStateA('A'))  } >
        Switch Case for A
    </Button>
    </>
    )
}

export default TestComponent