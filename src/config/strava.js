// Strava OAuth 2.0 configuration.
// Client ID and secret from VITE_ env vars (personal app, 1-3 users).
// Redirect URI is the import page — handles ?code= on mount.

export const STRAVA_CONFIG = {
    clientId: import.meta.env.VITE_STRAVA_CLIENT_ID,
    clientSecret: import.meta.env.VITE_STRAVA_CLIENT_SECRET,
    authorizeUrl: 'https://www.strava.com/oauth/authorize',
    tokenUrl: 'https://www.strava.com/oauth/token',
    apiBase: 'https://www.strava.com/api/v3',
    scopes: 'activity:read_all,profile:read_all',
    get redirectUri() {
        return `${window.location.origin}/maps/import`;
    },
};
