// Auth service — the Cognito Hosted-UI authorization-code (PKCE) token exchange.
//
// This module serves ONE consumer: `LoggedIn/LoggedIn.jsx`, the `/loggedin` OAuth callback.
// Darwin's own login has been the custom `/login` form over USER_SRP_AUTH since 2026-03-14, and
// no routed path performs the authorization redirect any more.
//
// It survives (req #3291) because `/loggedin/` is still LIVE CONFIG: the login page's
// "Forgot password?" anchor (`LoginPage.jsx`) sends users to the Cognito Hosted UI's
// /forgotPassword endpoint with `redirect_uri=<VITE_LOGIN_REDIRECT>` = `.../loggedin/`. Whether
// Cognito actually returns the browser there after a completed reset is UNVERIFIED — it needs a
// live production password-reset test — so the callback is kept rather than deleted.
//
// The dead URL builders that used to live here (`buildLoginUrl`, `buildSignupUrl`,
// `buildLogoutUrl`) were deleted with their only callers, `LoginLink`/`LogoutLink`. The LIVE
// token functions (`refreshTokens`, `parseIdToken`) moved to `tokenService.js`.
//
// Uses fetch directly against Cognito's /oauth2/token endpoint. No AWS SDK needed.

import { AUTH_CONFIG } from '../config/auth';

const TOKEN_ENDPOINT = `https://${AUTH_CONFIG.domain}/oauth2/token`;

export async function exchangeCodeForTokens(code, codeVerifier) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: AUTH_CONFIG.clientId,
        code: code,
        redirect_uri: AUTH_CONFIG.redirectSignIn,
        code_verifier: codeVerifier,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return {
        idToken: data.id_token,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
    };
}
