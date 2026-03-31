import './index.css';
import AuthenticatedRoute from './Components/AuthenticatedRoute/AuthenticatedRoute';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import { AuthContextProvider } from './Context/AuthContext'
import { AppContextProvider } from './Context/AppContext';
import { CookiesProvider } from 'react-cookie';
import { DndProvider } from "react-dnd";
import { TouchBackend } from "react-dnd-touch-backend";
import QueryClientSetup from './QueryClient/QueryClientSetup';
import ThemeWrapper from './Theme/ThemeWrapper';

import App from './App';
import HomePage from './HomePage/HomePage';
import LoginPage from './LoginPage/LoginPage';
import SignupPage from './SignupPage/SignupPage';
import LogoutPage from './LogoutPage/LogoutPage';
import LoggedIn from './LoggedIn/LoggedIn';
import TaskPlanView from './TaskPlanView/TaskPlanView';
import CalendarFC from './CalendarFC/CalendarFC';
import AreaEdit from './AreaEdit/AreaEdit';
import DomainEdit from './DomainEdit/DomainEdit';
import ProjectEdit from './ProjectEdit/ProjectEdit';
import CategoryEdit from './CategoryEdit/CategoryEdit';
import Profile from './NavBar/Profile';
import Error404 from './Error404/Error404';
import SwarmView from './SwarmView/SwarmView';
import PriorityDetail from './SwarmView/detail/PriorityDetail';
import SessionsView from './SwarmView/SessionsView';
import SwarmSessionDetail from './SwarmView/detail/SwarmSessionDetail';
import DevServersView from './DevServers/DevServersView';
import SetupWizard from './SetupWizard/SetupWizard';
import RecurringPlanView from './RecurringTaskEdit/RecurringPlanView';
import MapsPage from './Maps/MapsPage';
import CyclemeterImport from './CyclemeterImport/CyclemeterImport';

import RouteDetailView from './RouteCards/RouteDetailView';
import MapRouteSettingsView from './Maps/MapRouteSettingsView';
import MapPartnerSettingsView from './Maps/MapPartnerSettingsView';


const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <QueryClientSetup>
    <CookiesProvider>
      <AuthContextProvider>
        <AppContextProvider>
          <ThemeWrapper>
          <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true, delayTouchStart: 150 }}>
            <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <div className="app-layout">
              <Routes>
                <Route path="/"                element= {<App />} >
                    <Route index               element= {<HomePage />} />
                    <Route path="login"        element= {<LoginPage />} />
                    <Route path="signup"       element= {<SignupPage />} />
                    <Route path="logout"       element= {<LogoutPage />} />
                    <Route path="loggedin"     element= {<LoggedIn />} />
                    <Route path="taskcards"    element= {<AuthenticatedRoute>
                                                             <TaskPlanView />
                                                         </AuthenticatedRoute>} />
                    <Route path="calview"      element= {<AuthenticatedRoute>
                                                             <CalendarFC />
                                                         </AuthenticatedRoute>} />
                    <Route path="areaedit"     element= {<AuthenticatedRoute>
                                                             <AreaEdit />
                                                         </AuthenticatedRoute>} />
                    <Route path="domainedit"   element= {<AuthenticatedRoute>
                                                             <DomainEdit />
                                                         </AuthenticatedRoute>} />
                    <Route path="projectedit"  element= {<AuthenticatedRoute>
                                                             <ProjectEdit />
                                                         </AuthenticatedRoute>} />
                    <Route path="categoryedit" element= {<AuthenticatedRoute>
                                                             <CategoryEdit />
                                                         </AuthenticatedRoute>} />
                    <Route path="profile"      element= {<Profile />} />
                    <Route path="swarm"        element= {<AuthenticatedRoute>
                                                             <SwarmView />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/priority/:id" element= {<AuthenticatedRoute>
                                                             <PriorityDetail />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/sessions" element= {<AuthenticatedRoute>
                                                             <SessionsView />
                                                         </AuthenticatedRoute>} />
<Route path="swarm/session/:id" element= {<AuthenticatedRoute>
                                                             <SwarmSessionDetail />
                                                         </AuthenticatedRoute>} />
                    <Route path="setup"      element= {<AuthenticatedRoute>
                                                             <SetupWizard />
                                                         </AuthenticatedRoute>} />
                    <Route path="devservers" element= {<AuthenticatedRoute>
                                                             <DevServersView />
                                                         </AuthenticatedRoute>} />
                    <Route path="recurring" element= {<AuthenticatedRoute>
                                                             <RecurringPlanView />
                                                         </AuthenticatedRoute>} />
                    <Route path="maps" element= {<AuthenticatedRoute>
                                                             <MapsPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="maps/import" element= {<AuthenticatedRoute>
                                                             <CyclemeterImport />
                                                         </AuthenticatedRoute>} />

                    <Route path="maps/settings/routes" element= {<AuthenticatedRoute>
                                                             <MapRouteSettingsView />
                                                         </AuthenticatedRoute>} />
                    <Route path="maps/settings/partners" element= {<AuthenticatedRoute>
                                                             <MapPartnerSettingsView />
                                                         </AuthenticatedRoute>} />
                    <Route path="maps/:runId" element= {<AuthenticatedRoute>
                                                             <RouteDetailView />
                                                         </AuthenticatedRoute>} />
                </Route >
                <Route path="*"                element= {<Error404 />} />
              </Routes>
            </div>
          </Router>
          </DndProvider>
          </ThemeWrapper>
        </AppContextProvider>
      </AuthContextProvider>
    </CookiesProvider>
  </QueryClientSetup>
);
