import './index.css';

import { Outlet } from "react-router-dom"

import NavBar from './NavBar/NavBar.js'

const App = () => {

    return (
        <>
            <NavBar className="app-navbar" />
            <Outlet /> 
        </>
    );
}

export default App;
