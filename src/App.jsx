import './index.css';

import { Outlet } from "react-router-dom"

import NavBar from './NavBar/NavBar'
import { SnackBar } from './Components/SnackBar/SnackBar';
import { useSnackBarStore } from './stores/useSnackBarStore';

const App = () => {

    const snackBarOpen = useSnackBarStore(s => s.open);
    const snackBarMessage = useSnackBarStore(s => s.message);
    const setSnackBarOpen = (open) => {
        if (!open) useSnackBarStore.getState().close();
    };

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
