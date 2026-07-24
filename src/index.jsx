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
import RequirementDetail from './SwarmView/detail/RequirementDetail';
import SessionsView from './SwarmView/SessionsView';
import SwarmSessionDetail from './SwarmView/detail/SwarmSessionDetail';
import DevServersView from './DevServers/DevServersView';
import MachinesView from './Machines/MachinesView';
import AgentsPage from './Agents/AgentsPage';
import AgentDetail from './Agents/AgentDetail';
import InstructionsPage from './Agents/InstructionsPage';
import DocumentsPage from './Agents/DocumentsPage';
import ContextPage from './Agents/ContextPage';
import SetupWizard from './SetupWizard/SetupWizard';
import RecurringPlanView from './RecurringTaskEdit/RecurringPlanView';
import MapsPage from './Maps/MapsPage';
import CyclemeterImport from './CyclemeterImport/CyclemeterImport';

import RouteDetailView from './RouteCards/RouteDetailView';
import MapRouteSettingsView from './Maps/MapRouteSettingsView';
import MapPartnerSettingsView from './Maps/MapPartnerSettingsView';
import PhotoBrowser from './photo-browser/PhotoBrowser';
import PhotoSettingsView from './photo-browser/PhotoSettingsView';
import FeaturesPage from './Features/FeaturesPage';
import TestCasesPage from './Features/TestCasesPage';
import TestPlansPage from './Features/TestPlansPage';
import { TestRunsPage, TestRunDetail } from './Features/TestRunsPage';
import SwarmStartsPage from './SwarmStarts/SwarmStartsPage';
import SwarmStartDetail from './SwarmStarts/SwarmStartDetail';
import SwarmUndosPage from './SwarmUndos/SwarmUndosPage';
import SwarmUndoDetail from './SwarmUndos/SwarmUndoDetail';
import SwarmCompletesPage from './SwarmCompletes/SwarmCompletesPage';
import SwarmCompleteDetail from './SwarmCompletes/SwarmCompleteDetail';
import SystemsPage2 from './Systems/SystemsPage2';
import BuildVisualizerPage from './BuildVisualizer/BuildVisualizerPage';
import CustomersPage from './Customers/CustomersPage';
import CustomerReleasesPage from './CustomerReleases/CustomerReleasesPage';


// react-dnd TouchBackend options (req #1923).
// The app's primary touch-drag axis (task reordering) is VERTICAL — the same axis
// as page scrolling — so scrollAngleRanges cannot be used to free up scrolling
// without also disabling vertical reordering. Instead we disambiguate scroll-vs-drag
// the way the backend intends:
//   - delayTouchStart: a drag only arms after a deliberate press-and-hold. A normal
//     scroll moves the finger immediately, which clears the arm timer → page scrolls.
//     Raised 150→200ms so a brief finger-rest before scrolling no longer arms a drag
//     ("primed to treat any touch as a drag" on mobile).
//   - touchSlop: after arming, the pointer must travel this many px before a drag
//     actually begins (was 0 = any sub-pixel move). A small dead-zone absorbs jitter.
// delayTouchStart is touch-only (mouse uses delayMouseStart=0 → instant desktop drag).
// touchSlop, however, applies to BOTH touch and mouse, so desktop drags now need 10px
// of travel to begin — a harmless dead-zone that also suppresses accidental click-drags,
// and well below the 20px move the mouse-driven E2E drag helper dispatches.
const touchBackendOptions = {
  enableMouseEvents: true,
  delayTouchStart: 200,
  touchSlop: 10,
};

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <QueryClientSetup>
    <CookiesProvider>
      <AuthContextProvider>
        <AppContextProvider>
          <ThemeWrapper>
          <DndProvider backend={TouchBackend} options={touchBackendOptions}>
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
                    <Route path="swarm/requirement/:id" element= {<AuthenticatedRoute>
                                                             <RequirementDetail />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/sessions" element= {<AuthenticatedRoute>
                                                             <SessionsView />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/swarm-starts" element= {<AuthenticatedRoute>
                                                             <SwarmStartsPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/swarm-starts/:id" element= {<AuthenticatedRoute>
                                                             <SwarmStartDetail />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/swarm-undos" element= {<AuthenticatedRoute>
                                                             <SwarmUndosPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/swarm-undos/:id" element= {<AuthenticatedRoute>
                                                             <SwarmUndoDetail />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/swarm-completes" element= {<AuthenticatedRoute>
                                                             <SwarmCompletesPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/swarm-completes/:id" element= {<AuthenticatedRoute>
                                                             <SwarmCompleteDetail />
                                                         </AuthenticatedRoute>} />
<Route path="swarm/session/:id" element= {<AuthenticatedRoute>
                                                             <SwarmSessionDetail />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/features" element= {<AuthenticatedRoute>
                                                             <FeaturesPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/testcases" element= {<AuthenticatedRoute>
                                                             <TestCasesPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/testplans" element= {<AuthenticatedRoute>
                                                             <TestPlansPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/testruns" element= {<AuthenticatedRoute>
                                                             <TestRunsPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/testruns/:id" element= {<AuthenticatedRoute>
                                                             <TestRunDetail />
                                                         </AuthenticatedRoute>} />
                    <Route path="setup"      element= {<AuthenticatedRoute>
                                                             <SetupWizard />
                                                         </AuthenticatedRoute>} />
                    <Route path="devservers" element= {<AuthenticatedRoute>
                                                             <DevServersView />
                                                         </AuthenticatedRoute>} />
                    <Route path="swarm/machines" element= {<AuthenticatedRoute>
                                                             <MachinesView />
                                                         </AuthenticatedRoute>} />
                    {/* Agents registry (req #2998). React Router v6 ranks routes by
                        SPECIFICITY, not declaration order, so the two literal
                        sub-routes outrank "agents/:id" wherever they appear —
                        "instructions"/"documents" can never be matched as an agent
                        id. They are listed first for readability only. */}
                    <Route path="agents" element= {<AuthenticatedRoute>
                                                             <AgentsPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="agents/instructions" element= {<AuthenticatedRoute>
                                                             <InstructionsPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="agents/documents" element= {<AuthenticatedRoute>
                                                             <DocumentsPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="agents/context" element= {<AuthenticatedRoute>
                                                             <ContextPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="agents/:id" element= {<AuthenticatedRoute>
                                                             <AgentDetail />
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
                    <Route path="maps/settings/photos" element= {<AuthenticatedRoute>
                                                             <PhotoSettingsView />
                                                         </AuthenticatedRoute>} />
                    <Route path="maps/photos/:runId" element= {<AuthenticatedRoute>
                                                             <PhotoBrowser />
                                                         </AuthenticatedRoute>} />
                    <Route path="maps/:runId" element= {<AuthenticatedRoute>
                                                             <RouteDetailView />
                                                         </AuthenticatedRoute>} />
                    <Route path="customers" element= {<AuthenticatedRoute>
                                                             <CustomersPage />
                                                         </AuthenticatedRoute>} />
                    <Route path="customer-releases" element= {<AuthenticatedRoute>
                                                             <CustomerReleasesPage />
                                                         </AuthenticatedRoute>} />
                    {import.meta.env.DEV && <>
                      <Route path="systems2" element= {<AuthenticatedRoute>
                                                             <SystemsPage2 />
                                                         </AuthenticatedRoute>} />
                      <Route path="build-visualizer" element= {<AuthenticatedRoute>
                                                             <BuildVisualizerPage />
                                                         </AuthenticatedRoute>} />
                    </>}
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
