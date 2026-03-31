/**
 * @module services/stravaService
 * Strava API service — OAuth, token management (DB-backed + localStorage cache),
 * and activity/stream fetching.
 */

import { STRAVA_CONFIG } from '../config/strava';

// localStorage cache keys
const LS_ACCESS_TOKEN = 'strava_access_token';
const LS_REFRESH_TOKEN = 'strava_refresh_token';
const LS_EXPIRES_AT = 'strava_expires_at';
const LS_ATHLETE = 'strava_athlete';

// ---------------------------------------------------------------------------
// OAuth URL
// ---------------------------------------------------------------------------

/** Build the Strava OAuth authorization URL for the "Connect with Strava" redirect. */
export function buildAuthorizeUrl() {
    const params = new URLSearchParams({
        client_id: STRAVA_CONFIG.clientId,
        redirect_uri: STRAVA_CONFIG.redirectUri,
        response_type: 'code',
        scope: STRAVA_CONFIG.scopes,
        approval_prompt: 'auto',
    });
    return `${STRAVA_CONFIG.authorizeUrl}?${params}`;
}

// ---------------------------------------------------------------------------
// Token exchange & refresh (Strava API)
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for tokens.
 * @param {string} code - Authorization code from Strava redirect
 * @returns {Promise<{ access_token, refresh_token, expires_at, athlete }>}
 */
export async function exchangeCodeForTokens(code) {
    const res = await fetch(STRAVA_CONFIG.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: STRAVA_CONFIG.clientId,
            client_secret: STRAVA_CONFIG.clientSecret,
            code,
            grant_type: 'authorization_code',
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Strava token exchange failed (${res.status})`);
    }
    return res.json();
}

/**
 * Refresh an expired access token.
 * @param {string} refreshToken
 * @returns {Promise<{ access_token, refresh_token, expires_at }>}
 */
export async function refreshAccessToken(refreshToken) {
    const res = await fetch(STRAVA_CONFIG.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: STRAVA_CONFIG.clientId,
            client_secret: STRAVA_CONFIG.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Strava token refresh failed (${res.status})`);
    }
    return res.json();
}

// ---------------------------------------------------------------------------
// localStorage cache helpers
// ---------------------------------------------------------------------------

export function cacheTokensLocally(tokens) {
    localStorage.setItem(LS_ACCESS_TOKEN, tokens.access_token);
    localStorage.setItem(LS_REFRESH_TOKEN, tokens.refresh_token);
    localStorage.setItem(LS_EXPIRES_AT, String(tokens.expires_at));
    if (tokens.athlete) {
        localStorage.setItem(LS_ATHLETE, JSON.stringify(tokens.athlete));
    }
}

export function getCachedTokens() {
    const access_token = localStorage.getItem(LS_ACCESS_TOKEN);
    const refresh_token = localStorage.getItem(LS_REFRESH_TOKEN);
    const expires_at = Number(localStorage.getItem(LS_EXPIRES_AT));
    const athleteStr = localStorage.getItem(LS_ATHLETE);
    if (!access_token || !refresh_token) return null;
    return {
        access_token,
        refresh_token,
        expires_at,
        athlete: athleteStr ? JSON.parse(athleteStr) : null,
    };
}

export function clearCachedTokens() {
    localStorage.removeItem(LS_ACCESS_TOKEN);
    localStorage.removeItem(LS_REFRESH_TOKEN);
    localStorage.removeItem(LS_EXPIRES_AT);
    localStorage.removeItem(LS_ATHLETE);
}

function isTokenExpired(expiresAt) {
    // 60-second buffer
    return Date.now() / 1000 >= expiresAt - 60;
}

// ---------------------------------------------------------------------------
// DB token persistence (via Darwin REST API → user_integrations table)
// Uses call_rest_api for proper CORS handling and auth.
// ---------------------------------------------------------------------------

/**
 * Load stored Strava tokens from Darwin DB.
 * Returns null gracefully on any failure (CORS, 404, network error).
 * @param {string} darwinUri
 * @param {string} idToken
 * @param {function} callApi - call_rest_api function
 * @returns {Promise<Object|null>} Token record or null if not connected
 */
