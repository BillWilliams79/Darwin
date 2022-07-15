import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import { CookiesProvider } from 'react-cookie';

import HomePage from './HomePage/HomePage'
import LoggedIn from './LoggedIn/LoggedIn';
import Error404 from './Error404/Error404';
import App from './App';
import Profile from './NavBar/Profile';

import { AuthContextProvider } from './Context/AuthContext.js'

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
    <AuthContextProvider>
        <CookiesProvider>
            <Router >
                <div className="app-layout">
                    <Routes>
                        <Route path="/"                element= {<App />} >
                            <Route index               element= {<HomePage />} />
                            <Route path="loggedin"     element= {<LoggedIn />} />
                            <Route path="profile"      element= {<Profile />} />
                        </Route >
                        <Route path="*"                element= {<Error404 />} />
                    </Routes>
                </div>
            </Router>
        </CookiesProvider>
    </AuthContextProvider>
);
