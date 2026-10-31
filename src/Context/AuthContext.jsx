// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { useCookies } from 'react-cookie';
import { refreshTokens as refreshTokensApi, parseIdToken } from '../services/tokenService';
import call_rest_api, { setAuthToken } from '../RestApi/RestApi';
import { PROXY_AUTH } from '../config/product';
import { DEFAULT_DARWIN_URI } from './AppContext';

const AuthContext = createContext({});

// 90 days in seconds
const REFRESH_TOKEN_MAX_AGE = 90 * 24 * 3600;

// Context Provider for Authorization, Login and Profiles — `cognito` auth mode
// (darwin.one). Tokens live in memory (React state). The refresh token cookie
// enables silent re-authentication on page reload.
const CognitoAuthContextProvider = ({ children }) => {

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
    const loginWithTokens = useCallback(async (tokens, darwinUri, darwinOpsUri) => {
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

        // Validate ID token via Lambda-JWT. The /jwt route is an operational
        // endpoint provisioned only under `…/darwin` (req #2697 — like the swarm
        // ops tables); `…/darwin_dev/jwt` returns 403. Use the ops URI so dev-mode
        // login (darwinUri = darwin_dev) works. No-op in production where
        // darwinOpsUri === darwinUri === `…/darwin`. Falls back to darwinUri if a
        // caller predates the ops-uri argument.
        const jwtUri = `${darwinOpsUri || darwinUri}/jwt`;
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

// ── req #4076: `proxy` auth mode (the internal product) ─────────────────────
// The server authenticates: nginx challenges the browser and passes the
// authenticated user to the API, which maps it to a `profiles` row. So there is
// no login screen, no token and no logout here — the app asks the API who it is
// once, by reading `profiles`: Lambda-Rest scopes that table to the caller's own
// row (PROFILE_TABLE, `id = <sub>`), so an unfiltered GET IS "who am I".
//
// `idToken` carries PROXY_SESSION once the server has named a user. It is not a
// credential and is never sent (RestApi sends no Authorization header in proxy
// mode); it exists because ~100 components gate on `!!idToken` as "signed in",
// and keeping that one signal is a smaller change than teaching each a second.
export const PROXY_SESSION = 'proxy-session';

// The `profile` shape cognito mode builds from the ID token, from the row
// alone: `profiles.id` IS the user's sub, which is also what darwin.one's
// Cognito username is (LoginPage fetches `profiles?id=<username>`).
export function proxyProfile(row) {
    if (!row?.id) return null;
    return { ...row, userName: row.id, sub: row.id };
}

const ProxyAuthContextProvider = ({ children }) => {
    const [profile, setProfile] = useState(null);
    const [idToken, setIdToken] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    // Why the server did not name a user (HTTP status), for AuthenticatedRoute.
    const [authError, setAuthError] = useState(null);

    useEffect(() => {
        let live = true;
        (async () => {
            // call_rest_api THROWS `{data, httpStatus}` on any status outside
            // 2xx (403 = the server mapped this login to no profile); a throw
            // left unhandled would leave authLoading true and the app spinning.
            let result;
            try {
                result = await call_rest_api(`${DEFAULT_DARWIN_URI}/profiles`, 'GET', '');
            } catch (err) {
                result = err;
            }
            if (!live) return;
            const status = result?.httpStatus?.httpStatus;
            const me = status === 200 && Array.isArray(result.data) ? proxyProfile(result.data[0]) : null;
            if (me) {
                setProfile(me);
                setIdToken(PROXY_SESSION);
            } else {
                setAuthError(status ?? 'unknown');
            }
            setAuthLoading(false);
        })();
        return () => { live = false; };
    }, []);

    const noop = useCallback(() => {}, []);
    return (
        <AuthContext.Provider value={{
            idToken, setIdToken,
            accessToken: null, setAccessToken: noop,
            profile, setProfile,
            authLoading,
            authError,
            scheduleRefresh: noop,
            loginWithTokens: noop,
            logout: noop,
        }} >
            {children}
        </AuthContext.Provider>
    );
};

// Chosen at BUILD time (PROXY_AUTH is a folded constant), so the bundle carries
// only one provider — the internal build ships no Cognito token code.
export const AuthContextProvider = PROXY_AUTH ? ProxyAuthContextProvider : CognitoAuthContextProvider;

export default AuthContext;
