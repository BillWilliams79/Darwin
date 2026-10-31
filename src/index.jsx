// FIRST, before any app module evaluates: the Bug button's always-on console /
// error / network / navigation buffers (req #3815) — see utils/debugCapture.js.
import './utils/debugCapture';
import './index.css';
import AuthenticatedRoute from './Components/AuthenticatedRoute/AuthenticatedRoute';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import { AuthContextProvider } from './Context/AuthContext'
import { AppContextProvider } from './Context/AppContext';
import { CookiesProvider } from 'react-cookie';
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
import TestCasesPage from './TestCatalog/TestCasesPage';
import TestPlansPage from './TestCatalog/TestPlansPage';
import { TestRunsPage, TestRunDetail } from './TestCatalog/TestRunsPage';
import SwarmStartsPage from './SwarmStarts/SwarmStartsPage';
import SwarmStartDetail from './SwarmStarts/SwarmStartDetail';
import SwarmUndosPage from './SwarmUndos/SwarmUndosPage';
import SwarmUndoDetail from './SwarmUndos/SwarmUndoDetail';
import SwarmCompletesPage from './SwarmCompletes/SwarmCompletesPage';
import SwarmCompleteDetail from './SwarmCompletes/SwarmCompleteDetail';
import PipelineDetail from './SwarmView/pipelines/PipelineDetail';
// req #3463 — the route STRINGS come from the same module the link builders
// use, so a matcher and a builder cannot disagree about what a plan URL is.
import {
    planDetailRoutePath, planListRoutePath,
} from './SwarmView/pipelines/planEra';
// The plan-layer editors (req #3393). They stood on their own `2`-suffixed
// routes beside a parallel 1.0 era until req #3356 eradicated it; they now hold
// the plain routes outright.
import PipelinesPage from './Pipelines/PipelinesPage';
import InitiativesPage from './Initiatives/InitiativesPage';
import EpicsPage from './Epics/EpicsPage';
import EnginesPage from './SwarmView/engine/EnginesPage';
import { ENGINES_ROUTE } from './SwarmView/engine/enginePaths';
import SystemsPage2 from './Systems/SystemsPage2';
import BuildVisualizerPage from './BuildVisualizer/BuildVisualizerPage';
import CustomersPage from './Customers/CustomersPage';
import CustomerReleasesPage from './CustomerReleases/CustomerReleasesPage';
import {
    SCOPE_ALL, HAS_TASKS, HAS_MAPS, HAS_SWARM, HAS_SWARM_VALIDATE as HAS_VALIDATE, PROXY_AUTH,
} from './config/product';
import { TOPOLOGY_ON, BUILD_TOOLS_ON } from './NavBar/navConfig';

// req #4076 — which ROUTES this build carries. The product's application scope
// is a build-time constant (config/product.js), so each `{X && <Route/>}` below
// folds and the internal build (Topology + Swarm) does not contain the pages it
// does not route to. darwin.one's scope is "all": every gate is true and the
// route table is what it was. Proxy auth (internal) has no login, signup,
// logout or OAuth-callback page — the server authenticates.
// Setup wizard (timezone onboarding after a first Cognito login), Customers and
// Customer Releases are darwin.one-only.
const DARWIN_ONE_ONLY = SCOPE_ALL;
const COGNITO_PAGES = !PROXY_AUTH;


