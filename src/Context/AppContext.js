import { createContext, useState } from 'react';

const AppContext = createContext({});

// Context provider for general application data, URI and color schemes
export const AppContextProvider = ({ children }) => {

    console.count('AppContext initilialized');

    const [darwinUri, setDarwinUri] = useState('https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/darwin');
    const [droidsUri, setDroidsUri] = useState('https://vcgtjqigra.execute-api.us-west-2.amazonaws.com/proto/sensor_droid');

    return (
        <AppContext.Provider value={{
            darwinUri, setDarwinUri,
            droidsUri, setDroidsUri,
        }} >
            {children}
        </AppContext.Provider>
    )
}

export default AppContext;
