// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { useCookies } from 'react-cookie';
import { refreshTokens as refreshTokensApi, parseIdToken } from '../services/authService';

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
                setProfile(parseIdToken(tokens.idToken));
                scheduleRefresh(tokens.expiresIn);
            } catch (e) {
                console.log('Background token refresh failed:', e.message);
                // Tokens expired — user will be redirected to login on next navigation
                setIdToken(null);
                setAccessToken(null);
                setProfile(null);
            }
        }, refreshMs);
    }, []);

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
                    setProfile(parseIdToken(tokens.idToken));
                    scheduleRefresh(tokens.expiresIn);
                    setAuthLoading(false);
                    return;
                } catch (e) {
                    console.log('Silent refresh failed:', e.message);
                }
            }
            // Fallback: read legacy cookies (supports E2E tests and transition period)
            if (cookies?.idToken && cookies?.profile) {
                setIdToken(cookies.idToken);
                setAccessToken(cookies.accessToken);
                setProfile(cookies.profile);
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
