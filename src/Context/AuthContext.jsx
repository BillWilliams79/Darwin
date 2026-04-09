// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { useCookies } from 'react-cookie';
import { refreshTokens as refreshTokensApi, parseIdToken } from '../services/authService';
import call_rest_api, { setAuthToken } from '../RestApi/RestApi';

const AuthContext = createContext({});

// 90 days in seconds
const REFRESH_TOKEN_MAX_AGE = 90 * 24 * 3600;

// Context Provider for Authorization, Login and Profiles.
// Tokens live in memory (React state). The refresh token cookie
// enables silent re-authentication on page reload.
export const AuthContextProvider = ({ children }) => {

    const [cookies, setCookie, removeCookie] = useCookies(['refreshToken', 'idToken', 'accessToken', 'profile']);

    const [idToken, setIdToken] = useState(null);
    const [accessToken, setAccessToken] = useState(null);
    const [profile, setProfile] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const refreshTimerRef = useRef(null);
    const refreshTokenRef = useRef(null);

    // Schedule the next token refresh before expiry.
    // Called after initial login and after each successful refresh.
    // Uses a ref for the refresh token so the timer callback always has the current value.
    const scheduleRefresh = useCallback((expiresInSeconds, refreshToken) => {
        if (refreshToken) refreshTokenRef.current = refreshToken;
        clearTimeout(refreshTimerRef.current);
        // Refresh 5 minutes before expiry
        const refreshMs = Math.max((expiresInSeconds - 300) * 1000, 0);
        refreshTimerRef.current = setTimeout(async () => {
            if (!refreshTokenRef.current) return;
            try {
                const tokens = await refreshTokensApi(refreshTokenRef.current);
                setIdToken(tokens.idToken);
                setAccessToken(tokens.accessToken);
                const jwtProfile = parseIdToken(tokens.idToken);
                const cached = localStorage.getItem('darwin-profile');
                const dbProfile = cached ? JSON.parse(cached) : {};
                setProfile({ ...dbProfile, ...jwtProfile });
                scheduleRefresh(tokens.expiresIn);
            } catch (e) {
                // Tokens expired — user will be redirected to login on next navigation
                setIdToken(null);
                setAccessToken(null);
                setProfile(null);
            }
        }, refreshMs);
    }, []);

    // Keep module-level auth token in sync for TanStack Query hooks
    useEffect(() => {
        setAuthToken(idToken);
    }, [idToken]);

    // On mount, attempt silent refresh using the refresh token cookie.
    // This handles page reload (F5) — tokens are in memory so they're gone,
    // but the refresh token cookie survives and can re-acquire them.
    useEffect(() => {
        async function silentRefresh() {
            // Primary path: use refresh token cookie to silently re-acquire tokens
            const refreshToken = cookies?.refreshToken;
            if (refreshToken) {
                refreshTokenRef.current = refreshToken;
                try {
                    const tokens = await refreshTokensApi(refreshToken);
                    setIdToken(tokens.idToken);
                    setAccessToken(tokens.accessToken);
                    // Merge JWT claims with cached DB profile (preserves timezone, etc.)
                    const jwtProfile = parseIdToken(tokens.idToken);
                    const cached = localStorage.getItem('darwin-profile');
                    const dbProfile = cached ? JSON.parse(cached) : {};
                    setProfile({ ...dbProfile, ...jwtProfile });
                    scheduleRefresh(tokens.expiresIn);
                    setAuthLoading(false);
                    return;
                } catch (e) {
                    // Silent refresh failed — fall through to legacy cookie path
                }
            }
            // Fallback: read legacy cookies (supports E2E tests and transition period)
            if (cookies?.idToken && cookies?.profile) {
                const jwtProfile = parseIdToken(cookies.idToken);   // {id, userName, email, sub}
                setIdToken(cookies.idToken);
                setAccessToken(cookies.accessToken);
                setProfile({ ...cookies.profile, ...jwtProfile });  // JWT claims fill any gaps
            }
            setAuthLoading(false);
        }
        silentRefresh();
        return () => clearTimeout(refreshTimerRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // loginWithTokens — called by LoginPage after SRP auth completes.
    // Mirrors LoggedIn.jsx's post-exchange logic: validates JWT, fetches profile,
    // sets React state, stores refresh token cookie, schedules background refresh.
    // Returns the merged profile so the caller can navigate based on timezone presence.
    const loginWithTokens = useCallback(async (tokens, darwinUri) => {
        // Store refresh token in a Secure cookie for session persistence across reloads
        setCookie('refreshToken', tokens.refreshToken, {
            path: '/',
            maxAge: REFRESH_TOKEN_MAX_AGE,
            secure: true,
            sameSite: 'strict',
        });

        // Set tokens in React state (memory only)
        setIdToken(tokens.idToken);
        setAccessToken(tokens.accessToken);

        // Validate ID token via Lambda-JWT
        const jwtUri = `${darwinUri}/jwt`;
        const jwtResult = await call_rest_api(jwtUri, 'POST', { idToken: tokens.idToken }, tokens.idToken);

        // Fetch user profile from DB
        const profileUri = `${darwinUri}/profiles?id=${jwtResult.data['username']}`;
        const profileResult = await call_rest_api(profileUri, 'GET', '', tokens.idToken);

        let mergedProfile = null;
        if (profileResult.httpStatus.httpStatus === 200) {
            const dbProfile = profileResult.data[0];
            const jwtProfile = parseIdToken(tokens.idToken);
            mergedProfile = { ...dbProfile, ...jwtProfile };
            setProfile(mergedProfile);
            localStorage.setItem('darwin-profile', JSON.stringify(mergedProfile));
        }

        // Schedule background token refresh
        scheduleRefresh(tokens.expiresIn, tokens.refreshToken);

        return mergedProfile;
    }, [setCookie, scheduleRefresh]);

    // logout — called by LogoutPage. Clears cookies, React state, and local storage.
    const logout = useCallback(() => {
        clearTimeout(refreshTimerRef.current);
        refreshTokenRef.current = null;
        removeCookie('refreshToken', { path: '/', secure: true, sameSite: 'strict' });
        // Clear legacy cookies (E2E tests and transition period)
        removeCookie('idToken', { path: '/' });
        removeCookie('accessToken', { path: '/' });
        removeCookie('profile', { path: '/' });
        // Clear working preferences
        localStorage.removeItem('darwin_working_domain');
        localStorage.removeItem('darwin_calendar_view');
        setIdToken(null);
        setAccessToken(null);
        setProfile(null);
    }, [removeCookie]);

    return (
        <AuthContext.Provider value={{
            idToken, setIdToken,
            accessToken, setAccessToken,
            profile, setProfile,
            authLoading,
            scheduleRefresh,
            loginWithTokens,
            logout,
        }} >
            {children}
        </AuthContext.Provider>
    )
}

export default AuthContext;