export async function loadTokensFromDb(darwinUri, idToken, callApi) {
    try {
        const result = await callApi(
            `${darwinUri}/user_integrations?provider=strava`, 'GET', null, idToken
        );
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!row) return null;
        return {
            id: row.id,
            access_token: row.access_token,
            refresh_token: row.refresh_token,
            expires_at: row.expires_at,
            athlete: row.athlete_data,
        };
    } catch {
        // 404 (empty table), CORS error, network error — all mean "not connected"
        return null;
    }
}

/**
 * Save Strava tokens to Darwin DB (initial connect).
 */
export async function saveTokensToDb(darwinUri, idToken, callApi, tokens) {
    const body = {
        provider: 'strava',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        athlete_data: JSON.stringify(tokens.athlete || null),
    };
    await callApi(`${darwinUri}/user_integrations`, 'POST', body, idToken);
}

/**
 * Update Strava tokens in Darwin DB (after refresh).
 */
export async function updateTokensInDb(darwinUri, idToken, callApi, recordId, tokens) {
    const body = [{
        id: recordId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
    }];
    await callApi(`${darwinUri}/user_integrations`, 'PUT', body, idToken);
}

/**
 * Delete Strava tokens from Darwin DB (disconnect).
 */
export async function deleteTokensFromDb(darwinUri, idToken, callApi, recordId) {
    await callApi(`${darwinUri}/user_integrations`, 'DELETE', { id: recordId }, idToken);
}

// ---------------------------------------------------------------------------
// High-level token accessor — ensures a valid access token
// ---------------------------------------------------------------------------

/**
 * Get a valid Strava access token, refreshing if expired.
 * Updates both localStorage cache and DB on refresh.
 * @param {Object} stored - Current token state { id, access_token, refresh_token, expires_at, athlete }
 * @param {string} darwinUri
 * @param {string} idToken
 * @returns {Promise<{ accessToken: string, updatedStored: Object }>}
 */
export async function getValidAccessToken(stored, darwinUri, idToken, callApi) {
    if (!isTokenExpired(stored.expires_at)) {
        return { accessToken: stored.access_token, updatedStored: stored };
    }
    // Refresh
    const refreshed = await refreshAccessToken(stored.refresh_token);
    const updatedStored = {
        ...stored,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: refreshed.expires_at,
    };
    cacheTokensLocally(updatedStored);
    if (stored.id && callApi) {
        try {
            await updateTokensInDb(darwinUri, idToken, callApi, stored.id, refreshed);
        } catch {
            // DB update failure is non-fatal — cache is updated
        }
    }
    return { accessToken: refreshed.access_token, updatedStored };
}

// ---------------------------------------------------------------------------
// Strava API calls
// ---------------------------------------------------------------------------

/**
 * Fetch a page of the authenticated athlete's activities.
 * @param {string} accessToken
 * @param {number} page - 1-indexed
 * @param {number} perPage - 25, 50, or 100
 * @param {{ after?: number, before?: number }} [dateFilter] - epoch timestamps
 * @returns {Promise<Array>} Array of SummaryActivity objects
 */
export async function fetchActivities(accessToken, page = 1, perPage = 25, dateFilter = {}) {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (dateFilter.after) params.set('after', String(dateFilter.after));
    if (dateFilter.before) params.set('before', String(dateFilter.before));
    const res = await fetch(`${STRAVA_CONFIG.apiBase}/athlete/activities?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Strava API error (${res.status})`);
    return res.json();
}

/**
 * Fetch detailed activity data (includes description for notes mapping).
 * @param {string} accessToken
 * @param {number} activityId
 * @returns {Promise<Object>} DetailedActivity object
 */
export async function fetchActivityDetail(accessToken, activityId) {
    const res = await fetch(`${STRAVA_CONFIG.apiBase}/activities/${activityId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Strava API error (${res.status})`);
    return res.json();
}

/**
 * Fetch GPS streams for an activity.
 * @param {string} accessToken
 * @param {number} activityId
 * @returns {Promise<Object>} Keyed stream data { latlng, altitude, time }
 */
export async function fetchStreams(accessToken, activityId) {
    const keys = 'latlng,altitude,time';
    const res = await fetch(
        `${STRAVA_CONFIG.apiBase}/activities/${activityId}/streams?keys=${keys}&key_by_type=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Strava streams error (${res.status})`);
    return res.json();
}
