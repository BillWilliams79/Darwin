
import React, {useState} from 'react';

import Typography from '@mui/material/Typography';
import { Button } from '@mui/material';

const OwnStateComponent = ({stateA, changeStateA}) => {

    const [ myStateA, setMyStateA ] = useState('A');

    return (
        <>
    <Typography variant="h3">
    {`OwnState state is ${myStateA}`}
    {console.count('OwnState Render')}
    </Typography>
    <Button onClick= { (event) => (myStateA === 'A' ? setMyStateA('a') : setMyStateA('A'))  } >
        Switch Case for A
    </Button>
    </>
    )
}

export default OwnStateComponent