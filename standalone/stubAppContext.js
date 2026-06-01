// Standalone stub for ../Context/AppContext (req #2743).
// Aliased in by vite.standalone.js. The BuildVisualizer subtree consumes only
// `darwinUri` from this context; the value is a placeholder root the
// standaloneApi adapter ignores (it routes by table name, not host).
import { createContext } from 'react';

const AppContext = createContext({
    darwinUri: 'local',
    setDarwinUri: () => {},
    database: 'standalone',
    darwinOpsUri: 'local',
});

export const database = 'standalone';
export const AppContextProvider = ({ children }) => children;
export default AppContext;
