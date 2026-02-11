// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import AuthContext from '../../Context/AuthContext'

import {React, useContext} from 'react'
import {Navigate, useLocation } from 'react-router-dom';


const AuthenticatedRoute = ({children}) => {
    const { idToken, profile } = useContext(AuthContext);
    const location = useLocation();

    if ((profile?.userName === undefined) ||
        (idToken === '')) {

        // user is not loggedin, process login via LoginLink component
        // while saving the current URL for redirect
        return <Navigate to="/login" replace={true} state={{ from: location }} />;

    } else {

        // User is authanticated, so allow access to child component
        return children
    }
}

export default AuthenticatedRoute
