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

const API_BASE = 'https://k5j0ftr527.execute-api.us-west-1.amazonaws.com/eng';

// `darwinOpsUri` always points at the production `darwin` schema regardless of
// dev/prod build mode. Operational tables (`dev_servers`, `swarm_sessions`,
// `swarm_starts`, `swarm_start_sessions`) are written by the MCP daemon
// (hard-wired to `DB_NAME=darwin`) and are machine-singleton infrastructure —
// they were never meant to participate in the prod/dev USER-data split that
// `darwinUri` honors. Req #2697.
const DARWIN_OPS_URI = `${API_BASE}/darwin`;

// Context provider for general application data, URI and color schemes
export const AppContextProvider = ({ children }) => {

    const [darwinUri, setDarwinUri] = useState(`${API_BASE}/${database}`);

    return (
        <AppContext.Provider value={{
            darwinUri, setDarwinUri, database,
            darwinOpsUri: DARWIN_OPS_URI,
        }} >
            {children}
        </AppContext.Provider>
    )
}

export default AppContext;
