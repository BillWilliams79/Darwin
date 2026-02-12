// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import { useEffect } from 'react';
import { useLocation } from "react-router-dom"
import cryptoRandomString from 'crypto-random-string';
import { useCookies } from 'react-cookie';
import { generateCodeVerifier, generateCodeChallenge, storeCodeVerifier } from '../../services/pkce';
import { buildLoginUrl } from '../../services/authService';

const LoginLink = () => {

    // Login Link provides a mechanism for AuthenticatedRoute to call the AWS login handler
    // and then return to the original page. Cookie data picked up in LoggedIn component.

    // eslint-disable-next-line no-unused-vars
    const [cookies, setCookie] = useCookies(['csrfToken']);
    const location = useLocation();

    useEffect(() => {
        async function initiateLogin() {
            // Store return path for post-login redirect
            const redirectPath = location?.state?.from.pathname || "/";
            setCookie('redirectPath', redirectPath, {path: '/', maxAge: 600});

            // CSRF state parameter
            const csrf = cryptoRandomString({length: 64, type: 'alphanumeric'});
            setCookie('csrfToken', csrf, { path: '/', maxAge: 3600 });

            // PKCE challenge
            const codeVerifier = generateCodeVerifier();
            storeCodeVerifier(codeVerifier);
            const codeChallenge = await generateCodeChallenge(codeVerifier);

            // Redirect to Cognito hosted UI with auth code + PKCE
            window.location = buildLoginUrl(csrf, codeChallenge);
        }
        initiateLogin();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return null;
}

export default LoginLink;
