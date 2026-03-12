// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { useCookies } from 'react-cookie';
import { refreshTokens as refreshTokensApi, parseIdToken } from '../services/authService';
import { setAuthToken } from '../RestApi/RestApi';

const AuthContext = createContext({});

// Context Provider for Authorization, Login and Profiles.
// Tokens live in memory (React state). The refresh token cookie
// enables silent re-authentication on page reload.
export const AuthContextProvider = ({ children }) => {

    console.count('AuthContext initialized');

    const [cookies] = useCookies(['refreshToken', 'idToken', 'accessToken', 'profile']);

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
                const exp = Date.now() + tokens.expiresIn * 1000;
                sessionStorage.setItem('darwin-id-token', tokens.idToken);
                sessionStorage.setItem('darwin-access-token', tokens.accessToken);
                sessionStorage.setItem('darwin-token-expiry', String(exp));
            } catch (e) {
                console.log('Background token refresh failed:', e.message);
                // Tokens expired — user will be redirected to login on next navigation
                setIdToken(null);
                setAccessToken(null);
                setProfile(null);
                sessionStorage.removeItem('darwin-id-token');
                sessionStorage.removeItem('darwin-access-token');
                sessionStorage.removeItem('darwin-token-expiry');
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
            const refreshToken = cookies?.refreshToken;

            // Fast path: serve from sessionStorage cache (skips Cognito round-trip ~1.9s)
            const cachedId = sessionStorage.getItem('darwin-id-token');
            const cachedExpiry = sessionStorage.getItem('darwin-token-expiry');
            const BUFFER_MS = 5 * 60 * 1000;
            if (cachedId && cachedExpiry && Date.now() < parseInt(cachedExpiry) - BUFFER_MS) {
                const cachedAccess = sessionStorage.getItem('darwin-access-token');
                setIdToken(cachedId);
                setAccessToken(cachedAccess);
                const jwtProfile = parseIdToken(cachedId);
                const dbProfile = localStorage.getItem('darwin-profile');
                setProfile({ ...(dbProfile ? JSON.parse(dbProfile) : {}), ...jwtProfile });
                const remainingMs = parseInt(cachedExpiry) - Date.now();
                scheduleRefresh(Math.floor(remainingMs / 1000), refreshToken);
                setAuthLoading(false);
                return;
            }

            // Primary path: use refresh token cookie to silently re-acquire tokens
            if (refreshToken) {
                refreshTokenRef.current = refreshToken;
                try {
                    const tokens = await refreshTokensApi(refreshToken);
                    const absoluteExpiry = Date.now() + tokens.expiresIn * 1000;
                    sessionStorage.setItem('darwin-id-token', tokens.idToken);
                    sessionStorage.setItem('darwin-access-token', tokens.accessToken);
                    sessionStorage.setItem('darwin-token-expiry', String(absoluteExpiry));
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
                    console.log('Silent refresh failed:', e.message);
                    sessionStorage.removeItem('darwin-id-token');
                    sessionStorage.removeItem('darwin-access-token');
                    sessionStorage.removeItem('darwin-token-expiry');
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

    return (
        <AuthContext.Provider value={{
            idToken, setIdToken,
            accessToken, setAccessToken,
            profile, setProfile,
            authLoading,
            scheduleRefresh,
        }} >
            {children}
        </AuthContext.Provider>
    )
}

export default AuthContext;
