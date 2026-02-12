// Auth service — handles Cognito token exchange, refresh, and URL construction.
// Uses fetch directly against Cognito's /oauth2/token endpoint. No AWS SDK needed.

import { AUTH_CONFIG } from '../config/auth';

const TOKEN_ENDPOINT = `https://${AUTH_CONFIG.domain}/oauth2/token`;

export function buildLoginUrl(state, codeChallenge) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: AUTH_CONFIG.clientId,
        redirect_uri: AUTH_CONFIG.redirectSignIn,
        scope: AUTH_CONFIG.scopes.join(' '),
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });
    return `https://${AUTH_CONFIG.domain}/login?${params}`;
}

export function buildLogoutUrl() {
    const params = new URLSearchParams({
        client_id: AUTH_CONFIG.clientId,
        logout_uri: AUTH_CONFIG.redirectSignOut,
    });
    return `https://${AUTH_CONFIG.domain}/logout?${params}`;
}

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
        userName: payload['cognito:username'],
        email: payload.email,
        sub: payload.sub,
    };
}
