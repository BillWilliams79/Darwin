import './index.css';
import AuthenticatedRoute from './Components/AuthenticatedRoute/AuthenticatedRoute';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import { AuthContextProvider } from './Context/AuthContext.js'
import { AppContextProvider } from './Context/AppContext';
import { CookiesProvider } from 'react-cookie';
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import App from './App';
import HomePage from './HomePage/HomePage';
import LoginLink from './Components/LoginLink/LoginLink';
import LoggedIn from './LoggedIn/LoggedIn';
import TaskPlanView from './TaskPlanView/TaskPlanView';
import CalendarView from './CalendarView/CalendarView';
import AreaEdit from './AreaEdit/AreaEdit';
import DomainEdit from './DomainEdit/DomainEdit';
import Profile from './NavBar/Profile';
import Error404 from './Error404/Error404';
import LogoutLink from './Components/LogoutLink/LogoutLink';
import DroidView from './DroidView/DroidView';


const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <CookiesProvider>
    <AuthContextProvider>
      <AppContextProvider>
        <DndProvider backend={HTML5Backend}>  
          <Router >
            <div className="app-layout">
              <Routes>
                <Route path="/"                element= {<App />} >
                    <Route index               element= {<HomePage />} />
                    <Route path="login"        element= {<LoginLink/>} />
                    <Route path="logout"       element= {<LogoutLink/>} />
                    <Route path="loggedin"     element= {<LoggedIn />} />
                    <Route path="taskcards"    element= {<AuthenticatedRoute>
                                                             <TaskPlanView />
                                                         </AuthenticatedRoute>} />
                    <Route path="calview"      element= {<AuthenticatedRoute>
                                                             <CalendarView />
                                                         </AuthenticatedRoute>} />
                    <Route path="areaedit"     element= {<AuthenticatedRoute>
                                                             <AreaEdit />
                                                         </AuthenticatedRoute>} />
                    <Route path="domainedit"   element= {<AuthenticatedRoute>
                                                             <DomainEdit />
                                                         </AuthenticatedRoute>} />
                     <Route path="droidview"   element= {<AuthenticatedRoute>
                                                             <DroidView />
                                                         </AuthenticatedRoute>} />

                    <Route path="profile"      element= {<AuthenticatedRoute>
                                                             <Profile />
                                                         </AuthenticatedRoute>} />
                </Route >
                <Route path="*"                element= {<Error404 />} />
              </Routes>
            </div>
          </Router>
        </DndProvider>  
      </AppContextProvider>  
    </AuthContextProvider>
  </CookiesProvider>
);
