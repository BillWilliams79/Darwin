import '../index.css';
import AppContext from '../Context/AppContext';
import ProfileDrawer from './ProfileDrawer.js';

import React, {useContext} from 'react';
import { Link } from "react-router-dom"

import AppBar from '@mui/material/AppBar';
import Container from '@mui/material/Container';
import PedalBikeIcon from '@mui/icons-material/PedalBike';
import Stack from '@mui/material/Stack';

const NavBar = () => {
    console.log('navbar rendered');
    const { idToken } = useContext(AppContext);

  return (
    <AppBar className="app-navbar" position="static" sx={{backgroundColor: 'black', padding: 0, mb: {xs: 2, md:0}, ml:0, }}>
      <Container sx={{ padding: {xs:2 }, mt: {xs: 1, md: 0 }, }}>
        <Stack direction={{ xs: 'row', md: 'column', }}
               spacing={1} >
          <PedalBikeIcon />
          <Link className="app-link" to="/"> DARWIN </Link>
          {idToken &&
              <>
                <ProfileDrawer/>
              </>
          }
        </Stack>
      </Container>
    </AppBar>
  );
};

export default NavBar;
