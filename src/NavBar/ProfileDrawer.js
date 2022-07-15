import { useState } from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Button from '@mui/material/Button';
import Profile from '../Profile/Profile';

const ProfileDrawer = () => {

    const [drawerState, setDrawerState] = useState(false);

    const toggleDrawer = (openState) => (event) => {

        // disrupts drawer toggle for tab and shift keys
        if (event.type === 'keydown' && (event.key === 'Tab' || event.key === 'Shift')) {
            return;
        }

        setDrawerState(openState);
    };

    return (
        <>
            <Button sx = {{color: 'white', 
                           textTransform: 'capitalize',
                           font: 'Roboto',
                           fontSize: '16px',
                           fontWeight: '400',
                           margin: 0,
                           marginTop: 0,
                           padding: 0,
                           border: 0,
                           alignItems: 'start',
                           justifyContent: 'left',
                        }}
                    onClick={toggleDrawer(true)}>
                Profile
            </Button>
            <Drawer
                anchor='left'
                open={drawerState}
                onClose={toggleDrawer(false)}
            >
                <Box
                    onClick={toggleDrawer(false)}
                    onKeyDown={toggleDrawer(false)}
                >
                    <Profile></Profile>
                </Box>
            </Drawer>
        </>
    );
}

export default ProfileDrawer;

