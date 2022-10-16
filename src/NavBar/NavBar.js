import '../index.css';
import AuthContext from '../Context/AuthContext';
import ProfileDrawer from './ProfileDrawer.js';

import React, {useContext} from 'react';
import { Link } from "react-router-dom"

import AppBar from '@mui/material/AppBar';
import PedalBikeIcon from '@mui/icons-material/PedalBike';
import Stack from '@mui/material/Stack';

const NavBar = () => {
    console.count('Navbar render');
    const { idToken } = useContext(AuthContext);

  return (
    <AppBar className="app-navbar" position="static" sx={{backgroundColor: 'black', padding: 2,  pb: {xs:2, md:3} }}>
        <Stack direction={{ xs: 'row', md: 'column', }}
               spacing={1}
               alignItems={{xs: 'center', md: 'flex-start'}}
        >
          <PedalBikeIcon />
          <Link className="nav-title" to="/">
            Darwin
          </Link>
              <>
                <Link className="nav-link" to="/taskcards"> Plan </Link>
                <Link className="nav-link" to="/calview"> Calendar </Link>
                <Link className="nav-link" to="/domainedit"> Domains </Link>
                <Link className="nav-link" to="/areaedit"> Areas </Link>
                {idToken &&
                    <ProfileDrawer/>
                }
              </>
        </Stack>
    </AppBar>
  );
};

export default NavBar;
