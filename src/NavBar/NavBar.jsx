import React, { useEffect } from 'react';
import NavBarSidebar from './NavBarSidebar';

const NavBar = () => {
    console.count('Navbar render');

    // Apply layout class to .app-layout
    useEffect(() => {
        const el = document.querySelector('.app-layout');
        if (el) el.classList.add('layout-sidebar');
    }, []);

    return <NavBarSidebar />;
};

export default NavBar;
