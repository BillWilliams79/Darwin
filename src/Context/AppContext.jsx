import { createContext, useState } from 'react';

const AppContext = createContext({});

// Resolve the active database name once at module load. Dev mode soft-defaults
// to `darwin_dev` so a fresh worktree without `.env.development.local` never
// silently runs against production; production builds keep the `darwin` default
// untouched. `import.meta.env.DEV` is a Vite build-time constant — production
// bundles tree-shake the dev branch (and these console.warn calls) entirely.
// Req #2683.
const explicitDatabase = import.meta.env.VITE_DARWIN_DATABASE;
const isDev = import.meta.env.DEV;
export const database = explicitDatabase || (isDev ? 'darwin_dev' : 'darwin');

if (isDev) {
    if (!explicitDatabase) {
        // eslint-disable-next-line no-console
        console.warn(
            '[AppContext] VITE_DARWIN_DATABASE unset — defaulting to darwin_dev. ' +
            'Set the variable in Darwin/.env.development.local to override.'
        );
    } else if (explicitDatabase === 'darwin') {
        // eslint-disable-next-line no-console
        console.warn(
            '[AppContext] Dev mode is pointing at the production darwin database. ' +
            'Confirm this is intentional.'
        );
    }
}

// Context provider for general application data, URI and color schemes
export const AppContextProvider = ({ children }) => {

    const [darwinUri, setDarwinUri] = useState(`https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng/${database}`);

    return (
        <AppContext.Provider value={{
            darwinUri, setDarwinUri, database,
        }} >
            {children}
        </AppContext.Provider>
    )
}

export default AppContext;