const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <QueryClientSetup>
    <CookiesProvider>
      <AuthContextProvider>
        <AppContextProvider>
          <ThemeWrapper>
            <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <div className="app-layout">
              <Routes>
                <Route path="/"                element= {<App />} >
                    <Route index               element= {<HomePage />} />
                    {COGNITO_PAGES && <Route path="login"        element= {<LoginPage />} />}
                    {COGNITO_PAGES && <Route path="signup"       element= {<SignupPage />} />}
                    {COGNITO_PAGES && <Route path="logout"       element= {<LogoutPage />} />}
                    {COGNITO_PAGES && <Route path="loggedin"     element= {<LoggedIn />} />}
                    {HAS_TASKS && <Route path="taskcards"    element= {<AuthenticatedRoute>
                                                             <TaskPlanView />
                                                         </AuthenticatedRoute>} />}
                    {HAS_TASKS && <Route path="calview"      element= {<AuthenticatedRoute>
                                                             <CalendarFC />
                                                         </AuthenticatedRoute>} />}
                    {HAS_TASKS && <Route path="areaedit"     element= {<AuthenticatedRoute>
                                                             <AreaEdit />
                                                         </AuthenticatedRoute>} />}
                    {HAS_TASKS && <Route path="domainedit"   element= {<AuthenticatedRoute>
                                                             <DomainEdit />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="projectedit"  element= {<AuthenticatedRoute>
                                                             <ProjectEdit />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="categoryedit" element= {<AuthenticatedRoute>
                                                             <CategoryEdit />
                                                         </AuthenticatedRoute>} />}
                    <Route path="profile"      element= {<Profile />} />
                    {HAS_SWARM && <Route path="swarm"        element= {<AuthenticatedRoute>
                                                             <SwarmView />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="swarm/requirement/:id" element= {<AuthenticatedRoute>
                                                             <RequirementDetail />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="swarm/sessions" element= {<AuthenticatedRoute>
                                                             <SessionsView />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="swarm/swarm-starts" element= {<AuthenticatedRoute>
                                                             <SwarmStartsPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="swarm/swarm-starts/:id" element= {<AuthenticatedRoute>
                                                             <SwarmStartDetail />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="swarm/swarm-undos" element= {<AuthenticatedRoute>
                                                             <SwarmUndosPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="swarm/swarm-undos/:id" element= {<AuthenticatedRoute>
                                                             <SwarmUndoDetail />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="swarm/swarm-completes" element= {<AuthenticatedRoute>
                                                             <SwarmCompletesPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="swarm/swarm-completes/:id" element= {<AuthenticatedRoute>
                                                             <SwarmCompleteDetail />
                                                         </AuthenticatedRoute>} />}
{HAS_SWARM && <Route path="swarm/session/:id" element= {<AuthenticatedRoute>
                                                             <SwarmSessionDetail />
                                                         </AuthenticatedRoute>} />}
                    {/* Swarm Orchestration plan routes (req #3114; the single
                        surviving era since req #3356). React Router v6 ranks by
                        SPECIFICITY, so the literal "swarm/pipelines" and the
                        parameterised "swarm/pipeline/:id" cannot shadow each
                        other — the singular/plural split is deliberate.

                        req #3356 deleted the Pipeline 1.0 pair that stood on
                        these exact paths and moved the surviving pages onto
                        them, dropping the `2` suffixes the parallel era needed.
                        `PipelineDetail` no longer takes an `era` prop at all:
                        with one era there is no choice for a route to make, and
                        passing one would re-introduce the very
                        two-facts-one-question shape `planEra.js` exists to
                        remove. The paths still come from `planEra.js` rather
                        than from literals, because that module remains the one
                        place a plan route is spelled and its own test fails the
                        build on a route literal anywhere else in `src/`. */}
                    {HAS_SWARM && <Route path={planListRoutePath()} element= {<AuthenticatedRoute>
                                                             <PipelinesPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path={planDetailRoutePath()} element= {<AuthenticatedRoute>
                                                             <PipelineDetail />
                                                         </AuthenticatedRoute>} />}
                    {/* The plan-layer editors, initiative and epic tiers (req #3393).
                        The pipelines LIST route above already carries the plans
                        themselves; these two are not "plan routes" in
                        planEra.js's sense (they list initiatives/epics, not plans) so
                        they stay literal here. */}
                    {HAS_SWARM && <Route path="swarm/initiatives" element= {<AuthenticatedRoute>
                                                             <InitiativesPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="swarm/epics" element= {<AuthenticatedRoute>
                                                             <EpicsPage />
                                                         </AuthenticatedRoute>} />}
                    {/* req #3760 — the orchestration engines, machine-wide. */}
                    {HAS_SWARM && <Route path={ENGINES_ROUTE} element= {<AuthenticatedRoute>
                                                             <EnginesPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_VALIDATE && <Route path="swarm/testcases" element= {<AuthenticatedRoute>
                                                             <TestCasesPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_VALIDATE && <Route path="swarm/testplans" element= {<AuthenticatedRoute>
                                                             <TestPlansPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_VALIDATE && <Route path="swarm/testruns" element= {<AuthenticatedRoute>
                                                             <TestRunsPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_VALIDATE && <Route path="swarm/testruns/:id" element= {<AuthenticatedRoute>
                                                             <TestRunDetail />
                                                         </AuthenticatedRoute>} />}
                    {DARWIN_ONE_ONLY && <Route path="setup"      element= {<AuthenticatedRoute>
                                                             <SetupWizard />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="devservers" element= {<AuthenticatedRoute>
                                                             <DevServersView />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="swarm/machines" element= {<AuthenticatedRoute>
                                                             <MachinesView />
                                                         </AuthenticatedRoute>} />}
                    {/* Agents registry (req #2998). React Router v6 ranks routes by
                        SPECIFICITY, not declaration order, so the two literal
                        sub-routes outrank "agents/:id" wherever they appear —
                        "instructions"/"documents" can never be matched as an agent
                        id. They are listed first for readability only. */}
                    {HAS_SWARM && <Route path="agents" element= {<AuthenticatedRoute>
                                                             <AgentsPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="agents/instructions" element= {<AuthenticatedRoute>
                                                             <InstructionsPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="agents/documents" element= {<AuthenticatedRoute>
                                                             <DocumentsPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="agents/context" element= {<AuthenticatedRoute>
                                                             <ContextPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_SWARM && <Route path="agents/:id" element= {<AuthenticatedRoute>
                                                             <AgentDetail />
                                                         </AuthenticatedRoute>} />}
                    {HAS_TASKS && <Route path="recurring" element= {<AuthenticatedRoute>
                                                             <RecurringPlanView />
                                                         </AuthenticatedRoute>} />}
                    {HAS_MAPS && <Route path="maps" element= {<AuthenticatedRoute>
                                                             <MapsPage />
                                                         </AuthenticatedRoute>} />}
                    {HAS_MAPS && <Route path="maps/import" element= {<AuthenticatedRoute>
                                                             <CyclemeterImport />
                                                         </AuthenticatedRoute>} />}

                    {HAS_MAPS && <Route path="maps/settings/routes" element= {<AuthenticatedRoute>
                                                             <MapRouteSettingsView />
                                                         </AuthenticatedRoute>} />}
                    {HAS_MAPS && <Route path="maps/settings/partners" element= {<AuthenticatedRoute>
                                                             <MapPartnerSettingsView />
                                                         </AuthenticatedRoute>} />}
                    {HAS_MAPS && <Route path="maps/settings/photos" element= {<AuthenticatedRoute>
                                                             <PhotoSettingsView />
                                                         </AuthenticatedRoute>} />}
                    {HAS_MAPS && <Route path="maps/photos/:runId" element= {<AuthenticatedRoute>
                                                             <PhotoBrowser />
                                                         </AuthenticatedRoute>} />}
                    {HAS_MAPS && <Route path="maps/:runId" element= {<AuthenticatedRoute>
                                                             <RouteDetailView />
                                                         </AuthenticatedRoute>} />}
                    {DARWIN_ONE_ONLY && <Route path="customers" element= {<AuthenticatedRoute>
                                                             <CustomersPage />
                                                         </AuthenticatedRoute>} />}
                    {DARWIN_ONE_ONLY && <Route path="customer-releases" element= {<AuthenticatedRoute>
                                                             <CustomerReleasesPage />
                                                         </AuthenticatedRoute>} />}
                    {TOPOLOGY_ON && <Route path="systems2" element= {<AuthenticatedRoute>
                                                             <SystemsPage2 />
                                                         </AuthenticatedRoute>} />}
                    {BUILD_TOOLS_ON && <Route path="build-visualizer" element= {<AuthenticatedRoute>
                                                             <BuildVisualizerPage />
                                                         </AuthenticatedRoute>} />}
                </Route >
                <Route path="*"                element= {<Error404 />} />
              </Routes>
            </div>
          </Router>
          </ThemeWrapper>
        </AppContextProvider>
      </AuthContextProvider>
    </CookiesProvider>
  </QueryClientSetup>
);
