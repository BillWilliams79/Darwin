// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import {SnackBar, snackBarError} from '../Components/SnackBar/SnackBar';

import React, { useEffect, useContext, useState } from "react";
import { useLocation, Navigate } from "react-router-dom"
import { useCookies } from 'react-cookie';

import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

function  LoggedIn() {

    console.count('LoggedIn Render');
    const { idToken, setIdToken, 
            setAccessToken, 
            profile, setProfile, } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [cookies, setCookie, removeCookie] = useCookies(['csrfToken', 'idToken', 'accessToken']);

    const [errorMsg, setErrorMsg] = useState('');
    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');
    const [redirectPath, setRedirectPath] = useState();
        
    let location = useLocation();

    useEffect( () => {
        console.log('loggedin useEffect called');

        // STEP 1: verify CSRF token match and presence of id/access tokens.
        //         Fail if criteria not met with appropriate message.

        const hashParams = {};

        if (location.hash) {

            // implicit grant oath flow returns ID and access tokens as hash string
            var generatedCsrf = cookies?.csrfToken;
            removeCookie('csrfToken', { path: '/', maxAge: 1800 });

            // parse hash(#) params
            location.hash.slice(1).split('&').map( qspString => {
                let splitString = qspString.split('=');
                hashParams[splitString[0]] = splitString[1];
                return null;
            });
            var returnedCsrfToken = hashParams?.state;

            // CSRF token verification
            if (returnedCsrfToken.localeCompare(generatedCsrf)) {
                // CSRF does not match - do not proceed to acquire tokens. User is not properly logged in
                // what to do? return to home page? display a not logged in page or alternate text on this page
                console.log('CSRF match failed, not logged in');
                setErrorMsg('CSRF Tokens did not match, invalid redirect from AWS');
                return;
            }

            // retrieve and verify ID and Access Tokens provided
            var newIdToken = hashParams?.id_token;
            var newAccessToken = hashParams?.access_token;

            if (!((newIdToken) && (newAccessToken))) {
                console.log('Tokens are missing, not logged in');
                setErrorMsg('Access credentials not returned from login service');
                return;
            }

        } else {
            console.log('error no hash params, not logged in')
            setErrorMsg('No hash paramaters returned from login service, hence credentials unavailable.');
            return;
        } 

        // STEP 2: id token is JWT format, need to parse and verify the hash is valid
        
        let uri = `${darwinUri}/jwt`;
        let body = {'idToken': newIdToken}

        // Arbitrarily use a post call so we can encode the token in the body instead of QSP
        call_rest_api(uri, 'POST', body, `${newIdToken}`)
            .then(result => {

                // after verification, store tokens and expiry in cookie
                // Tokens are good for 24 hours, so expire the cookie at 24 hours - 5 mins to force re-login
                setCookie('idToken', newIdToken, { path: '/', maxAge: ((24 * 3600) - 300), secure: true });
                setCookie('accessToken', newAccessToken, { path: '/', maxAge: ((24 * 3600) - 300), secure: true });

                // @ initial login, also need to populate react context copies of tokens as the app uses 
                // these throughout.
                setIdToken(newIdToken);
                setAccessToken(newAccessToken);

                //STEP 3: Read the database and populate user information into react state
                uri = `${darwinUri}/profiles?id=${result.data['username']}`;
                body = '';

                call_rest_api(uri, 'GET', body, `${newIdToken}`)
                    .then(result => {
                        if (result.httpStatus.httpStatus === 200) {
                            // profile information ages out same time as the tokens
                            setProfile(result.data[0]);
                            setCookie('profile', result.data[0], { path: '/', maxAge: ((24 * 3600) - 300), secure: true })
                        } else {
                            snackBarError(result, 'Unable to read user profile data', setSnackBarMessage, setSnackBarOpen)
                        }
                    }).catch(error => {
                        snackBarError(error, 'Unable to read user profile data', setSnackBarMessage, setSnackBarOpen)
                    });
            }).catch(error => {
                console.log('Access token returned from authentication system is invalid.');
                setErrorMsg('Access token returned from authentication system is invalid.');
                return;
            });

            //STEP 4: determine location to navigate post login - either default or the page
            //        from which the login was initiated, value is stored in a cookie.
            setRedirectPath(cookies?.redirectPath || "/");
            removeCookie('redirectPath', {path: '/', maxAge: 600});

        //eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location])

    return (
        <>
            {(idToken && profile && redirectPath) ?
                <Navigate to={redirectPath} replace={true} />
            :
                <>
                    {errorMsg ?
                            <>
                                <Typography className="app-title" variant="h3">
                                    Login unsuccessful, error message below
                                </Typography>
                                <Typography className="app-content" variant="body1" component="p"> 
                                    {errorMsg}
                                </Typography>
                            </>
                    :
                        <CircularProgress />
                    }
                </>
            }
            <SnackBar {...{snackBarOpen,
                           setSnackBarOpen,
                           snackBarMessage,}} />
        </>
    )
}

export default LoggedIn;
