import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import { AuthContextProvider } from './Context/AuthContext.js'
import { AppContextProvider } from './Context/AppContext';
import { CookiesProvider } from 'react-cookie';
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import HomePage from './HomePage/HomePage'
import LoggedIn from './LoggedIn/LoggedIn';
import Error404 from './Error404/Error404';
import App from './App';
import Profile from './NavBar/Profile';
import TaskPlanView from './TaskPlanView/TaskPlanView';
import AreaEdit from './AreaEdit/AreaEdit';
import DomainEdit from './DomainEdit/DomainEdit';
import CalendarView from './CalendarView/CalendarView';

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
    <AuthContextProvider>
      <AppContextProvider>
        <CookiesProvider>
          <DndProvider backend={HTML5Backend}>  
            <Router >
                <div className="app-layout">
                    <Routes>
                        <Route path="/"                element= {<App />} >
                            <Route index               element= {<HomePage />} />
                            <Route path="taskcards"    element= {<TaskPlanView />} />
                            <Route path="calview"      element= {<CalendarView /> } />
                            <Route path="areaedit"     element= {<AreaEdit />} />
                            <Route path="domainedit"   element= {<DomainEdit />} />
                            <Route path="loggedin"     element= {<LoggedIn />} />
                            <Route path="profile"      element= {<Profile />} />
                        </Route >
                        <Route path="*"                element= {<Error404 />} />
                    </Routes>
                </div>
            </Router>
          </DndProvider>  
        </CookiesProvider>
      </AppContextProvider>  
    </AuthContextProvider>
);
