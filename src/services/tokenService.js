// Token service — the LIVE token path, used by the custom USER_SRP_AUTH login flow.
//
// Split out of `authService.js` by req #3291. Everything here is on a reachable path:
// `AuthContext.jsx` calls `refreshTokens()` for silent re-authentication (on mount and on the
// scheduled pre-expiry timer) and `parseIdToken()` to derive the profile from the ID token.
// Neither has anything to do with the deprecated Hosted-UI authorization-code flow that the
// remainder of `authService.js` serves.
//
// Uses fetch directly against Cognito's /oauth2/token endpoint. No AWS SDK needed.

import { AUTH_CONFIG } from '../config/auth';

const TOKEN_ENDPOINT = `https://${AUTH_CONFIG.domain}/oauth2/token`;

export async function refreshTokens(refreshToken) {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: AUTH_CONFIG.clientId,
        refresh_token: refreshToken,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!response.ok) {
        throw new Error(`Token refresh failed (${response.status})`);
    }

    const data = await response.json();
    return {
        idToken: data.id_token,
        accessToken: data.access_token,
        // Cognito refresh response does not include a new refresh_token — the original stays valid
        expiresIn: data.expires_in,
    };
}

export function parseIdToken(jwt) {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    return {
        id: payload['cognito:username'],
        userName: payload['cognito:username'],
        email: payload.email,
        sub: payload.sub,
    };
}
