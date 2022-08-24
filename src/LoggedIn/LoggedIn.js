import varDump from '../classifier/classifier';
import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';

import React, { useEffect, useContext, useState } from "react";
import { useLocation, Navigate } from "react-router-dom"
import { useCookies } from 'react-cookie';

import Typography from '@mui/material/Typography';

function  LoggedIn() {

    console.count('LoggedIn Render');
    const { idToken, setIdToken, 
            accessToken, setAccessToken, 
            profile, setProfile, } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [cookies, setCookie, removeCookie] = useCookies(['csrfToken']);

    const [errorMsg, setErrorMsg] = useState('');
    
    let location = useLocation();

    useEffect( () => {
        console.log('loggedin useEffect called');

        // STEP 1: verify CSRF token match and presence of id/access tokens
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

        // STEP 2: id token is JWT format, need to parse and verify the hash is valid
        
        let uri = `${darwinUri}/jwt`;
        let body = {'idToken': newIdToken}
        var cognitoUserName = ''
        call_rest_api(uri, 'POST', body, `${newIdToken}`)
            .then(result => {
                cognitoUserName = result.data['username'];

                //STEP 3 read the database and populate user information into react state
                uri = `${darwinUri}/profiles?id=${cognitoUserName}`;
                body = '';
                call_rest_api(uri, 'GET', body, `${newIdToken}`)
                    .then(result => {
                        setProfile(result.data[0]);
                    }).catch(error => {
                        varDump(error, 'Retrieve user Profile: Error Data');
                    });
            }).catch(error => {
                varDump(error, 'JWT Verify: Call to JWT returned an error');
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
