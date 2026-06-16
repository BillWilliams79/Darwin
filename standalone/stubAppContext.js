// Standalone stub for ../Context/AppContext (req #2743).
// Aliased in by vite.standalone.js. The BuildVisualizer subtree reads
// `darwinBuildVizUri` from this context (req #2760 dev/prod split — the Build
// Visualizer is pinned to darwin_dev); the value is a placeholder root the
// standaloneApi adapter ignores (it routes by table name, not host).
// `darwinBuildVizUri` MUST be truthy or the data hooks' `enabled` gate stays
// false and nothing seeds.
import { createContext } from 'react';

const AppContext = createContext({
    darwinUri: 'local',
    darwinBuildVizUri: 'local',
    setDarwinUri: () => {},
    database: 'standalone',
    darwinOpsUri: 'local',
});

export const database = 'standalone';
export const AppContextProvider = ({ children }) => children;
export default AppContext;
