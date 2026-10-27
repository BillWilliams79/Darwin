import './index.css';

import { useEffect } from 'react';
import { Outlet, useLocation } from "react-router-dom"

import NavBar from './NavBar/NavBar'
import DevServerDashboard from './DevServers/DevServerDashboard';
import DevServerActionPopup from './NavBar/DevServerActionPopup';
import RequirementFiler from './RequirementFiler/RequirementFiler';
import RequirementEditorPopup from './RequirementFiler/RequirementEditorPopup';
import LastHoveredHighlight from './RequirementFiler/LastHoveredHighlight';
import FilerDataScope from './RequirementFiler/filerScope';
import { SnackBar } from './Components/SnackBar/SnackBar';
import { useSnackBarStore } from './stores/useSnackBarStore';
import { noteRoute } from './utils/routeTrail';
import { installFocusCapture } from './utils/focusCapture';

const App = () => {

    const snackBarOpen = useSnackBarStore(s => s.open);
    const snackBarMessage = useSnackBarStore(s => s.message);
    const snackBarDuration = useSnackBarStore(s => s.duration);
    const snackBarAction = useSnackBarStore(s => s.action);
    const setSnackBarOpen = (open) => {
        if (!open) useSnackBarStore.getState().close();
    };

    // req #3431 — the app shell is the ONLY component mounted across every
    // navigation, so it is the only place that can record which route the reader
    // came from. `/swarm/pipelines` resumes the plan they last had open, and that
    // redirect must not fire when they arrive FROM a plan (the nav rail, or Back)
    // or the list becomes unreachable. See `utils/routeTrail.js` for why this is
    // a module rather than a store: nothing renders from it, so the write must
    // not re-render anything either.
    //
    // PATHNAME ONLY, never `location.search`: the question is "was that a plan
    // page", and `?mode=` changes a view of a plan, not the page.
    const { pathname } = useLocation();
    useEffect(() => { noteRoute(pathname); }, [pathname]);

    // req #3652 — the focus timeline and the Ctrl+Shift+F capture run app-wide
    // from start-up: the event worth capturing is the one nobody planned for.
    // See `utils/focusCapture.js`.
    useEffect(() => { installFocusCapture(); }, []);

    return (
        <>
            <NavBar className="app-navbar" />
            <Outlet />
            {/* req #3643 — docked to the viewport, over every page */}
            <DevServerDashboard />
            {/* req #3727 — dev builds only; racked in the navbar by default */}
            <DevServerActionPopup />
            {/* req #3811 — opened from the navbar's filer control, on every page;
                files into production from every build (req #3888) */}
            <FilerDataScope>
                <RequirementFiler />
                <RequirementEditorPopup />
                <LastHoveredHighlight />
            </FilerDataScope>
            <SnackBar snackBarOpen={snackBarOpen}
                      setSnackBarOpen={setSnackBarOpen}
                      snackBarMessage={snackBarMessage}
                      autoHideDuration={snackBarDuration}
                      snackBarAction={snackBarAction} />
        </>
    );
}

export default App;
