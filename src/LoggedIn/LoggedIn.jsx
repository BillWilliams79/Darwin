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

import { exchangeCodeForTokens, parseIdToken } from '../services/authService';
import { getAndClearCodeVerifier } from '../services/pkce';

// 90 days in seconds
const REFRESH_TOKEN_MAX_AGE = 90 * 24 * 3600;

function LoggedIn() {

    console.count('LoggedIn Render');
    const { idToken, setIdToken,
            setAccessToken,
            profile, setProfile,
            scheduleRefresh } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [cookies, setCookie, removeCookie] = useCookies(['csrfToken', 'refreshToken']);

    const [errorMsg, setErrorMsg] = useState('');
    const [snackBarOpen, setSnackBarOpen] = useState(false);
    const [snackBarMessage, setSnackBarMessage] = useState('');
    const [redirectPath, setRedirectPath] = useState();

    let location = useLocation();

    useEffect( () => {
        console.log('LoggedIn useEffect called');

        // STEP 1: Parse authorization code and state from query params.
        //         Auth code flow returns ?code=xxx&state=yyy (not hash fragments).
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        const returnedState = params.get('state');

        if (!code) {
            setErrorMsg('No authorization code returned from login service');
            return;
        }

        // CSRF token verification
        const generatedCsrf = cookies?.csrfToken;
        removeCookie('csrfToken', { path: '/', maxAge: 1800 });

        if (returnedState !== generatedCsrf) {
            console.log('CSRF match failed, not logged in');
            setErrorMsg('CSRF Tokens did not match, invalid redirect from AWS');
            return;
        }

        // Retrieve PKCE code_verifier stored before redirect
        const codeVerifier = getAndClearCodeVerifier();
        if (!codeVerifier) {
            setErrorMsg('PKCE code verifier missing — please try logging in again');
            return;
        }

        // STEP 2: Exchange authorization code for tokens via Cognito /oauth2/token
        exchangeCodeForTokens(code, codeVerifier)
            .then(tokens => {
                // Store refresh token in a Secure cookie for session persistence across reloads
                setCookie('refreshToken', tokens.refreshToken, {
                    path: '/',
                    maxAge: REFRESH_TOKEN_MAX_AGE,
                    secure: true,
                    sameSite: 'strict',
                });

                // Set tokens in React context (memory only, no token cookies)
                setIdToken(tokens.idToken);
                setAccessToken(tokens.accessToken);

                // STEP 3: Validate ID token via Lambda-JWT (same as before)
                const jwtUri = `${darwinUri}/jwt`;
                const jwtBody = {'idToken': tokens.idToken};

                return call_rest_api(jwtUri, 'POST', jwtBody, tokens.idToken)
                    .then(result => {
                        // STEP 4: Read user profile from database
                        const profileUri = `${darwinUri}/profiles?id=${result.data['username']}`;

                        return call_rest_api(profileUri, 'GET', '', tokens.idToken)
                            .then(result => {
                                if (result.httpStatus.httpStatus === 200) {
                                    setProfile(result.data[0]);
                                    // Schedule background token refresh (pass refresh token for the ref)
                                    scheduleRefresh(tokens.expiresIn, tokens.refreshToken);
                                } else {
                                    snackBarError(result, 'Unable to read user profile data', setSnackBarMessage, setSnackBarOpen);
                                }
                            }).catch(error => {
                                snackBarError(error, 'Unable to read user profile data', setSnackBarMessage, setSnackBarOpen);
                            });
                    });
            }).catch(error => {
                console.log('Authentication failed:', error.message);
                setErrorMsg('Authentication failed. Please try logging in again.');
                return;
            });

        // STEP 5: Determine post-login redirect path
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
