import varDump from '../classifier/classifier';
import call_rest_api from '../RestApi/RestApi';
import AppContext from '../Context/AppContext';

import React, { useEffect, useContext, useState } from "react";
import { useLocation, Navigate } from "react-router-dom"
import { useCookies } from 'react-cookie';

import Typography from '@mui/material/Typography';

function  LoggedIn() {

    const [errorMsg, setErrorMsg] = useState('');

    console.log('LoggedIn Render');
    const [cookies, setCookie, removeCookie] = useCookies(['csrfToken']);

    const { idToken, setIdToken, 
            accessToken, setAccessToken, 
            profile, setProfile, } = useContext(AppContext);
    
    let location = useLocation();

    useEffect( () => {

        // STEP 1: id token is JWT format, need to parse and verify the hash is valid
        // TODO: Implement api / lambda to verify on the backend.

        // STEP 2: verify CSRF token match and presence of id/access tokens
        const hashParams = {};
        if (location.hash) {

            // implicit grant oath flow returns ID and access tokens as hash string
            var generatedCsrf = cookies?.csrfToken;
            removeCookie('csrfToken', { path: '/', maxAge: 1800 });

            // parse hash(#) params
            location.hash.slice(1).split('&').map( qspString => {
                let splitString = qspString.split('=');
                hashParams[splitString[0]] = splitString[1]
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

            setIdToken(newIdToken);
            setAccessToken(newAccessToken);

        } else {
            console.log('error no hash params, not logged in')
            setErrorMsg('No hash paramaters returned from login service, hence credentials unavailable.');
            return;

        } 
        /* else {
            // NOTE: At present auth code path is not supported. Leave starting point of code in place for now.
            var returnedCsrfToken = searchParams.get('state');
            var generatedCsrf = cookies?.csrfToken;
            removeCookie('csrfToken', { path: '/', maxAge: 1800 });

            if (!returnedCsrfToken.localeCompare(generatedCsrf)) {
                // CSRF matches - proceed to acquire tokens, store in state
                var returnedCode = searchParams.get('code');
                setCode(returnedCode);
    
            } else {
                // CSRF does not match - do not proceed to acquire tokens. User is not properly logged in
                // what to do? return to home page? display a not logged in page or alternate text on this page
                console.log('CSRF match failed, not logged in');
            }
        } */

        //STEP 3 read the database and populate user information into react state
        let url = 'https://l4pdv6n3wg.execute-api.us-west-1.amazonaws.com/eng/user_information/profiles?id=1';
        let body = '';
        call_rest_api(url, 'GET', body, `${newIdToken}`)
            .then(result => {
                setProfile(result.data[0]);
            }).catch(error => {
                varDump(error, 'error state for retrieve table data');
            });
    }, [location])

    return (
        <>
            {idToken ?
                <Navigate to="/" replace={true} />
            :
                <>
                <Typography className="app-title" variant="h3">
                    Login unsuccessful, error message below
                </Typography>
                {errorMsg &&
                    <Typography className="app-content" variant="body1" component="p"> 
                        {errorMsg}
                    </Typography>
                }
                </>
            }
        </>
    )
}

export default LoggedIn;
