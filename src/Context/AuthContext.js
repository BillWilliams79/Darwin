import { createContext, useState } from 'react';

const AuthContext = createContext({});

// Context Provider for Authorization, Login and Profiles
export const AuthContextProvider = ({ children }) => {

    console.count('AuthContext initilialized');

    const [idToken, setIdToken] = useState('')
    const [accessToken, setAccessToken] = useState('')
    const [profile, setProfile] = useState({})

    return (
        <AuthContext.Provider value={{
            idToken, setIdToken,
            accessToken, setAccessToken,
            profile, setProfile,
        }} >
            {children}
        </AuthContext.Provider>
    )
}

export default AuthContext;
