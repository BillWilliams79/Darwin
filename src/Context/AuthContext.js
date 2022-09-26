// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import { createContext, useState, useEffect } from 'react';
import { useCookies } from 'react-cookie';

const AuthContext = createContext({});

// Context Provider for Authorization, Login and Profiles
export const AuthContextProvider = ({ children }) => {

    console.count('AuthContext initilialized');

    const [cookies] = useCookies(['idToken', 'accessToken', 'profile']);

    // Set initial values by directly reading the cookie, this defeats the race condition of
    // reading the values from useEffect. However, keeping useEffect since it conveniently
    // re-sets context when the cookie expires
    //
    const [idToken, setIdToken] = useState(cookies?.idToken)
    const [accessToken, setAccessToken] = useState(cookies?.accessToken)
    const [profile, setProfile] = useState(cookies?.profile)
    const [droidProfile, setDroidProfile] = useState(1);

    useEffect( () => {

        console.count('Auth Context load via useEffect')
        // UseEffect checks and retrieves idToken from cookie. Is called if cookie or state changes.
        // Page level behavior:
        // idToken === '' - didn't evaluate cookie token yet, so display blank/wait spinner
        // idToken === undefined - did evaluate cookie and none available. Page should login/return
        // idToken === some value - attempt to render JSX
        if (idToken !== cookies?.idToken) {
            // avoid needless state changes
            setIdToken(cookies?.idToken);
        }
        if (accessToken !== cookies?.idToken) {
            setAccessToken(cookies?.accessToken);
        }
        if (profile !== cookies?.idToken) {
            setProfile(cookies?.profile);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cookies])

    return (
        <AuthContext.Provider value={{
            idToken, setIdToken,
            accessToken, setAccessToken,
            profile, setProfile,
            droidProfile, setDroidProfile,
        }} >
            {children}
        </AuthContext.Provider>
    )
}

export default AuthContext;
