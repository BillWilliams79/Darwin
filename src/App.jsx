import './index.css';

import { useEffect } from 'react';
import { Outlet, useLocation } from "react-router-dom"

import NavBar from './NavBar/NavBar'
import { SnackBar } from './Components/SnackBar/SnackBar';
import { useSnackBarStore } from './stores/useSnackBarStore';
import { noteRoute } from './utils/routeTrail';

const App = () => {

    const snackBarOpen = useSnackBarStore(s => s.open);
    const snackBarMessage = useSnackBarStore(s => s.message);
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

    return (
        <>
            <NavBar className="app-navbar" />
            <Outlet />
            <SnackBar snackBarOpen={snackBarOpen}
                      setSnackBarOpen={setSnackBarOpen}
                      snackBarMessage={snackBarMessage} />
        </>
    );
}

export default App;
