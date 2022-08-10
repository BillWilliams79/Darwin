import '../index.css';
import AuthContext from '../Context/AuthContext';
import ProfileDrawer from './ProfileDrawer.js';

import React, {useContext} from 'react';
import { Link } from "react-router-dom"

import AppBar from '@mui/material/AppBar';
import Container from '@mui/material/Container';
import PedalBikeIcon from '@mui/icons-material/PedalBike';
import Stack from '@mui/material/Stack';

const NavBar = () => {
    console.count('Navbar render');
    const { idToken } = useContext(AuthContext);

  return (
    <AppBar className="app-navbar" position="static" sx={{backgroundColor: 'black', padding: 0, mb: {xs: 2, md:0}, ml:0, }}>
      <Container sx={{ padding: {xs:2 }, mt: {xs: 1, md: 0 }, }}>
        <Stack direction={{ xs: 'row', md: 'column', }}
               spacing={1} >
          <PedalBikeIcon />
          <Link className="nav-title" to="/">
            Darwin
          </Link>
          {idToken &&
              <>
                <Link className="nav-link" to="/taskcards"> Plan </Link>
                <Link className="nav-link" to="/calview"> Calendar </Link>
                <Link className="nav-link" to="/domainedit"> Domains </Link>
                <Link className="nav-link" to="/areaedit"> Areas </Link>
                <ProfileDrawer/>
              </>
          }
        </Stack>
      </Container>
    </AppBar>
  );
};

export default NavBar;
