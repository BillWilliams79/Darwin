import { createContext, useState } from 'react';

const AppContext = createContext({});

export const AppProvider = ({ children }) => {
    const [idToken, setIdToken] = useState('')
    const [accessToken, setAccessToken] = useState('')
    const [code, setCode] = useState('')
    const [csrfToken, setCsrfToken] = useState('')

    const [profile, setProfile] = useState({})

    console.log('state is being reset to default')

    return (
        <AppContext.Provider value={{
            idToken, setIdToken,
            accessToken, setAccessToken,
            code, setCode,
            csrfToken, setCsrfToken,
            profile, setProfile,
        }} >
            {children}
        </AppContext.Provider>
    )
}

export default AppContext;
