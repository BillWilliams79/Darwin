import { createContext, useState } from 'react';

const AppContext = createContext({});

// Context provider for general application data, URI and color schemes
export const AppContextProvider = ({ children }) => {

    console.count('AppContext initilialized');

    const [darwinUri, setDarwinUri] = useState('https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/darwin')

    return (
        <AppContext.Provider value={{
            darwinUri, setDarwinUri,
        }} >
            {children}
        </AppContext.Provider>
    )
}

export default AppContext;
