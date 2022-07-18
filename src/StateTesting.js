
import React,  { useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Button } from '@mui/material';
import TestComponent from './TestComponent';
import OwnStateComponent from './OwnStateComponent';

const StateTesting = () => {

    console.count('StateTesting Function Rendered');
    const [ myStateA, setMyStateA ] = useState('A');
    const [ myStateB, setMyStateB ] = useState('B');
    const [ myStateC, setMyStateC ] = useState('C');
    const [ myStateAll, setMyStateAll ] = useState({'stateA': 'A', 'stateB': 'B', 'stateC': 'C'});
        
    return (
        <Box>
            <TestComponent stateA = {myStateA} changeStateA = {setMyStateA}></TestComponent>
            <OwnStateComponent ></OwnStateComponent>
            <Typography variant="h3">
                {`string useState ${myStateB}`}
                {console.count('string b Render')}
            </Typography>
            <Button onClick= { (event) => (myStateB === 'B' ? setMyStateB('b') : setMyStateB('B'))  } >
                Switch Case for B
            </Button>
            <Typography variant="h3">
                {`string useState ${myStateC}`}
                {console.count('string c Render')}
            </Typography>
            <Button onClick= { (event) => (myStateC === 'C' ? setMyStateC('c') : setMyStateC('C'))  } >
                Switch Case for C
            </Button>

            <Typography variant="h3">
                {`Object useState ${myStateAll['stateA']}`}
                {console.count('Object A Render')}
            </Typography>
            <Button onClick= { (event) => (myStateAll['stateA'] === 'A' ? setMyStateAll({...myStateAll, 'stateA': 'a'}) : 
                                                               setMyStateAll({...myStateAll, 'stateA': 'A'}))  } >
                Switch Case for A (All)
            </Button>
            <Typography variant="h3">
                {`Object useState ${myStateAll['stateB']}`}
                {console.count('object B Render')}
            </Typography>
            <Button onClick= { (event) => (myStateAll['stateB'] === 'B' ? setMyStateAll({...myStateAll, 'stateB': 'b'}) : 
                                                               setMyStateAll({...myStateAll, 'stateB': 'B'}))  } >
                Switch Case for B
            </Button>
            </Box>
    )
}

export default StateTesting;
